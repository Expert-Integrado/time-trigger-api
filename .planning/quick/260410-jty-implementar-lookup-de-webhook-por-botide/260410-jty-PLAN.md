---
phase: quick
plan: 260410-jty
type: execute
wave: 1
depends_on: []
files_modified:
  - src/dispatch/run-dispatch.service.ts
  - src/dispatch/run-dispatch.service.spec.ts
autonomous: true
must_haves:
  truths:
    - "Run with botIdentifier dispatches to bot-specific webhook URL when a matching webhooks doc exists"
    - "Run with botIdentifier falls back to generic webhook URL when no bot-specific webhooks doc exists"
    - "Run without botIdentifier continues to use the generic webhook URL (no regression)"
    - "Generic webhook fetch still happens once per database cycle (not per-run)"
  artifacts:
    - path: "src/dispatch/run-dispatch.service.ts"
      provides: "Per-run bot-specific webhook lookup in processDatabaseRuns"
      contains: "findOne.*botIdentifier"
    - path: "src/dispatch/run-dispatch.service.spec.ts"
      provides: "Tests for bot-specific webhook lookup, fallback, and no-botIdentifier cases"
  key_links:
    - from: "src/dispatch/run-dispatch.service.ts"
      to: "webhooks collection"
      via: "findOne({ botIdentifier }) per-run lookup"
      pattern: "findOne.*botIdentifier.*run"
---

<objective>
Implement per-botIdentifier webhook URL lookup for runs dispatch.

Currently `processDatabaseRuns` fetches a single generic webhook document via `findOne({})` and uses its `'Processador de Runs'` URL for ALL runs in the database. This change adds a per-run lookup: if a run has a `botIdentifier`, try `findOne({ botIdentifier: run.botIdentifier })` first. If that doc has a `'Processador de Runs'` URL, use it. Otherwise fall back to the generic webhook URL already fetched.

Purpose: Allow one MongoDB database to host multiple bots with different webhook URLs, routing each run to the correct processor.
Output: Updated `run-dispatch.service.ts` with per-botIdentifier webhook lookup and comprehensive tests.
</objective>

<execution_context>
@.planning/quick/260410-jty-implementar-lookup-de-webhook-por-botide/260410-jty-PLAN.md
</execution_context>

<context>
@src/dispatch/run-dispatch.service.ts
@src/dispatch/run-dispatch.service.spec.ts
@src/dispatch/webhook-dispatch.service.ts

<interfaces>
<!-- Key types and contracts the executor needs -->

From src/dispatch/run-dispatch.service.ts:
```typescript
interface WebhookDoc {
  'Processador de Runs'?: string;
  FUP?: string;
  'mensagens pendentes'?: string;
}
```

From src/dispatch/webhook-dispatch.service.ts:
```typescript
async dispatch(db: Db, run: Document, webhookUrl: string): Promise<boolean>;
```

The `webhooks` collection is accessed via `db.collection('webhooks').findOne<WebhookDoc>(filter)`.
Current generic fetch: `findOne<WebhookDoc>({})` — returns first doc (no filter).
New bot-specific fetch: `findOne<WebhookDoc>({ botIdentifier: run.botIdentifier })` — returns doc matching the bot.

WebhookDoc for bot-specific docs will have the same shape but include a `botIdentifier` field:
```typescript
// Generic doc (existing): { "Processador de Runs": "https://generic..." }
// Bot-specific doc (new):  { "botIdentifier": "bot-A", "Processador de Runs": "https://bot-a..." }
```

Test helper `makeDb` at line 17 creates mock Db with collections. The `webhooks` collection mock uses
`findOne: jest.fn().mockResolvedValue(webhooks)` — this must be updated to support conditional returns
based on the filter argument for tests that exercise bot-specific lookup.
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Add per-botIdentifier webhook lookup in processDatabaseRuns and update tests</name>
  <files>src/dispatch/run-dispatch.service.ts, src/dispatch/run-dispatch.service.spec.ts</files>
  <behavior>
    - Test WEBHOOK-BOT-01: Run with botIdentifier dispatches to bot-specific webhook URL when matching webhooks doc exists (findOne({ botIdentifier: 'bot-A' }) returns { 'Processador de Runs': 'https://bot-a-hook...' })
    - Test WEBHOOK-BOT-02: Run with botIdentifier falls back to generic webhook URL when no bot-specific webhooks doc found (findOne({ botIdentifier: 'bot-B' }) returns null)
    - Test WEBHOOK-BOT-03: Run with botIdentifier falls back to generic webhook URL when bot-specific doc exists but has no 'Processador de Runs' key
    - Test WEBHOOK-BOT-04: Run without botIdentifier uses the generic webhook URL (no per-bot lookup attempted — findOne called only once with {})
    - Test WEBHOOK-BOT-05: Multiple runs in same cycle — one with botIdentifier (has specific webhook), one without — each dispatches to correct URL
    - All existing tests continue to pass unchanged (runs without botIdentifier go through generic path)
  </behavior>
  <action>
