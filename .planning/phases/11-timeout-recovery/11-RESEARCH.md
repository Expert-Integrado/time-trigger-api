# Phase 11: Timeout Recovery — Research

**Researched:** 2026-03-30
**Domain:** NestJS scheduler extension, MongoDB bulk update, idempotent state recovery
**Confidence:** HIGH

## Summary

Phase 11 adds a timeout recovery mechanism for messages that become stuck in `"processing"` state. When `dispatchMessage` claims a message it sets `processingStartedAt` (added in Phase 10). If the downstream webhook never calls back to reset the status, that message permanently blocks runs for the same conversation. The recovery mechanism finds these stuck documents and resets them to `"pending"` so the messages dispatch cycle can re-dispatch them normally.

The implementation fits entirely inside `SchedulerService` (a new method `recoverTimedOutMessages`) and `RunDispatchService` (a new method `runRecoveryCycle` that mirrors the guard-loop pattern already used for runs, FUP, and messages). A fourth `setInterval` — keyed `recover-messages` — is registered in `onModuleInit` and deleted in `onModuleDestroy`, following the exact same pattern as the three existing intervals. The timeout threshold is controlled by `MESSAGE_TIMEOUT_MINUTES` (default: 10), which is optional at startup (consistent with `RATE_LIMIT_*` precedent).

The MongoDB query is straightforward: `updateMany` with a filter of `{ messageStatus: 'processing', processingStartedAt: { $lte: cutoffDate } }`. Documents that never received `processingStartedAt` (the field is absent) are naturally excluded by this filter because a missing field does not satisfy `$lte` — satisfying TOUT-04 at zero extra cost. Idempotency is automatic: re-running the query against already-recovered documents finds none matching the filter and updates zero records.

**Primary recommendation:** Add `runRecoveryCycle` to `RunDispatchService` and wire it as a fourth independent interval in `SchedulerService`. Use `MESSAGE_TIMEOUT_MINUTES` as an optional env var with default 10. Write unit tests in a new `scheduler.service.spec.ts` block and directly against the new `RunDispatchService` method.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| TOUT-01 | Messages with `messageStatus: "processing"` for longer than `MESSAGE_TIMEOUT_MINUTES` are reset to `"pending"` | `updateMany` with `processingStartedAt: { $lte: cutoff }` handles this atomically across all tenant DBs |
| TOUT-02 | `MESSAGE_TIMEOUT_MINUTES` env var controls the timeout threshold (default: 10) | Optional env var pattern already established by `RATE_LIMIT_*` in Phase 9 — use `parseInt(process.env['MESSAGE_TIMEOUT_MINUTES'] ?? '10', 10)` |
| TOUT-03 | Timeout recovery runs on its own interval — not embedded in the messages dispatch hot path | Fourth `setInterval` (`recover-messages`) registered in `SchedulerService.onModuleInit`, independent of `dispatch-messages` |
| TOUT-04 | Recovery is idempotent — messages without `processingStartedAt` field are not affected | MongoDB `$lte` on a missing field evaluates to false — no extra guard needed |
</phase_requirements>

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| mongodb (native driver) | 7.1.1 | `updateMany` bulk reset of stuck messages | Already the project's data layer — no new dependency |
| @nestjs/schedule | 6.1.1 | `SchedulerRegistry` interval lifecycle | Already registered in `SchedulerModule`; `addInterval`/`deleteInterval` pattern in use |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @nestjs/common Logger | (NestJS 11) | Structured log lines for recovery pass | All service logging uses this — no change |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `updateMany` in `RunDispatchService` | New `MessageRecoveryService` | Extra file, extra module wiring — unnecessary for a single-method feature; keep in RunDispatchService to match existing cycle pattern |
| Optional env var with default | Required env var (add to `REQUIRED_ENV_VARS`) | Phase 9 established the pattern: rate-limit vars are optional with defaults; MESSAGE_TIMEOUT_MINUTES follows the same convention |

**Installation:** No new packages required.

## Architecture Patterns

### Where the Recovery Method Lives

The existing cycle pattern is: `SchedulerService` owns interval lifecycle → calls `RunDispatchService.run*Cycle()` → `run*Cycle()` calls per-database helpers. Phase 11 follows this exactly:

```
SchedulerService.onModuleInit()
  └── setInterval('recover-messages', recoveryMs)
        └── RunDispatchService.runRecoveryCycle()
              └── for each db: RunDispatchService.recoverTimedOutMessages(dbName)
```

### Pattern 1: Independent Interval Registration

**What:** Each dispatch type gets its own named interval. The recovery interval is a fourth entry.
**When to use:** Any background job that must not block or be blocked by another.

