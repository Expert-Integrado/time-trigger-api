# Project Research Summary

**Project:** Time Trigger API — v1.5 Rate Limiting and Message-Run Dependency
**Domain:** Multi-tenant cron-based webhook dispatcher (NestJS + MongoDB)
**Researched:** 2026-03-29
**Confidence:** HIGH

## Executive Summary

This milestone adds three complementary features to the existing v1.4 dispatch system: per-database rate limiting, message-run dependency enforcement, and automatic timeout recovery for stuck messages. All three features are purely application logic — no new dependencies are required. The existing NestJS 11 + MongoDB 7.1.1 stack provides every primitive needed: `countDocuments`, `updateMany`, in-memory `Map`, and `ConfigService`.

The recommended implementation order mirrors the feature dependency graph. Timeout recovery must ship before dependency enforcement, because the dependency check blocks runs on "processing" messages — and without recovery, a stuck message permanently blocks a run. Rate limiting is independent and can ship in any order, but starting with it establishes the dispatch loop structure that the other features extend. All three features integrate additively into `RunDispatchService` and `WebhookDispatchService` with no structural changes to existing services.

The critical risk in this milestone is correctness, not complexity. Three specific mistakes can silently corrupt dispatch behavior: (1) a global rate limiter that starves low-volume tenants, (2) a dependency check missing the `botIdentifier` filter causing cross-bot blocking, and (3) timeout recovery that never fires because the `processingStartedAt` timestamp field was not added to the `dispatchMessage` update. All three are easy to get wrong and hard to detect without deliberate testing.

## Key Findings

### Stack Additions

No new libraries required. All features use the existing validated stack.

**New environment variables (all optional with defaults):**
- `RATE_LIMIT_RUNS` (default: 10) — max runs dispatched per database per cycle
- `RATE_LIMIT_FUP` (default: 10) — max FUPs dispatched per database per cycle
- `RATE_LIMIT_MESSAGES` (default: 10) — max messages dispatched per database per cycle
- `MESSAGE_TIMEOUT_MINUTES` (default: 10) — minutes before a "processing" message resets to "pending"

**Schema change (additive, no migration):** Add `processingStartedAt: number` to messages when status changes to `"processing"`. Old messages without this field are unaffected by recovery queries.

**What NOT to add:** `@nestjs/throttler`, Redis, BullMQ, `bottleneck`, or any distributed locking library. Rate limit is cycle-scoped and resets every interval — in-memory `Map` is sufficient and correct.

### Feature Table Stakes

**Must have (table stakes):**
- Per-database, per-type rate limiting with per-cycle counter reset — prevents webhook overload
- Soft limit behavior (log + skip, keep running) — hard stop would break reliability guarantees
- Message-run dependency check using `botIdentifier` AND `chatDataId` — prevents runs racing ahead of in-flight messages
- Timeout recovery for messages stuck in `"processing"` — required before dependency enforcement ships or runs can block permanently
- `processingStartedAt` timestamp on message status change — prerequisite for both dependency check and timeout recovery

**Should have (differentiators):**
- Rate limit metrics in cycle logs ("dispatched X/Y limit per database")
- Dependency chain visibility in logs (run skipped due to N pending messages for chatDataId)
- Configurable timeout threshold via env var (not hard-coded)

**Defer to v2+:**
- Per-database rate limit overrides stored in `vars` collection
- Per-database timeout threshold overrides
- Timeout recovery dry-run mode (`TIMEOUT_RECOVERY_DRY_RUN=true`)
- Adaptive/dynamic rate limits based on webhook response times

### Architecture Approach

All three features integrate into the existing `RunDispatchService` + `WebhookDispatchService` pair without new modules. Rate limiting lives as inline counter logic inside each `processDatabase*` method. Message-run dependency is extracted into a new `MessageCheckService` (injectable, testable in isolation). Timeout recovery runs at the start of `runMessagesCycle` via a new `recoverTimedOutMessages` private method — on a separate slower interval, not inside the dispatch hot path.

**Key components and changes:**

