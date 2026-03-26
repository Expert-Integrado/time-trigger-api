---
phase: 08-independent-cron-intervals
plan: "01"
subsystem: dispatch
tags: [cron, dispatch, guard, isolation, tdd]
dependency_graph:
  requires: []
  provides: [runRunsCycle, runFupCycle, runMessagesCycle]
  affects: [scheduler.service.ts]
tech_stack:
  added: []
  patterns: [independent-isRunning-guards, split-cycle-methods]
key_files:
  created: []
  modified:
    - src/dispatch/run-dispatch.service.ts
    - src/dispatch/run-dispatch.service.spec.ts
    - src/scheduler/scheduler.service.ts
    - src/scheduler/scheduler.service.spec.ts
decisions:
  - runRunsCycle dispatches both runs AND FUPs (they share the timeTrigger gate in the same DB pass)
  - runFupCycle is a standalone FUP-only method for when a separate FUP interval fires
  - runMessagesCycle has no time gate or day gate — runs independently
  - scheduler temporarily wired to runRunsCycle only; Plan 02 will add independent intervals
metrics:
  duration: "264s"
  completed_date: "2026-03-26"
  tasks_completed: 2
  files_modified: 4
---

# Phase 08 Plan 01: Split runCycle into 3 Independent Cycle Methods Summary

**One-liner:** Split monolithic `runCycle()` into `runRunsCycle()`, `runFupCycle()`, and `runMessagesCycle()` with independent `isRunning*` guards to eliminate cross-blocking between dispatch types.

## What Was Built

`RunDispatchService` now exposes 3 public cycle methods instead of one:

- `runRunsCycle()`: Guarded by `isRunningRuns`. Processes both runs dispatch and FUP dispatch per DB (both share the timeTrigger gate in the same pass).
- `runFupCycle()`: Guarded by `isRunningFup`. Standalone FUP-only dispatch per DB (for when a dedicated FUP interval fires).
- `runMessagesCycle()`: Guarded by `isRunningMessages`. Processes pending messages per DB with no time gate or day gate.

The old `runCycle()` method and single `isRunning` guard were removed. The old `processDatabase()` was split into `processDatabaseRuns()`, `processDatabaseFup()`, and `processDatabaseMessages()`. The `cycleCount` counter was also removed (no longer meaningful with 3 separate cycles).

## Decisions Made

1. **runRunsCycle dispatches both runs AND FUPs** — They share the same `timeTrigger` gate and the same `webhookDoc` read. Combining them in one DB pass is efficient and preserves the existing behavior from `processDatabase()`.
2. **runFupCycle is FUP-only** — It serves as the target for a dedicated FUP setInterval (Plan 02 will wire it). It also checks the timeTrigger gate.
3. **Scheduler temporarily uses runRunsCycle** — The old `runCycle()` call was replaced with `runRunsCycle()` to keep the build passing. Plan 02 will add `runFupCycle` and `runMessagesCycle` to their own separate intervals.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Scheduler service still called deleted runCycle()**
- **Found during:** Post-implementation build verification
- **Issue:** `src/scheduler/scheduler.service.ts` called `this.runDispatchService.runCycle()` which no longer exists, causing a TypeScript build error.
- **Fix:** Updated `scheduler.service.ts` to call `runRunsCycle()` as the closest equivalent. Updated `scheduler.service.spec.ts` to mock `runRunsCycle` instead of `runCycle`.
- **Files modified:** `src/scheduler/scheduler.service.ts`, `src/scheduler/scheduler.service.spec.ts`
- **Commit:** b8d18e2

## Test Coverage

40 tests pass for `run-dispatch.service.spec.ts`:
- All existing DETECT/TRIG/FUP/MSG/CONN behavioral tests migrated to new method names
- 3 per-type guard tests (SCHED-03 pattern for each method)
- 4 CRON-06 guard independence tests verifying that a running cycle in one type does not block the others

## Known Stubs

None.

## Self-Check: PASSED

Files exist:
- FOUND: src/dispatch/run-dispatch.service.ts
- FOUND: src/dispatch/run-dispatch.service.spec.ts
- FOUND: src/scheduler/scheduler.service.ts
- FOUND: src/scheduler/scheduler.service.spec.ts

Commit b8d18e2 exists and contains all changes.
