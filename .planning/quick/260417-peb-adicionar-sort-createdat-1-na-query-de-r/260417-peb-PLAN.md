---
phase: quick-260417-peb
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/dispatch/run-dispatch.service.ts
  - src/dispatch/run-dispatch.service.spec.ts
autonomous: true
requirements:
  - QUICK-260417-PEB-01
must_haves:
  truths:
    - "Runs query in processDatabaseRuns() applies .sort({ createdAt: 1 }) before .toArray()"
    - "Oldest runs (smallest createdAt) are processed first within a cycle"
    - "All existing unit tests continue to pass (Jest mock cursor supports .sort() chaining)"
    - "A new unit test asserts that the runs collection find() is followed by sort({ createdAt: 1 })"
  artifacts:
    - path: "src/dispatch/run-dispatch.service.ts"
      provides: "Runs query with createdAt ascending sort"
      contains: ".sort({ createdAt: 1 })"
    - path: "src/dispatch/run-dispatch.service.spec.ts"
      provides: "Mock cursor supporting .sort() + assertion test"
      contains: "sort"
  key_links:
    - from: "src/dispatch/run-dispatch.service.ts processDatabaseRuns"
      to: "MongoDB runs.find().sort()"
      via: "cursor chaining before toArray()"
      pattern: "\\.find\\([^)]*runStatus.*waiting[^)]*\\)[\\s\\S]*\\.sort\\(\\s*\\{\\s*createdAt:\\s*1"
---

<objective>
Adicionar `.sort({ createdAt: 1 })` na query de runs de `processDatabaseRuns()` para processar os runs na ordem de criação (mais antigos primeiro).

Purpose: Garantir ordem determinística de processamento. Sem o sort, o MongoDB pode retornar documentos em ordem arbitrária (ordem natural), o que pode atrasar o dispatch de runs mais antigos quando o rate limit é atingido em cada ciclo.

Output: Runs query atualizada com ordenação ascendente por `createdAt`, testes de unidade atualizados/adicionados para cobrir o novo comportamento.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@./CLAUDE.md
@src/dispatch/run-dispatch.service.ts
@src/dispatch/run-dispatch.service.spec.ts

<interfaces>
<!-- Key code locations the executor needs. Extracted from codebase. -->

Current runs query (src/dispatch/run-dispatch.service.ts:252-255):
```typescript
// DETECT-01: find waiting runs with waitUntil in the past
const runs: Document[] = await db
  .collection('runs')
  .find({ runStatus: 'waiting', waitUntil: { $lte: Date.now() } })
  .toArray();
```

Target (after change):
```typescript
// DETECT-01: find waiting runs with waitUntil in the past,
// ordered by createdAt ascending to process oldest first
const runs: Document[] = await db
  .collection('runs')
  .find({ runStatus: 'waiting', waitUntil: { $lte: Date.now() } })
  .sort({ createdAt: 1 })
  .toArray();
```

Current test mock cursor (src/dispatch/run-dispatch.service.spec.ts:24):
```typescript
const mockRunsFind = { toArray: jest.fn().mockResolvedValue(runs) };
```

This mock does NOT support `.sort()` chaining. After adding `.sort({ createdAt: 1 })` in the service, the mock must return an object whose `.sort()` returns the same (or chained) cursor so `.toArray()` still resolves. The simplest fix is to make `.sort()` return the same mock object:
```typescript
const mockRunsFind: any = { toArray: jest.fn().mockResolvedValue(runs) };
mockRunsFind.sort = jest.fn().mockReturnValue(mockRunsFind);
```

