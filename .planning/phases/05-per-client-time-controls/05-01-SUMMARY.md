---
phase: 05-per-client-time-controls
plan: 01
subsystem: dispatch
tags: [mongodb, nestjs, cron, timeTrigger, allowedDays, per-client]

# Dependency graph
requires:
  - phase: 04-database-targeting
    provides: TARGET_DATABASES filter in DatabaseScanService
provides:
  - timeTrigger per-client control logic in RunDispatchService
  - TimeTriggerConfig interface with enabled, morningLimit, nightLimit, allowedDays
  - isAllowedDay() day-of-week gate method
  - 8 new TDD tests covering TRIG-01 to TRIG-06
affects: [future per-client config changes, vars schema evolution]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "timeTrigger object in vars replaces root-level morningLimit/nightLimit"
    - "enabled flag checked before time/day gates — short-circuit evaluation order"
    - "isAllowedDay() uses new Date().getDay() with TZ env for Brazil time"

key-files:
  created: []
  modified:
    - src/dispatch/run-dispatch.service.ts
    - src/dispatch/run-dispatch.service.spec.ts

key-decisions:
  - "timeTrigger absence from vars causes skip (not error) — warn + return pattern"
  - "Verification order: enabled -> time window -> day-of-week -> webhooks -> runs (fail fast)"
  - "isAllowedDay reads new Date().getDay() directly, TZ=America/Sao_Paulo handles Brazil time"

patterns-established:
  - "Per-client control: each database vars document controls its own timeTrigger independently"
  - "TDD RED-GREEN-REFACTOR: failing tests committed before implementation"

requirements-completed: [TRIG-01, TRIG-02, TRIG-03, TRIG-04, TRIG-05, TRIG-06]

# Metrics
duration: 2min
completed: 2026-03-25
---

# Phase 5 Plan 01: timeTrigger Per-Client Controls Summary

**RunDispatchService refactored to read timeTrigger object from vars, adding enabled flag, day-of-week allowedDays gate, and removing root-level morningLimit/nightLimit**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-25T18:00:28Z
- **Completed:** 2026-03-25T18:03:00Z
- **Tasks:** 3 (RED + GREEN + REFACTOR)
- **Files modified:** 2

## Accomplishments

- New `TimeTriggerConfig` interface with `enabled`, `morningLimit`, `nightLimit`, `allowedDays` fields
- `VarsDoc` interface simplified to `{ timeTrigger?: TimeTriggerConfig }` — root-level fields removed
- `processDatabase()` rewritten with 4-gate verification: timeTrigger presence, enabled flag, time window, day-of-week
- New `isAllowedDay(allowedDays: number[])` method using `new Date().getDay()`
- 8 new TDD tests covering TRIG-01 through TRIG-06 — all 59 tests passing (zero regressions)

## Task Commits

Each TDD phase was committed atomically:

1. **FASE RED: failing tests for timeTrigger controls** - `b6ec7d7` (test)
2. **FASE GREEN: implement timeTrigger per-client controls** - `5654bbd` (feat)
3. **FASE REFACTOR: prettier formatting** - `96b8f4f` (refactor)

## Files Created/Modified

- `src/dispatch/run-dispatch.service.ts` - Refactored with TimeTriggerConfig interface, updated processDatabase(), new isAllowedDay() method
- `src/dispatch/run-dispatch.service.spec.ts` - Updated withinWindowVars to timeTrigger structure, added getDay() mocks, added 8 new TRIG-* tests

## Decisions Made

- **timeTrigger absence = warn + skip (not error):** Consistent with existing pattern for missing webhooks URL. Databases without timeTrigger config are simply not processed, no crash.
- **Verification order — enabled before time/day gates:** enabled=false is the cheapest check (no Date calls), so it's done first.
- **isAllowedDay uses TZ env convention:** Same `TZ=America/Sao_Paulo` env var that controls `getHours()` also applies to `getDay()` — consistent Brazil time throughout.

## Deviations from Plan

None — plan executed exactly as written. Prettier auto-formatted warn() calls to single-line during REFACTOR phase (cosmetic only, committed in refactor commit).

## Issues Encountered

None. All 59 tests passed on first GREEN run.

## Out-of-Scope Lint Issues Found

Pre-existing lint errors in unrelated files were observed during `pnpm run lint` but are out of scope for this plan:
- `src/mongo/mongo.service.ts` — unsafe-return / no-unsafe-call / no-unsafe-member-access
- `src/mongo/mongo.service.spec.ts` — unbound-method
- `src/scheduler/scheduler.service.spec.ts` — unbound-method (multiple)
- `src/main.ts` — no-floating-promises

These were logged but not fixed per deviation scope rules.

## Next Phase Readiness

- All TRIG requirements (TRIG-01 to TRIG-06) implemented and tested
- v1.1 milestone requirements complete: TARGET_DATABASES (Phase 04) + timeTrigger controls (Phase 05)
- No blockers for milestone completion

---
*Phase: 05-per-client-time-controls*
*Completed: 2026-03-25*

## Self-Check: PASSED

- FOUND: src/dispatch/run-dispatch.service.ts
- FOUND: src/dispatch/run-dispatch.service.spec.ts
- FOUND: .planning/phases/05-per-client-time-controls/05-01-SUMMARY.md
- FOUND commits: b6ec7d7, 5654bbd, 96b8f4f
- Tests: 59 passed, 8 suites (zero failures)
