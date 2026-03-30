# Feature Landscape: Rate Limiting and Message-Run Dependency

**Domain:** Cron-based webhook dispatcher with multi-database monitoring
**Milestone:** v1.5 Rate Limiting and Message-Run Dependency
**Researched:** 2026-03-29
**Confidence:** MEDIUM-HIGH (based on codebase analysis + domain patterns from training data)

## Context

This research focuses on NEW features for an existing Time Trigger API (v1.4) that already handles:
- Multi-database MongoDB monitoring with automatic discovery
- 3 independent dispatch types (runs, FUP, messages) with separate intervals
- Per-client time controls (timeTrigger gates for runs/FUP only)
- Atomic dispatch prevention via findOneAndUpdate
- Single retry on failure with 60s delay
- 746 LOC serving dozens of client databases

The NEW features being added in v1.5:
1. **Rate limiting:** Prevent overwhelming webhook endpoints by limiting dispatches per cycle per database
2. **Message-run dependency:** Prevent runs from dispatching when related messages are still processing
3. **Auto-timeout recovery:** Unstick messages that have been in "processing" state too long

## Table Stakes

Features users expect in these domains. Missing = system feels incomplete or broken.

| Feature | Why Expected | Complexity | Notes | Dependencies |
|---------|--------------|------------|-------|--------------|
| **Per-database rate limit** | Prevents webhook endpoint overload; essential for production stability | Low | Configurable limit (e.g., 10 per cycle) prevents flooding downstream services | None - standalone feature |
| **Global fallback limit** | Safety net when per-database config missing | Low | Single env var applies to all databases without explicit config | Depends on per-database rate limit |
| **Limit per dispatch type** | Runs, FUP, and messages have different priorities and load characteristics | Medium | Each dispatch type needs independent counter; prevents fast messages from consuming runs quota | Depends on per-database rate limit |
| **Soft limit (log + continue)** | Hard stop breaks system reliability; soft limit maintains uptime while alerting | Low | Log warning when limit hit, skip remaining items, continue next cycle | Depends on rate limiting implementation |
| **Run-message dependency check** | Prevents race conditions where run dispatches while related message still processing | Medium | Query messages collection for "processing" status matching botIdentifier + chatDataId | Requires message status tracking (already exists) |
| **Timeout recovery for stuck messages** | Messages stuck in "processing" forever block runs indefinitely; auto-recovery prevents manual intervention | Medium | Background job or pre-dispatch check: if `messageStatus="processing"` AND `processingStartedAt` > threshold, reset to "pending" | Requires tracking `processingStartedAt` timestamp |
| **Configurable timeout threshold** | Different deployments have different processing time expectations | Low | Env var for timeout (default: 10 minutes) | Depends on timeout recovery |
| **Atomic timestamp on status change** | Prevents race conditions in timeout detection | Low | Set `processingStartedAt` in same findOneAndUpdate that changes status to "processing" | Modifies existing dispatchMessage logic |
| **Per-cycle reset of rate counters** | Each cycle starts fresh; limits apply within cycle, not across cycles | Low | Counters live in memory, reset at cycle start | Depends on rate limiting implementation |

## Differentiators

Features that set the implementation apart. Not expected, but valuable.

| Feature | Value Proposition | Complexity | Notes | Dependencies |
|---------|-------------------|------------|-------|--------------|
| **Rate limit metrics in logs** | Visibility into dispatch patterns; helps tune limits | Low | Log "dispatched X/Y limit" at cycle end per database | Depends on rate limiting |
| **Skip vs queue behavior** | Skipped items retry next cycle (existing pattern); no new queue complexity | Low | Aligns with existing "leave as waiting/pending" pattern | None - architectural alignment |
| **Dependency chain visibility** | Log when run skipped due to pending messages; aids debugging | Low | "Run {id} skipped — {N} pending messages for botIdentifier + chatDataId" | Depends on run-message dependency |
| **Graceful degradation on query errors** | If dependency check query fails, dispatch anyway (fail open) vs block forever (fail closed) | Medium | Trade-off: availability vs consistency. Recommendation: fail open with loud warning | Depends on run-message dependency |
| **Timeout recovery dry-run mode** | Preview what would be reset without actually resetting | Medium | Env var `TIMEOUT_RECOVERY_DRY_RUN=true` logs candidates without updating | Depends on timeout recovery |
| **Per-database timeout overrides** | Some clients process faster/slower than others | High | Read timeout from vars collection; falls back to env var default | Depends on timeout recovery + vars schema extension |

