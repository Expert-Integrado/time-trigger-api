# Architecture Research: Rate Limiting and Message-Run Dependency

**Domain:** Rate limiting and message-run dependency for cron-based webhook dispatch
**Researched:** 2026-03-29
**Confidence:** HIGH — Integration patterns based on existing architecture; rate limiting and dependency checking are well-established patterns in NestJS/MongoDB systems.

## Executive Summary

This research covers how to integrate **per-database rate limiting** and **message-run dependency checking** into the existing Time Trigger API architecture without disrupting the 3-interval independent dispatch system shipped in v1.4.

**Key findings:**
1. Rate limiting integrates cleanly at the **per-database processing level** (inside `processDatabase*` methods)
2. Message-run dependency requires a **new query service** to check messages before dispatching runs
3. Auto-timeout recovery fits naturally in **runMessagesCycle** as a pre-dispatch cleanup step
4. All features are **additive** — no structural changes to existing services

## Existing Architecture Context

### Current Component Structure

```
SchedulerService (3 independent setIntervals)
    ├── runRunsCycle() → RunDispatchService.runRunsCycle()
    ├── runFupCycle() → RunDispatchService.runFupCycle()
    └── runMessagesCycle() → RunDispatchService.runMessagesCycle()

RunDispatchService
    ├── processDatabaseRuns(dbName)
    │   ├── Read vars (timeTrigger gate)
    │   ├── Read webhooks
    │   ├── Find eligible runs
    │   └── Dispatch via WebhookDispatchService
    ├── processDatabaseFup(dbName)
    └── processDatabaseMessages(dbName)

WebhookDispatchService
    ├── dispatch(db, run, url) → POST + atomic status update
    ├── dispatchFup(db, fup, url)
    └── dispatchMessage(db, message, url)
```

### Current Data Flow

```
CRON tick
    ↓
runRunsCycle()
    ↓
getEligibleDatabases() → [db1, db2, ...]
    ↓
Promise.allSettled(databases.map(processDatabaseRuns))
    ↓
For each database:
    → Read vars/webhooks (fresh)
    → Apply timeTrigger gates
    → Find eligible runs
    → FOR EACH RUN: dispatch()
```

## Integration Architecture

### 1. Rate Limiting Architecture

**Requirement:** Stop after N webhooks per dispatch type per cycle per database (e.g., 10 runs, 10 FUPs, 10 messages).

#### Integration Point

Insert rate limiting **inside each `processDatabase*` method**, immediately after the query but before the dispatch loop.

**Why this location:**
- Per-database isolation (each DB gets own limit counter)
- Per-cycle isolation (counter resets each cycle)
- Per-type isolation (runs, FUP, messages each have own limit)
- No cross-contamination between independent intervals

#### Pattern: Inline Counter with Early Exit

```typescript
private async processDatabaseRuns(dbName: string): Promise<void> {
  const db: Db = this.mongoService.db(dbName);

  // Existing timeTrigger gate logic...

  const runs: Document[] = await db
    .collection('runs')
    .find({ runStatus: 'waiting', waitUntil: { $lte: Date.now() } })
    .toArray();

  // NEW: Rate limiting — process at most N runs per cycle
  const limit = this.configService.get<number>('RATE_LIMIT_RUNS', 10);
  const dispatched = 0;

  for (const run of runs) {
    if (dispatched >= limit) {
      this.logger.log(
        `[${dbName}] Rate limit reached: ${dispatched}/${limit} runs dispatched`
      );
      break;
    }

    await this.webhookDispatchService.dispatch(db, run, webhookUrl);
    dispatched++;
  }
}
```

**Trade-offs:**
- **Pro:** Simple, stateless, no shared state between databases or cycles
- **Pro:** Limit enforced even if MongoDB returns 1000 eligible runs
- **Con:** Does not throttle MongoDB query size (but acceptable — query is fast)

#### Configuration

Add 3 new optional env vars:
```bash
RATE_LIMIT_RUNS=10       # Default 10
RATE_LIMIT_FUP=10        # Default 10
RATE_LIMIT_MESSAGES=10   # Default 10
```