```typescript
// Source: src/scheduler/scheduler.service.ts (existing pattern — lines 22–53)
// TOUT-03: recovery interval — independent of dispatch-messages
const recoveryMs = Number(
  this.configService.getOrThrow<string>('CRON_INTERVAL_RECOVERY'),
);
const recoveryId = setInterval(
  () => void this.runDispatchService.runRecoveryCycle(),
  recoveryMs,
);
this.schedulerRegistry.addInterval('recover-messages', recoveryId);
this.logger.log(`Recovery interval registered: ${recoveryMs}ms`);
```

> Note: If the plan decides `CRON_INTERVAL_RECOVERY` should be optional (not requiring `getOrThrow`), see Pattern 2 below.

### Pattern 2: Optional Env Var with Default (established by Phase 9)

**What:** Read from `process.env` directly with a fallback; do not use `configService.getOrThrow`.
**When to use:** Non-critical tuning knob — absence should not crash the process.

```typescript
// Source: src/dispatch/run-dispatch.service.ts (lines 32–43, rate limit pattern)
private readonly timeoutMinutes = parseInt(
  process.env['MESSAGE_TIMEOUT_MINUTES'] ?? '10',
  10,
);
```

### Pattern 3: Idempotent `updateMany` Recovery Query

**What:** Filter on both `messageStatus: 'processing'` AND `processingStartedAt: { $lte: cutoff }`. Documents missing `processingStartedAt` never satisfy `$lte` and are naturally excluded (TOUT-04).
**When to use:** Bulk state reset where idempotency and field-absence safety are required.

```typescript
// Derived from existing MongoDB 7.x native driver usage in this codebase
const cutoff = new Date(Date.now() - this.timeoutMinutes * 60 * 1000);
const result = await db.collection('messages').updateMany(
  {
    messageStatus: 'processing',
    processingStartedAt: { $lte: cutoff },
  },
  { $set: { messageStatus: 'pending' } },
);
this.logger.log(
  `[${dbName}] Recovery: ${result.modifiedCount} message(s) reset to pending`,
);
```

### Pattern 4: Reentrancy Guard (established by runRunsCycle / runFupCycle / runMessagesCycle)

**What:** A boolean flag (`isRunning*`) prevents a slow pass from overlapping with the next tick.

```typescript
// Source: src/dispatch/run-dispatch.service.ts (lines 52–84, runRunsCycle pattern)
private isRunningRecovery = false;

async runRecoveryCycle(): Promise<void> {
  if (this.isRunningRecovery) {
    this.logger.warn('Recovery cycle skipped — previous cycle still running');
    return;
  }
  this.isRunningRecovery = true;
  try {
    // ...
  } finally {
    this.isRunningRecovery = false;
  }
}
```

### Anti-Patterns to Avoid

- **Embedding recovery in `runMessagesCycle`:** Violates TOUT-03. The recovery pass runs on its own interval; mixing it with the dispatch hot path means a slow recovery blocks message dispatch.
- **Using `findOneAndUpdate` in a loop:** Correct for single-claim dispatch but wrong for bulk recovery. `updateMany` resets all eligible documents in one round trip.
- **Adding `MESSAGE_TIMEOUT_MINUTES` to `REQUIRED_ENV_VARS`:** The field has a sensible default (10 minutes). Forcing it to be required would break existing deployments that do not set it.
- **Unsetting `processingStartedAt` on recovery:** The reset only changes `messageStatus` back to `"pending"`. Leaving `processingStartedAt` intact avoids rewriting history and keeps the field available for future diagnostics.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Bulk document update | `findOneAndUpdate` loop | `updateMany` | Single round trip; atomicity per-document is sufficient for idempotent reset |
| Missing-field exclusion | Explicit `$exists: true` guard | `$lte` on missing field | MongoDB naturally evaluates `{ processingStartedAt: { $lte: X } }` as false when the field is absent |
| Interval cleanup | Manual `clearInterval` store | `SchedulerRegistry.deleteInterval` | Already the project pattern; handles cleanup on module destroy |

**Key insight:** The `$lte` filter on `processingStartedAt` is the entire implementation of TOUT-04 — no additional code path is needed to protect documents lacking the field.

## Common Pitfalls

### Pitfall 1: Wrong Interval Name in `onModuleDestroy`

**What goes wrong:** `deleteInterval('recover-messages')` is omitted or uses a different string than `addInterval`. The interval leaks on graceful shutdown.
**Why it happens:** Copy-paste of the three existing intervals in `onModuleDestroy` but forgetting the fourth.
**How to avoid:** Add `this.schedulerRegistry.deleteInterval('recover-messages')` in `onModuleDestroy` immediately when adding the `addInterval` call.
**Warning signs:** `SchedulerRegistry` throws on shutdown; or the interval fires after the DB connection is closed.

