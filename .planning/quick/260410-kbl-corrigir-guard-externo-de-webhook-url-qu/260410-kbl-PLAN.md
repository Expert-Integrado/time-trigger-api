---
phase: quick
plan: 260410-kbl
type: execute
wave: 1
depends_on: []
files_modified:
  - src/dispatch/run-dispatch.service.ts
  - src/dispatch/run-dispatch.service.spec.ts
autonomous: true
must_haves:
  truths:
    - "Multi-bot DB where findOne({}) returns doc WITHOUT the URL key still dispatches items that have a botIdentifier whose bot-specific doc contains the URL"
    - "Single-bot DB where findOne({}) returns doc WITH the URL key still works as before (backward compat)"
    - "Item with no botIdentifier AND no generic URL is skipped with per-item warning (not entire section skip)"
  artifacts:
    - path: "src/dispatch/run-dispatch.service.ts"
      provides: "Per-item URL resolution without outer early-return guards"
    - path: "src/dispatch/run-dispatch.service.spec.ts"
      provides: "Tests covering multi-bot scenario where generic doc lacks URL but bot-specific doc has it"
  key_links:
    - from: "run-dispatch.service.ts processDatabaseRuns (runs block)"
      to: "webhooks.findOne({ botIdentifier })"
      via: "per-run URL resolution inside loop"
    - from: "run-dispatch.service.ts processDatabaseRuns (FUP block)"
      to: "webhooks.findOne({ botIdentifier })"
      via: "per-fup URL resolution inside loop"
    - from: "run-dispatch.service.ts processDatabaseFup"
      to: "webhooks.findOne({ botIdentifier })"
      via: "per-fup URL resolution inside loop"
    - from: "run-dispatch.service.ts processDatabaseMessages"
      to: "webhooks.findOne({ botIdentifier })"
      via: "per-message URL resolution inside loop"
---

<objective>
Fix the outer webhook URL guards that block entire dispatch sections when `findOne({})` returns a document missing the URL key, even though a per-botIdentifier document in the same collection has the correct URL.

Purpose: In multi-bot databases like `sdr-grupofsa`, the first `webhooks` document (returned by `findOne({})`) may not have `Processador de Runs` / `Gerenciador follow up` / `mensagens pendentes`, but a second document with a specific `botIdentifier` does. The current outer guard skips the entire section, causing ALL runs/FUPs/messages to be missed.

Output: Updated service with per-item URL resolution and updated tests covering the multi-bot scenario.
</objective>

<context>
@src/dispatch/run-dispatch.service.ts
@src/dispatch/run-dispatch.service.spec.ts
</context>

<tasks>

<task type="auto">
  <name>Task 1: Remove outer URL guards and make URL resolution fully per-item</name>
  <files>src/dispatch/run-dispatch.service.ts</files>
  <action>
Fix 4 locations where an outer `if (!webhookUrl)` guard skips the entire section. In each case, remove the outer guard and move the "no URL" check to a per-item `continue` inside the loop.

**1. Runs block in `processDatabaseRuns` (lines ~248-303):**
Remove the `if (!webhookUrl) { warn + skip }` block. Instead:
- Keep `const webhookUrl = webhookDoc?.['Processador de Runs']` as the generic fallback (may be undefined).
- Inside the `for (const run of runs)` loop, AFTER rate limit check and dependency guard, resolve the URL:
  ```
  let runWebhookUrl = webhookUrl; // may be undefined
  if (botIdentifier) {
    const botWebhookDoc = await db.collection('webhooks').findOne<WebhookDoc>({ botIdentifier });
    const botSpecificUrl = botWebhookDoc?.['Processador de Runs'];
    if (botSpecificUrl) {
      runWebhookUrl = botSpecificUrl;
    }
  }
  if (!runWebhookUrl) {
    this.logger.warn(`[${dbName}] No "Processador de Runs" URL for run ${String(run['_id'])} (botIdentifier: ${botIdentifier ?? 'none'}) — skipping`);
    continue;
  }
  ```
- The existing per-bot lookup code is already there, just restructure so the fallback `webhookUrl` can be undefined and the final `if (!runWebhookUrl)` check catches items that truly have no URL.