**Why per-type limits:** Different dispatch types have different performance characteristics. Messages have no time gate and may queue aggressively — independent limit prevents message volume from affecting runs.

### 2. Message-Run Dependency Architecture

**Requirement:** Before dispatching a run, check if any messages with same `botIdentifier` + `chatDataId` are still `messageStatus: "processing"`. If yes, skip the run (leave as `waiting`).

#### Integration Point

Insert dependency check **inside `processDatabaseRuns`**, after rate limit check but before individual dispatch.

#### Pattern: Pre-Dispatch Query

```typescript
private async processDatabaseRuns(dbName: string): Promise<void> {
  // ... existing gates and query ...

  for (const run of runs) {
    if (dispatched >= limit) break;

    // NEW: Message-run dependency check
    const hasBlockingMessages = await this.messageCheckService.hasPendingMessages(
      db,
      run.botIdentifier,
      run.chatDataId
    );

    if (hasBlockingMessages) {
      this.logger.debug(
        `[${dbName}] Run ${run._id} blocked by pending messages (botIdentifier=${run.botIdentifier}, chatDataId=${run.chatDataId})`
      );
      continue; // Skip this run, leave as "waiting"
    }

    await this.webhookDispatchService.dispatch(db, run, webhookUrl);
    dispatched++;
  }
}
```

#### New Component: MessageCheckService

**Purpose:** Encapsulate message-related queries to keep RunDispatchService focused on orchestration.

**Responsibility:** Query `messages` collection for blocking conditions.

**Interface:**
```typescript
@Injectable()
export class MessageCheckService {
  async hasPendingMessages(
    db: Db,
    botIdentifier: string,
    chatDataId: string
  ): Promise<boolean> {
    const count = await db.collection('messages').countDocuments({
      botIdentifier,
      chatDataId,
      messageStatus: 'processing',
    });
    return count > 0;
  }
}
```

**Why a separate service:**
- **Testability:** Mock message checks without touching RunDispatchService
- **Reusability:** Other dispatch types may need similar checks later
- **Clarity:** RunDispatchService doesn't need to know MongoDB query syntax for messages

**Trade-offs:**
- **Pro:** Clean separation of concerns
- **Pro:** One query per run (not per cycle) — only runs that pass rate limit incur query cost
- **Con:** Adds latency per run (~5-10ms per query) — acceptable for sub-limit runs

### 3. Auto-Timeout Recovery Architecture

**Requirement:** Messages stuck in `messageStatus: "processing"` for >10 minutes should be reset to `"pending"` so they can be retried.

#### Integration Point

Insert timeout recovery **at the start of `runMessagesCycle`**, before finding eligible messages.

**Why this location:**
- Messages cycle has no time gate (runs 24/7) — cleanup executes frequently
- Cleanup before query ensures timed-out messages are immediately eligible
- Independent of rate limiting (cleanup is not dispatching)

#### Pattern: Pre-Cycle Cleanup

```typescript
async runMessagesCycle(): Promise<void> {
  if (this.isRunningMessages) {
    this.logger.warn('Messages cycle skipped — previous cycle still running');
    return;
  }
  this.isRunningMessages = true;

  try {
    this.logger.log('Messages cycle started');
    const databases = await this.databaseScanService.getEligibleDatabases();

    // NEW: Auto-timeout recovery — run first, before dispatching
    await Promise.allSettled(
      databases.map((dbName) => this.recoverTimedOutMessages(dbName))
    );

    // Existing dispatch logic
    const results = await Promise.allSettled(
      databases.map((dbName) => this.processDatabaseMessages(dbName))
    );

    // ... existing error handling and logging ...
  } finally {
    this.isRunningMessages = false;
  }
}

private async recoverTimedOutMessages(dbName: string): Promise<void> {
  const db: Db = this.mongoService.db(dbName);
  const timeoutMs = this.configService.get<number>(
    'MESSAGE_TIMEOUT_MINUTES',
    10
  ) * 60_000;
  const cutoff = Date.now() - timeoutMs;

  const result = await db.collection('messages').updateMany(
    {
      messageStatus: 'processing',
      processingStartedAt: { $lte: cutoff },
    },
    {
      $set: { messageStatus: 'pending' },
      $unset: { processingStartedAt: 1 },
    }
  );

  if (result.modifiedCount > 0) {
    this.logger.warn(
      `[${dbName}] Recovered ${result.modifiedCount} timed-out messages`
    );
  }
}
```