Scope note: ONLY the runs query (inside `processDatabaseRuns`) is affected. FUP query (line 322) and messages query (line 470) are OUT OF SCOPE for this task — the user's description specifically says "na query de runs".
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Add .sort({ createdAt: 1 }) to runs query and update test mock</name>
  <files>src/dispatch/run-dispatch.service.ts, src/dispatch/run-dispatch.service.spec.ts</files>
  <behavior>
    - Test 1 (new): `(DETECT-01-SORT) runs query calls .sort({ createdAt: 1 }) after find()` — asserts the mocked runs cursor's `sort` mock was called with `{ createdAt: 1 }` during `runRunsCycle()`.
    - Test 2 (regression): Existing `(DETECT-01) queries runs collection with runStatus:waiting and waitUntil <= now` still passes — filter shape unchanged.
    - Test 3 (regression): All other existing tests in run-dispatch.service.spec.ts still pass because the mock cursor's `.sort()` returns the same object, preserving `.toArray()` resolution.
    - Test 4 (regression): FUP `find()` and messages `find()` mock cursors are NOT required to gain `.sort()` (scope-limited change). Their tests continue to work unchanged.
  </behavior>
  <action>
    Step 1 — Update the test mock cursor in `src/dispatch/run-dispatch.service.spec.ts` so the runs cursor supports `.sort()` chaining. In the `makeDb` helper (around line 24), replace:

    ```typescript
    const mockRunsFind = { toArray: jest.fn().mockResolvedValue(runs) };
    ```

    with:

    ```typescript
    const mockRunsFind: any = { toArray: jest.fn().mockResolvedValue(runs) };
    mockRunsFind.sort = jest.fn().mockReturnValue(mockRunsFind);
    ```

    Keep `mockFupsFind` and `mockMessagesFind` unchanged — they don't need `.sort()` since this task only changes the runs query.

    Step 2 — Add a new assertion test next to `(DETECT-01)` (around line 115) in the same spec file. The test must verify that the runs collection cursor's `.sort` was called with `{ createdAt: 1 }`:

    ```typescript
    it('(DETECT-01-SORT) runs query is sorted by createdAt ascending', async () => {
      const db = makeDb(withinWindowVars, webhooksDoc, []);
      mongoService.db.mockReturnValue(db as unknown as Db);
      jest.spyOn(Date.prototype, 'getHours').mockReturnValue(10);
      jest.spyOn(Date.prototype, 'getDay').mockReturnValue(allowedDay);

      await service.runRunsCycle();

      const runsFindResult = (db as any)._collections.runs.find.mock.results[0].value;
      expect(runsFindResult.sort).toHaveBeenCalledWith({ createdAt: 1 });
      jest.restoreAllMocks();
    });
    ```

    Step 3 — Run tests (expect the new test to FAIL in RED phase because the service hasn't been updated yet):
    ```
    pnpm run test -- src/dispatch/run-dispatch.service.spec.ts
    ```

    Step 4 — Update the service in `src/dispatch/run-dispatch.service.ts` around line 252. Replace:

    ```typescript
    // DETECT-01: find waiting runs with waitUntil in the past
    const runs: Document[] = await db
      .collection('runs')
      .find({ runStatus: 'waiting', waitUntil: { $lte: Date.now() } })
      .toArray();
    ```

    with:

    ```typescript
    // DETECT-01: find waiting runs with waitUntil in the past,
    // ordered by createdAt ascending to process oldest first
    const runs: Document[] = await db
      .collection('runs')
      .find({ runStatus: 'waiting', waitUntil: { $lte: Date.now() } })
      .sort({ createdAt: 1 })
      .toArray();
    ```

    IMPORTANT: Only modify the runs query inside `processDatabaseRuns()` (the block under `// DETECT-01` around line 251-255). Do NOT modify the FUP query (line 320-326) or messages query (line 468-471) — this task is scoped strictly to the runs query per user description.

    Step 5 — Run tests again (expect GREEN — all tests pass):
    ```
    pnpm run test -- src/dispatch/run-dispatch.service.spec.ts
    ```

    Step 6 — Run the full test suite to confirm no regressions elsewhere:
    ```
    pnpm run test
    ```

    Step 7 — Format and lint:
    ```
    pnpm run format
    pnpm run lint
    ```
  </action>
  <verify>
    <automated>pnpm run test -- src/dispatch/run-dispatch.service.spec.ts</automated>
  </verify>
  <done>
    - `src/dispatch/run-dispatch.service.ts` contains `.sort({ createdAt: 1 })` chained between `.find(...)` and `.toArray()` in the runs query inside `processDatabaseRuns()`.
    - FUP query and messages query are untouched (no `.sort()` added).
    - `src/dispatch/run-dispatch.service.spec.ts` has a new test `(DETECT-01-SORT)` that passes.
    - Mock cursor in `makeDb` supports `.sort()` chaining for runs.
    - `pnpm run test` passes with zero failures.
    - `pnpm run lint` exits clean.
  </done>
</task>

</tasks>

<verification>
- `pnpm run test` — full suite passes, including new `(DETECT-01-SORT)` test
- `pnpm run lint` — no errors
- `pnpm run build` — TypeScript compiles without errors
- Grep verification: `grep -n "sort.*createdAt" src/dispatch/run-dispatch.service.ts` returns exactly one match inside `processDatabaseRuns`
- Scope verification: `grep -c "\.sort(" src/dispatch/run-dispatch.service.ts` returns 1 (only the runs query)
</verification>

<success_criteria>
1. Runs query in `processDatabaseRuns()` chains `.sort({ createdAt: 1 })` between `.find()` and `.toArray()`.
2. Existing test `(DETECT-01)` still passes — filter criteria unchanged.
3. New test `(DETECT-01-SORT)` passes — sort assertion green.
4. All other tests in `run-dispatch.service.spec.ts` still pass.
5. No changes to FUP or messages queries (scope discipline).
6. Lint and build clean.
</success_criteria>

<output>
After completion, create `.planning/quick/260417-peb-adicionar-sort-createdat-1-na-query-de-r/260417-peb-SUMMARY.md` with:
- What changed (one-line: runs query now sorted by createdAt ascending)
- Files modified
- Test results (new test passes, regression tests pass)
- Commit hash

Commit message (follow CLAUDE.md convention):
```
⚡️ perf(quick-260417-peb): sort runs query by createdAt ascending

Process oldest runs first within each dispatch cycle. Prevents
starvation of older runs when rate limit caps the batch.
```
</output>
