# Pitfalls Research: Rate Limiting and Message-Run Dependency

**Domain:** Adding rate limiting and message-run dependency to multi-tenant dispatch system
**Researched:** 2026-03-29
**Confidence:** HIGH — drawn from established patterns in distributed systems, MongoDB concurrency patterns, and specific architecture analysis of Time Trigger API

---

## Critical Pitfalls

### Pitfall 1: Global Rate Limiter Instead of Per-Database — Cross-Tenant Throttling

**What goes wrong:**
A single in-memory rate limiter is used for all databases. One client with 100 pending messages consumes the entire global rate limit (e.g., 10 webhooks per cycle), blocking all other clients from having any messages dispatched. High-volume clients starve low-volume clients.

**Why it happens:**
Developers implement rate limiting with a simple counter or token bucket without considering that this is a multi-tenant system. The natural pattern is `rateLimiter.tryAcquire()` at the start of the dispatch loop, which applies globally.

**Consequences:**
- Client A with 10 pending messages gets all 10 dispatched
- Clients B, C, D with 2-3 messages each get 0 dispatched
- Unfair resource allocation across tenants
- Low-volume clients experience unpredictable delays

**How to avoid:**
Implement per-database rate limiting with a `Map<dbName, RateLimiter>` structure. Each database gets its own token bucket or counter, initialized and tracked independently. Rate limit enforcement happens **per database** during `processDatabaseMessages()`.

```typescript
// Per-database limit tracked in a Map
private readonly rateLimiters = new Map<string, { dispatched: number }>();

private async processDatabaseMessages(dbName: string): Promise<void> {
  const limiter = this.rateLimiters.get(dbName) || { dispatched: 0 };
  this.rateLimiters.set(dbName, limiter);

  const limit = this.configService.get<number>('RATE_LIMIT_MESSAGES', 10);

  for (const message of messages) {
    if (limiter.dispatched >= limit) {
      break; // This DB hit its limit, move to next DB
    }
    await this.webhookDispatchService.dispatchMessage(db, message, url);
    limiter.dispatched++;
  }
}

// Reset all counters at start of each cycle
async runMessagesCycle(): Promise<void> {
  this.rateLimiters.clear(); // Fresh limits per cycle
  // ... rest of cycle logic
}
```

**Warning signs:**
- High-volume client logs show many dispatches per cycle
- Low-volume client logs show zero dispatches for multiple cycles
- Total dispatches per cycle equal the configured limit, regardless of database count
- "Rate limit reached" logs appear immediately at cycle start, not gradually

**Detection:**
Add per-database dispatch counters to cycle completion logs. If distribution is heavily skewed (one DB always at limit, others at zero), global rate limiting is occurring.

**Phase to address:**
Rate limiting implementation phase — design the limiter structure before writing any enforcement logic.

---

### Pitfall 2: Message-Run Dependency Race Condition — Dispatch While Check Is In-Flight

**What goes wrong:**
A run checks for pending messages via `db.messages.find({ botIdentifier: X, chatDataId: Y, messageStatus: 'pending' })`. While the query is in-flight, a message cycle dispatches one of those messages (changing status to `processing`). The run's check completes with stale results, sees messages as still pending, and blocks itself — even though the message is already being processed and will clear soon.

**Why it happens:**
MongoDB queries are not isolated from concurrent updates unless explicit transactions or snapshot reads are used. The check-then-decide pattern has a time window where state changes between the read and the decision.

**Consequences:**
- Runs block unnecessarily on messages that are already dispatched
- False positives in dependency detection delay runs
- If the blocked run waits for "all messages to complete," and one message gets stuck (Pitfall 4), the run waits forever

**How to avoid:**
Either:
1. **Check only `pending` messages** (ignore `processing`) — if a message is processing, assume it will complete soon and don't block the run. Only block if `pending` messages exist.
2. **Use MongoDB snapshot reads** with `readConcern: "snapshot"` for the dependency check, ensuring a consistent view across the messages collection at query time.

