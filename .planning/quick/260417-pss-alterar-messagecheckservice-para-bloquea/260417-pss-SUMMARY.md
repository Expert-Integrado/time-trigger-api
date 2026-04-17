---
phase: 260417-pss
plan: "01"
subsystem: dispatch
tags: [message-check, dependency-guard, tdd]
dependency_graph:
  requires: []
  provides: [broadened-message-dependency-guard]
  affects: [run-dispatch-service]
tech_stack:
  added: []
  patterns: [claim-first, tdd]
key_files:
  modified:
    - src/dispatch/message-check.service.ts
    - src/dispatch/message-check.service.spec.ts
decisions:
  - "Kept method name hasProcessingMessage unchanged to avoid cross-file rename"
  - "Changed only the findOne filter — signature and return semantics preserved"
metrics:
  duration: ~5min
  completed: "2026-04-17T21:37:38Z"
  tasks_completed: 1
  files_modified: 2
---

# Phase 260417-pss Plan 01: Broaden MessageCheckService Filter to $ne: 'done' Summary

**One-liner:** Changed `messageStatus: 'processing'` to `messageStatus: { $ne: 'done' }` in `hasProcessingMessage` so any non-done message (pending, processing, failed, etc.) blocks run dispatch.

## What Was Built

`MessageCheckService.hasProcessingMessage` now queries with `{ botIdentifier, chatDataId, messageStatus: { $ne: 'done' } }` instead of `{ botIdentifier, chatDataId, messageStatus: 'processing' }`. This broadens the dependency guard: before, only messages in `processing` state would block a run; now any message that has not reached `done` status will block it.

The method name, signature, and return type are intentionally unchanged. The call site in `run-dispatch.service.ts` (~lines 267-273) was not touched.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Broaden messages filter to block on any non-done status | 6968c91 | message-check.service.ts, message-check.service.spec.ts |

## Test Updates (4 tests)

1. **"returns true when a non-done message exists"** — renamed from "returns true when a processing message exists"; behavior identical (findOne returns doc → true).
2. **"returns false when no non-done message exists"** — renamed from "returns false when no processing message exists"; behavior identical (findOne returns null → false).
3. **"queries messages collection with botIdentifier, chatDataId, and messageStatus $ne 'done'"** — updated filter assertion from `messageStatus: 'processing'` to `messageStatus: { $ne: 'done' }`.
4. **"uses messageStatus $ne 'done' — not a fixed 'processing' match"** — replaced old `toBe('processing')` assertion with shape check: `typeof calledFilter.messageStatus === 'object'`, `calledFilter.messageStatus.$ne === 'done'`, and not equal to `'processing'` or `'pending'`.

## Verification

- `pnpm test -- src/dispatch/message-check.service.spec.ts`: 4/4 tests pass
- `pnpm test -- src/dispatch`: 125/125 tests pass (no regression in run-dispatch tests)
- `pnpm run lint`: 0 errors (1 pre-existing warning in `src/main.ts`, unrelated)

## Call Site Note

`run-dispatch.service.ts` was intentionally left untouched. The method name `hasProcessingMessage` is preserved to avoid a cross-file rename outside this quick task's scope. The broadened semantics are transparent to the caller.

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check

- [x] `src/dispatch/message-check.service.ts` modified with `$ne: 'done'` filter
- [x] `src/dispatch/message-check.service.spec.ts` updated with 4 passing tests
- [x] Commit 6968c91 exists and is correct
- [x] No other files modified
