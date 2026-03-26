---
phase: 07-messages-dispatch
plan: 01
subsystem: dispatch
tags: [messages, webhook-dispatch, tdd, no-time-gate]
dependency_graph:
  requires: []
  provides: [dispatchMessage, messages-block-in-processDatabase]
  affects: [webhook-dispatch.service.ts, run-dispatch.service.ts]
tech_stack:
  added: []
  patterns: [atomic-claim-pattern, retry-on-failure, no-time-gate]
key_files:
  created: []
  modified:
    - src/dispatch/webhook-dispatch.service.ts
    - src/dispatch/webhook-dispatch.service.spec.ts
    - src/dispatch/run-dispatch.service.ts
    - src/dispatch/run-dispatch.service.spec.ts
decisions:
  - "Messages dispatch runs outside the timeTrigger block — restructured processDatabase() from early-returns to if-else to allow messages to run even when timeTrigger is absent/disabled/out-of-window"
  - "Webhooks collection is read twice per cycle — once inside timeTrigger block (for runs/FUP), once outside for messages — intentional, keeps logic simple, aligns with fresh-read pattern"
  - "Atomic claim uses { _id, messageStatus: 'pending' } filter and transitions to 'processing' on success — prevents duplicate dispatch"
metrics:
  duration: "~4 min"
  completed_date: "2026-03-26"
  tasks_completed: 2
  files_modified: 4
---

# Phase 07 Plan 01: Messages Dispatch Summary

**One-liner:** Messages dispatch with `dispatchMessage()` method and no-time-gate block in `processDatabase()` — atomic claim via `messageStatus: 'pending' → 'processing'`.

## What Was Built

### Task 1: `dispatchMessage()` in WebhookDispatchService

Added `dispatchMessage(db: Db, message: Document, webhookUrl: string): Promise<void>` method to `WebhookDispatchService`, following the exact same pattern as `dispatchFup()`:

- POSTs message document as JSON with `Content-Type: application/json` and `AbortSignal.timeout(10_000)`
- On success: calls `db.collection('messages').findOneAndUpdate({ _id: messageId, messageStatus: 'pending' }, { $set: { messageStatus: 'processing' } })` atomically
- On failed POST: schedules single retry via `setTimeout(retryFn, 60_000)`
- On retry failure: leaves message as `'pending'` for next cycle
- If `findOneAndUpdate` returns null: logs warn `"Message <id> already claimed by another cycle"`

### Task 2: Messages block in `processDatabase()`

Extended `RunDispatchService.processDatabase()` with a messages dispatch block that runs **outside** the timeTrigger gate:

- Extended `WebhookDoc` interface: added `'mensagens pendentes'?: string`
- Restructured `processDatabase()` from early-return pattern to if-else so the messages block always executes regardless of timeTrigger state
- Messages block queries `db.collection('messages').find({ messageStatus: 'pending' })` — no timestamp condition
- Reads `'mensagens pendentes'` webhook URL from webhooks collection (fresh read per cycle)
- Missing URL: logs warn containing `"mensagens pendentes"` and skips — runs/FUP dispatch unaffected
- Calls `dispatchMessage()` for each eligible message

## Tests Added (MSG-01 to MSG-09)

### webhook-dispatch.service.spec.ts (new `dispatchMessage` describe block):
- `(MSG-04)` POSTs message document as JSON to webhookUrl
- `(MSG-04)` includes AbortSignal.timeout(10000)
- `(MSG-05)` calls findOneAndUpdate on messages collection when POST succeeds
- `(MSG-06)` findOneAndUpdate filter includes `{ _id: messageId, messageStatus: "pending" }`
- `(MSG-05)` findOneAndUpdate $set contains `{ messageStatus: "processing" }`
- `(MSG-07)` schedules retry via setTimeout(60000) when POST fails
- `(MSG-07)` retry calls findOneAndUpdate when retry POST succeeds
- `(MSG-08)` does NOT call findOneAndUpdate when retry also fails
- fetch throw treated as failure (schedules retry, does not propagate)

### run-dispatch.service.spec.ts (new Messages tests section):
- `(MSG-01)` queries messages collection with `{ messageStatus: "pending" }` — no timestamp condition
- `(MSG-02)` messages dispatched even when currentHour is outside morningLimit/nightLimit
- `(MSG-03)` messages dispatched even when currentDay is not in allowedDays
- `(MSG-02/MSG-03)` messages dispatched even when timeTrigger is absent in vars
- `(MSG-09)` dispatchMessage called in same processDatabase() call as dispatch and dispatchFup
- mensagens pendentes URL absent → logs warn, skips messages, runs still dispatched
- dispatchMessage called once per eligible message

## Decisions Made

1. **if-else vs early-returns:** Restructured `processDatabase()` from early-return pattern to if-else chain to allow the messages block to execute even when timeTrigger gates trigger. Early returns for timeTrigger would have required extracting the block into a helper — the if-else approach is simpler and keeps all existing tests green.

2. **Double webhooks read:** The webhooks collection is read twice per `processDatabase()` call — once inside the timeTrigger block (for runs/FUP) and once outside (for messages). This is intentional: it keeps the messages block fully self-contained and aligns with the DETECT-03 "fresh read every cycle" pattern.

3. **No queuedAt on messages:** Unlike `runStatus: 'queued'` (which sets `queuedAt: new Date()`), message status transitions to `'processing'` with no timestamp — consistent with `dispatchFup()` pattern.

## Deviations from Plan

None — plan executed exactly as written.

## Commits

- `0ce9132` — `feat(07-01): implement dispatchMessage() in WebhookDispatchService`
- `d8a4253` — `feat(07-01): add messages dispatch block to processDatabase()`

## Self-Check: PASSED

- `src/dispatch/webhook-dispatch.service.ts` — FOUND
- `src/dispatch/run-dispatch.service.ts` — FOUND
- `pnpm test` — 90 tests, 8 suites, 0 failures
- `pnpm run lint` — 0 errors (1 pre-existing warning in main.ts)
- `pnpm run build` — clean compile