Option 1 is simpler and appropriate for this architecture. The dependency should be "don't dispatch runs while messages are still *waiting* to be sent," not "while any message exists in any state."

**Warning signs:**
- Runs with `runStatus: waiting` remain undispatched even though `waitUntil` has passed
- Logs show dependency blocks for runs where all messages were already dispatched
- Runs clear to dispatch immediately after a messages cycle completes

**Detection:**
Log the message query result count when blocking a run. If it frequently shows zero `pending` messages but the run is still blocked, race conditions are occurring.

**Phase to address:**
Message-run dependency implementation phase — define the dependency semantics (what states block) before writing the check logic.

---

### Pitfall 3: Dependency Deadlock via Circular Wait on Same chatDataId

**What goes wrong:**
Two documents in the system create a circular dependency:
- Run A waits for Message M to complete (both have `chatDataId: "123"`)
- Message M gets stuck in `processing` (external webhook timeout, no timeout recovery yet)
- Run A never dispatches because Message M never clears

This isn't a true deadlock (both waiting on each other), but a **dependency stall** where one entity blocks the other indefinitely due to a stuck intermediate state.

**Why it happens:**
The message-run dependency is one-directional (runs check for messages), but there's no bounded wait time. If a message enters `processing` and the external system never marks it complete, the message stays `processing` forever. Without timeout recovery (Pitfall 4's solution), the run is permanently blocked.

**Consequences:**
- Runs wait indefinitely for stuck messages
- Silent data loss — runs are never dispatched
- No alerting or visibility into the stall condition
- As more messages get stuck, more runs become blocked

**How to avoid:**
Implement both:
1. **Timeout recovery for stuck messages** (see Pitfall 4) — messages in `processing` for >10 minutes return to `pending`
2. **Bounded dependency check** — runs check for `pending` messages only, not `processing`; or add a timestamp check: "block only if message has been pending for <5 minutes, else assume stuck and proceed"

Option 1 is essential. Option 2 provides defense-in-depth.

**Warning signs:**
- Runs remain in `waiting` state for hours despite `waitUntil` in the past
- Messages collection shows documents with `messageStatus: processing` and old timestamps
- Specific `chatDataId` values consistently block runs across multiple cycles
- Webhook logs show dispatch attempts but no completion callbacks

**Detection:**
Monitor the age of runs in `waiting` state with `waitUntil` in the past. If any exceed a threshold (e.g., 30 minutes), investigate for stuck dependencies.

**Phase to address:**
Message-run dependency phase — design recovery mechanisms before implementing the dependency check. Timeout recovery must ship alongside dependency enforcement.

---

### Pitfall 4: No Timeout Recovery for Stuck Messages — Permanent `processing` State

**What goes wrong:**
Messages are marked `processing` after successful webhook dispatch (per v1.3 behavior). If:
- The external webhook endpoint crashes mid-processing
- The network connection drops during the webhook POST
- The external system marks the message as complete but the callback fails to reach MongoDB

...the message remains in `processing` forever. It is invisible to the dispatch query (`messageStatus: pending`) and never re-dispatched.

**Why it happens:**
The current architecture marks `processing` on successful POST but has no mechanism to detect "processing took too long." The external system is expected to update the message status, but there's no timeout enforced.

**Consequences:**
- Messages stuck in `processing` accumulate over time
- Client chats stall — users never receive expected messages
- Run dispatch is blocked (via Pitfall 3) on stuck messages
- Silent data loss with no visibility

**How to avoid:**
Add a recovery mechanism at the start of each messages cycle:

