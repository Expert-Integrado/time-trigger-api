# Phase 10: Message-Run Dependency - Research

**Researched:** 2026-03-30
**Domain:** NestJS service injection, MongoDB atomic queries, dependency guard patterns
**Confidence:** HIGH

## Summary

Phase 10 introduces a dependency check gate in the run dispatch loop: before dispatching a run, the system must verify that no message with `messageStatus: "processing"` exists for the same `botIdentifier` + `chatDataId`. If a blocking message exists, the run stays `"waiting"` and is retried next cycle automatically. Additionally, every message transition to `"processing"` must atomically record `processingStartedAt: new Date()` to enable the Phase 11 timeout recovery.

All architectural decisions are already locked in CONTEXT.md. The work is precisely scoped: (1) create `MessageCheckService` as a new injectable NestJS service, (2) inject it into `RunDispatchService` and add a guard inside the existing `for (const run of runs)` loop, (3) add `processingStartedAt` to both `$set` operations inside `WebhookDispatchService.dispatchMessage`, and (4) register `MessageCheckService` in `DispatchModule`. No new dependencies, no schema changes to existing collections.

**Primary recommendation:** Follow the guard pattern already established by the rate limit check — same `if` + `continue/break` style inside the `for (const run of runs)` loop. Use `findOne` (not `countDocuments`) for the blocking check to leverage MongoDB index usage and return early on first match.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** `botIdentifier` comes from `run.botIdentifier` directly — not from `vars`
- **D-02:** MongoDB query: `{ botIdentifier: run.botIdentifier, chatDataId: run.chatDataId, messageStatus: 'processing' }` — always both fields (DEP-04)
- **D-03:** Only `"processing"` messages block runs — `"pending"` does not block
- **D-04:** `processingStartedAt` is written in BOTH paths of `dispatchMessage`: success AND retry (setTimeout 60s)
- **D-05:** Added to `$set` of `findOneAndUpdate` together with `messageStatus: 'processing'` — atomic. Ex: `{ $set: { messageStatus: 'processing', processingStartedAt: new Date() } }`
- **D-06:** Retry fire-and-forget also includes `processingStartedAt` — for Phase 11 timeout recovery eligibility
- **D-07:** Create `MessageCheckService` as separate NestJS service at `src/dispatch/message-check.service.ts`
- **D-08:** Method signature: `hasProcessingMessage(db: Db, botIdentifier: string, chatDataId: string): Promise<boolean>`
- **D-09:** `RunDispatchService` receives `MessageCheckService` via constructor injection
- **D-10:** Log message per blocked run: `[dbName] Run {id} blocked — message still processing (chatDataId: X, botIdentifier: Y)`
- **D-11:** Log level `warn` for blocked runs

### Claude's Discretion
- Positioning of the check within the loop (before or after rate limit check) — coherence with existing guard flow
- Handling when `botIdentifier` or `chatDataId` is absent in run document: silent skip or warning log
- Number of unit tests per scenario

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| DEP-01 | `processingStartedAt` timestamp set when `messageStatus` changes to `"processing"` | Add to both `$set` operations in `dispatchMessage` (main + retry paths). MongoDB atomic `findOneAndUpdate` guarantees consistency. |
| DEP-02 | Before dispatching a run, check for `messageStatus: "processing"` matching same `botIdentifier` + `chatDataId` | `MessageCheckService.hasProcessingMessage()` calls `db.collection('messages').findOne({...})` — returns boolean |
| DEP-03 | If blocking message exists: run is skipped, stays `"waiting"`, next cycle retries automatically | Guard with `continue` inside run loop — no status mutation, no flag; "waiting" persists naturally |
| DEP-04 | Dependency filter always uses both `botIdentifier` AND `chatDataId` — never one without the other | Method signature enforces this: `hasProcessingMessage(db, botIdentifier, chatDataId)` |
| DEP-05 | Only `"processing"` messages block runs — `"pending"` does not block | Filter explicitly includes `messageStatus: 'processing'` — pending messages are invisible to this query |
</phase_requirements>

## Standard Stack

### Core (already installed — no new dependencies)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `mongodb` (native) | already in project | `Db`, `Document`, `ObjectId` types; `findOne`, `findOneAndUpdate` | Project-standard — no Mongoose |
| `@nestjs/common` | ^11.0.1 | `@Injectable()`, `Logger` | Established project pattern |
| `@nestjs/testing` | ^11.0.1 | `Test.createTestingModule()` for unit tests | Established test pattern |

