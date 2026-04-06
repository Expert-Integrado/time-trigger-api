---
type: quick
description: Separar timeTrigger.enabled em enabledRuns e enabledFups para controle independente de cada fluxo
created: 2026-04-06
files_modified:
  - src/dispatch/run-dispatch.service.ts
  - src/dispatch/run-dispatch.service.spec.ts
  - docs/vars-schema.md
---

<objective>
Split `timeTrigger.enabled` into two independent boolean flags: `enabledRuns` and `enabledFups`.

Purpose: Allow clients to enable/disable runs dispatch independently from FUP dispatch. Currently a single `enabled` flag controls both flows, which limits flexibility.

Output:
- Updated `TimeTriggerConfig` interface with `enabledRuns` and `enabledFups` booleans
- `processDatabaseRuns()` checks `enabledRuns` only (for runs dispatch)
- `processDatabaseFup()` checks `enabledFups` only
- Backward compatibility: if old `enabled` field exists and new fields are absent, use `enabled` for both
- Updated tests covering independent enable/disable scenarios
- Updated documentation in vars-schema.md
</objective>

<context>
@src/dispatch/run-dispatch.service.ts (lines 8-17 for interface, 219-222 for runs check, 343-346 for FUP check)
@src/dispatch/run-dispatch.service.spec.ts (TRIG-03 test at line 198)
@docs/vars-schema.md (field documentation)
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Update TimeTriggerConfig interface and service logic</name>
  <files>src/dispatch/run-dispatch.service.ts</files>
  <behavior>
    - Test 1: `enabledRuns: false` skips runs dispatch, FUPs still dispatched if `enabledFups: true`
    - Test 2: `enabledFups: false` skips FUP dispatch, runs still dispatched if `enabledRuns: true`
    - Test 3: Both false skips both flows
    - Test 4: Both true dispatches both flows
    - Test 5: Legacy `enabled: true` (no enabledRuns/enabledFups) dispatches both (backward compat)
    - Test 6: Legacy `enabled: false` (no enabledRuns/enabledFups) skips both (backward compat)
  </behavior>
  <action>
1. Update `TimeTriggerConfig` interface:
   ```typescript
   interface TimeTriggerConfig {
     enabled?: boolean;       // DEPRECATED - backward compat only
     enabledRuns?: boolean;   // NEW - controls runs dispatch
     enabledFups?: boolean;   // NEW - controls FUP dispatch
     morningLimit: number;
     nightLimit: number;
     allowedDays: number[];
   }
   ```

2. Add helper method to resolve enabled state with backward compatibility:
   ```typescript
   private isRunsEnabled(config: TimeTriggerConfig): boolean {
     if (config.enabledRuns !== undefined) return config.enabledRuns;
     return config.enabled ?? true; // default true if neither field present
   }

   private isFupsEnabled(config: TimeTriggerConfig): boolean {
     if (config.enabledFups !== undefined) return config.enabledFups;
     return config.enabled ?? true;
   }
   ```

3. Update `processDatabaseRuns()` (around line 219):
   - Replace `if (!vars.timeTrigger.enabled)` with `if (!this.isRunsEnabled(vars.timeTrigger))`
   - Update log message: `timeTrigger.enabledRuns is false — skipping runs`

4. Update `processDatabaseFup()` (around line 343):
   - Replace `if (!vars.timeTrigger.enabled)` with `if (!this.isFupsEnabled(vars.timeTrigger))`
   - Update log message: `timeTrigger.enabledFups is false — skipping FUP`

