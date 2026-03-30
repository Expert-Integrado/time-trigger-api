# Stack Research: v1.5 Rate Limiting and Message-Run Dependency

**Domain:** Adding rate limiting and message-run dependency to existing Time Trigger API
**Researched:** 2026-03-29
**Confidence:** HIGH (all capabilities implementable with existing stack)

---

## Executive Summary

**NO NEW DEPENDENCIES REQUIRED.** All three features (rate limiting, message-run dependency, timeout recovery) can be implemented using the existing NestJS 11 + MongoDB native driver stack.

**Key Finding:** The requested features are application logic patterns, not infrastructure concerns. The MongoDB native driver already provides all necessary query primitives, and NestJS services provide in-memory state management.

---

## Feature Analysis

### 1. Per-Database Rate Limiting

**Requirement:** Limit webhook dispatch to 10 per type per cycle (configurable via env vars)

**Implementation approach:**
- In-memory counter map: `Map<string, number>` per dispatch cycle
- Key format: `${dbName}:${dispatchType}` → count
- Reset at start of each cycle
- Check before dispatch: `if (count >= limit) skip`
- Increment after successful dispatch

**Stack needs:**
- ✅ Already available: TypeScript Map<K,V>
- ✅ Already available: ConfigService for env var reading
- ✅ Already available: Logger for skip warnings

**New env vars needed:**
- `RATE_LIMIT_RUNS` (default: 10)
- `RATE_LIMIT_FUP` (default: 10)
- `RATE_LIMIT_MESSAGES` (default: 10)

**NO external libraries required.**

---

### 2. Message-Run Dependency

**Requirement:** Runs wait for pending messages (same `botIdentifier` + `chatDataId`) to complete before dispatch

**Implementation approach:**
- Before dispatching each run, query messages collection:
  ```typescript
  const pendingMessages = await db.collection('messages').countDocuments({
    botIdentifier: run.botIdentifier,
    chatDataId: run.chatDataId,
    messageStatus: { $in: ['pending', 'processing'] }
  });
  if (pendingMessages > 0) {
    // Skip this run, will retry next cycle
    return;
  }
  ```
- This is a MongoDB query coordination pattern
- Uses existing MongoDB native driver `countDocuments()` method

**Stack needs:**
- ✅ Already available: MongoDB native driver 7.1.1 (`countDocuments`, `$in` operator)
- ✅ Already available: Db collection access via `MongoService`

**NO external libraries required.**

---

### 3. Timeout Recovery for Stuck Messages

**Requirement:** Messages stuck in "processing" for >10 minutes should reset to "pending"

**Implementation approach:**
- At start of messages cycle, run a recovery query:
  ```typescript
  const tenMinutesAgo = Date.now() - 10 * 60 * 1000;
  await db.collection('messages').updateMany(
    {
      messageStatus: 'processing',
      processingStartedAt: { $lte: tenMinutesAgo }
    },
    {
      $set: { messageStatus: 'pending' },
      $unset: { processingStartedAt: '' }
    }
  );
  ```
- Requires adding `processingStartedAt` timestamp field when marking `processing`
- Uses MongoDB native driver's `updateMany` with time-based query

**Stack needs:**
- ✅ Already available: MongoDB native driver 7.1.1 (`updateMany`, timestamp comparison)
- ✅ Already available: JavaScript Date arithmetic

**Schema change needed:**
- Add `processingStartedAt?: number` field to messages when status → `processing`
- This is a code change, not a stack change

**NO external libraries required.**

---

## Recommended Stack (UNCHANGED)

All capabilities use the existing validated stack:

### Core Technologies

| Technology | Version | Purpose | Status |
|------------|---------|---------|--------|
| NestJS | 11.0.1 (installed) | Application framework | ✅ No changes needed |
| TypeScript | 5.7.3 (installed) | Type-safe language | ✅ No changes needed |
| mongodb (native driver) | 7.1.1 (installed) | Multi-database access + query coordination | ✅ Sufficient for all new features |
| Node.js | 22.x (from package.json) | Runtime | ✅ No changes needed |

### Supporting Libraries

| Library | Version | Purpose | Status |
|---------|---------|---------|--------|
| @nestjs/schedule | 6.1.1 (installed) | Cron scheduling | ✅ Already used for 3 independent intervals |
| @nestjs/config | 4.0.3 (installed) | Environment variable loading | ✅ Will read new RATE_LIMIT_* vars |
| @nestjs/platform-express | 11.0.1 (installed) | HTTP server | ✅ No changes needed |

---

## New Environment Variables

Add to `.env` and fail-fast validation:

| Variable | Default | Description |
|----------|---------|-------------|
| `RATE_LIMIT_RUNS` | 10 | Max runs dispatched per database per runs cycle |
| `RATE_LIMIT_FUP` | 10 | Max FUPs dispatched per database per FUP cycle |
| `RATE_LIMIT_MESSAGES` | 10 | Max messages dispatched per database per messages cycle |
| `MESSAGE_TIMEOUT_MINUTES` | 10 | Minutes before "processing" message resets to "pending" |

All should be **optional** with sensible defaults (no breaking change to deployment).

---

## Implementation Patterns

### Pattern 1: Cycle-Scoped Rate Limiter

```typescript
// Inside each cycle method (runRunsCycle, runFupCycle, runMessagesCycle)
class RunDispatchService {
  private readonly rateLimitRuns: number;
  private readonly rateLimitFup: number;
  private readonly rateLimitMessages: number;

  async runRunsCycle(): Promise<void> {
    const dispatchCounts = new Map<string, number>(); // Per-database counter

    for (const dbName of databases) {
      const currentCount = dispatchCounts.get(dbName) ?? 0;
      if (currentCount >= this.rateLimitRuns) {
        this.logger.warn(`[${dbName}] Rate limit reached (${this.rateLimitRuns}), skipping remaining runs`);
        continue;
      }

      // Process runs, increment count after each successful dispatch
      const dispatched = await this.processDatabaseRuns(dbName, this.rateLimitRuns - currentCount);
      dispatchCounts.set(dbName, currentCount + dispatched);
    }
  }
}
```

**Why this works:**
- Counter resets every cycle (garbage collected after cycle completes)
- No persistence needed (rate limit is per-cycle, not global)
- Thread-safe (single-threaded Node.js, no race conditions within cycle)

---

### Pattern 2: Message-Run Dependency Check

```typescript
// Inside processDatabaseRuns, before dispatching each run
async dispatch(db: Db, run: Document, webhookUrl: string): Promise<void> {
  // NEW: Check for pending/processing messages with same botIdentifier + chatDataId
  const blockingMessages = await db.collection('messages').countDocuments({
    botIdentifier: run.botIdentifier,
    chatDataId: run.chatDataId,
    messageStatus: { $in: ['pending', 'processing'] }
  });

  if (blockingMessages > 0) {
    this.logger.debug(
      `[${run._id}] Skipping run — ${blockingMessages} message(s) still processing for chat ${run.chatDataId}`
    );
    return; // Leave runStatus as "waiting", will retry next cycle
  }

  // Existing dispatch logic continues...
  const success = await this.post(webhookUrl, run);
  // ...
}
```

**Why this works:**
- MongoDB query is fast (indexed on `botIdentifier`, `chatDataId`, `messageStatus`)
- `countDocuments()` is more efficient than `find().toArray()` when we only need count
- Non-blocking: If messages exist, run stays "waiting" and retries next cycle
- No deadlock risk: Messages dispatch independently, will eventually complete or timeout

**Index recommendation:**
```javascript
db.messages.createIndex({ botIdentifier: 1, chatDataId: 1, messageStatus: 1 })
```

---

### Pattern 3: Timeout Recovery for Stuck Messages

```typescript
// At start of runMessagesCycle, before processing pending messages
async runMessagesCycle(): Promise<void> {
  if (this.isRunningMessages) return;
  this.isRunningMessages = true;

  try {
    // NEW: Reset stuck messages first
    await this.recoverStuckMessages();

    // Existing cycle logic continues...
    const databases = await this.databaseScanService.getEligibleDatabases();
    // ...
  } finally {
    this.isRunningMessages = false;
  }
}

private async recoverStuckMessages(): Promise<void> {
  const timeoutMs = this.configService.get('MESSAGE_TIMEOUT_MINUTES', 10) * 60 * 1000;
  const cutoffTime = Date.now() - timeoutMs;

  const databases = await this.databaseScanService.getEligibleDatabases();

  for (const dbName of databases) {
    const db = this.mongoService.db(dbName);
    const result = await db.collection('messages').updateMany(
      {
        messageStatus: 'processing',
        processingStartedAt: { $lte: cutoffTime }
      },
      {
        $set: { messageStatus: 'pending' },
        $unset: { processingStartedAt: '' }
      }
    );

    if (result.modifiedCount > 0) {
      this.logger.warn(
        `[${dbName}] Recovered ${result.modifiedCount} stuck message(s) (timeout: ${timeoutMs}ms)`
      );
    }
  }
}
```