**Installation:** No new packages required — all dependencies already in `pnpm-lock.yaml`.

## Architecture Patterns

### Recommended Project Structure
```
src/dispatch/
├── message-check.service.ts   # NEW: hasProcessingMessage query
├── message-check.service.spec.ts  # NEW: unit tests for MessageCheckService
├── run-dispatch.service.ts    # MODIFIED: inject MessageCheckService, add guard
├── webhook-dispatch.service.ts  # MODIFIED: add processingStartedAt to $set
├── dispatch.module.ts         # MODIFIED: add MessageCheckService to providers
└── run-dispatch.service.spec.ts  # MODIFIED: add DEP-* tests
```

### Pattern 1: NestJS Injectable Service (MessageCheckService)
**What:** Stateless service with a single query method. No internal state, accepts `Db` as parameter per call.
**When to use:** Whenever logic is isolated, testable independently, and consumed by other services via DI.
**Example:**
```typescript
// Source: established project pattern (webhook-dispatch.service.ts, run-dispatch.service.ts)
import { Injectable } from '@nestjs/common';
import { Db } from 'mongodb';

@Injectable()
export class MessageCheckService {
  async hasProcessingMessage(
    db: Db,
    botIdentifier: string,
    chatDataId: string,
  ): Promise<boolean> {
    const doc = await db.collection('messages').findOne({
      botIdentifier,
      chatDataId,
      messageStatus: 'processing',
    });
    return doc !== null;
  }
}
```