1. `MessageCheckService` (new) — queries messages collection for blocking conditions; injected into `RunDispatchService`; enables isolated unit testing of the dependency check
2. `RunDispatchService` (modified) — adds rate limit counters per type, dependency check per run in `processDatabaseRuns`, recovery call at start of `runMessagesCycle`
3. `WebhookDispatchService.dispatchMessage` (modified) — sets `processingStartedAt` timestamp when marking `"processing"`; returns `boolean` to indicate successful atomic claim (needed for correct rate limit counting)

**Data flow after v1.5 (runs cycle):**
```
getEligibleDatabases()
  → processDatabaseRuns(dbName)
      → timeTrigger gate [existing]
      → find eligible runs [existing]
      → FOR EACH run (up to RATE_LIMIT_RUNS):
          → MessageCheckService.hasPendingMessages(botIdentifier, chatDataId)?
              YES → skip, leave "waiting", continue
              NO  → dispatch() [existing atomic findOneAndUpdate]
                    → if dispatched: increment counter
```

**Data flow after v1.5 (messages cycle):**
```
runMessagesCycle()
  → recoverTimedOutMessages() [NEW — runs first, per DB]
      → updateMany: processing + processingStartedAt <= cutoff → pending
  → processDatabaseMessages(dbName)
      → find pending messages [existing]
      → FOR EACH message (up to RATE_LIMIT_MESSAGES):
          → dispatch() [existing]
```

### Critical Pitfalls

1. **Global rate limiter starves tenants** — Use `Map<dbName, counter>` with `.clear()` at cycle start, never a single shared counter. High-volume clients would consume the entire limit, leaving zero capacity for others (Pitfall 1).

2. **Dependency check missing `botIdentifier` filter** — Always query `{ botIdentifier, chatDataId, messageStatus: 'processing' }`. `chatDataId` values can repeat across bots in the same database; filtering only on `chatDataId` causes cross-bot blocking (Pitfall 6).

3. **`processingStartedAt` field never written** — Timeout recovery is silently a no-op if `dispatchMessage()` does not set this timestamp when changing status to `"processing"`. Implement the schema field in the same commit as the recovery mechanism and test both together (Pitfall 11).

4. **Rate limiter increments on failed atomic claims** — `dispatched++` must only fire after `findOneAndUpdate` returns a non-null document. Incrementing on attempts causes effective dispatch rate to fall below the configured limit (Pitfall 7).

5. **Dependency without timeout recovery ships first** — If the message-run dependency check goes live before timeout recovery, a single stuck "processing" message permanently blocks all runs with the same `chatDataId`. These two features must be deployed together (Pitfall 3).

## Implications for Roadmap

Based on research, the dependency graph dictates a clear 3-phase implementation order.

### Phase 1: Rate Limiting

**Rationale:** Independent feature with no prerequisites. Establishes the dispatch loop structure (counter, early-exit, log-on-limit) that phases 2 and 3 extend. Simplest to implement and test in isolation.

**Delivers:** Configurable cap on webhooks dispatched per database per cycle, across all three dispatch types independently.

**Addresses:** Per-database limit, per-type independence, soft limit behavior, per-cycle reset.

**Avoids:**
- Pitfall 1 (global limiter starves tenants) — design `Map<dbName, counter>` first
- Pitfall 5 (shared limit across types) — three separate limiters, one per dispatch type
- Pitfall 7 (count attempts vs. successes) — increment only after successful `findOneAndUpdate`

### Phase 2: processingStartedAt Timestamp + Message-Run Dependency

**Rationale:** The `processingStartedAt` field is a shared prerequisite for both dependency checking and timeout recovery. Adding it here is low-risk (additive schema change) and unblocks Phase 3. The dependency check itself ships in this phase; timeout recovery is designed concurrently so both go live before production traffic hits the dependency logic.

**Delivers:** Runs blocked from dispatching while related messages are actively processing; runs retry next cycle automatically. The `processingStartedAt` timestamp lands on messages, enabling Phase 3.

**Uses:** `MessageCheckService` (new injectable), `countDocuments` query, compound filter on `botIdentifier + chatDataId + messageStatus`.

