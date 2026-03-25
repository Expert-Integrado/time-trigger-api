---
phase: 02-core-dispatch-loop
plan: 01
subsystem: api
tags: [nestjs, mongodb, fetch, webhook, dispatch, retry, abort-signal]

# Dependency graph
requires:
  - phase: 01-foundation
    provides: MongoService singleton with db(name) handle, ConfigModule, NestJS project scaffolding
provides:
  - WebhookDispatchService with dispatch(db, run, webhookUrl) method
  - Atomic run claim via findOneAndUpdate with runStatus:'waiting' filter
  - Non-blocking single retry via setTimeout(60_000)
  - AbortSignal.timeout(10_000) on all fetch calls
  - 9 unit tests covering DISP-01 through DISP-06
affects:
  - 02-core-dispatch-loop plan 02 (RunDispatchService depends on WebhookDispatchService)
  - DispatchModule assembly in plan 02

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Atomic dispatch claim: findOneAndUpdate with {_id, runStatus:'waiting'} filter prevents duplicate dispatch"
    - "Non-blocking retry: setTimeout(fn, 60_000) — never awaited, fire-and-forget"
    - "Fetch timeout: AbortSignal.timeout(10_000) on every fetch call"
    - "Jest 30 fake timers: jest.spyOn(global, 'setTimeout') required after jest.useFakeTimers() for spy assertions"

key-files:
  created:
    - src/dispatch/webhook-dispatch.service.ts
    - src/dispatch/webhook-dispatch.service.spec.ts
  modified: []

key-decisions:
  - "Use Node 22 global fetch (no axios) — already available, no new dependency needed"
  - "WebhookDispatchService takes db as method param (not injected) — called from RunDispatchService which owns the Db handle"
  - "jest.spyOn(global, 'setTimeout') needed alongside jest.useFakeTimers() in Jest 30 for expect(setTimeout).toHaveBeenCalledWith assertions"

patterns-established:
  - "Atomic dispatch pattern: POST first, then findOneAndUpdate with runStatus:'waiting' filter — loser gets null"
  - "Non-blocking retry pattern: setTimeout fires once, no await, does not block the cycle"

requirements-completed: [DISP-01, DISP-02, DISP-03, DISP-04, DISP-05, DISP-06]

# Metrics
duration: 2min
completed: 2026-03-25
---

# Phase 02 Plan 01: WebhookDispatchService Summary

**NestJS injectable service that HTTP-POSTs run documents to webhook URLs with atomic MongoDB claim, 10s fetch timeout, and non-blocking 60s single retry**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-25T15:59:32Z
- **Completed:** 2026-03-25T16:01:54Z
- **Tasks:** 1
- **Files modified:** 2

## Accomplishments

- WebhookDispatchService implemented with `dispatch(db, run, webhookUrl)` public method
- Atomic `findOneAndUpdate` with `{ _id: run._id, runStatus: 'waiting' }` filter — concurrent cycles cannot double-claim a run
- `AbortSignal.timeout(10_000)` on every fetch call — hanging webhooks cannot stall the cycle
- Non-blocking `setTimeout(fn, 60_000)` retry — cycle completes immediately, retry fires after 1 minute
- 9 unit tests passing, covering all DISP-01 through DISP-06 requirements

## Task Commits

1. **Task 1: WebhookDispatchService spec (RED) + implementation (GREEN)** - `356b741` (feat)

**Plan metadata:** (see final commit)

_Note: TDD task — spec written first (RED), then implementation added (GREEN). Single combined commit._

## Files Created/Modified

- `src/dispatch/webhook-dispatch.service.ts` — WebhookDispatchService with dispatch() and private post() methods
- `src/dispatch/webhook-dispatch.service.spec.ts` — 9 unit tests for DISP-01 through DISP-06

## Decisions Made

- Used Node 22 global `fetch` instead of axios — no new dependency, cleaner with `AbortSignal.timeout()`
- `WebhookDispatchService.dispatch()` accepts `db: Db` as a method parameter rather than constructor injection — `RunDispatchService` (plan 02) will hold the Db handle and pass it in per call
- Jest 30 requires `jest.spyOn(global, 'setTimeout')` alongside `jest.useFakeTimers()` for `expect(setTimeout).toHaveBeenCalledWith(...)` assertions (behavior changed from Jest 29)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed Jest 30 fake timer spy compatibility**
- **Found during:** Task 1 (GREEN phase — running tests)
- **Issue:** Plan spec template used `expect(setTimeout).toHaveBeenCalledWith(...)` but in Jest 30, `jest.useFakeTimers()` does not automatically make `setTimeout` a spy/mock function — `expect(setTimeout)` fails with "received value must be a mock or spy function"
- **Fix:** Added `jest.spyOn(global, 'setTimeout')` call immediately after `jest.useFakeTimers()` in `beforeEach` block
- **Files modified:** `src/dispatch/webhook-dispatch.service.spec.ts`
- **Verification:** All 9 tests pass with `jest.spyOn(global, 'setTimeout')` — DISP-04 and DISP-06 setTimeout assertions work correctly
- **Committed in:** `356b741` (same task commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - bug fix)
**Impact on plan:** Minimal — single-line fix to spec `beforeEach` to match Jest 30 API. Implementation unchanged from plan spec.

## Issues Encountered

- Jest 30 changed fake timer behavior: `jest.useFakeTimers()` no longer auto-spies on `setTimeout`. Fixed with `jest.spyOn(global, 'setTimeout')`.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `WebhookDispatchService` is fully tested and ready for `RunDispatchService` (plan 02) to import and call
- Plan 02 will create `DispatchModule` wiring `WebhookDispatchService` + `RunDispatchService` together
- No blockers — all DISP requirements met and verified

---
*Phase: 02-core-dispatch-loop*
*Completed: 2026-03-25*