### Pattern 2: Guard Inside Run Loop (RunDispatchService)
**What:** Check before dispatch, `continue` to skip without mutating state.
**When to use:** Same style as the existing rate limit guard (`if (counterRuns >= this.rateLimitRuns) break`).
**Positioning decision (Claude's discretion):** Place AFTER the rate limit check. Rationale: rate limit is a fast in-memory check; the dependency check is an async MongoDB query. Exhausting the rate limit early avoids unnecessary DB queries for runs that would be skipped anyway.

```typescript
// Source: established pattern in run-dispatch.service.ts (rate limit guard)
for (const run of runs) {
  if (counterRuns >= this.rateLimitRuns) {
    this.logger.warn(`[${dbName}] Rate limit reached for runs ...`);
    break;
  }

  // DEP-02, DEP-03, DEP-04, DEP-05 (Phase 10 addition)
  const botIdentifier = run['botIdentifier'] as string | undefined;
  const chatDataId = run['chatDataId'] as string | undefined;
  if (botIdentifier && chatDataId) {
    const blocked = await this.messageCheckService.hasProcessingMessage(
      db,
      botIdentifier,
      chatDataId,
    );
    if (blocked) {
      this.logger.warn(
        `[${dbName}] Run ${String(run['_id'])} blocked — message still processing (chatDataId: ${chatDataId}, botIdentifier: ${botIdentifier})`,
      );
      continue;
    }
  }

  const claimed = await this.webhookDispatchService.dispatch(db, run, webhookUrl);
  if (claimed) counterRuns++;
}
```

**Handling absent fields (Claude's discretion):** If `botIdentifier` or `chatDataId` is absent, skip the dependency check silently and proceed to dispatch. This avoids blocking runs from legacy documents that predate the field. A silent skip is safer than a warning flood in production.

### Pattern 3: Atomic processingStartedAt in dispatchMessage
**What:** Add `processingStartedAt: new Date()` to the `$set` in both `findOneAndUpdate` calls inside `dispatchMessage`.
**When to use:** Phase 11 recovery requires this timestamp — without it, timed-out messages cannot be detected.

```typescript
// BEFORE (current):
{ $set: { messageStatus: 'processing' } }

// AFTER (Phase 10):
{ $set: { messageStatus: 'processing', processingStartedAt: new Date() } }
```

Both locations in `dispatchMessage` require this change:
1. Main path (line ~101): inside `if (success)` after `this.post(...)`
2. Retry path (line ~117): inside `retryFn` setTimeout callback

### Pattern 4: DispatchModule Registration
**What:** Add `MessageCheckService` to both `providers` and `exports` arrays.
**When to use:** Any new service that needs to be injected elsewhere in the dispatch module.

```typescript
// Source: dispatch.module.ts pattern
@Module({
  imports: [DatabaseModule],
  providers: [RunDispatchService, WebhookDispatchService, MessageCheckService],
  exports: [RunDispatchService, WebhookDispatchService, MessageCheckService],
})
export class DispatchModule {}
```

### Pattern 5: Constructor Injection in RunDispatchService
**What:** Add `MessageCheckService` as a fourth constructor parameter.
**When to use:** Standard NestJS DI — all existing services follow `private readonly`.

```typescript
constructor(
  private readonly mongoService: MongoService,
  private readonly databaseScanService: DatabaseScanService,
  private readonly webhookDispatchService: WebhookDispatchService,
  private readonly messageCheckService: MessageCheckService,
) {}
```

### Anti-Patterns to Avoid
- **Query without both fields:** Never query `messages` with only `botIdentifier` OR only `chatDataId` — DEP-04 is explicit. The method signature enforces this at the call site.
- **`countDocuments` instead of `findOne`:** `findOne` stops at the first match; `countDocuments` scans all matches. For a boolean check, `findOne` is always faster.
- **Mutating run status on block:** Do NOT change the run to any other status when blocked. Leave it as `"waiting"` so the next cycle picks it up automatically (DEP-03).
- **Single-path processingStartedAt:** Adding `processingStartedAt` only to the success path and forgetting the retry path means retried messages have no timestamp — they become permanently unrecoverable by Phase 11 (violates D-06).
- **Missing MessageCheckService in test module:** Tests for `RunDispatchService` must include `MessageCheckService` as a mock provider, or the NestJS DI container will throw `Nest can't resolve dependencies`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Atomic check+set for message status | Custom optimistic lock | `findOneAndUpdate` (already used) | MongoDB guarantees atomicity at document level |
| Checking for processing message | In-memory cache or Set | Direct `db.collection('messages').findOne(...)` per run | Each cycle gets fresh DB state; caching would create stale reads |
| Service injection | Manual service instantiation | NestJS `@Injectable()` + `providers` array | Established project pattern; enables clean mocking in tests |

**Key insight:** The entire dependency check is a single `findOne` query. There is no state to maintain between runs or cycles — the `messages` collection IS the state.

## Common Pitfalls

### Pitfall 1: Missing Mock in Test Module
**What goes wrong:** `RunDispatchService` tests fail at compile time with `Nest can't resolve dependencies of the RunDispatchService (MongoService, DatabaseScanService, WebhookDispatchService, ?). Please make sure that the argument MessageCheckService at index [3] is available in the RootTestModule context.`
**Why it happens:** `TestingModule` in `beforeEach` does not include a `MessageCheckService` mock in `providers`.
**How to avoid:** Add `{ provide: MessageCheckService, useValue: { hasProcessingMessage: jest.fn().mockResolvedValue(false) } }` to all existing `Test.createTestingModule` calls in `run-dispatch.service.spec.ts`.
**Warning signs:** Any existing test that exercises `runRunsCycle` will fail if the mock is not added.

### Pitfall 2: processingStartedAt Missing from Retry Path
**What goes wrong:** Messages dispatched via the retry path (60s setTimeout) have `messageStatus: 'processing'` but no `processingStartedAt`. Phase 11 recovery query filters `processingStartedAt: { $lt: cutoff }` — these messages are invisible to recovery and stay permanently stuck.
**Why it happens:** Developer adds `processingStartedAt` only to the main success path (easy to spot) and misses the retry path inside the `setTimeout` callback.
**How to avoid:** Search for both occurrences of `{ $set: { messageStatus: 'processing' } }` in `webhook-dispatch.service.ts` — there are exactly two. Both must be updated.
**Warning signs:** Unit test for retry path that verifies `processingStartedAt` is included in `$set`.

### Pitfall 3: Guard Position Creates Unnecessary DB Queries
**What goes wrong:** Dependency check placed BEFORE rate limit check means every run triggers a `findOne` query even when the rate limit is already exhausted for that database.
**Why it happens:** No fixed ordering rule exists for guards — developer places them in any order.
**How to avoid:** Rate limit check first (in-memory, free), dependency check second (DB query, has cost). The order: `if (rateLimit) break` → `if (blocked) continue` → `dispatch`.
**Warning signs:** Profiling shows `messages.findOne` called for runs that are never dispatched.

### Pitfall 4: botIdentifier/chatDataId Field Access
**What goes wrong:** TypeScript error or runtime `undefined` because `run` is typed as `Document` (MongoDB generic). Accessing `run.botIdentifier` directly fails type-check.
**Why it happens:** `Document` type in the MongoDB native driver is `Record<string, any>` — field access requires bracket notation or cast.
**How to avoid:** Use `run['botIdentifier'] as string | undefined` with a null-guard before calling `hasProcessingMessage`. This matches the pattern already used for `run['_id']` in `WebhookDispatchService`.
**Warning signs:** TypeScript strict mode errors at compile time.

### Pitfall 5: Exporting MessageCheckService from DispatchModule
**What goes wrong:** Other modules that import `DispatchModule` cannot inject `MessageCheckService` if it is in `providers` but not `exports`.
**Why it happens:** NestJS distinction between `providers` (available within module) and `exports` (available to importers).
**How to avoid:** Phase 11's `SchedulerService` may eventually need access. Add to `exports` proactively, consistent with how `WebhookDispatchService` is exported.
**Warning signs:** `Nest can't resolve dependencies` error in `SchedulerModule`.

## Code Examples

### MessageCheckService — Full Implementation
```typescript
// src/dispatch/message-check.service.ts
import { Injectable } from '@nestjs/common';
import { Db } from 'mongodb';

@Injectable()
export class MessageCheckService {
  async hasProcessingMessage(
    db: Db,
    botIdentifier: string,
    chatDataId: string,
  ): Promise<boolean> {
    const doc = await db.collection('messages').findOne({
      botIdentifier,
      chatDataId,
      messageStatus: 'processing',
    });
    return doc !== null;
  }
}
```

### dispatchMessage — Updated $set (both paths)
```typescript
// Main path — inside if (success):
const result = await db
  .collection('messages')
  .findOneAndUpdate(
    { _id: messageId, messageStatus: 'pending' },
    { $set: { messageStatus: 'processing', processingStartedAt: new Date() } },
  );

// Retry path — inside retryFn setTimeout callback:
await db
  .collection('messages')
  .findOneAndUpdate(
    { _id: messageId, messageStatus: 'pending' },
    { $set: { messageStatus: 'processing', processingStartedAt: new Date() } },
  );
```

### Test: MessageCheckService unit test structure
```typescript
// src/dispatch/message-check.service.spec.ts
describe('MessageCheckService', () => {
  let service: MessageCheckService;
  let mockDb: { collection: jest.Mock };
  let mockCollection: { findOne: jest.Mock };

  beforeEach(async () => {
    mockCollection = { findOne: jest.fn() };
    mockDb = { collection: jest.fn().mockReturnValue(mockCollection) };
    const module = await Test.createTestingModule({
      providers: [MessageCheckService],
    }).compile();
    service = module.get(MessageCheckService);
  });

  it('returns true when a processing message exists', async () => {
    mockCollection.findOne.mockResolvedValue({ _id: 'msg-1' });
    const result = await service.hasProcessingMessage(
      mockDb as unknown as Db,
      'bot-x',
      'chat-y',
    );
    expect(result).toBe(true);
    expect(mockCollection.findOne).toHaveBeenCalledWith({
      botIdentifier: 'bot-x',
      chatDataId: 'chat-y',
      messageStatus: 'processing',
    });
  });

  it('returns false when no processing message exists', async () => {
    mockCollection.findOne.mockResolvedValue(null);
    const result = await service.hasProcessingMessage(
      mockDb as unknown as Db,
      'bot-x',
      'chat-y',
    );
    expect(result).toBe(false);
  });
});
```

### Test: RunDispatchService — adding MessageCheckService mock to existing beforeEach
```typescript
// Add to the providers array in the existing Test.createTestingModule call:
{
  provide: MessageCheckService,
  useValue: {
    hasProcessingMessage: jest.fn().mockResolvedValue(false),
  },
},
```

### Test: DEP-02/DEP-03 — run blocked when processing message exists
```typescript
it('(DEP-02/DEP-03) skips run and logs warn when processing message exists', async () => {
  const run = {
    _id: 'run-001',
    runStatus: 'waiting',
    waitUntil: 1,
    botIdentifier: 'bot-x',
    chatDataId: 'chat-y',
  };
  const db = makeDb(withinWindowVars, webhooksDoc, [run]);
  mongoService.db.mockReturnValue(db as unknown as Db);
  messageCheckService.hasProcessingMessage.mockResolvedValue(true);
  jest.spyOn(Date.prototype, 'getHours').mockReturnValue(10);
  jest.spyOn(Date.prototype, 'getDay').mockReturnValue(1);
  const warnSpy = jest.spyOn((service as any).logger, 'warn').mockImplementation(() => {});

  await service.runRunsCycle();

  expect(webhookDispatchService.dispatch).not.toHaveBeenCalled();
  expect(warnSpy).toHaveBeenCalledWith(
    expect.stringContaining('blocked — message still processing'),
  );
  jest.restoreAllMocks();
});
```

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Jest 30.0.0 |
| Config file | `package.json` (`jest` key) |
| Quick run command | `pnpm run test -- --testPathPattern="message-check\|run-dispatch\|webhook-dispatch" --no-coverage` |
| Full suite command | `pnpm run test` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| DEP-01 | `processingStartedAt` set in main dispatch path | unit | `pnpm run test -- --testPathPattern="webhook-dispatch" --no-coverage` | ✅ (webhook-dispatch.service.spec.ts) |
| DEP-01 | `processingStartedAt` set in retry path | unit | same as above | ✅ |
| DEP-02 | `hasProcessingMessage` called with correct fields | unit | `pnpm run test -- --testPathPattern="run-dispatch" --no-coverage` | ✅ (run-dispatch.service.spec.ts) |
| DEP-03 | Blocked run: dispatch NOT called, run stays `"waiting"` | unit | same | ✅ |
| DEP-04 | Query uses both `botIdentifier` AND `chatDataId` | unit | `pnpm run test -- --testPathPattern="message-check" --no-coverage` | ❌ Wave 0 |
| DEP-05 | `"pending"` messages do NOT appear in block query | unit | same | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `pnpm run test -- --testPathPattern="message-check\|run-dispatch\|webhook-dispatch" --no-coverage`
- **Per wave merge:** `pnpm run test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src/dispatch/message-check.service.spec.ts` — covers DEP-04, DEP-05, DEP-02 (MessageCheckService unit tests)

## Environment Availability

Step 2.6: SKIPPED — Phase 10 is purely code/config changes (new service, modified existing services). No external runtime dependencies beyond the already-running MongoDB instance used in all prior phases.

## Open Questions

1. **Does `chatDataId` exist on run documents in production?**
   - What we know: `STATE.md` explicitly flags this: "Confirm that run documents contain `chatDataId` field in production data before implementing the dependency filter."
   - What's unclear: Field presence is assumed but not verified in the codebase or schema docs. `docs/vars-schema.md` covers `vars` collection only.
   - Recommendation: The guard implementation with `if (botIdentifier && chatDataId)` (absent-field skip silently) is the safe approach. If either field is absent, the run is dispatched without the dependency check rather than being blocked indefinitely. This was flagged as Claude's discretion.

2. **`makeDb` helper in run-dispatch.service.spec.ts — needs `findOne` mock on `messages` collection for MessageCheckService**
   - What we know: The existing `makeDb` helper creates a `messages` mock collection with only `find` (for `processDatabaseMessages`). The dependency check calls `findOne` on `messages` — this is a different method.
   - What's unclear: Will existing tests break if `findOne` is not present on the mock `messages` collection?
   - Recommendation: Update `makeDb` to add `findOne: jest.fn().mockResolvedValue(null)` to the `messages` collection mock. Default `null` means "no blocking message" — all existing tests continue to pass unchanged.

## Sources

### Primary (HIGH confidence)
- Direct code reading: `src/dispatch/run-dispatch.service.ts` — loop structure, rate limit guard pattern, logger usage
- Direct code reading: `src/dispatch/webhook-dispatch.service.ts` — both `$set` locations in `dispatchMessage`
- Direct code reading: `src/dispatch/run-dispatch.service.spec.ts` — `makeDb` helper, `buildServiceWithLimit`, established test patterns
- Direct code reading: `src/dispatch/dispatch.module.ts` — current providers/exports structure
- Direct code reading: `.planning/phases/10-message-run-dependency/10-CONTEXT.md` — all locked decisions D-01 through D-11

### Secondary (MEDIUM confidence)
- `.planning/REQUIREMENTS.md` — DEP-01 through DEP-05 acceptance criteria
- `.planning/STATE.md` — historical decisions, open concern about `chatDataId` field presence

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new dependencies; all patterns copied from existing Phase 9 code
- Architecture: HIGH — decisions fully locked in CONTEXT.md; patterns directly observed in codebase
- Pitfalls: HIGH — identified from actual code structure (two $set locations, makeDb helper gap, DI mock requirement)

**Research date:** 2026-03-30
**Valid until:** 2026-04-30 (stable codebase, no external API dependencies)
