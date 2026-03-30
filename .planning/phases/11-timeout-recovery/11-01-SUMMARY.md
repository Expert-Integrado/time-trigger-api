---
phase: 11-timeout-recovery
plan: 01
subsystem: dispatch/scheduler
tags: [timeout-recovery, messages, scheduler, mongodb, tdd]
dependency_graph:
  requires:
    - 10-02 (processingStartedAt timestamp added to messages on claim)
  provides:
    - runRecoveryCycle() method in RunDispatchService
    - recover-messages setInterval in SchedulerService
    - CRON_INTERVAL_RECOVERY required env var
  affects:
    - src/dispatch/run-dispatch.service.ts
    - src/scheduler/scheduler.service.ts
    - src/main.ts
tech_stack:
  added: []
  patterns:
    - updateMany with $lte filter (no $exists guard) for idempotent recovery
    - Fourth independent setInterval following existing cycle pattern
    - Optional env var with default (MESSAGE_TIMEOUT_MINUTES, same pattern as RATE_LIMIT_*)
key_files:
  created: []
  modified:
    - src/dispatch/run-dispatch.service.ts
    - src/dispatch/run-dispatch.service.spec.ts
    - src/scheduler/scheduler.service.ts
    - src/scheduler/scheduler.service.spec.ts
    - src/main.ts
    - src/main.spec.ts
decisions:
  - MESSAGE_TIMEOUT_MINUTES is optional with default 10 — consistent with RATE_LIMIT_* precedent from Phase 9
  - $lte filter on processingStartedAt naturally excludes documents without the field — no $exists guard needed (TOUT-04)
  - Recovery implemented in RunDispatchService (not a new service) — single-method feature follows existing cycle pattern
metrics:
  duration: ~8min
  completed: 2026-03-30
  tasks_completed: 2
  files_modified: 6
---

# Phase 11 Plan 01: Timeout Recovery — Summary

**One-liner:** Independent recovery interval resets stuck "processing" messages to "pending" via MongoDB updateMany with 10-minute timeout threshold.

## What Was Built

Messages stuck in `"processing"` state (webhook never called back to reset them) are now automatically recovered by an independent `setInterval` registered as `recover-messages`. The recovery uses MongoDB `updateMany` with a `{ messageStatus: 'processing', processingStartedAt: { $lte: cutoff } }` filter — no `$exists` guard needed because MongoDB's `$lte` naturally evaluates to false for missing fields.

### Key additions

**RunDispatchService** (`src/dispatch/run-dispatch.service.ts`):
- `isRunningRecovery` reentrancy guard field
- `timeoutMinutes` field reading `MESSAGE_TIMEOUT_MINUTES` env var (default: 10)
- `runRecoveryCycle()` public method following the exact same guard-loop pattern as the 3 existing cycles
- `recoverTimedOutMessages(dbName)` private method: computes cutoff, calls `updateMany`, logs warn when `modifiedCount > 0`

**SchedulerService** (`src/scheduler/scheduler.service.ts`):
- Fourth interval `recover-messages` registered in `onModuleInit` using `CRON_INTERVAL_RECOVERY` (via `configService.getOrThrow`)
- Cleanup in `onModuleDestroy` (`deleteInterval('recover-messages')`)

**main.ts**:
- `CRON_INTERVAL_RECOVERY` added to `REQUIRED_ENV_VARS` — absence triggers `process.exit(1)` at startup

## Tests

- 139 tests passing (up from 138), 0 failures
- New tests cover TOUT-01 (updateMany filter), TOUT-02 (default and custom timeout), TOUT-03 (interval registration/firing/cleanup), TOUT-04 ($lte only, no $exists)
- Reentrancy guard and multi-DB error isolation also tested
- main.spec.ts updated to include `CRON_INTERVAL_RECOVERY` in required env setup

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing test update] Updated main.spec.ts env setup**
- **Found during:** Task 2 full suite run
- **Issue:** `main.spec.ts` beforeEach was missing `CRON_INTERVAL_RECOVERY` in the required env vars setup, causing 2 test failures after adding the new required var
- **Fix:** Added `CRON_INTERVAL_RECOVERY: '60000'` to the beforeEach env object
- **Files modified:** `src/main.spec.ts`
- **Commit:** 20c40d1

## Self-Check

Verified files exist and commits are present.