```typescript
async runMessagesCycle(): Promise<void> {
  // RECOVERY: reset stuck messages before dispatch
  const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);

  for (const dbName of databases) {
    const db = this.mongoService.db(dbName);

    const result = await db.collection('messages').updateMany(
      {
        messageStatus: 'processing',
        updatedAt: { $lt: tenMinutesAgo }  // Requires updatedAt timestamp!
      },
      {
        $set: { messageStatus: 'pending' }
      }
    );

    if (result.modifiedCount > 0) {
      this.logger.warn(
        `[${dbName}] Reset ${result.modifiedCount} stuck messages (processing >10 min)`
      );
    }
  }

  // ... normal dispatch logic
}
```

**CRITICAL:** This requires `updatedAt` timestamp on the `$set` operation when marking `processing`. Modify `dispatchMessage()` to include:

```typescript
{ $set: { messageStatus: 'processing', updatedAt: new Date() } }
```

Without `updatedAt`, you cannot detect stuck messages.

**Warning signs:**
- `db.messages.countDocuments({ messageStatus: 'processing' })` grows over time without bounds
- Client reports messages "sent" but never delivered
- No "processing → complete" state transitions in logs
- Runs blocked on messages for extended periods (>10 minutes)

**Detection:**
Add metrics: count of messages per state per database at cycle completion. Alert if `processing` count exceeds a threshold or grows monotonically.

**Phase to address:**
Timeout recovery phase — implement before enabling message-run dependency (Pitfall 3 mitigation depends on this).

---

### Pitfall 5: Rate Limit Per Dispatch Type Applied Globally Instead of Independently

**What goes wrong:**
A single shared rate limit applies across all three dispatch types (runs, FUP, messages). The configurable limit is "10 webhooks per cycle," and it counts runs + FUP + messages together. If 8 runs are dispatched, only 2 messages can be dispatched in the same cycle period — even though they run on independent `setInterval` schedules.

**Why it happens:**
Developers use a single `dispatchedCount` variable checked in all three dispatch methods, or a shared token bucket. The requirement says "10 webhooks per dispatch type" but the implementation applies it globally.

**Consequences:**
- High-volume runs dispatch starves messages dispatch
- Rate limiting becomes unpredictable based on which cycle fires first
- The benefit of independent cron intervals (v1.4) is negated — dispatch types still interfere with each other

**How to avoid:**
Implement **three separate rate limiters** — one per dispatch type. Each tracks its own limit independently:

```typescript
private readonly runLimiters = new Map<string, { dispatched: number }>();
private readonly fupLimiters = new Map<string, { dispatched: number }>();
private readonly messageLimiters = new Map<string, { dispatched: number }>();

async runRunsCycle(): Promise<void> {
  this.runLimiters.clear(); // Reset run limits
  const limit = this.configService.get<number>('RATE_LIMIT_RUNS', 10);
  // ... enforce limit using this.runLimiters
}

async runMessagesCycle(): Promise<void> {
  this.messageLimiters.clear(); // Reset message limits (independent!)
  const limit = this.configService.get<number>('RATE_LIMIT_MESSAGES', 10);
  // ... enforce limit using this.messageLimiters
}
```

Each cycle resets its own limiter at the start, enforcing limits independently.

**Warning signs:**
- Messages dispatch count drops to zero when runs cycle fires at the same time
- Total webhook count per minute (across all types) never exceeds the configured limit, even with 3 independent intervals
- Logs show "rate limit reached" in one dispatch type immediately after another type dispatches

**Detection:**
Log dispatch counts per type per cycle. If the sum of all three types exactly equals the configured limit, global limiting is occurring.

**Phase to address:**
Rate limiting implementation phase — design separate limiters before enforcement logic is written.

---

### Pitfall 6: Message-Run Dependency Check Missing `botIdentifier` Filter — Cross-Bot Blocking

**What goes wrong:**
The dependency check queries:
```typescript
db.collection('messages').find({ chatDataId: '123', messageStatus: 'pending' })
```

A run for `botIdentifier: "bot-A"` checks for messages with `chatDataId: "123"`. But the query doesn't filter by `botIdentifier`. If `botIdentifier: "bot-B"` has a message with the same `chatDataId: "123"`, the run for bot-A blocks unnecessarily.