**2. FUPs block in `processDatabaseRuns` (lines ~313-359):**
Remove the `if (!fupWebhookUrl) { warn + skip }` block. Instead:
- Keep `const fupWebhookUrl = webhookDoc?.['Gerenciador follow up']` as the generic fallback (may be undefined, typed as `string | undefined`).
- Inside the `for (const fup of fups)` loop, AFTER rate limit check, resolve the URL:
  ```
  let resolvedFupUrl: string | undefined = fupWebhookUrl; // may be undefined
  if (fupBotIdentifier) {
    const botWebhookDoc = ...
    ...same pattern...
  }
  if (!resolvedFupUrl) {
    this.logger.warn(`[${dbName}] No "Gerenciador follow up" URL for FUP ${String(fup['_id'])} (botIdentifier: ${fupBotIdentifier ?? 'none'}) — skipping`);
    continue;
  }
  ```

**3. `processDatabaseFup` (lines ~397-406):**
Remove the `if (!fupWebhookUrl) { warn + return }` early return. Instead:
- Keep `const fupWebhookUrl = webhookDoc?.['Gerenciador follow up']` as generic fallback (may be undefined).
- Inside the `for (const fup of fups)` loop, AFTER rate limit check, resolve the URL:
  ```
  let resolvedFupUrl: string | undefined = fupWebhookUrl;
  if (fupBotIdentifier) {
    ...same pattern...
  }
  if (!resolvedFupUrl) {
    this.logger.warn(`[${dbName}] No "Gerenciador follow up" URL for FUP ${String(fup['_id'])} (botIdentifier: ${fupBotIdentifier ?? 'none'}) — skipping`);
    continue;
  }
  ```

**4. `processDatabaseMessages` (lines ~458-464):**
Remove the `if (!messagesWebhookUrl) { warn + return }` early return. Instead:
- Keep `const messagesWebhookUrl = webhookDoc?.['mensagens pendentes']` as generic fallback (may be undefined).
- Inside the `for (const message of messages)` loop, AFTER rate limit check, resolve the URL:
  ```
  let resolvedMsgUrl: string | undefined = messagesWebhookUrl;
  if (msgBotIdentifier) {
    ...same pattern...
  }
  if (!resolvedMsgUrl) {
    this.logger.warn(`[${dbName}] No "mensagens pendentes" URL for message ${String(message['_id'])} (botIdentifier: ${msgBotIdentifier ?? 'none'}) — skipping`);
    continue;
  }
  ```

Key points:
- The generic `webhookUrl` variable is now allowed to be `undefined` — it is just a fallback.
- Per-botIdentifier lookup code already exists inside loops from quick task 260410-k36. Just ensure the fallback path handles `undefined` gracefully.
- The per-item `continue` replaces the per-section `skip`, so other items that DO have a URL are still dispatched.
- Still query for runs/fups/messages even if the generic URL is missing — items with botIdentifier may resolve their own URL.
  </action>
  <verify>
    <automated>cd /root/time-trigger-api && pnpm test -- --testPathPattern=run-dispatch.service.spec --no-coverage 2>&1 | tail -20</automated>
  </verify>
  <done>All 4 outer guards removed. URL resolution is fully per-item. Existing tests that relied on the old "skip entire section" behavior may need updating in Task 2, but the service logic is correct.</done>
</task>

<task type="auto">
  <name>Task 2: Update existing tests and add multi-bot scenario tests</name>
  <files>src/dispatch/run-dispatch.service.spec.ts</files>
  <action>
**Update existing "URL missing skips" tests:**

1. **Test at ~line 452: 'skips database and logs warning when "Processador de Runs" URL is missing'**
   This test uses `makeDb(withinWindowVars, {}, [eligibleRun])` — the generic doc has NO URL and the run has NO botIdentifier. After the fix, this run should STILL be skipped (per-item skip) and a warning logged, but it is now a per-item warning not a per-section warning. Update the test:
   - `eligibleRun` has no `botIdentifier`, so the per-bot lookup is skipped, and `runWebhookUrl` stays `undefined`.
   - Expect a warn containing the run ID and "Processador de Runs".
   - Expect `dispatch` NOT called — same as before.
   - The test should still pass conceptually, but the warning message text may differ. Update `expect(warnSpy).toHaveBeenCalledWith(...)` to match the new per-item message format.

2. **Test at ~line 657: 'FUP URL absent -> logs warn and does NOT call dispatchFup, but runs still dispatched'**
   Same update. `eligibleFup` has no `botIdentifier`, so per-item skip applies. Runs are still dispatched. Update warning matcher to the new per-item message format.

3. **Test at ~line 910: 'mensagens pendentes URL absent -> logs warn, skips messages'**
   Same update. `eligibleMessage` has no `botIdentifier`. Update warning matcher.

4. **FUP standalone at ~line 397-406 tests**: Check if any existing test for `runFupCycle` tests the "URL missing" path. The `runFupCycle dispatches FUPs within time window` test at line 727 uses `webhooksDoc` which has the FUP URL, so it should still pass. If there is no explicit "FUP URL missing in standalone cycle" test, the coverage is already handled by the processDatabaseRuns tests.

