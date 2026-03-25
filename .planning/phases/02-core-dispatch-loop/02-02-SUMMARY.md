---
phase: 02-core-dispatch-loop
plan: 02
subsystem: api
tags: [nestjs, mongodb, dispatch, time-gate, cycle-guard, tdd]

# Dependency graph
requires:
  - phase: 02-core-dispatch-loop
    plan: 01
    provides: WebhookDispatchService with dispatch(db, run, webhookUrl) method
  - phase: 01-foundation
    provides: MongoService (global singleton), DatabaseScanService, NestJS scaffolding
provides:
  - RunDispatchService with runCycle() cycle orchestrator and isRunning guard
  - processDatabase() with fresh vars/webhooks reads, time gate, run detection
  - DispatchModule exporting both RunDispatchService and WebhookDispatchService
  - 11 unit tests covering DETECT-01 through DETECT-04 and SCHED-03
affects:
  - 02-core-dispatch-loop plan 03 (SchedulerService will call RunDispatchService.runCycle())

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "isRunning guard: boolean flag in try/finally ensures overlapping cycles cannot occur"
    - "Fresh reads per cycle: vars and webhooks fetched via db.collection().findOne() on every processDatabase() call — no class-level caching"
    - "Time gate: new Date().getHours() compared against morningLimit/nightLimit — TZ=America/Sao_Paulo env makes this return Brazil time"
    - "Bracket notation for webhook URL: webhookDoc?.['Processador de Runs'] — required because field name contains spaces"
    - "Sequential DB processing: for...of loop across eligible databases — one DB failure does not abort the cycle"

key-files:
  created:
    - src/dispatch/run-dispatch.service.ts
    - src/dispatch/run-dispatch.service.spec.ts
    - src/dispatch/dispatch.module.ts
  modified: []

key-decisions:
  - "DatabaseModule imported in DispatchModule (not relying on global resolution) — DatabaseModule lacks @Global() decorator so explicit import required for DatabaseScanService injection"
  - "isRunning guard uses try/finally reset — guarantees flag cleared even on unhandled errors"
  - "Per-DB errors caught and logged individually — single DB failure does not abort the entire cycle"

# Metrics
duration: 3min
completed: 2026-03-25
---

# Phase 02 Plan 02: RunDispatchService Summary

**Cycle orchestrator that iterates eligible databases, reads fresh vars/webhooks, applies Brazil-time gate, queries waiting runs, and delegates to WebhookDispatchService — guarded by isRunning flag to prevent concurrent cycles**

## Performance

- **Duration:** ~3 min
- **Started:** 2026-03-25T16:04:12Z
- **Completed:** 2026-03-25T16:06:52Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- `RunDispatchService` implemented with `runCycle()` as the public entry point
- `isRunning` guard with `try/finally` reset prevents overlapping cycle execution (SCHED-03)
- `processDatabase()` reads `vars` and `webhooks` freshly on every invocation — no class-level caching (DETECT-02, DETECT-03)
- Time gate via `new Date().getHours()` compared against `morningLimit`/`nightLimit` — relies on `TZ=America/Sao_Paulo` env var (DETECT-04)
- Runs queried with `{ runStatus: 'waiting', waitUntil: { $lte: new Date() } }` (DETECT-01)
- Null guards: missing vars or webhooks URL causes a warning log and skip — no throw
- 11 unit tests passing covering all DETECT-01 through DETECT-04 and SCHED-03
- `DispatchModule` created exporting both `RunDispatchService` and `WebhookDispatchService`
- Full test suite: 39 tests pass across all 6 spec files

## Task Commits

1. **Task 1: RunDispatchService spec + implementation (TDD RED→GREEN)** - `0ae393e` (test + feat)
2. **Task 2: DispatchModule** - `8885cf0` (feat)

## Files Created/Modified

- `src/dispatch/run-dispatch.service.ts` — RunDispatchService with runCycle(), processDatabase(), isWithinTimeWindow(), isRunning guard
- `src/dispatch/run-dispatch.service.spec.ts` — 11 unit tests for DETECT-01 through DETECT-04 and SCHED-03
- `src/dispatch/dispatch.module.ts` — DispatchModule with providers and exports for both dispatch services

## Decisions Made

- Imported `DatabaseModule` explicitly in `DispatchModule` rather than relying on global resolution — `DatabaseModule` does not have `@Global()` decorator, so DatabaseScanService would not be auto-available to DispatchModule without explicit import
- `isRunning` guard reset in `finally` block — ensures the flag is cleared even if `getEligibleDatabases()` or any per-DB processing throws
- Per-DB processing errors are caught individually with `this.logger.error()` — a single failing database does not abort the rest of the cycle

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical Functionality] Added DatabaseModule import to DispatchModule**
- **Found during:** Task 2
- **Issue:** Plan stated "Do NOT import DatabaseModule — DatabaseScanService resolves globally" but DatabaseModule lacks `@Global()` decorator. Without explicit import, NestJS cannot resolve `DatabaseScanService` when `DispatchModule` is imported by `SchedulerModule` in plan 03. Runtime injection would fail.
- **Fix:** Added `DatabaseModule` to `DispatchModule`'s `imports` array
- **Files modified:** `src/dispatch/dispatch.module.ts`
- **Commit:** `8885cf0`
- **Verification:** `pnpm run build` exits 0, `pnpm test` exits 0 with 39 passing

## Known Stubs

None — all data flows are wired correctly.

## Issues Encountered

- Plan assumption that DatabaseScanService is globally available without @Global() was incorrect. Auto-fixed by importing DatabaseModule.

## Cumulative Test Count (Phase 2)

| Plan | Tests Added | Cumulative |
|------|-------------|------------|
| 02-01 (WebhookDispatchService) | 9 | 9 |
| 02-02 (RunDispatchService) | 11 | 20 |

Full suite across all phases: **39 tests passing**

## Next Phase Readiness

- `RunDispatchService.runCycle()` is tested and ready for `SchedulerService` (plan 03) to call on a cron interval
- `DispatchModule` is ready for import into `SchedulerModule`
- All DETECT-01 through DETECT-04 requirements met

---
*Phase: 02-core-dispatch-loop*
*Completed: 2026-03-25*

## Self-Check: PASSED

Files verified:
- FOUND: src/dispatch/run-dispatch.service.ts
- FOUND: src/dispatch/run-dispatch.service.spec.ts
- FOUND: src/dispatch/dispatch.module.ts

Commits verified:
- FOUND: 0ae393e (test(02-02): add failing tests for RunDispatchService)
- FOUND: 8885cf0 (feat(02-02): create DispatchModule)