5. In `processDatabaseRuns()` FUP section (around line 290-324):
   - Add early check: `if (!this.isFupsEnabled(vars.timeTrigger))` before FUP dispatch loop
   - This allows runs dispatch while skipping FUP in the combined cycle
  </action>
  <verify>
    <automated>pnpm test -- --testPathPattern=run-dispatch.service.spec.ts --passWithNoTests</automated>
  </verify>
  <done>
    - TimeTriggerConfig has enabledRuns and enabledFups (optional)
    - Helper methods isRunsEnabled/isFupsEnabled handle backward compat
    - processDatabaseRuns checks enabledRuns for runs, enabledFups for FUP section
    - processDatabaseFup checks enabledFups only
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Add tests for independent enable/disable behavior</name>
  <files>src/dispatch/run-dispatch.service.spec.ts</files>
  <behavior>
    - TRIG-03a: enabledRuns=false, enabledFups=true -> runs skipped, FUPs dispatched
    - TRIG-03b: enabledRuns=true, enabledFups=false -> runs dispatched, FUPs skipped
    - TRIG-03c: both false -> both skipped
    - TRIG-03d: both true -> both dispatched
    - TRIG-03-legacy: old enabled=false (no new fields) -> both skipped (backward compat)
  </behavior>
  <action>
1. Update existing `withinWindowVars` to use new fields:
   ```typescript
   const withinWindowVars = {
     timeTrigger: {
       enabledRuns: true,
       enabledFups: true,
       morningLimit: 8,
       nightLimit: 22,
       allowedDays: [0, 1, 2, 3, 4, 5, 6],
     },
   };
   ```

2. Keep existing TRIG-03 test but rename to `(TRIG-03-legacy)` and use old `enabled: false` format

3. Add new tests:
   ```typescript
   it('(TRIG-03a) skips runs but dispatches FUP when enabledRuns=false, enabledFups=true', async () => {
     const vars = {
       timeTrigger: {
         enabledRuns: false,
         enabledFups: true,
         morningLimit: 8,
         nightLimit: 22,
         allowedDays: [0, 1, 2, 3, 4, 5, 6],
       },
     };
     const db = makeDb(vars, webhooksDoc, [eligibleRun], [eligibleFup]);
     mongoService.db.mockReturnValue(db as unknown as Db);
     jest.spyOn(Date.prototype, 'getHours').mockReturnValue(10);
     jest.spyOn(Date.prototype, 'getDay').mockReturnValue(allowedDay);

     await service.runRunsCycle();

     expect(webhookDispatchService.dispatch).not.toHaveBeenCalled();
     expect(webhookDispatchService.dispatchFup).toHaveBeenCalledTimes(1);
     jest.restoreAllMocks();
   });

   it('(TRIG-03b) dispatches runs but skips FUP when enabledRuns=true, enabledFups=false', async () => {
     const vars = {
       timeTrigger: {
         enabledRuns: true,
         enabledFups: false,
         morningLimit: 8,
         nightLimit: 22,
         allowedDays: [0, 1, 2, 3, 4, 5, 6],
       },
     };
     const db = makeDb(vars, webhooksDoc, [eligibleRun], [eligibleFup]);
     mongoService.db.mockReturnValue(db as unknown as Db);
     jest.spyOn(Date.prototype, 'getHours').mockReturnValue(10);
     jest.spyOn(Date.prototype, 'getDay').mockReturnValue(allowedDay);

     await service.runRunsCycle();

     expect(webhookDispatchService.dispatch).toHaveBeenCalledTimes(1);
     expect(webhookDispatchService.dispatchFup).not.toHaveBeenCalled();
     jest.restoreAllMocks();
   });

   it('(TRIG-03c) skips both when enabledRuns=false and enabledFups=false', async () => {
     // ... similar pattern
   });

   it('(TRIG-03d) dispatches both when enabledRuns=true and enabledFups=true', async () => {
     // ... similar pattern
   });
   ```

