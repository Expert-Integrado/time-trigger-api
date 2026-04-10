---
phase: quick
plan: 260410-kbl
subsystem: dispatch
tags: [bug-fix, webhook, multi-bot, url-resolution]
dependency_graph:
  requires: []
  provides: [per-item-webhook-url-resolution]
  affects: [run-dispatch.service.ts]
tech_stack:
  added: []
  patterns: [per-item-continue-instead-of-section-skip]
key_files:
  modified:
    - src/dispatch/run-dispatch.service.ts
    - src/dispatch/run-dispatch.service.spec.ts
decisions:
  - "Outer URL guards replaced with per-item continue — items with botIdentifier can find their URL even when generic doc lacks it"
  - "Generic webhookUrl variable is now typed as string | undefined — allowed to be absent, used as fallback only"
metrics:
  duration: ~5min
  completed: 2026-04-10
---

# Phase quick Plan 260410-kbl: Fix outer webhook URL guards Summary

Per-item URL resolution in all 4 dispatch sections so multi-bot DBs where the generic webhooks doc lacks the URL key are no longer entirely skipped.

## Tasks Completed

| # | Task | Commit | Files |
|---|------|--------|-------|
| 1 | Remove outer URL guards, make URL resolution per-item | cceaf06 | run-dispatch.service.ts |
| 2 | Update existing tests and add 5 multi-bot scenario tests | cceaf06 | run-dispatch.service.spec.ts |

## What Was Built

Four locations in `RunDispatchService` previously had outer `if (!webhookUrl) { warn; skip/return }` guards that would abort entire dispatch sections (runs, FUPs in processDatabaseRuns, FUPs in processDatabaseFup, messages) when `webhooks.findOne({})` returned a document missing the relevant URL key.

In multi-bot databases like `sdr-grupofsa`, the first document (returned by `findOne({})`) may not have these keys — the actual URLs live in a second document keyed by `botIdentifier`. The outer guards caused every run/FUP/message to be missed.

**Fix applied to all 4 locations:**
- Removed outer guard entirely
- Generic URL variable is now `string | undefined` (allowed to be absent)
- Inside each loop, after rate limit check, URL is resolved: start with generic fallback, then override with bot-specific lookup if `botIdentifier` is present
- If final resolved URL is still `undefined`, log a per-item warning and `continue` — only that item is skipped, not the entire section

## Test Results

- 79 pre-existing tests: all pass
- 5 new multi-bot tests added: all pass
- Total: 84 tests passing

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check: PASSED

- `src/dispatch/run-dispatch.service.ts` — modified, exists
- `src/dispatch/run-dispatch.service.spec.ts` — modified, exists
- Commit `cceaf06` — exists in git log
