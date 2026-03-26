---
phase: 08-independent-cron-intervals
plan: "02"
subsystem: scheduler
tags:
  - scheduler
  - intervals
  - cron
  - refactor
dependency_graph:
  requires:
    - "08-01: RunDispatchService split into runRunsCycle/runFupCycle/runMessagesCycle"
  provides:
    - "3 independent setInterval registrations: dispatch-runs, dispatch-fup, dispatch-messages"
    - "Each interval has its own env var and fires independently"
  affects:
    - src/scheduler/scheduler.service.ts
    - src/scheduler/scheduler.service.spec.ts
tech_stack:
  added: []
  patterns:
    - "3 independent setIntervals each reading its own env var via ConfigService.getOrThrow"
    - "SchedulerRegistry.addInterval/deleteInterval for lifecycle management"
key_files:
  created: []
  modified:
    - src/scheduler/scheduler.service.ts
    - src/scheduler/scheduler.service.spec.ts
decisions:
  - "CRON_INTERVAL completely removed — replaced by CRON_INTERVAL_RUNS, CRON_INTERVAL_FUP, CRON_INTERVAL_MESSAGES"
  - "Each interval independently calls its own RunDispatchService cycle method"
metrics:
  duration: "~4 min"
  completed: "2026-03-26T18:34:18Z"
  tasks_completed: 2
  files_modified: 2
---

# Phase 08 Plan 02: Independent Cron Intervals Summary

**One-liner:** Replaced single `dispatch-cycle` interval (CRON_INTERVAL) with 3 independent setIntervals each reading its own env var and calling its own RunDispatchService cycle method.

## What Was Built

Refactored `SchedulerService.onModuleInit()` to register 3 independent intervals:

- `dispatch-runs` reads `CRON_INTERVAL_RUNS`, calls `runDispatchService.runRunsCycle()`
- `dispatch-fup` reads `CRON_INTERVAL_FUP`, calls `runDispatchService.runFupCycle()`
- `dispatch-messages` reads `CRON_INTERVAL_MESSAGES`, calls `runDispatchService.runMessagesCycle()`

`onModuleDestroy()` now deletes all 3 intervals via `SchedulerRegistry`.

Old `CRON_INTERVAL` and `dispatch-cycle` references are completely removed.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Rewrite SchedulerService with 3 independent intervals | 430f0b1 | src/scheduler/scheduler.service.ts |
| 2 | Rewrite scheduler.service.spec.ts for 3-interval architecture | 4207e46 | src/scheduler/scheduler.service.spec.ts |

## Verification

- Build: `pnpm run build` exits 0
- Tests: 113/113 passed — all scheduler tests pass including CRON-01 through CRON-05, CRON-07

## Deviations from Plan

None - plan executed exactly as written.

## Known Stubs

None.
