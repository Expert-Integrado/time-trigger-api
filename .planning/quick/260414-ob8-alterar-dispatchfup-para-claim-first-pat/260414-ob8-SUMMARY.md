---
phase: quick-260414-ob8
plan: 01
subsystem: dispatch
tags: [refactor, fup-dispatch, claim-first, atomicity]
dependency_graph:
  requires: []
  provides: [claim-first-fup-dispatch]
  affects: [fup-dispatch-flow]
tech_stack:
  added: []
  patterns: [claim-first-dispatch, atomic-status-update, revert-on-failure]
key_files:
  created: []
  modified:
    - src/dispatch/webhook-dispatch.service.ts
decisions:
  - decision: "Claim-first pattern for FUP dispatch"
    rationale: "Prevents duplicate dispatches by atomically claiming FUP before POST"
    alternatives: ["POST-first (original pattern)", "Two-phase commit"]
    chosen: "Claim-first with revert-on-failure"
  - decision: "Retry also uses claim-first pattern"
    rationale: "Ensures retry doesn't double-dispatch if original eventually succeeds"
    alternatives: ["Retry without claim", "Skip retry if already claimed"]
    chosen: "Retry with claim-first"
metrics:
  duration: "~1 min"
  completed_date: "2026-04-14T20:35:16Z"
  tasks_completed: 1
  files_modified: 1
  commits: 1
---

# Quick Task 260414-ob8: Alterar dispatchFup para claim-first pattern

**One-liner:** Refactored FUP dispatch to atomically claim status before webhook POST with revert-on-failure pattern

## Objective

Refactor `dispatchFup` method to use "claim-first" pattern: atomically update FUP status from 'on' to 'queued' BEFORE sending POST to webhook, then revert to 'on' if POST fails. This prevents duplicate FUP dispatches while allowing retries for failed webhooks.

## Tasks Completed

### Task 1: Refactor dispatchFup to claim-first pattern
**Status:** ✅ Complete
**Commit:** 6312550
**Files:** src/dispatch/webhook-dispatch.service.ts

**Implementation:**

1. **Atomic claim first**: Uses `findOneAndUpdate` to atomically update status from 'on' to 'queued' BEFORE calling `post()`
   - Filter: `{ _id: fupId, status: 'on' }`
   - Update: `{ $set: { status: 'queued' } }`
   - If result is null → FUP already claimed, log warning, return false

2. **POST to webhook**: Calls `this.post(webhookUrl, fup)` AFTER successful claim

3. **Revert on failure**: If POST returns false:
   - Immediately reverts status: `findOneAndUpdate({ _id: fupId, status: 'queued' }, { $set: { status: 'on' } })`
   - Schedules 60s retry (existing retry logic preserved)
   - Retry follows same pattern: claim → POST → revert-if-fail

4. **Success path**: If POST returns true, keeps status as 'queued', returns true

**Flow comparison:**

*Before (POST-first):*
```
POST → if success → claim (status 'on' → 'queued')
     → if fail → retry after 60s
```

*After (claim-first):*
```
Claim (status 'on' → 'queued') → if claimed → POST
                                → if fail → revert (status 'queued' → 'on') → retry after 60s
                                → if success → keep 'queued'
```

**Verification:** Lint passed ✅

## Deviations from Plan

None - plan executed exactly as written.

## Known Stubs

None - no stubs introduced.

## Threat Flags

None - no new security surface added.

## Impact

**Changed behavior:**
- FUPs are now claimed BEFORE webhook POST (prevents race conditions)
- Failed POST reverts FUP status to 'on' (enables retry by next cycle)
- Retry logic also uses claim-first pattern (prevents double-dispatch)

**Consistency with runs/messages:**
- Runs: POST-first pattern (once queued, stays queued)
- Messages: POST-first pattern (once processing, stays processing)
- FUPs: **Now claim-first pattern** (can revert to 'on' on failure)

**Rationale for difference:** FUPs need revert-on-failure because failed dispatches should return to 'on' state for retry, unlike runs/messages which stay in their queued/processing states.

## Self-Check

**Files created:** None (modification only)

**Files modified:**
```bash
[ -f "src/dispatch/webhook-dispatch.service.ts" ] && echo "FOUND: src/dispatch/webhook-dispatch.service.ts" || echo "MISSING: src/dispatch/webhook-dispatch.service.ts"
```
FOUND: src/dispatch/webhook-dispatch.service.ts ✅

**Commits:**
```bash
git log --oneline --all | grep -q "6312550" && echo "FOUND: 6312550" || echo "MISSING: 6312550"
```
FOUND: 6312550 ✅

## Self-Check: PASSED

All files modified as expected, commit exists in git history.
