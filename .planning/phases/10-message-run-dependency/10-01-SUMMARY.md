---
phase: 10-message-run-dependency
plan: 01
subsystem: dispatch
tags: [mongodb, message-dependency, run-blocking, processingStartedAt]

# Dependency graph
requires:
  - phase: 09-rate-limiting
    provides: "RunDispatchService with rateLimitRuns guard and boolean dispatch returns"
provides:
  - "MessageCheckService with hasProcessingMessage(db, botIdentifier, chatDataId)"
  - "processingStartedAt timestamp in both $set paths of dispatchMessage"
  - "Dependency guard in processDatabaseRuns blocking runs with matching processing message"
  - "MessageCheckService registered in DispatchModule providers and exports"
affects: [11-timeout-recovery]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Dependency guard: rate limit check first (in-memory, free), then DB query — avoids unnecessary MongoDB queries for runs already hitting the rate limit"
    - "findOne instead of countDocuments for presence check — stops at first match, more efficient"
    - "botIdentifier read from run document directly, not from vars — avoids cross-document join"

key-files:
  created:
    - src/dispatch/message-check.service.ts
  modified:
    - src/dispatch/webhook-dispatch.service.ts
    - src/dispatch/run-dispatch.service.ts
    - src/dispatch/dispatch.module.ts
    - src/dispatch/run-dispatch.service.spec.ts

key-decisions:
  - "MessageCheckService uses findOne (not countDocuments) — stops at first match per research anti-pattern guidance"
  - "botIdentifier comes from run document directly, NOT from vars (D-01)"
  - "Only 'processing' messageStatus blocks — 'pending' does not block (DEP-05)"
  - "Blocked runs use 'continue' (not 'break') — only this run is skipped, rest proceed"
  - "Guard silently skips check when botIdentifier or chatDataId absent — safe default for legacy documents"

patterns-established:
  - "Dependency check pattern: extract fields from document, check presence, query DB, log warn + continue on block"

requirements-completed: [DEP-01, DEP-02, DEP-03, DEP-04, DEP-05]

# Metrics
duration: 4min
completed: 2026-03-30
---

# Phase 10 Plan 01: Message-Run Dependency Summary

**MessageCheckService injectable with hasProcessingMessage query, processingStartedAt added to both dispatchMessage $set paths, and run dispatch loop guarded against in-flight messages by botIdentifier + chatDataId**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-30T13:17:05Z
- **Completed:** 2026-03-30T13:21:20Z
- **Tasks:** 2
- **Files modified:** 5 (4 source + 1 test)

## Accomplishments
- Created MessageCheckService with hasProcessingMessage(db, botIdentifier, chatDataId) using findOne query targeting messageStatus: 'processing'
- Added processingStartedAt: new Date() to both $set paths in dispatchMessage (main path and retry path) — prerequisite for Phase 11 timeout recovery
- Added dependency guard to processDatabaseRuns run loop: after rate limit check, before dispatch — blocked runs log at warn level and continue to next run
- All 129 tests pass, lint clean

## Task Commits

Each task was committed atomically:

1. **Task 1: Create MessageCheckService and add processingStartedAt** - `5d8f049` (feat)
2. **Task 2: Add dependency guard to processDatabaseRuns** - `dadeff4` (feat)
3. **Deviation: Add MessageCheckService mock to test module** - `22eb976` (test)
4. **Deviation: Fix unused variable and lint formatting** - `ca8c9d5` (test)

**Plan metadata:** (docs commit below)

## Files Created/Modified
- `src/dispatch/message-check.service.ts` - New service: hasProcessingMessage query using findOne on messages collection
- `src/dispatch/webhook-dispatch.service.ts` - Added processingStartedAt: new Date() to both $set paths in dispatchMessage
- `src/dispatch/run-dispatch.service.ts` - Injected MessageCheckService; added dependency guard after rate limit check in run loop
- `src/dispatch/dispatch.module.ts` - Added MessageCheckService to providers and exports arrays
- `src/dispatch/run-dispatch.service.spec.ts` - Added MessageCheckService mock provider to both TestingModule setups

## Decisions Made
- Used findOne (not countDocuments) for hasProcessingMessage — stops at first match, more efficient
- botIdentifier extracted from run document directly (not from vars) — no cross-document join needed
- Guard positioned after rate limit check and before dispatch — rate limit is in-memory (free), DB query has cost
- Blocked runs use `continue` not `break` — only the blocked run is skipped, other runs in the same cycle still dispatch
- Missing botIdentifier or chatDataId on a run document silently bypasses the guard — safe default for legacy documents

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Added MessageCheckService mock to RunDispatchService test module**
- **Found during:** Task 2 (add dependency guard) — discovered when running test suite
- **Issue:** Adding MessageCheckService as 4th constructor parameter caused 49 existing tests to fail with "Cannot lookup component" injection error — test module had no provider for the new dependency
- **Fix:** Added `{ provide: MessageCheckService, useValue: { hasProcessingMessage: jest.fn().mockResolvedValue(false) } }` to both the main `beforeEach` TestingModule and the `buildServiceWithLimit` helper
- **Files modified:** src/dispatch/run-dispatch.service.spec.ts
- **Verification:** All 129 tests pass after fix
- **Committed in:** 22eb976 + ca8c9d5 (lint cleanup follow-up)

---

**Total deviations:** 1 auto-fixed (Rule 1 - broken tests from new constructor dependency)
**Impact on plan:** Fix essential for test suite validity. No scope creep — only wired the mock that was already implied.

## Issues Encountered
- Lint auto-formatted webhook-dispatch.service.ts (multi-line $set object) and flagged an unused `messageCheckService` variable in the test — both resolved in the cleanup commit.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 11 can now implement timeout recovery using processingStartedAt field
- MessageCheckService is injectable and available for any future consumers via DispatchModule exports
- Blocker from STATE.md (confirm chatDataId field in production data) remains — but the implementation safely skips the guard when chatDataId is absent, so it degrades gracefully

## Self-Check: PASSED
- All 4 source files created/modified confirmed on disk
- All 4 task commits verified in git log (5d8f049, dadeff4, 22eb976, ca8c9d5)

---
*Phase: 10-message-run-dependency*
*Completed: 2026-03-30*