**Production code change in `src/dispatch/run-dispatch.service.ts`:**

In `processDatabaseRuns`, inside the `for (const run of runs)` loop (around line 260), AFTER the rate limit check and dependency guard, BEFORE calling `this.webhookDispatchService.dispatch`:

1. Read `botIdentifier` from the run (it is already extracted at line 268 as `const botIdentifier = run['botIdentifier'] as string | undefined;`). Reuse this variable — do NOT extract it again.

2. Add webhook URL resolution logic:
```typescript
// Resolve per-run webhook URL: bot-specific takes priority over generic
let runWebhookUrl = webhookUrl; // default to generic
if (botIdentifier) {
  const botWebhookDoc = await db.collection('webhooks').findOne<WebhookDoc>({ botIdentifier });
  const botSpecificUrl = botWebhookDoc?.['Processador de Runs'];
  if (botSpecificUrl) {
    runWebhookUrl = botSpecificUrl;
  }
}
```

3. Change the dispatch call to use `runWebhookUrl` instead of `webhookUrl`:
```typescript
const claimed = await this.webhookDispatchService.dispatch(
  db,
  run,
  runWebhookUrl, // was: webhookUrl
);
```

The generic `webhookDoc` fetch at line 240 (`findOne({})`) stays as-is — it runs once per database cycle for the fallback URL. The per-bot lookup only happens inside the loop when `botIdentifier` is present.

**Do NOT change** `processDatabaseFup`, `processDatabaseMessages`, or any other method. This change is scoped to runs dispatch only.

**Test changes in `src/dispatch/run-dispatch.service.spec.ts`:**

The `makeDb` helper's `webhooks` mock currently uses `findOne: jest.fn().mockResolvedValue(webhooks)` which always returns the same value regardless of filter. For the new tests, the webhooks findOne mock needs to be smarter.

**Strategy for new tests:** Do NOT modify the existing `makeDb` helper (to avoid breaking existing tests). Instead, in each new test, after calling `makeDb`, override the `webhooks.findOne` mock on the returned db object to use `mockImplementation` that inspects the filter argument:

```typescript
// Override webhooks.findOne to be filter-aware
(db as any)._collections.webhooks.findOne = jest.fn().mockImplementation((filter: any) => {
  if (filter?.botIdentifier === 'bot-A') {
    return Promise.resolve({ botIdentifier: 'bot-A', 'Processador de Runs': 'https://bot-a-hook.example.com' });
  }
  // Generic fallback (empty filter {})
  return Promise.resolve({ 'Processador de Runs': 'https://hook.example.com' });
});
```

Add the new tests in a new `describe('Webhook per-botIdentifier lookup', ...)` block at the end of the main `describe('RunDispatchService', ...)` block (before the closing `});`), following the existing test conventions:
- Use `jest.spyOn(Date.prototype, 'getHours').mockReturnValue(10)` and `jest.spyOn(Date.prototype, 'getDay').mockReturnValue(allowedDay)` for time/day mocks
- Use `jest.restoreAllMocks()` at end of each test
- Use `withinWindowVars` for vars
- Assert `webhookDispatchService.dispatch` was called with the expected URL as third argument

For WEBHOOK-BOT-04 (no botIdentifier), assert that `webhooks.findOne` was called exactly once (the generic `findOne({})` call) and NOT called with a botIdentifier filter.
  </action>
  <verify>
    <automated>cd /root/time-trigger-api && pnpm test -- --testPathPattern="run-dispatch.service.spec" --no-coverage 2>&1 | tail -40</automated>
  </verify>
  <done>
    - All existing tests pass unchanged
    - New WEBHOOK-BOT-01 through WEBHOOK-BOT-05 tests pass
    - Run with botIdentifier + matching webhook doc dispatches to bot-specific URL
    - Run with botIdentifier + no matching webhook doc falls back to generic URL
    - Run without botIdentifier dispatches to generic URL (no per-bot lookup)
    - Generic webhook fetch remains once per database cycle (outside the loop)
  </done>
</task>

</tasks>

<verification>
```bash
cd /root/time-trigger-api && pnpm test -- --no-coverage 2>&1 | tail -20
```
All tests pass. No regressions in existing behavior.
</verification>

<success_criteria>
- Runs with `botIdentifier` dispatch to bot-specific webhook URLs when a matching doc exists in the webhooks collection
- Runs without `botIdentifier` or without a matching bot-specific doc continue to use the generic webhook URL
- Generic webhook fetch happens once per database cycle (performance: no extra DB call for runs without botIdentifier)
- All existing tests pass without modification
- New tests cover: bot-specific hit, bot-specific miss/fallback, no-botIdentifier, mixed runs in same cycle
</success_criteria>

<output>
After completion, create `.planning/quick/260410-jty-implementar-lookup-de-webhook-por-botide/260410-jty-SUMMARY.md`
</output>