This is especially problematic if `chatDataId` is a common identifier (e.g., a numeric user ID) that repeats across different bots in the same database.

**Why it happens:**
Developers assume `chatDataId` is globally unique within a database, but it's only unique within a `botIdentifier` scope. The schema design allows multiple bots to operate in the same MongoDB database.

**Consequences:**
- Runs for one bot blocked by messages for a different bot
- False dependencies across isolated bot contexts
- Unpredictable run delays based on unrelated bot activity

**How to avoid:**
Always include `botIdentifier` in the dependency check query:

```typescript
const run = ...; // Document from runs collection
const pendingMessages = await db.collection('messages').find({
  botIdentifier: run.botIdentifier,
  chatDataId: run.chatDataId,
  messageStatus: 'pending'
}).toArray();

if (pendingMessages.length > 0) {
  // Block this run — messages from the SAME bot are pending
}
```

**Warning signs:**
- Runs remain blocked even when filtering messages by `botIdentifier` shows zero results
- Single `chatDataId` appears in multiple bots' documents in logs
- Dependency blocks occur in databases known to host multiple bots

**Detection:**
Log both `botIdentifier` and `chatDataId` when blocking a run. Manually query MongoDB to verify the pending messages belong to the same bot.

**Phase to address:**
Message-run dependency implementation phase — define the query filter correctly before writing the check logic.

---

### Pitfall 7: Rate Limiting Breaks Atomic findOneAndUpdate Pattern — Lost Updates

**What goes wrong:**
Rate limiting is enforced **before** attempting dispatch:

```typescript
if (limiter.dispatched >= limit) {
  break; // Skip dispatch
}
```

But the dispatch logic uses `findOneAndUpdate` with `{ messageStatus: 'pending' }` as the atomic claim. If the rate limit check passes, but another cycle (or concurrent process) claims the message between the check and the dispatch, the `findOneAndUpdate` returns `null`. The rate limiter still increments `dispatched++`, even though no message was actually dispatched.

Over time, this causes the rate limiter to undercount available capacity — "dispatched 10 messages" but only 7 were actually sent.

**Why it happens:**
Rate limiting operates on **attempted dispatches** rather than **successful dispatches**. The `dispatched++` increment happens before verifying the `findOneAndUpdate` result.

**Consequences:**
- Effective dispatch rate drops below the configured limit
- Underutilized webhook capacity
- Rate limiter state drifts from reality

**How to avoid:**
Increment the rate limiter **only after successful claim**:

```typescript
for (const message of messages) {
  if (limiter.dispatched >= limit) {
    break;
  }

  const wasDispatched = await this.webhookDispatchService.dispatchMessage(
    db,
    message,
    messagesWebhookUrl
  );

  if (wasDispatched) {
    limiter.dispatched++; // Only count successful claims
  }
}
```

Modify `dispatchMessage()` to return `true` if `findOneAndUpdate` returned a document, `false` otherwise.

**Warning signs:**
- Logs show "dispatched X messages" but MongoDB shows fewer than X documents changed status
- Rate limiter reports hitting the limit early in the cycle
- Webhook POST logs count fewer than expected dispatches

**Detection:**
Compare rate limiter counts to actual MongoDB state changes per cycle. If limiter count > actual changes, lost update tracking is occurring.

**Phase to address:**
Rate limiting implementation phase — test atomic claim behavior before shipping enforcement logic.

---

## Moderate Pitfalls

### Pitfall 8: Timeout Recovery Runs on Every Cycle — MongoDB Write Load Spike

**What goes wrong:**
The timeout recovery mechanism (Pitfall 4 solution) runs `updateMany` across all databases at the start of **every** messages cycle. If the cycle fires every 5 seconds, that's 12 `updateMany` operations per minute per database. With 30 databases, that's 360 write queries per minute — even when there are zero stuck messages.

**Why it happens:**
Developers implement recovery as "always check for stuck messages," prioritizing correctness over efficiency. The query is not expensive per se, but the cumulative write load adds up.