**Avoids:**
- Pitfall 2 (race condition — check only `"processing"`, not `"pending"`)
- Pitfall 6 (missing `botIdentifier` filter)
- Pitfall 9 (O(runs) queries — pre-fetch processing messages per DB as a single query, then use in-memory map for O(1) lookup per run)
- Pitfall 11 (timestamp missing — same commit as recovery mechanism)

### Phase 3: Timeout Recovery

**Rationale:** Dependency-blocking feature — stuck messages permanently block runs without this. Must deploy alongside or before Phase 2 goes live. Requires the `processingStartedAt` timestamp field from Phase 2.

**Delivers:** Messages stuck in `"processing"` for longer than `MESSAGE_TIMEOUT_MINUTES` automatically reset to `"pending"`, unblocking dependent runs without manual intervention.

**Avoids:**
- Pitfall 3 (dependency deadlock from stuck messages)
- Pitfall 4 (permanent processing state)
- Pitfall 8 (recovery embedded in dispatch loop — use a separate slower interval, not the 5-second hot path)

### Phase Ordering Rationale

- Phase 1 first because it is fully independent and low-risk; validates the counter pattern before adding query complexity.
- Phases 2 and 3 are tightly coupled — dependency enforcement without recovery creates an unbounded blocking condition. The `processingStartedAt` timestamp lands in Phase 2; timeout recovery ships in Phase 3 but should be deployed together with Phase 2 before production traffic reaches the dependency check.
- All three phases are purely additive — no structural changes to existing services, no schema migrations, no breaking changes to deployment config.
- Backwards-compatible: rate limit env vars have defaults, dependency check is transparent to unaffected runs, recovery is a no-op when no messages are stuck.

### Research Flags

Phases with standard patterns (skip additional research):
- **Phase 1 (Rate Limiting):** Well-established pattern; `Map<dbName, counter>` with cycle-scoped reset is idiomatic and completely understood.
- **Phase 3 (Timeout Recovery):** Standard dead-letter-queue recovery pattern; `updateMany` with timestamp filter is stable MongoDB API.

Phases that need validation before implementation:
- **Phase 2 (Message-Run Dependency):** Requires confirming that `runs` documents actually contain `chatDataId` and `botIdentifier` fields. Research assumes yes based on codebase analysis, but this must be verified against real data before writing the dependency query filter.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Verified against installed package.json; all required APIs exist in current driver versions; zero new packages needed |
| Features | MEDIUM-HIGH | Pattern analysis from existing codebase; run document schema fields (`chatDataId`) assumed but not confirmed in live production data |
| Architecture | HIGH | Integration points derived from direct codebase analysis of run-dispatch.service.ts and webhook-dispatch.service.ts |
| Pitfalls | HIGH | Drawn from established multi-tenant dispatch patterns and MongoDB concurrency documentation |

**Overall confidence:** HIGH

### Gaps to Address

- **`chatDataId` on run documents:** Research assumes run documents include `chatDataId` for the dependency filter. Confirm this field exists in production data before implementing Phase 2. If absent, the dependency feature requires a schema extension.
- **Existing indexes on messages collection:** Dependency check queries `(botIdentifier, chatDataId, messageStatus)` and timeout recovery queries `(messageStatus, processingStartedAt)`. Profile query performance on real data before deciding if compound indexes are required at launch.
- **Typical message processing duration:** The 10-minute timeout default is a reasonable assumption. Validate against real client data to confirm it does not prematurely recover legitimately slow messages.

## Sources

### Primary (HIGH confidence)
- `/root/time-trigger-api/src/dispatch/run-dispatch.service.ts` — existing cycle structure, isRunning guards, database iteration patterns
- `/root/time-trigger-api/src/dispatch/webhook-dispatch.service.ts` — atomic `findOneAndUpdate` pattern, existing `dispatchMessage` implementation
- `/root/time-trigger-api/package.json` — confirmed installed versions (NestJS 11.0.1, MongoDB 7.1.1, @nestjs/config 4.0.3)

### Secondary (MEDIUM confidence)
- MongoDB 7.1.1 native driver API — `countDocuments`, `updateMany`, compound query operators (stable since v3.x)
- Training data: NestJS injectable service patterns, per-tenant rate limiting, dead-letter-queue timeout recovery

---
*Research completed: 2026-03-29*
*Ready for roadmap: yes*