## Anti-Features

Features to explicitly NOT build.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| **Per-document rate limiting** | Over-engineered; cycle-level limiting is sufficient; adds O(N) memory overhead | Use per-database, per-dispatch-type limit — simpler, sufficient |
| **Priority queues for rate-limited items** | Adds complexity (queue storage, ordering, persistence); conflicts with "next cycle picks up" pattern | Keep existing pattern: skipped items stay "waiting"/"pending", next cycle processes FIFO |
| **Distributed rate limiting (cross-instance)** | No requirement for multi-instance deployment; premature optimization | Single-instance rate limiting in memory |
| **Adaptive/dynamic rate limits** | Auto-adjusting based on webhook response time — too complex, too opaque | Static configurable limits; operators adjust based on monitoring |
| **Retry escalation for stuck messages** | If message stuck, try harder (more retries, different endpoints) — scope creep | Timeout recovery resets to "pending"; existing retry logic handles it |
| **Message priority/ordering guarantees** | "Process message A before message B" — not in requirements, adds database indexes and sorting complexity | Process messages FIFO as found; dependency check only blocks runs, not message order |
| **Webhook endpoint health checking** | Proactively disable dispatch to failing endpoints — different concern, belongs in separate monitoring system | Rely on existing POST success/failure + retry logic |
| **Rate limit by time window (e.g., per minute)** | Adds timestamp tracking and sliding window logic | Per-cycle limit is simpler and sufficient given fixed cycle intervals |

## Feature Dependencies

```
Rate Limiting Foundation
  ├─> Per-database rate limit (per dispatch type)
  ├─> Global fallback limit
  ├─> Soft limit (log + continue)
  └─> Per-cycle reset

Message-Run Dependency Foundation
  ├─> Atomic timestamp on status change (processingStartedAt)
  ├─> Run-message dependency check (botIdentifier + chatDataId)
  └─> Dependency chain visibility (logs)

Timeout Recovery Foundation
  ├─> Atomic timestamp on status change (processingStartedAt) [SHARED with dependency]
  ├─> Timeout recovery query (messageStatus="processing" AND age > threshold)
  ├─> Configurable timeout threshold
  └─> Reset to "pending" with log
```

**Critical path:** Atomic timestamp MUST be implemented first — both dependency checking and timeout recovery depend on it.

## Expected Behavior Patterns

### Rate Limiting

**Standard pattern (from cron job / batch processing domains):**

1. **Counter per scope:** Each database + dispatch type gets independent counter
2. **Check before dispatch:** Before processing item, check if counter < limit
3. **Increment on success:** Only successful dispatches count toward limit
4. **Soft limit:** When limit hit, log + skip remaining, don't fail entire cycle
5. **Reset per cycle:** Counter resets at start of next cycle

**Example flow:**
```
Cycle starts for db="sdr-4blue"
  runsCounter = 0, fupCounter = 0, messagesCounter = 0
  RATE_LIMIT_RUNS = 10 (from env or default)

  Process runs:
    - Run #1: dispatch success → runsCounter = 1
    - Run #2: dispatch success → runsCounter = 2
    ...
    - Run #10: dispatch success → runsCounter = 10
    - Run #11: runsCounter >= limit → SKIP (log: "Rate limit reached for runs in sdr-4blue")
    - Remaining runs skipped, stay "waiting"

  Process FUP:
    - fupCounter starts at 0 (independent)
    - FUP #1: dispatch success → fupCounter = 1
    ...
```

**Configuration:**
- `RATE_LIMIT_RUNS=10` (env var, default)
- `RATE_LIMIT_FUP=5` (env var, default)
- `RATE_LIMIT_MESSAGES=20` (env var, default)
- Per-database overrides in vars collection (differentiator, not table stakes)

### Message-Run Dependency

**Standard pattern (from task orchestration / workflow domains):**

1. **Identify related messages:** Query messages collection for documents matching:
   - `messageStatus: "processing"`
   - `botIdentifier: <run.botIdentifier>`
   - `chatDataId: <run.chatDataId>`
2. **Block if any found:** If count > 0, skip run, log dependency, leave run as "waiting"
3. **Dispatch if clear:** If count = 0, proceed with normal dispatch logic