**Prerequisites:**
- Messages collection must track `processingStartedAt` timestamp (set when status changes to `"processing"`)
- WebhookDispatchService.dispatchMessage must set this timestamp

**Configuration:**
```bash
MESSAGE_TIMEOUT_MINUTES=10  # Default 10 minutes
```

**Trade-offs:**
- **Pro:** Self-healing — stuck messages automatically recover without manual intervention
- **Pro:** Per-cycle execution frequency matches messages interval (5s default)
- **Con:** Requires schema change (add `processingStartedAt` field)

## New Components Summary

| Component | Responsibility | Dependencies | Integration Point |
|-----------|----------------|--------------|-------------------|
| **MessageCheckService** | Query messages collection for blocking conditions | MongoService | Injected into RunDispatchService |
| **Rate limit counter** | Inline logic per dispatch type | ConfigService | Inside each `processDatabase*` method |
| **Timeout recovery** | Reset stuck messages to pending | MongoService, ConfigService | Start of `runMessagesCycle` |

## Modified Components

| Component | What Changes | Why |
|-----------|--------------|-----|
| **RunDispatchService** | Add MessageCheckService injection; add rate limit logic + message dependency check in `processDatabaseRuns`; add timeout recovery call in `runMessagesCycle` | Integration point for all 3 features |
| **WebhookDispatchService.dispatchMessage** | Set `processingStartedAt` timestamp when updating status to "processing" | Required for timeout recovery |
| **ConfigService / validateEnv** | Add optional env vars: `RATE_LIMIT_*`, `MESSAGE_TIMEOUT_MINUTES` | Configuration for new features |

## Data Flow Changes

### Before (v1.4)

```
runRunsCycle()
  → getEligibleDatabases()
  → processDatabaseRuns(dbName)
      → timeTrigger gate
      → find runs (runStatus: waiting, waitUntil <= now)
      → FOR EACH run: dispatch()
```

### After (v1.5)

```
runRunsCycle()
  → getEligibleDatabases()
  → processDatabaseRuns(dbName)
      → timeTrigger gate
      → find runs (runStatus: waiting, waitUntil <= now)
      → FOR EACH run (up to RATE_LIMIT_RUNS):
          → MessageCheckService.hasPendingMessages()?
              → YES: skip run (leave waiting)
              → NO: dispatch()
```

```
runMessagesCycle()
  → getEligibleDatabases()
  → recoverTimedOutMessages(dbName) [NEW — runs first]
      → updateMany: processing + processingStartedAt < cutoff → pending
  → processDatabaseMessages(dbName)
      → find messages (messageStatus: pending)
      → FOR EACH message (up to RATE_LIMIT_MESSAGES):
          → dispatch()
```

## MongoDB Schema Changes

### messages collection

**New field:** `processingStartedAt: number` (timestamp)

**When set:** WebhookDispatchService.dispatchMessage sets it during `findOneAndUpdate` when changing status to "processing"

**When unset:** Timeout recovery clears it when resetting to "pending"

**Query pattern:**
```typescript
// Timeout recovery
db.collection('messages').updateMany(
  {
    messageStatus: 'processing',
    processingStartedAt: { $lte: Date.now() - timeoutMs }
  },
  {
    $set: { messageStatus: 'pending' },
    $unset: { processingStartedAt: 1 }
  }
);
```

**Index recommendation:**
```typescript
db.collection('messages').createIndex(
  { messageStatus: 1, processingStartedAt: 1 },
  { sparse: true }
);
```
Sparse index because `processingStartedAt` only exists on "processing" messages.

## Build Order

Dependency graph for implementation:

```
1. MessageCheckService (new)
   - Pure query service, no dependencies beyond MongoService
   - Test: mock Db, verify query structure

2. Rate limiting logic (inline)
   - Add to each processDatabase* method
   - Test: verify loop breaks at limit

3. Message-run dependency (integration)
   - Inject MessageCheckService into RunDispatchService
   - Add check before dispatch in processDatabaseRuns
   - Test: mock MessageCheckService, verify skip behavior

4. Timeout recovery (integration)
   - Add recoverTimedOutMessages method to RunDispatchService
   - Call at start of runMessagesCycle
   - Modify WebhookDispatchService.dispatchMessage to set timestamp
   - Test: seed stuck messages, verify recovery

5. Configuration (cross-cutting)
   - Add env vars to .env.example
   - Document defaults in README
   - No code changes needed (ConfigService already handles missing vars)
```

**Critical path:** MessageCheckService must exist before message-run dependency can be integrated. Timeout recovery requires timestamp field on messages, so dispatchMessage modification is a prerequisite.

**Suggested implementation order:**
1. **Phase 1:** Rate limiting (simplest, no new services)
2. **Phase 2:** MessageCheckService + message-run dependency
3. **Phase 3:** Timeout recovery (requires schema field)

## Scalability Considerations

| Concern | At 10 DBs | At 100 DBs | Mitigation |
|---------|-----------|------------|------------|
| **Rate limit per cycle** | 10 DBs × 10 runs = 100 dispatches/cycle max | 100 DBs × 10 runs = 1000 dispatches/cycle max | Acceptable — limit prevents unbounded growth |
| **Message dependency queries** | 10 queries per run (up to 100 total) | 100 queries per run (up to 1000 total) | Queries are indexed and fast (~5ms); total cycle time still <10s |
| **Timeout recovery overhead** | 10 updateMany operations per cycle | 100 updateMany operations per cycle | updateMany is efficient (single round-trip); no loops |

**Bottleneck analysis:**
- **First bottleneck:** Message dependency queries add latency proportional to (databases × rate_limit_runs). With 100 DBs and 10 runs each, that's up to 1000 queries per cycle. At 5ms per query, worst case is 5s of serial query time.
- **Fix:** Already mitigated by rate limit — without rate limit, a database with 1000 eligible runs would execute 1000 dependency queries. Rate limit caps this at 10.

**Optimization opportunities (defer until proven necessary):**
1. Batch message checks: query once per database with `$or` array of (botIdentifier, chatDataId) pairs
2. Cache message state per cycle: single query at start of processDatabaseRuns returns all "processing" messages for that DB

**Do NOT prematurely optimize:** Current design is simple, testable, and performs adequately for stated scale (dozens of databases).

## Anti-Patterns to Avoid

### Anti-Pattern 1: Global Rate Limit Across All Databases

**What:** Single shared counter for all databases, e.g., "stop after 100 dispatches total across all DBs".

**Why wrong:** A database with 100 eligible runs would consume the entire global limit, starving all other databases. Defeats the purpose of parallel processing.

**Do this instead:** Per-database limits with local counters (as designed above).

### Anti-Pattern 2: Message Dependency Check at Cycle Start

**What:** Query all messages for all databases at the start of runRunsCycle, build a Set of blocked (botIdentifier, chatDataId) pairs, consult Set before each dispatch.

**Why wrong:** Message status changes during the cycle (external processors mark them "done"). A message that was "processing" at cycle start might be "done" by the time its run is evaluated. Stale data causes unnecessary blocking.

**Do this instead:** Query messages immediately before dispatching each run (as designed above).

### Anti-Pattern 3: Timeout Recovery as Separate Interval

**What:** Add a 4th independent setInterval specifically for timeout recovery.

**Why wrong:** Adds unnecessary complexity (another interval to configure, another isRunning guard). Timeout recovery is cheap (one updateMany per DB) and logically part of the messages cycle.

**Do this instead:** Run timeout recovery at the start of each runMessagesCycle (as designed above).

### Anti-Pattern 4: Rate Limiting via MongoDB Query Limit

**What:** Use `.limit(10)` in the MongoDB find query instead of loop counter.