**How to avoid:**
Either:
1. **Run recovery less frequently** — only execute `updateMany` every Nth cycle (e.g., every 10 cycles = once per 50 seconds if interval is 5s)
2. **Add a timestamp index** — ensure `{ messageStatus: 1, updatedAt: 1 }` index exists so the query is fast and skips unaffected documents efficiently
3. **Batch recovery separately** — run recovery on a slower, independent interval (e.g., once per minute) rather than in the hot dispatch loop

Option 3 is cleanest for this architecture (already uses independent intervals).

**Warning signs:**
- MongoDB metrics show high write operation count relative to actual dispatches
- `updateMany` appears in slow query logs even with low result counts
- CPU usage on MongoDB nodes correlates with messages cycle frequency

**Prevention:**
Add a fourth independent interval for timeout recovery:

```typescript
// In scheduler.service.ts
const recoveryMs = Number(
  this.configService.get<string>('RECOVERY_INTERVAL', 60_000) // Default 1 min
);
const recoveryId = setInterval(
  () => void this.runDispatchService.runRecoveryCycle(),
  recoveryMs
);
```

**Phase to address:**
Timeout recovery phase — design as a separate concern, not embedded in dispatch logic.

---

### Pitfall 9: Message-Run Dependency Check Scales O(runs × messages) Per Database

**What goes wrong:**
Each run queries the messages collection independently:

```typescript
for (const run of runs) {
  const messages = await db.collection('messages').find({
    botIdentifier: run.botIdentifier,
    chatDataId: run.chatDataId,
    messageStatus: 'pending'
  }).toArray();

  if (messages.length > 0) {
    continue; // Block this run
  }

  await dispatch(run);
}
```

If 50 runs are eligible and each queries messages, that's 50 separate MongoDB round-trips per database per cycle. With 30 databases, that's 1,500 queries per cycle — even if most runs have no messages.

**Why it happens:**
The per-run query pattern is simple and correct, but doesn't consider that most runs will have zero dependencies. The cost is paid upfront for every run.

**How to avoid:**
**Pre-fetch all pending messages** at the start of database processing:

```typescript
// Fetch all pending messages for this database ONCE
const pendingMessagesMap = new Map<string, Document[]>();
const allPendingMessages = await db.collection('messages')
  .find({ messageStatus: 'pending' })
  .toArray();

// Group by (botIdentifier, chatDataId) key
allPendingMessages.forEach(msg => {
  const key = `${msg.botIdentifier}:${msg.chatDataId}`;
  if (!pendingMessagesMap.has(key)) {
    pendingMessagesMap.set(key, []);
  }
  pendingMessagesMap.get(key).push(msg);
});

// Check dependency using in-memory map (O(1) lookup)
for (const run of runs) {
  const key = `${run.botIdentifier}:${run.chatDataId}`;
  if (pendingMessagesMap.has(key)) {
    continue; // Block this run
  }

  await dispatch(run);
}
```

This reduces MongoDB queries from O(runs) to O(1) per database.

**Warning signs:**
- MongoDB query count spikes with the number of eligible runs
- Runs cycle duration grows linearly with run count, even when no messages exist
- MongoDB slow query logs show many small `messages.find()` queries

**Prevention:**
Implement the pre-fetch pattern from the start. Only acceptable to skip this optimization in MVP if run counts are <10 per database.

**Phase to address:**
Message-run dependency phase — design efficient query patterns before implementing the check logic.

---

### Pitfall 10: Rate Limit State Resets Mid-Cycle on Service Restart — Double Dispatch

**What goes wrong:**
Rate limiter state is stored in-memory (`Map<dbName, { dispatched: number }>`). The service restarts mid-cycle after dispatching 5 messages from database A. On restart, the rate limiter reinitializes to zero. The next cycle dispatches another 10 messages from database A — total 15 messages dispatched in the effective same cycle period, exceeding the limit of 10.