**Why this works:**
- Runs at start of each messages cycle (before processing new messages)
- Atomic `updateMany` with timestamp filter ensures no race conditions
- Messages that genuinely complete within 10 minutes are unaffected
- Recovery is automatic — no manual intervention needed

**Schema change needed:**
- Modify `dispatchMessage` to set `processingStartedAt: Date.now()` when status → `processing`
- No migration needed (old messages without this field will never match recovery query)

---

## What NOT to Add

| Library | Why Avoid | Alternative |
|---------|-----------|-------------|
| `@nestjs/throttler` | Designed for HTTP rate limiting (requests per second), not application-level dispatch limits per database | In-memory Map counter pattern |
| `bottleneck` / `p-limit` | Overkill for simple "N per cycle" limit; adds dependency for 10 lines of code | In-memory counter with early return |
| Redis / external state | Rate limit is cycle-scoped (resets every interval), no need for persistence | TypeScript Map (garbage collected after cycle) |
| `@nestjs/bull` / BullMQ | Would require Redis, adds queue infrastructure for what's already a polling loop | Native MongoDB queries + in-memory counters |
| Distributed locking (Redlock, etc.) | Single-instance service (no horizontal scaling needed per PROJECT.md constraints) | MongoDB's atomic `findOneAndUpdate` (already used) |
| `async-mutex` / `p-queue` | Node.js is single-threaded; no race conditions within cycle execution | Native JavaScript Map + sequential processing |

**Key principle:** Keep zero external dependencies for these features. The existing MongoDB driver + NestJS services are sufficient.

---

## Integration Points

### 1. Rate Limiting Integration

**Where:** `RunDispatchService` (all 3 cycle methods)

**Changes:**
- Add `Map<string, number>` at start of each cycle method
- Pass remaining capacity to `processDatabase*` methods
- Increment counter after each successful dispatch
- Early-return from processing when limit reached

**Impact:** Minimal — localized to cycle orchestration logic

---

### 2. Message-Run Dependency Integration

**Where:** `WebhookDispatchService.dispatch()` (runs only)

**Changes:**
- Add `countDocuments` query before webhook POST
- Return early if blocking messages found
- Log skip reason at debug level

**Impact:** Adds one MongoDB query per run dispatch (negligible — typically <1ms with proper index)

---

### 3. Timeout Recovery Integration

**Where:** `RunDispatchService.runMessagesCycle()` (start of cycle)

**Changes:**
- Add `recoverStuckMessages()` private method
- Call it before processing pending messages
- Add `processingStartedAt` field when marking messages as "processing"

**Impact:** Adds one `updateMany` per database per messages cycle (fast — only matches old records)

---

## Testing Strategy

All features testable with existing Jest + @nestjs/testing infrastructure:

### Rate Limiting Tests

```typescript
// Mock ConfigService to return rate limit of 2
// Create 5 mock runs in test database
// Run cycle, verify only 2 dispatched
// Verify logger.warn called for remaining 3
```

### Message-Run Dependency Tests

```typescript
// Insert run with botIdentifier="bot1", chatDataId="chat1"
// Insert message with same botIdentifier + chatDataId, messageStatus="processing"
// Attempt to dispatch run
// Verify run NOT dispatched (still "waiting")
// Update message to "done"
// Attempt dispatch again
// Verify run dispatched successfully (now "queued")
```

### Timeout Recovery Tests

```typescript
// Insert message with messageStatus="processing", processingStartedAt=11 minutes ago
// Run recoverStuckMessages()
// Verify message status reset to "pending", processingStartedAt unset
// Insert message with processingStartedAt=5 minutes ago
// Run recovery again
// Verify message NOT touched (still "processing")
```

**No new test dependencies needed.**

---

## Performance Considerations

### Rate Limiting
- **Memory:** `Map<string, number>` with ~50 databases = ~1KB per cycle (negligible)
- **CPU:** Simple integer increment + comparison per dispatch (sub-microsecond)
- **Latency:** Zero added latency (in-memory operation)

### Message-Run Dependency
- **Query cost:** `countDocuments` with index = ~1ms per run
- **Worst case:** 100 runs/cycle × 1ms = 100ms added to cycle (acceptable)
- **Mitigation:** Create compound index on `(botIdentifier, chatDataId, messageStatus)`

### Timeout Recovery
- **Query cost:** `updateMany` scans only `processing` messages (typically 0-10 per database)
- **Worst case:** 50 databases × 10 stuck messages = 500 updates (MongoDB handles this efficiently in single batch)
- **Latency:** Runs once per messages cycle (5 seconds interval per current config), negligible impact

**No performance issues expected.** All operations are O(N) where N is small (dozens, not thousands).

