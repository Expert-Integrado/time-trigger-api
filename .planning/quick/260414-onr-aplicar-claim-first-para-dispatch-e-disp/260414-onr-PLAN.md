---
phase: quick-260414-onr
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/dispatch/webhook-dispatch.service.ts
  - src/dispatch/webhook-dispatch.service.spec.ts
autonomous: true
requirements: [RELIABILITY-01]

must_haves:
  truths:
    - "dispatch() atomically claims run before POST (same as dispatchFup)"
    - "dispatchMessage() atomically claims message before POST (same as dispatchFup)"
    - "Failed POST reverts status to original value"
    - "Retry path also uses claim-first pattern with revert on failure"
  artifacts:
    - path: "src/dispatch/webhook-dispatch.service.ts"
      provides: "dispatch() and dispatchMessage() with claim-first pattern"
      min_lines: 150
    - path: "src/dispatch/webhook-dispatch.service.spec.ts"
      provides: "Updated tests verifying claim-first behavior"
      min_lines: 600
  key_links:
    - from: "dispatch()"
      to: "runs collection"
      via: "findOneAndUpdate before POST"
      pattern: "findOneAndUpdate.*waiting.*queued"
    - from: "dispatchMessage()"
      to: "messages collection"
      via: "findOneAndUpdate before POST"
      pattern: "findOneAndUpdate.*pending.*processing"
---

<objective>
Apply claim-first pattern to `dispatch()` and `dispatchMessage()` methods in webhook-dispatch.service.ts, matching the pattern already implemented in `dispatchFup()`.

**Purpose:** Prevent duplicate dispatches by atomically claiming the document before sending webhook POST. If POST fails, revert the status so the next cycle can retry.

**Output:** Both methods follow claim-first pattern: 1) Update status in DB, 2) POST to webhook, 3) Revert status if POST fails.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@src/dispatch/webhook-dispatch.service.ts
@src/dispatch/webhook-dispatch.service.spec.ts

**Pattern reference:** The `dispatchFup()` method (lines 46-113) already implements the claim-first pattern correctly:
1. Claim first: `findOneAndUpdate({ _id, status: 'on' }, { $set: { status: 'queued' } })`
2. If claim fails (null result), return false
3. POST to webhook
4. If POST fails, revert: `findOneAndUpdate({ _id, status: 'queued' }, { $set: { status: 'on' } })`
5. Retry also uses claim-first pattern

**Apply this same pattern to:**
- `dispatch()` - transitions `waiting` → `queued` (with `queuedAt`)
- `dispatchMessage()` - transitions `pending` → `processing` (with `processingStartedAt`)
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Refactor dispatch() to use claim-first pattern</name>
  <files>src/dispatch/webhook-dispatch.service.ts</files>
  <behavior>
    - Initial claim: atomically update runStatus 'waiting' → 'queued' before POST
    - If claim returns null, log warning and return false (already claimed)
    - If claim succeeds, POST to webhook
    - If POST fails, revert status 'queued' → 'waiting' (remove queuedAt)
    - Retry path: same claim-first pattern (claim → POST → revert on failure)
  </behavior>
  <action>
Refactor the `dispatch()` method to match the claim-first pattern from `dispatchFup()`:

1. **Move findOneAndUpdate BEFORE the POST call**
   - Extract runId at the start
   - Call `db.collection('runs').findOneAndUpdate({ _id: runId, runStatus: 'waiting' }, { $set: { runStatus: 'queued', queuedAt: new Date() } })`
   - If result is null, log warning and return false

2. **POST after successful claim**
   - Call `this.post(webhookUrl, run)`
   - If POST fails, REVERT the claim: `findOneAndUpdate({ _id: runId, runStatus: 'queued' }, { $set: { runStatus: 'waiting' } })` (remove queuedAt)

3. **Update retry path to use claim-first**
   - Retry should ALSO claim first, then POST, then revert on failure
   - Follow the same pattern as dispatchFup retry (lines 78-106)

**Pattern to follow:** dispatchFup() lines 46-113 — identical structure with different field names (runStatus vs status, runs vs fup collection).
  </action>
  <verify>
    <automated>pnpm test -- webhook-dispatch.service.spec.ts</automated>
  </verify>
  <done>dispatch() uses claim-first pattern, existing tests pass, no POST happens before atomic claim</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Refactor dispatchMessage() to use claim-first pattern</name>
  <files>src/dispatch/webhook-dispatch.service.ts</files>
  <behavior>
    - Initial claim: atomically update messageStatus 'pending' → 'processing' before POST
    - If claim returns null, log warning and return false
    - If claim succeeds, POST to webhook
    - If POST fails, revert status 'processing' → 'pending' (remove processingStartedAt)
    - Retry path: same claim-first pattern (claim → POST → revert on failure)
  </behavior>
  <action>