**Why it happens:**
In-memory rate limiters have no persistence. Restarts reset state, and the system has no memory of dispatches already performed in the current time window.

**Consequences:**
- Rate limit violations on restarts
- Downstream webhooks receive bursts exceeding expected rate
- If downstream systems enforce strict rate limits, they may block the service

**How to avoid:**
Either:
1. **Accept temporary violations on restart** — document that rate limits are "best effort" and restarts may cause brief overruns. Monitor downstream webhook error rates.
2. **Persist rate limit state in MongoDB** — store `{ dbName, dispatchType, count, windowStartTime }` in a `rate_limits` collection. Read and restore on startup. Adds complexity and latency.

For this architecture, **Option 1 is acceptable** if:
- Restarts are infrequent (normal operation)
- Downstream systems tolerate brief rate spikes
- Limits are soft (throughput management, not hard quotas)

If downstream systems enforce strict rate limits (e.g., external API quotas), use Option 2.

**Warning signs:**
- Webhook endpoints return 429 Too Many Requests after service restarts
- Dispatch counts immediately after restart exceed configured limits
- Downstream system alerts fire on rate violations correlated with restart times

**Prevention:**
Document the behavior in logs:
```typescript
this.logger.warn('Service restarted — rate limit state reset (limits may be exceeded this cycle)');
```

**Phase to address:**
Rate limiting implementation phase — decide persistence strategy before implementation. If skipping persistence, document the tradeoff.

---

## Integration Pitfalls

### Pitfall 11: Message `updatedAt` Timestamp Missing — Cannot Detect Stuck Messages

**What goes wrong:**
The timeout recovery mechanism (Pitfall 4 solution) queries:

```typescript
{ messageStatus: 'processing', updatedAt: { $lt: tenMinutesAgo } }
```

But the `messages` collection schema has no `updatedAt` field. The query returns zero results even when messages have been stuck for hours, because `updatedAt` doesn't exist.

**Why it happens:**
The current implementation (v1.3) sets `messageStatus: 'processing'` but doesn't add a timestamp:

```typescript
// Current code (webhook-dispatch.service.ts:91-94)
{ $set: { messageStatus: 'processing' } }
```

No timestamp → no way to detect "how long in processing."

**How to avoid:**
Modify `dispatchMessage()` to set a timestamp:

```typescript
{ $set: { messageStatus: 'processing', statusUpdatedAt: new Date() } }
```

Use a dedicated `statusUpdatedAt` field (not `updatedAt`) to avoid conflicts with other systems that might manage `updatedAt`.

Then query:
```typescript
{ messageStatus: 'processing', statusUpdatedAt: { $lt: tenMinutesAgo } }
```

**Warning signs:**
- Timeout recovery logs show zero stuck messages found, but manual queries show old `processing` messages exist
- MongoDB query returns empty results even with messages in `processing` for hours
- `updatedAt` field is missing in `messages` collection documents

**Prevention:**
Add the timestamp field in the same commit that implements timeout recovery. Test by manually setting old timestamps and verifying recovery works.

**Phase to address:**
Timeout recovery phase — implement alongside the recovery mechanism, not as a later addition.

---

### Pitfall 12: Runs Collection Missing Compound Index on (botIdentifier, chatDataId, runStatus)

**What goes wrong:**
The message-run dependency check queries:

```typescript
db.collection('runs').find({
  botIdentifier: 'bot-A',
  chatDataId: '123',
  runStatus: 'waiting'
}).toArray();
```

But the `runs` collection only has an index on `{ runStatus: 1, waitUntil: 1 }` (from v1.0). The query does a collection scan filtered by `botIdentifier` and `chatDataId`, becoming slow as the `runs` collection grows.

**Why it happens:**
Indexes are optimized for the primary query pattern (finding waiting runs). The new dependency check introduces a different query pattern (find runs by bot+chat), and the existing index doesn't cover it.