---

## Deployment Impact

### Breaking Changes
**NONE.** All new features are backwards-compatible:
- Rate limit env vars have defaults (10 for each type)
- Message-run dependency only affects runs (FUP and messages unchanged)
- Timeout recovery gracefully handles old messages without `processingStartedAt`

### Migration Requirements
**NONE.** No schema migrations needed:
- `processingStartedAt` field added on next dispatch (forward-compatible)
- Old messages without this field never match recovery query (safe)

### Rollback Safety
**HIGH.** Can revert to previous version without data corruption:
- Rate limiting is stateless (no persistent state)
- Message-run dependency is query-based (no schema changes)
- Timeout recovery leaves old messages as-is if field missing

---

## Version Compatibility

| Component | Current Version | Changes Needed | Notes |
|-----------|----------------|----------------|-------|
| NestJS | 11.0.1 | None | All patterns use existing DI + lifecycle hooks |
| MongoDB driver | 7.1.1 | None | `countDocuments`, `updateMany` available since v3.x |
| TypeScript | 5.7.3 | None | Map<K,V> and async/await fully supported |
| @nestjs/config | 4.0.3 | None | Will read new env vars via existing ConfigService |
| @nestjs/schedule | 6.1.1 | None | No changes to cron interval logic |

**Zero version upgrades required.**

---

## Confidence Assessment

| Feature | Confidence | Source |
|---------|-----------|--------|
| Rate limiting via Map | HIGH | Standard TypeScript pattern, already used in service (`isRunning` guards) |
| Message-run dependency | HIGH | MongoDB native driver documentation (countDocuments) + existing query patterns in codebase |
| Timeout recovery | HIGH | MongoDB native driver documentation (updateMany) + atomic operations already used for duplicate prevention |
| No new dependencies needed | HIGH | All features implementable with existing stack (verified against current package.json + MongoDB 7.1.1 API) |
| Performance impact | MEDIUM | Based on MongoDB query performance estimates; should validate with indexes in production data |

**Overall confidence: HIGH** — All features are straightforward application logic using well-established MongoDB patterns.

---

## Alternatives Considered

### For Rate Limiting

| Recommended | Alternative | Why Not Alternative |
|-------------|-------------|---------------------|
| In-memory Map counter | `@nestjs/throttler` | Throttler is for HTTP request rate limiting (per IP/user), not application-level dispatch limits per database |
| In-memory Map counter | Token bucket algorithm | Overkill — we need simple "N per cycle" limit, not sophisticated rate smoothing |
| In-memory Map counter | Redis-based counter | Unnecessary persistence — counter resets every cycle by design |

### For Message-Run Dependency

| Recommended | Alternative | Why Not Alternative |
|-------------|-------------|---------------------|
| `countDocuments` query | Load all messages into memory | Wasteful — we only need count, not full documents |
| `countDocuments` query | Separate dependency tracking table | Added complexity for no benefit — messages collection already has all needed data |
| `countDocuments` query | Event-driven coordination | Overkill — simple query on each dispatch is fast enough with index |

### For Timeout Recovery

| Recommended | Alternative | Why Not Alternative |
|-------------|-------------|---------------------|
| `updateMany` with timestamp | External cron job | Unnecessary — messages cycle already runs every 5 seconds, perfect place for recovery |
| `updateMany` with timestamp | TTL index on messages | MongoDB TTL indexes delete documents; we need to reset status, not delete |
| `updateMany` with timestamp | Manual admin intervention | Defeats purpose of automatic recovery |

---

## Sources

- `/root/time-trigger-api/package.json` — Confirmed existing stack versions (HIGH confidence)
- `/root/time-trigger-api/src/dispatch/run-dispatch.service.ts` — Current dispatch patterns and cycle structure (HIGH confidence)
- `/root/time-trigger-api/src/dispatch/webhook-dispatch.service.ts` — Existing atomic update patterns with `findOneAndUpdate` (HIGH confidence)
- MongoDB 7.1.1 native driver documentation — `countDocuments`, `updateMany`, query operators (HIGH confidence — stable API since v3.x)
- TypeScript 5.7.3 Map/Set documentation — In-memory counter patterns (HIGH confidence)
- Training data: NestJS service patterns, MongoDB query coordination (MEDIUM confidence — standard patterns, but no external verification possible)

**No external dependencies researched because none are needed.**

---

*Stack research for: v1.5 Rate Limiting and Message-Run Dependency*
*Researched: 2026-03-29*
*Conclusion: Zero new dependencies required — all features implementable with existing NestJS 11 + MongoDB 7.1.1 stack*
