---
phase: 06-fup-dispatch
plan: 01
subsystem: dispatch
tags: [mongodb, webhook, fup, tdd, cron]

# Dependency graph
requires:
  - phase: 05-per-client-time-controls
    provides: timeTrigger gates (morningLimit, nightLimit, allowedDays) already applied in processDatabase()
  - phase: 02-core-dispatch-loop
    provides: dispatch() pattern in WebhookDispatchService and processDatabase() structure
provides:
  - dispatchFup() method in WebhookDispatchService — atomic FUP claim and dispatch with single retry
  - FUP detection block in processDatabase() — queries fup collection after runs loop
affects: [future-fup-enhancements, integration-tests]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "FUP dispatch mirrors runs dispatch: same post()/retry pattern, different collection and status field"
    - "Atomic claim: findOneAndUpdate({ _id, status: 'on' }) prevents duplicate FUP dispatch"
    - "FUP dispatch is pure addition after runs loop — no modification to existing runs flow"

key-files:
  created: []
  modified:
    - src/dispatch/webhook-dispatch.service.ts
    - src/dispatch/webhook-dispatch.service.spec.ts
    - src/dispatch/run-dispatch.service.ts
    - src/dispatch/run-dispatch.service.spec.ts

key-decisions:
  - "dispatchFup() is a separate method (not a generalized dispatch()) — keeps runs dispatch isolated and avoids breaking changes"
  - "Missing FUP URL logs warn but does not interrupt runs dispatch — partial config is valid"
  - "FUP $set uses only { status: 'queued' } — no queuedAt field, different from runs dispatch"
  - "FUP query uses nextInteractionTimestamp $lte Date.now() — different field from runs' waitUntil"

patterns-established:
  - "New dispatch types: add dedicated method to WebhookDispatchService, add detection block in processDatabase()"
  - "Missing webhook URL: warn + skip that dispatch type, continue processing other dispatches"

requirements-completed: [FUP-01, FUP-02, FUP-03, FUP-04, FUP-05, FUP-06, FUP-07, FUP-08, FUP-09]

# Metrics
duration: 4min
completed: 2026-03-26
---

# Phase 06 Plan 01: FUP Dispatch Summary

**FUP dispatch added to existing cron cycle: dispatchFup() with atomic { _id, status: 'on' } claim and single 60s retry, querying fup collection via nextInteractionTimestamp $lte Date.now()**

## Performance

- **Duration:** ~4 min
- **Started:** 2026-03-26T15:13:26Z
- **Completed:** 2026-03-26T15:17:13Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- Added `dispatchFup()` to `WebhookDispatchService` — mirrors `dispatch()` but targets `fup` collection with `{ status: 'on' }` atomic claim and no `queuedAt`
- Added FUP detection block in `processDatabase()` after runs loop — pure addition, existing runs dispatch unchanged
- 15 new tests (9 in webhook-dispatch spec + 6 in run-dispatch spec) covering FUP-01 through FUP-09, all GREEN

## Task Commits

Each task was committed atomically:

1. **Task 1: dispatchFup() em WebhookDispatchService (RED → GREEN)** - `f63e327` (feat)
2. **Task 2: FUP block em processDatabase() (RED → GREEN)** - `8d10312` (feat)

**Plan metadata:** (docs commit — see below)

_Note: TDD tasks committed as feat since tests + implementation were committed together per GREEN commit._

## Files Created/Modified

- `src/dispatch/webhook-dispatch.service.ts` - Added `dispatchFup()` method
- `src/dispatch/webhook-dispatch.service.spec.ts` - Added 9 FUP tests (describe block)
- `src/dispatch/run-dispatch.service.ts` - Added FUP field to WebhookDoc interface + FUP detection block in processDatabase()
- `src/dispatch/run-dispatch.service.spec.ts` - Updated makeDb() with fups param + 6 new FUP tests

## Decisions Made

- `dispatchFup()` implemented as a separate method (not a generalized dispatch with options) to keep runs dispatch fully isolated and avoid introducing breaking changes
- Missing FUP URL emits warn and skips FUP dispatch only — runs dispatch already completed and is unaffected
- FUP `$set` contains only `{ status: 'queued' }` with no `queuedAt` field, per spec
- ESLint auto-formatted `'FUP'?: string` → `FUP?: string` in interface — semantically equivalent

## Deviations from Plan

None — plan executed exactly as written. ESLint auto-format on `WebhookDoc` interface key quotes is cosmetic and not a deviation.

## Issues Encountered

None. Build and lint passed clean after implementation.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- v1.2 milestone complete: FUPs are now dispatched with the same reliability guarantees as runs
- Both dispatch types protected by atomic findOneAndUpdate — no duplicate dispatches
- Total test suite: 74 passing (up from ~49 before phase)
- Ready for v1.3 or production monitoring phase

---
*Phase: 06-fup-dispatch*
*Completed: 2026-03-26*

## Self-Check: PASSED

- SUMMARY.md created at .planning/phases/06-fup-dispatch/06-01-SUMMARY.md
- Task 1 commit f63e327 exists
- Task 2 commit 8d10312 exists