**Consequences:**
- Dependency check queries become slow (>100ms) on large collections
- Messages cycle duration grows with runs collection size, even if no runs are blocked
- MongoDB CPU usage spikes during dependency checks

**How to avoid:**
Add a compound index:

```typescript
db.collection('runs').createIndex({
  botIdentifier: 1,
  chatDataId: 1,
  runStatus: 1
});
```

This supports efficient lookups for the dependency check. The existing `{ runStatus: 1, waitUntil: 1 }` index still covers the primary dispatch query.

**Warning signs:**
- MongoDB slow query logs show `runs.find()` with `botIdentifier` and `chatDataId` filters
- `explain()` output shows `COLLSCAN` or `IXSCAN` with high `docsExamined` count
- Dependency check duration grows as `runs` collection size increases

**Prevention:**
Create the index before enabling message-run dependency. Document in migration guide.

**Phase to address:**
Message-run dependency phase — index creation is part of the feature implementation, not a performance optimization.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| In-memory rate limiter (no persistence) | Simple implementation | Rate limit violations on service restart | Acceptable if restarts are rare and downstream tolerates brief spikes |
| Sequential dependency checks (O(runs) queries) | Straightforward logic | Slow at scale (>50 runs/DB) | MVP only — migrate to pre-fetch before 20+ runs/DB |
| Timeout recovery in dispatch loop | Single responsibility | High write load (12 updateMany/min/DB) | Never — use separate interval |
| No alerting on stuck messages | No infra needed | Silent data loss, no visibility | Never in production — add monitoring from day one |
| Dependency blocks on `processing` messages | Conservative safety | Unnecessary run delays | Acceptable if timeout recovery is fast (<30s) |
| Hard-coded 10-minute timeout threshold | No config needed | Inflexible for different message types | Acceptable for MVP — extract to env var later |

---

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation Strategy |
|-------------|---------------|---------------------|
| Rate limiting implementation | Global limiter instead of per-database (Pitfall 1) | Design `Map<dbName, limiter>` structure first; test with multiple databases |
| Rate limiting implementation | Limiter counts attempts, not successes (Pitfall 7) | Increment counter AFTER `findOneAndUpdate` succeeds |
| Rate limiting implementation | Single limit across all dispatch types (Pitfall 5) | Create three separate limiters (runs, FUP, messages) |
| Message-run dependency | Race condition during dependency check (Pitfall 2) | Check only `pending` messages, ignore `processing` |
| Message-run dependency | Missing `botIdentifier` filter (Pitfall 6) | Always filter by `botIdentifier` AND `chatDataId` |
| Message-run dependency | O(runs × messages) query cost (Pitfall 9) | Pre-fetch all pending messages once, use in-memory map |
| Message-run dependency | Missing compound index (Pitfall 12) | Create index on (botIdentifier, chatDataId, runStatus) before deployment |
| Timeout recovery | No timestamp on status change (Pitfall 11) | Add `statusUpdatedAt` field when setting `messageStatus: processing` |
| Timeout recovery | Recovery runs every cycle (Pitfall 8) | Use separate interval (1 min) for recovery, not in dispatch loop |
| Timeout recovery | Stuck messages block runs forever (Pitfall 3) | Ship timeout recovery BEFORE enabling dependency checks |

---

## "Looks Done But Isn't" Checklist