### Pitfall 2: `timeoutMinutes` Stored as String

**What goes wrong:** `parseInt` is omitted; `Date.now() - '10' * 60 * 1000` produces `NaN`, making the cutoff `new Date(NaN)` — which is an invalid date. MongoDB's behavior with `{ $lte: InvalidDate }` is to match nothing (returns 0 modified), silently disabling recovery.
**Why it happens:** Forgetting `parseInt` when reading from `process.env`.
**How to avoid:** Always use `parseInt(process.env['MESSAGE_TIMEOUT_MINUTES'] ?? '10', 10)` — exactly as the rate limit fields do.
**Warning signs:** `result.modifiedCount` always 0 even when stuck messages exist; `new Date(NaN)` in log output.

### Pitfall 3: `$unset processingStartedAt` on Recovery

**What goes wrong:** Recovery resets `messageStatus` to `"pending"` AND unsets `processingStartedAt`. On the next dispatch, the message is reclaimed and `processingStartedAt` is set again — but if recovery runs again before dispatch, the filter `{ processingStartedAt: { $lte: cutoff } }` does not find the document (field absent after unset), so TOUT-04 and TOUT-01 still hold. The real risk is diagnostic: wiping the timestamp destroys the audit trail.
**How to avoid:** Recovery `$set` touches only `messageStatus`. Do not `$unset processingStartedAt`.

### Pitfall 4: `configService.getOrThrow` for `MESSAGE_TIMEOUT_MINUTES`

**What goes wrong:** Using `configService.getOrThrow('MESSAGE_TIMEOUT_MINUTES')` makes it a required env var. Any deployment that does not set it will crash at startup.
**Why it happens:** Mirroring the `CRON_INTERVAL_*` pattern instead of the `RATE_LIMIT_*` pattern.
**How to avoid:** Use `process.env['MESSAGE_TIMEOUT_MINUTES'] ?? '10'` directly — the same pattern used for `RATE_LIMIT_RUNS`, `RATE_LIMIT_FUP`, `RATE_LIMIT_MESSAGES`.

### Pitfall 5: `CRON_INTERVAL_RECOVERY` vs `MESSAGE_TIMEOUT_MINUTES` Confusion

**What goes wrong:** `CRON_INTERVAL_RECOVERY` is the interval frequency (milliseconds between recovery passes); `MESSAGE_TIMEOUT_MINUTES` is the age threshold a message must exceed to be reset. These are two independent knobs. Conflating them (e.g., deriving the cutoff from the interval) breaks the intent.
**How to avoid:** Keep them separate. The planner must decide whether `CRON_INTERVAL_RECOVERY` is required (via `getOrThrow`) or optional (via `process.env` with default). The roadmap description does not mention it as a configurable env var, so the plan should decide.

## Code Examples

### Recovery Method (complete, idiomatic)

```typescript
// Pattern derived from runMessagesCycle + updateMany MongoDB 7.x API
private async recoverTimedOutMessages(dbName: string): Promise<void> {
  const db: Db = this.mongoService.db(dbName);
  const cutoff = new Date(Date.now() - this.timeoutMinutes * 60 * 1000);

  const result = await db.collection('messages').updateMany(
    {
      messageStatus: 'processing',
      processingStartedAt: { $lte: cutoff },
    },
    { $set: { messageStatus: 'pending' } },
  );

  if (result.modifiedCount > 0) {
    this.logger.warn(
      `[${dbName}] Recovery: ${result.modifiedCount} message(s) reset to pending (timeout: ${this.timeoutMinutes}min)`,
    );
  }
}
```

### Unit Test Pattern: verify updateMany filter

```typescript
// Mirrors message-check.service.spec.ts style — mock collection, assert call shape
it('(TOUT-01) resets processing messages older than timeout to pending', async () => {
  mockCollection.updateMany.mockResolvedValue({ modifiedCount: 2 });
  await service.recoverTimedOutMessages('test-db');
  const [filter, update] = mockCollection.updateMany.mock.calls[0];
  expect(filter.messageStatus).toBe('processing');
  expect(filter.processingStartedAt.$lte).toBeInstanceOf(Date);
  expect(update.$set.messageStatus).toBe('pending');
});

it('(TOUT-04) filter does not touch messages without processingStartedAt', async () => {
  // No documents match because $lte on missing field = false (MongoDB behavior)
  // Test verifies filter NEVER includes $exists or other bypass
  const [filter] = mockCollection.updateMany.mock.calls[0];
  expect(filter.processingStartedAt).toEqual({ $lte: expect.any(Date) });
  expect(filter.processingStartedAt['$exists']).toBeUndefined();
});
```