Refactor the `dispatchMessage()` method to match the claim-first pattern from `dispatchFup()`:

1. **Move findOneAndUpdate BEFORE the POST call**
   - Extract messageId at the start
   - Call `db.collection('messages').findOneAndUpdate({ _id: messageId, messageStatus: 'pending' }, { $set: { messageStatus: 'processing', processingStartedAt: new Date() } })`
   - If result is null, log warning and return false

2. **POST after successful claim**
   - Call `this.post(webhookUrl, message)`
   - If POST fails, REVERT the claim: `findOneAndUpdate({ _id: messageId, messageStatus: 'processing' }, { $set: { messageStatus: 'pending' } })` (remove processingStartedAt by not including it)

3. **Update retry path to use claim-first**
   - Retry should ALSO claim first, then POST, then revert on failure
   - Follow the same pattern as dispatchFup retry (lines 78-106)

**Pattern to follow:** dispatchFup() lines 46-113 — identical structure with different field names (messageStatus vs status, messages vs fup collection).
  </action>
  <verify>
    <automated>pnpm test -- webhook-dispatch.service.spec.ts</automated>
  </verify>
  <done>dispatchMessage() uses claim-first pattern, processingStartedAt still set on claim, tests pass</done>
</task>

<task type="auto">
  <name>Task 3: Update tests to verify claim-first behavior</name>
  <files>src/dispatch/webhook-dispatch.service.spec.ts</files>
  <action>
Update the test suite to verify the claim-first pattern for both `dispatch()` and `dispatchMessage()`:

**For dispatch() tests:**
1. Update "calls findOneAndUpdate when POST succeeds" test:
   - Change expectation: findOneAndUpdate should be called ONCE (claim only, since POST succeeds)
   - NOT twice — the old pattern called it after POST

2. Add test: "reverts status when POST fails (claim-first pattern)"
   - Mock: POST fails with `{ ok: false }`
   - Verify: 2 findOneAndUpdate calls
     - Call 1: claim (waiting→queued)
     - Call 2: revert (queued→waiting)

3. Update retry test to verify claim-first:
   - When retry succeeds: 3 total calls (initial claim, initial revert, retry claim)
   - When retry fails: 4 total calls (initial claim, initial revert, retry claim, retry revert)

**For dispatchMessage() tests:**
Apply the same updates as dispatch() tests:
1. Update existing "calls findOneAndUpdate when POST succeeds" to expect 1 call (claim only)
2. Add "reverts status when POST fails (claim-first pattern)" test
3. Update retry tests to verify claim-first pattern (3 calls on retry success, 4 on retry failure)

**Reference:** Use dispatchFup tests (lines 272-325) as the exact pattern to follow.
  </action>
  <verify>
    <automated>pnpm test -- webhook-dispatch.service.spec.ts</automated>
  </verify>
  <done>All tests pass, claim-first behavior verified for dispatch() and dispatchMessage(), test counts match dispatchFup pattern</done>
</task>

</tasks>

<verification>
Run full test suite:
```bash
pnpm test -- webhook-dispatch.service.spec.ts
```

All tests should pass with claim-first pattern enforced.
</verification>

<success_criteria>
- [ ] dispatch() claims run (waiting→queued) BEFORE POST
- [ ] dispatch() reverts status (queued→waiting) if POST fails
- [ ] dispatch() retry path uses claim-first pattern
- [ ] dispatchMessage() claims message (pending→processing) BEFORE POST
- [ ] dispatchMessage() reverts status (processing→pending) if POST fails
- [ ] dispatchMessage() retry path uses claim-first pattern
- [ ] processingStartedAt still set during claim (not after POST)
- [ ] All existing tests pass
- [ ] New tests verify revert behavior on POST failure
- [ ] Test call counts match dispatchFup pattern (1 on success, 2 on initial failure, 3 on retry success, 4 on retry failure)
</success_criteria>

<output>
After completion, create `.planning/quick/260414-onr-aplicar-claim-first-para-dispatch-e-disp/260414-onr-SUMMARY.md`
</output>