- [ ] **Per-database rate limiting:** Verify limiter is `Map<dbName, ...>` not a single global counter
- [ ] **Independent dispatch type limits:** Verify three separate limiters exist (runs, FUP, messages)
- [ ] **Rate limiter counts successes:** Verify `dispatched++` only after `findOneAndUpdate` returns non-null
- [ ] **Dependency filters by botIdentifier:** Verify query includes both `botIdentifier` AND `chatDataId`
- [ ] **Dependency checks pending only:** Verify `messageStatus: 'pending'` in query (not `processing`)
- [ ] **Timeout recovery has timestamp:** Verify `statusUpdatedAt` is set when marking `processing`
- [ ] **Timeout recovery on separate interval:** Verify recovery is not in dispatch loop, has own `setInterval`
- [ ] **Pre-fetch messages pattern:** Verify O(1) lookup per run, not O(runs) separate queries
- [ ] **Compound index exists:** Verify `runs` collection has index on (botIdentifier, chatDataId, runStatus)
- [ ] **Stuck message alerting:** Verify monitoring exists for messages in `processing` >10 min
- [ ] **Rate limit reset per cycle:** Verify limiters call `.clear()` at start of each cycle
- [ ] **Timeout threshold is configurable:** Verify 10-minute timeout reads from env var (or document hard-coded)

---

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Cross-tenant rate limit starvation | LOW | Identify affected databases from logs; deploy per-database limiter; backfill missed dispatches if needed |
| Runs blocked on stuck messages | MEDIUM | Run manual timeout recovery query (`updateMany` processing → pending); deploy timeout recovery mechanism; monitor for recurrence |
| Messages stuck in `processing` | LOW | Same as above — manual query resets state; add `statusUpdatedAt` field; deploy recovery |
| Missing `botIdentifier` filter in dependency | LOW | Deploy fix; no data corruption, just unnecessary blocking — runs will dispatch after fix |
| Rate limiter counts lost updates | LOW | No data loss, just underutilized capacity; deploy counter fix; monitor dispatch rates return to expected |
| O(runs) dependency queries causing slowdown | MEDIUM | Add compound index; deploy pre-fetch pattern; monitor query performance improves |
| Timeout recovery causing write load | LOW | Move recovery to separate interval; reduce frequency; no data loss, just reduced load |

---

## Verification Matrix

| Pitfall | Automated Test | Integration Test | Production Verification |
|---------|---------------|------------------|------------------------|
| Per-database rate limiting | Unit test with mock databases, verify independent counters | Load test 3 DBs with different message volumes, verify fair distribution | Monitor dispatch counts per DB per cycle, alert on skew |
| Message-run dependency race | Unit test with mock `find()` returning stale data, verify blocks/unblocks correctly | Concurrent test: dispatch message while checking dependency, verify no false blocks | Log dependency blocks with message IDs, manually verify messages were actually pending |
| Stuck message timeout recovery | Unit test with old timestamps, verify `updateMany` query | Create test message with old `statusUpdatedAt`, run recovery, verify reset to pending | Monitor count of messages in `processing` >10 min, alert if >0 |
| Rate limiter counts successes | Unit test with `findOneAndUpdate` returning null, verify counter unchanged | Run two cycles concurrently targeting same message, verify count == 1 | Compare rate limiter logs to MongoDB `updateOne` counts per cycle |
| Dependency filters by botIdentifier | Unit test with messages from different bots, verify no cross-bot blocking | Run test with 2 bots, same chatDataId, verify bot A not blocked by bot B messages | Log blocked runs with botIdentifier, audit MongoDB for pending messages with same ID |

---

## Sources

- **MongoDB concurrency patterns** — HIGH confidence, based on MongoDB official documentation and `findOneAndUpdate` atomicity guarantees
- **Multi-tenant rate limiting** — HIGH confidence, drawn from established distributed systems patterns (per-tenant resource isolation)
- **Message-run dependency patterns** — HIGH confidence, based on dependency graph cycles and timeout recovery in distributed job systems
- **NestJS service architecture** — HIGH confidence, from analysis of Time Trigger API codebase (scheduler.service.ts, run-dispatch.service.ts, webhook-dispatch.service.ts)
- **MongoDB index optimization** — HIGH confidence, standard query optimization patterns for compound queries
- **Race condition in read-then-update patterns** — HIGH confidence, well-documented concurrency problem in distributed systems

---

*Pitfalls research for: Adding rate limiting and message-run dependency to multi-tenant dispatch system*
*Researched: 2026-03-29*
*Context: Time Trigger API v1.5 milestone*