**Add new tests for the multi-bot scenario (the `sdr-grupofsa` case):**

Add a new `describe('Multi-bot webhook resolution — generic doc lacks URL but bot-specific doc has it', ...)` block with these tests:

5. **'(MULTI-BOT-RUNS-01) run with botIdentifier dispatches even when generic webhookDoc lacks Processador de Runs'**
   - Generic webhookDoc: `{ 'Gerenciador follow up': 'https://fup.example.com' }` (NO `Processador de Runs`)
   - Run: `{ _id: 'run-mb-01', runStatus: 'waiting', waitUntil: 1, botIdentifier: 'BotX' }`
   - Override `webhooks.findOne` to: return `{ 'Gerenciador follow up': '...' }` for `{}` filter, return `{ botIdentifier: 'BotX', 'Processador de Runs': 'https://botx-runs.example.com' }` for `{ botIdentifier: 'BotX' }` filter.
   - Expect `dispatch` called with URL `'https://botx-runs.example.com'`.

6. **'(MULTI-BOT-RUNS-02) run WITHOUT botIdentifier skipped when generic doc lacks URL — does not block other runs'**
   - Same generic webhookDoc (no `Processador de Runs`)
   - Two runs: `runWithBot` (botIdentifier: 'BotX'), `runWithoutBot` (no botIdentifier)
   - Expect `dispatch` called ONCE (only for `runWithBot` with bot-specific URL)
   - Expect warn logged for `runWithoutBot`

7. **'(MULTI-BOT-FUP-01) FUP with botIdentifier dispatches even when generic doc lacks Gerenciador follow up — processDatabaseRuns'**
   - Generic webhookDoc: `{ 'Processador de Runs': '...' }` (NO `Gerenciador follow up`)
   - FUP: `{ _id: 'fup-mb-01', status: 'on', nextInteractionTimestamp: 1, botIdentifier: 'BotX' }`
   - Override to return bot-specific doc with `'Gerenciador follow up'` for `{ botIdentifier: 'BotX' }`
   - Expect `dispatchFup` called with bot-specific URL.

8. **'(MULTI-BOT-FUP-02) FUP with botIdentifier dispatches even when generic doc lacks URL — processDatabaseFup standalone'**
   - Same as above but through `runFupCycle()`.

9. **'(MULTI-BOT-MSG-01) message with botIdentifier dispatches even when generic doc lacks mensagens pendentes'**
   - Generic webhookDoc: `{}` (NO `mensagens pendentes`)
   - Message: `{ _id: 'msg-mb-01', messageStatus: 'pending', botIdentifier: 'BotX' }`
   - Override to return bot-specific doc with `'mensagens pendentes'` for `{ botIdentifier: 'BotX' }`
   - Expect `dispatchMessage` called with bot-specific URL.

Follow the existing test patterns: use `makeDb`, override `_collections.webhooks.findOne` with `jest.fn().mockImplementation(...)`, spy on `Date.prototype.getHours`/`getDay`, and call `jest.restoreAllMocks()` at end.
  </action>
  <verify>
    <automated>cd /root/time-trigger-api && pnpm test -- --testPathPattern=run-dispatch.service.spec --no-coverage 2>&1 | tail -30</automated>
  </verify>
  <done>All existing tests pass (updated for new per-item warning format). New multi-bot tests pass, proving that items with botIdentifier are dispatched even when the generic webhookDoc lacks the URL key. Zero regressions on all other tests.</done>
</task>

</tasks>

<verification>
1. `pnpm test -- --testPathPattern=run-dispatch.service.spec --no-coverage` — ALL tests pass
2. `pnpm run lint` — no lint errors
3. New multi-bot tests prove the `sdr-grupofsa` scenario works: generic doc missing URL does NOT block dispatch for items with a botIdentifier that resolves to a bot-specific doc with the URL
</verification>

<success_criteria>
- Outer `if (!webhookUrl) skip` guards removed from all 4 locations
- URL resolution is fully per-item inside each loop
- Items with botIdentifier find their URL via per-bot lookup even when generic doc lacks it
- Items without botIdentifier AND without generic URL are skipped individually (not entire section)
- Backward compatibility preserved: single-bot DBs with generic URL still work
- All existing tests pass (with updated warning message matchers)
- New multi-bot scenario tests pass
</success_criteria>

<output>
After completion, create `.planning/quick/260410-kbl-corrigir-guard-externo-de-webhook-url-qu/260410-kbl-SUMMARY.md`
</output>