### SchedulerService Test Pattern: fourth interval fires runRecoveryCycle

```typescript
// Mirrors existing scheduler tests in scheduler.service.spec.ts
it('recover-messages interval fires runRecoveryCycle()', () => {
  service.onModuleInit();
  jest.advanceTimersByTime(/* CRON_INTERVAL_RECOVERY value */);
  expect(runDispatchService.runRecoveryCycle).toHaveBeenCalled();
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Manual stuck-message cleanup | Automatic recovery interval | Phase 11 | No manual intervention required |
| `processingStartedAt` absent | `processingStartedAt` set on atomic claim | Phase 10 | Enables the `$lte` recovery filter |

## Open Questions

1. **Is `CRON_INTERVAL_RECOVERY` required or optional?**
   - What we know: `CRON_INTERVAL_RUNS/FUP/MESSAGES` are required (crash on missing). `RATE_LIMIT_*` are optional with defaults. The phase description says "independent recovery interval" but does not specify a default frequency.
   - What's unclear: Should the recovery interval crash on startup if absent, or default to something reasonable (e.g., 60000ms)?
   - Recommendation: Make it **required via `configService.getOrThrow`** to be consistent with the other three CRON intervals. The planner should confirm this decision. If a default is preferred, use `process.env` with a sensible fallback (e.g., 60000ms).

2. **Should recovery log at `warn` or `log` when modifiedCount > 0?**
   - What we know: `runRunsCycle` logs normal operations at `log`, anomalies at `warn`. A message being recovered is an anomaly (webhook never called back).
   - Recommendation: `warn` when `modifiedCount > 0`, no log when `modifiedCount === 0` (avoids noise on every clean pass).

## Environment Availability

Step 2.6: SKIPPED (no external dependencies — pure code additions to existing NestJS service layer).

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Jest 30.0.0 |
| Config file | package.json (`jest` key) |
| Quick run command | `pnpm run test -- --testPathPattern=scheduler.service` |
| Full suite command | `pnpm run test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| TOUT-01 | `updateMany` resets processing messages older than timeout to pending | unit | `pnpm run test -- --testPathPattern=run-dispatch.service` | ✅ (extend existing spec) |
| TOUT-02 | `MESSAGE_TIMEOUT_MINUTES` env var read with default 10 | unit | `pnpm run test -- --testPathPattern=run-dispatch.service` | ✅ (extend existing spec) |
| TOUT-03 | Recovery interval registered independently in SchedulerService | unit | `pnpm run test -- --testPathPattern=scheduler.service` | ✅ (extend existing spec) |
| TOUT-04 | Filter uses `$lte` only — documents without `processingStartedAt` unaffected | unit | `pnpm run test -- --testPathPattern=run-dispatch.service` | ✅ (extend existing spec) |

### Sampling Rate

- **Per task commit:** `pnpm run test -- --testPathPattern="scheduler.service|run-dispatch.service"`
- **Per wave merge:** `pnpm run test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

None — existing test infrastructure covers all phase requirements. Tests are added to the existing `scheduler.service.spec.ts` and `run-dispatch.service.spec.ts` files rather than creating new files.

## Sources

### Primary (HIGH confidence)

- MongoDB 7.x native driver API — `updateMany(filter, update)` returns `UpdateResult` with `modifiedCount`; `$lte` on missing field evaluates to false (verified against MongoDB driver 7.1.1 installed in project)
- `src/scheduler/scheduler.service.ts` — existing interval registration pattern (direct code read)
- `src/dispatch/run-dispatch.service.ts` — reentrancy guard pattern, optional env var pattern, cycle structure (direct code read)
- `src/main.ts` — `REQUIRED_ENV_VARS` and `validateEnv` patterns (direct code read)

### Secondary (MEDIUM confidence)

- Phase 9 decisions in STATE.md — `RATE_LIMIT_*` as optional env vars with defaults (project decision log)
- Phase 10 decisions in STATE.md — `processingStartedAt` set atomically at claim time (project decision log)

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH — no new dependencies; all patterns already proven in phases 8–10
- Architecture: HIGH — directly derived from existing code in scheduler.service.ts and run-dispatch.service.ts
- Pitfalls: HIGH — derived from close reading of existing implementation and MongoDB 7.x behavior
- Test patterns: HIGH — mirrors spec files already in the codebase

**Research date:** 2026-03-30
**Valid until:** 2026-04-30 (stable stack — NestJS 11, MongoDB 7, no fast-moving dependencies)