**Why wrong:** Query limit would prevent seeing runs beyond the first 10, but there's no guarantee those 10 will all pass the message dependency check. If 3 of the first 10 are blocked by messages, only 7 get dispatched, not 10. The rate limit is then non-deterministic.

**Do this instead:** Query all eligible runs (no limit), apply rate limit + dependency checks in the dispatch loop (as designed above).

## Verification Strategy

### Rate Limiting Verification

**Setup:** Seed database with 50 eligible runs, set `RATE_LIMIT_RUNS=10`.

**Expected behavior:**
- Cycle 1: Dispatches 10 runs, leaves 40 as "waiting"
- Cycle 2: Dispatches 10 more, leaves 30 as "waiting"
- ...
- Cycle 5: Dispatches final 10, all runs now "queued"

**Log verification:** Look for "Rate limit reached: 10/10 runs dispatched" in logs.

### Message-Run Dependency Verification

**Setup:** Seed run with botIdentifier="bot1", chatDataId="chat1". Seed message with same identifiers, messageStatus="processing".

**Expected behavior:**
- Run query returns the run (eligible by time)
- Message dependency check returns true (blocking message exists)
- Run is NOT dispatched, remains "waiting"
- Log shows "Run [id] blocked by pending messages"

**After message completes:** Set message to "done", next cycle dispatches the run.

### Timeout Recovery Verification

**Setup:** Seed message with messageStatus="processing", processingStartedAt=(now - 15 minutes).

**Expected behavior:**
- Messages cycle starts
- Timeout recovery executes updateMany
- Message status changes to "pending", processingStartedAt unset
- Log shows "Recovered 1 timed-out messages"
- Message is now eligible for dispatch in same cycle

## Migration Path

### Deployment Strategy

**Zero-downtime safe:** Yes — all features are opt-in via behavior (rate limits default high, message dependency skips runs safely, timeout recovery is idempotent).

**Rollback safe:** Yes — remove env vars, redeploy. No database schema changes required (processingStartedAt is additive, ignored if absent).

**Steps:**
1. Deploy code with rate limiting disabled (set limits very high or omit env vars)
2. Verify existing behavior unchanged (monitor logs)
3. Enable rate limiting (set `RATE_LIMIT_*` env vars)
4. Enable message-run dependency (already active, controlled by message data)
5. Enable timeout recovery (already active if messages have timestamp field)

**Gradual rollout:** Use `TARGET_DATABASES` to test on a single database first, then expand to all.

## Open Questions

**Q: Should rate limits be configurable per database, not just per dispatch type?**

**A:** Out of scope for v1.5. Per-database configuration would require storing limits in the `vars` collection, adding complexity. Global per-type limits are sufficient for stated requirements ("10 webhooks per type per cycle").

**Q: What happens if a message is stuck in "processing" but processingStartedAt is missing?**

**A:** Timeout recovery query won't match it (query requires field to exist). This is acceptable — the field is set by new code, so only new messages have it. Old stuck messages remain stuck until manually fixed. Document this limitation.

**Q: Should message dependency check also consider "pending" messages, not just "processing"?**

**A:** No. "pending" messages haven't been dispatched yet — they don't block runs. Only "processing" messages (actively being handled by external service) are blockers. If we blocked on "pending", runs would never dispatch until all messages are done, defeating the purpose of concurrent dispatch.

## Sources

- Existing codebase analysis: `/root/time-trigger-api/src/dispatch/run-dispatch.service.ts`, `/root/time-trigger-api/src/dispatch/webhook-dispatch.service.ts`, `/root/time-trigger-api/src/scheduler/scheduler.service.ts`
- Project requirements: `/root/time-trigger-api/.planning/PROJECT.md` (v1.5 milestone requirements)
- MongoDB native driver patterns: standard updateMany, countDocuments, indexed queries (HIGH confidence — well-established patterns)
- NestJS dependency injection: service-per-concern pattern (HIGH confidence — framework idiom)

---
*Architecture research for: Rate Limiting and Message-Run Dependency integration*
*Researched: 2026-03-29*
*Confidence: HIGH — all patterns are standard NestJS/MongoDB practices; no speculative techniques*