4. Add test for `runFupCycle()` with `enabledFups=false`:
   ```typescript
   it('runFupCycle skips when enabledFups=false', async () => {
     const vars = {
       timeTrigger: {
         enabledRuns: true,
         enabledFups: false,
         morningLimit: 8,
         nightLimit: 22,
         allowedDays: [0, 1, 2, 3, 4, 5, 6],
       },
     };
     const db = makeDb(vars, webhooksDoc, [], [eligibleFup]);
     mongoService.db.mockReturnValue(db as unknown as Db);
     jest.spyOn(Date.prototype, 'getHours').mockReturnValue(10);
     jest.spyOn(Date.prototype, 'getDay').mockReturnValue(allowedDay);

     await service.runFupCycle();

     expect(webhookDispatchService.dispatchFup).not.toHaveBeenCalled();
     jest.restoreAllMocks();
   });
   ```
  </action>
  <verify>
    <automated>pnpm test -- --testPathPattern=run-dispatch.service.spec.ts</automated>
  </verify>
  <done>
    - All existing TRIG-* tests pass (updated to use new fields or marked as legacy)
    - New TRIG-03a/b/c/d tests pass covering independent enable/disable
    - runFupCycle respects enabledFups independently
  </done>
</task>

<task type="auto">
  <name>Task 3: Update documentation</name>
  <files>docs/vars-schema.md</files>
  <action>
1. Update the schema example to show new fields:
   ```json
   {
     "botIdentifier": "sdr4blue",
     "timeTrigger": {
       "enabledRuns": true,
       "enabledFups": true,
       "morningLimit": 8,
       "nightLimit": 20,
       "allowedDays": [1, 2, 3, 4, 5]
     }
   }
   ```

2. Update the field description table:
   | Campo | Tipo | Obrigatorio | Descricao |
   |-------|------|-------------|-----------|
   | `timeTrigger.enabledRuns` | boolean | Sim* | `true` = processa runs desse cliente, `false` = ignora runs |
   | `timeTrigger.enabledFups` | boolean | Sim* | `true` = processa FUPs desse cliente, `false` = ignora FUPs |
   | `timeTrigger.enabled` | boolean | DEPRECATED | Usado para backward compat. Se enabledRuns/enabledFups ausentes, usa esse valor para ambos |

   *Se ausentes, usa o valor de `enabled` (default: true)

3. Update behavior section to document independent control:
   - Se `enabledRuns: false` -> ignora runs, mas FUPs podem rodar se `enabledFups: true`
   - Se `enabledFups: false` -> ignora FUPs, mas runs podem rodar se `enabledRuns: true`
   - Backward compat: Se `enabled` presente e novos campos ausentes, usa `enabled` para ambos

4. Add new example:
   ### Apenas Runs (sem FUP)
   ```json
   {
     "timeTrigger": {
       "enabledRuns": true,
       "enabledFups": false,
       "morningLimit": 8,
       "nightLimit": 20,
       "allowedDays": [1, 2, 3, 4, 5]
     }
   }
   ```

   ### Apenas FUP (sem Runs)
   ```json
   {
     "timeTrigger": {
       "enabledRuns": false,
       "enabledFups": true,
       "morningLimit": 8,
       "nightLimit": 20,
       "allowedDays": [1, 2, 3, 4, 5]
     }
   }
   ```
  </action>
  <verify>
    <automated>test -f docs/vars-schema.md && grep -q "enabledRuns" docs/vars-schema.md && grep -q "enabledFups" docs/vars-schema.md && echo "OK"</automated>
  </verify>
  <done>
    - vars-schema.md documents enabledRuns and enabledFups fields
    - Backward compatibility with `enabled` is documented
    - New examples show independent control scenarios
  </done>
</task>

</tasks>

<verification>
1. All existing tests pass: `pnpm test`
2. New independent enable/disable tests pass
3. Documentation updated with new schema
4. Build succeeds: `pnpm build`
</verification>

<success_criteria>
- `enabledRuns: false` skips runs dispatch while allowing FUP dispatch
- `enabledFups: false` skips FUP dispatch while allowing runs dispatch
- Backward compatibility: existing `enabled` field works for clients not yet migrated
- All tests pass including new independent control tests
- Documentation reflects the new schema
</success_criteria>
