---
phase: quick-260417-peb
plan: "01"
subsystem: dispatch
tags: [perf, mongodb, query, sort, runs]
dependency_graph:
  requires: []
  provides: [runs-query-sorted-by-createdAt]
  affects: [src/dispatch/run-dispatch.service.ts]
tech_stack:
  added: []
  patterns: [cursor-chaining, tdd-red-green]
key_files:
  modified:
    - src/dispatch/run-dispatch.service.ts
    - src/dispatch/run-dispatch.service.spec.ts
decisions:
  - Only the runs query in processDatabaseRuns() received .sort() — FUP and messages queries are out of scope per task description
  - Mock cursor in makeDb and makeDbWithRecovery both updated to support .sort() chaining via mockRunsFind.sort = jest.fn().mockReturnValue(mockRunsFind)
metrics:
  duration: ~5 min
  completed: "2026-04-17"
  tasks_completed: 1
  files_modified: 2
---

# Phase quick-260417-peb Plan 01: Sort Runs Query by createdAt Ascending Summary

**One-liner:** Runs query in `processDatabaseRuns()` now chains `.sort({ createdAt: 1 })` before `.toArray()` so the oldest waiting runs are dispatched first within each cycle.

## What Changed

- `src/dispatch/run-dispatch.service.ts` — Added `.sort({ createdAt: 1 })` between `.find(...)` and `.toArray()` in the DETECT-01 block inside `processDatabaseRuns()`. FUP query (line ~322) and messages query (line ~470) are untouched.
- `src/dispatch/run-dispatch.service.spec.ts` — Updated both `makeDb` and `makeDbWithRecovery` helpers so `mockRunsFind` carries a `.sort()` mock that returns itself (chaining). Added new test `(DETECT-01-SORT)` asserting `.sort({ createdAt: 1 })` is called.

## Test Results

- **New test:** `(DETECT-01-SORT) runs query is sorted by createdAt ascending` — PASSES
- **Regression:** `(DETECT-01) queries runs collection with runStatus:waiting and waitUntil <= now` — PASSES
- **Full suite:** 175 tests across 9 suites — all PASS
- **Lint:** clean (1 pre-existing warning in `main.ts`, unrelated)

## Commits

| Hash | Message |
|------|---------|
| dce030f | ⚡️ perf(quick-260417-peb): sort runs query by createdAt ascending |

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check: PASSED

- `src/dispatch/run-dispatch.service.ts` contains `.sort({ createdAt: 1 })` at line 256 — FOUND
- `src/dispatch/run-dispatch.service.spec.ts` contains `(DETECT-01-SORT)` test — FOUND
- Commit `dce030f` exists — FOUND
- `grep -c "\.sort(" src/dispatch/run-dispatch.service.ts` returns 1 — CONFIRMED