**Example flow:**
```
Run ready: { _id: "run-123", botIdentifier: "sdr4blue", chatDataId: "chat-456", runStatus: "waiting" }

Dependency check:
  messages.find({
    messageStatus: "processing",
    botIdentifier: "sdr4blue",
    chatDataId: "chat-456"
  }).count()
  → returns 2

  Log: "Run run-123 skipped — 2 pending messages for sdr4blue/chat-456"
  → Run stays "waiting", next cycle checks again
```

**Why this works:**
- Messages change to "processing" on successful webhook POST (existing logic)
- External system changes "processing" → "sent" when done (external to this API)
- Dependency check prevents run from racing ahead of in-flight messages

**Edge case:** If message webhook fails retry and reverts to "pending", it won't block runs (only "processing" blocks). This is correct — failed message will retry next cycle, run can proceed.

### Auto-Timeout Recovery

**Standard pattern (from distributed system / dead letter queue domains):**

1. **Detect stuck items:** Query messages collection for:
   - `messageStatus: "processing"`
   - `processingStartedAt < (Date.now() - TIMEOUT_THRESHOLD_MS)`
2. **Reset status:** Update found messages:
   - `{ $set: { messageStatus: "pending" }, $unset: { processingStartedAt: "" } }`
3. **Log recovery:** Emit structured log with message ID and how long it was stuck
4. **Run on cycle start or dedicated interval:** Either runs before messages dispatch in each cycle, or on independent slower interval

**Example flow:**
```
TIMEOUT_THRESHOLD_MS = 600000 (10 minutes)
Current time: 1234567890000

messages.find({
  messageStatus: "processing",
  processingStartedAt: { $lt: 1234567890000 - 600000 }
})
→ returns 1 document: { _id: "msg-789", processingStartedAt: 1234567200000 }

messages.updateMany(
  { _id: { $in: ["msg-789"] } },
  { $set: { messageStatus: "pending" }, $unset: { processingStartedAt: "" } }
)

Log: "Timeout recovery reset msg-789 (stuck for 11.5 minutes)"
```

**When to run:**
- **Option A:** Before messages dispatch in each messages cycle (fast interval, low overhead)
- **Option B:** Independent slower interval (e.g., every 5 minutes) to reduce query load

**Recommendation:** Option A — runs in messages cycle, before finding "pending" messages. Keeps recovery responsive without adding another interval.

## MongoDB Schema Implications

### Existing Schema (messages collection)
```json
{
  "_id": ObjectId,
  "messageStatus": "pending" | "processing" | "sent",
  "botIdentifier": "sdr4blue",
  "chatDataId": "chat-456",
  ...
}
```

### Required Addition
```json
{
  "_id": ObjectId,
  "messageStatus": "pending" | "processing" | "sent",
  "processingStartedAt": Date | undefined,  // NEW: set when status → "processing"
  "botIdentifier": "sdr4blue",
  "chatDataId": "chat-456",
  ...
}
```

**Index requirements:**
- Existing: None assumed (small databases, queries per cycle are fast enough)
- Recommended for timeout recovery: `{ messageStatus: 1, processingStartedAt: 1 }` (compound index)
- Recommended for dependency check: `{ messageStatus: 1, botIdentifier: 1, chatDataId: 1 }` (compound index)

**Note:** Indexes are OPTIONAL for MVP — profile first. Dozens of databases × dozens of messages = low query cost. Add indexes only if cycle time degrades.

### Existing Schema (runs collection)
```json
{
  "_id": ObjectId,
  "runStatus": "waiting" | "queued" | "done",
  "waitUntil": Number (timestamp),
  "botIdentifier": "sdr4blue",
  "chatDataId": "chat-456",  // Assumed — verify in real data
  ...
}
```

**Assumption:** `chatDataId` exists on run documents. If not, dependency check cannot match. **Validation needed.**

### Existing Schema (vars collection)
```json
{
  "botIdentifier": "sdr4blue",
  "timeTrigger": {
    "enabled": true,
    "morningLimit": 8,
    "nightLimit": 20,
    "allowedDays": [1, 2, 3, 4, 5]
  }
}
```

**Potential addition (differentiator, not MVP):**
```json
{
  "botIdentifier": "sdr4blue",
  "timeTrigger": { ... },
  "rateLimits": {  // OPTIONAL per-database override
    "runs": 10,
    "fup": 5,
    "messages": 20
  },
  "timeoutThresholdMs": 600000  // OPTIONAL per-database override
}
```

