---
phase: 02-core-dispatch-loop
plan: "03"
subsystem: scheduler
tags: [nestjs, schedule, scheduler-registry, cron, interval, dispatch]

# Dependency graph
requires:
  - phase: 02-core-dispatch-loop-02-02
    provides: RunDispatchService with runCycle() method and DispatchModule
  - phase: 02-core-dispatch-loop-02-01
    provides: WebhookDispatchService, MongoDB atomic claim, single retry
provides:
  - SchedulerService: dynamic interval registration via SchedulerRegistry.addInterval
  - SchedulerModule: imports ScheduleModule.forRoot() and DispatchModule
  - AppModule wired with SchedulerModule — full dispatch loop active on bootstrap
affects: [phase-03-docker-deployment, any phase needing scheduler context]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Dynamic interval registration via SchedulerRegistry.addInterval (not static @Interval() decorator)"
    - "CRON_INTERVAL env var cast with Number() before passing to setInterval — env vars are always strings"
    - "SchedulerService implements OnModuleInit/OnModuleDestroy for interval lifecycle management"
    - "setInterval callback uses void operator for fire-and-forget async call"
    - "ScheduleModule.forRoot() in SchedulerModule.imports registers SchedulerRegistry DI token"

key-files:
  created:
    - src/scheduler/scheduler.service.ts
    - src/scheduler/scheduler.service.spec.ts
    - src/scheduler/scheduler.module.ts
  modified:
    - src/app.module.ts

key-decisions:
  - "Dynamic interval via SchedulerRegistry.addInterval — allows ConfigService injection at runtime (static @Interval() decorator runs before DI is ready)"
  - "ScheduleModule.forRoot() in SchedulerModule (not AppModule) — keeps scheduler self-contained"
  - "DispatchModule imported in SchedulerModule (not @Global) — RunDispatchService scoped to scheduler"
  - "SchedulerService not exported from SchedulerModule — no other module needs it directly"

patterns-established:
  - "Pattern: SchedulerRegistry lifecycle pattern — addInterval in onModuleInit, deleteInterval in onModuleDestroy"
  - "Pattern: TDD with jest.useFakeTimers() + jest.advanceTimersByTime() for interval testing"

requirements-completed: [SCHED-01, SCHED-02, SCHED-03]

# Metrics
duration: 3min
completed: "2026-03-25"
---

# Phase 2 Plan 3: SchedulerService + SchedulerModule Summary

**SchedulerService with dynamic SchedulerRegistry.addInterval wiring full dispatch loop — CRON_INTERVAL-driven interval fires runCycle() fire-and-forget on every tick**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-25T16:09:02Z
- **Completed:** 2026-03-25T16:12:00Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- SchedulerService registers dynamic interval via SchedulerRegistry.addInterval('dispatch-cycle') in onModuleInit
- CRON_INTERVAL env var is cast with Number() before setInterval — handles string-to-number pitfall
- SchedulerModule imports ScheduleModule.forRoot() and DispatchModule, makes SchedulerRegistry available via DI
- AppModule updated to import SchedulerModule — the full dispatch chain (Scheduler → RunDispatch → WebhookDispatch → MongoDB) is active on bootstrap
- 5 unit tests pass (SCHED-01, SCHED-02 coverage) — RED confirmed before GREEN
- Full 44-test suite passes with build exit 0

## Task Commits

Each task was committed atomically:

1. **Task 1: Write SchedulerService spec (RED) then implement service (GREEN)** - `2faa3a2` (test + feat)
2. **Task 2: Create SchedulerModule and wire into AppModule** - `d08630a` (feat)

## Files Created/Modified

- `src/scheduler/scheduler.service.ts` - SchedulerService with onModuleInit/onModuleDestroy managing interval lifecycle via SchedulerRegistry
- `src/scheduler/scheduler.service.spec.ts` - 5 unit tests covering SCHED-01/SCHED-02: interval registration, callback invocation, Number() cast, cleanup
- `src/scheduler/scheduler.module.ts` - SchedulerModule importing ScheduleModule.forRoot() and DispatchModule
- `src/app.module.ts` - Added SchedulerModule import to activate dispatch loop on application bootstrap

## Decisions Made

- Used dynamic SchedulerRegistry.addInterval instead of @Interval() decorator — ConfigService injection requires DI to be available, which static decorators don't support
- ScheduleModule.forRoot() placed in SchedulerModule.imports (not AppModule) — keeps the scheduler module self-contained
- SchedulerService not exported from SchedulerModule — no other module needs it directly

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- Jest 30 renamed `--testPathPattern` to `--testPathPatterns` — used `pnpm jest [pattern]` directly to run spec files (minor adaptation, no code change needed)

## Next Phase Readiness

- Phase 2 complete: full dispatch loop wired end-to-end — Scheduler → RunDispatch → WebhookDispatch → MongoDB atomic update
- All 44 tests pass (Phase 1 + Phase 2), build exits 0
- Ready for Phase 3: Docker deployment and production configuration

---
*Phase: 02-core-dispatch-loop*
*Completed: 2026-03-25*