## MVP Recommendation

Prioritize (in order):

### Phase 1: Atomic Timestamp (Foundation)
**Why first:** Both dependency check and timeout recovery need it.
1. Modify `dispatchMessage()` in WebhookDispatchService
2. Change findOneAndUpdate to set `processingStartedAt: new Date()` alongside `messageStatus: "processing"`
3. Test: Verify timestamp written on success, not written on failure/retry

**Complexity:** Low
**Risk:** Low — additive change, doesn't break existing behavior

### Phase 2: Rate Limiting
**Why second:** Independent feature, high value, low risk.
1. Add env vars: `RATE_LIMIT_RUNS`, `RATE_LIMIT_FUP`, `RATE_LIMIT_MESSAGES` (defaults: 10, 5, 20)
2. Add counters to `processDatabaseRuns/Fup/Messages()` methods
3. Check counter before each dispatch, skip if >= limit, log when limit hit
4. Test: Verify counter increments, limit enforced, remaining items skipped

**Complexity:** Low
**Risk:** Low — pure addition, no schema changes

### Phase 3: Message-Run Dependency
**Why third:** Depends on Phase 1 being stable; higher complexity.
1. Before dispatching run, query messages for "processing" + matching botIdentifier + chatDataId
2. If count > 0, skip run, log dependency
3. Test: Verify run skipped when messages processing, dispatched when clear

**Complexity:** Medium (additional query per run)
**Risk:** Medium — could slow down runs cycle if query inefficient

### Phase 4: Timeout Recovery
**Why last:** Depends on Phase 1; can be MVP-ed as manual intervention if needed.
1. Add env var: `MESSAGE_TIMEOUT_MS` (default: 600000 = 10 min)
2. In `runMessagesCycle()`, before finding "pending" messages, run timeout recovery query
3. Update stuck messages: `{ messageStatus: "pending" }, $unset: { processingStartedAt }`
4. Log each recovered message
5. Test: Verify stuck messages reset, logs emitted

**Complexity:** Medium
**Risk:** Low — runs before normal processing, worst case is no-op

## Defer for Later

1. **Per-database rate limit overrides** (vars collection) — operators can adjust global env vars for now
2. **Per-database timeout overrides** — global timeout sufficient for MVP
3. **Rate limit metrics in logs** — can add after validating base functionality
4. **Timeout recovery dry-run mode** — debugging feature, add if needed

## Open Questions for Validation

1. **Do run documents have `chatDataId` field?** Assumption: yes. If not, dependency check impossible without schema change.
2. **Do run documents have `botIdentifier` field?** Assumption: yes (seen in tests). Confirm in real data.
3. **What's typical processing time for messages?** Determines if 10-minute timeout is reasonable. Too short = premature resets, too long = runs blocked unnecessarily.
4. **What's typical count of eligible runs/FUP/messages per database per cycle?** Determines if rate limits of 10/5/20 are appropriate.
5. **Are there existing indexes on messages collection?** Determines if dependency check / timeout recovery queries are fast enough.

## Sources

**Confidence Level: MEDIUM-HIGH**

Research based on:
- **HIGH confidence:** Existing codebase analysis (run-dispatch.service.ts, webhook-dispatch.service.ts, messages dispatch implementation from v1.3)
- **HIGH confidence:** MongoDB native driver patterns (findOneAndUpdate, atomic updates)
- **MEDIUM confidence:** Rate limiting patterns (standard per-scope counter pattern from training data, aligned with cron job best practices)
- **MEDIUM confidence:** Dependency checking patterns (standard task orchestration pattern from training data)
- **MEDIUM confidence:** Timeout recovery patterns (dead letter queue / stuck job recovery from training data)

**Limitations:**
- Web search tools unavailable — relied on training data for pattern validation
- No access to Context7 or official documentation for rate limiting libraries (not using library, implementing in-app)
- Assumptions about `chatDataId` and `botIdentifier` fields on run documents need validation against real data

**Validation needed:**
- Confirm run document schema (chatDataId, botIdentifier fields)
- Confirm typical processing times and eligible item counts (informs defaults)
- Verify existing indexes on messages collection (performance)

---
*Feature research for v1.5: Rate Limiting and Message-Run Dependency*
*Researched: 2026-03-29*
