# Phase 2: Core Dispatch Loop - Research

**Researched:** 2026-03-25
**Domain:** NestJS interval scheduling, MongoDB atomic status transitions, HTTP webhook dispatch, timezone-aware time gating
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from Phase 1 CONTEXT.md)

### Locked Decisions

**Env & Config**
- D-01: `CRON_INTERVAL` is in milliseconds (e.g., `CRON_INTERVAL=10000` for 10 seconds)
- D-02: `morningLimit`/`nightLimit` values in `vars` collection are in Brazil timezone (America/Sao_Paulo)
- D-03: Add `TZ` environment variable (e.g., `TZ=America/Sao_Paulo`) — configurable, used for time-gate comparisons
- D-04: Three required env vars: `MONGODB_URI`, `CRON_INTERVAL`, `TZ` — fail fast with clear error if any is missing
- D-05: Use `@nestjs/config` with `.env` file support for env var management

**DB Discovery**
- D-06: Filter databases only by collection presence (`runs` + `webhooks` + `vars`) — no name-based filtering
- D-07: Re-list all databases every cron cycle (not cached) — picks up new client databases automatically
- D-08: Use single shared `MongoClient` instance — `client.db(dbName)` to access each database (no per-DB connections)
- D-09: Skip system databases (`admin`, `local`, `config`) before checking collections

**Logging**
- D-10: Use NestJS built-in Logger (no external logging library)
- D-11: 1 summary line per cycle (e.g., "Cycle #42: 15 DBs scanned, 3 eligible, 0 errors")
- D-12: Log startup validation results (env vars loaded, MongoDB connected, initial DB count)

**Re-read policy**
- Re-read `vars`/`webhooks` every cycle — configs change externally, no caching
- Single retry with 1-min delay — simple policy; run stays `waiting` if retry also fails

### Claude's Discretion
- Module structure (how to organize SchedulerModule, DispatchModule)
- Exact log format and message wording
- Error handling patterns within a cycle (per-DB isolation)
- HTTP client implementation choice (plain `fetch` vs `@nestjs/axios`)

### Deferred Ideas (OUT OF SCOPE)
- RES-01: Graceful shutdown (v2)
- RES-02: Stuck run recovery on startup (v2)
- RES-03: Configurable retry delay via env var (v2)
- TIME-01: `morningLimitFUP`/`nightLimitFUP` secondary window (v2)
- OBS-01: Cycle summary log line (v2)
- CONN-06: Parallel DB processing with `Promise.allSettled` (Phase 3)
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SCHED-01 | Cron job runs at interval configured via `CRON_INTERVAL` env var | `SchedulerRegistry.addInterval` wraps `setInterval` with millisecond value — directly maps to `CRON_INTERVAL` in ms |
| SCHED-02 | Interval is registered dynamically at runtime (not via static `@Interval()` decorator) | `SchedulerRegistry.addInterval` called in `onModuleInit` after reading `ConfigService` — this IS the dynamic registration pattern |
| SCHED-03 | Overlapping cycles prevented via guard flag | `isRunning: boolean` flag + `try/finally` reset — documented pattern in PITFALLS.md |
| DETECT-01 | Query `runs` for `runStatus: "waiting"` AND `waitUntil <= Date.now()` | MongoDB `collection.find({ runStatus: 'waiting', waitUntil: { $lte: new Date() } })` |
| DETECT-02 | Re-read `vars` collection fresh every cycle | No caching in service fields — read inside per-DB processing block |
| DETECT-03 | Re-read `webhooks` collection fresh every cycle | No caching in service fields — read inside per-DB processing block |
| DETECT-04 | Skip runs if current hour is before `morningLimit` or after `nightLimit` | Compare `new Date().getHours()` (TZ env pinned to America/Sao_Paulo) against limits from `vars` |
| DISP-01 | POST eligible run as JSON to "Processador de Runs" URL from `webhooks` | `fetch(url, { method: 'POST', body: JSON.stringify(run), ... })` with serialized document |
| DISP-02 | On successful POST, atomically update run to `runStatus: "queued"` with `queuedAt` | `collection.findOneAndUpdate({ _id, runStatus: 'waiting' }, { $set: { runStatus: 'queued', queuedAt: new Date() } })` |
| DISP-03 | Atomic update uses `{runStatus: "waiting"}` filter to prevent duplicate dispatch | Filter condition in `findOneAndUpdate` — if document is already claimed, update returns null |
| DISP-04 | Failed POST retries once after 1 minute | `setTimeout(retryFn, 60_000)` — non-blocking, in-process |
| DISP-05 | If retry fails, run remains `waiting` (picked up next cycle) | Simply do not update status on retry failure |
| DISP-06 | HTTP requests have explicit timeout | `AbortController` with `signal: AbortSignal.timeout(10_000)` on native `fetch`, or `timeout: 10_000` option on axios |
</phase_requirements>

---

## Summary

Phase 2 builds on the foundation from Phase 1 (MongoService singleton, DatabaseScanService, ConfigModule, ScheduleModule already wired) to implement the full dispatch loop. The three sub-problems are: (1) interval scheduling via `SchedulerRegistry`, (2) per-database run detection with time gating, and (3) atomic HTTP dispatch with a single retry.

The key architectural insight is that `CRON_INTERVAL` is in **milliseconds**, which means we use `SchedulerRegistry.addInterval` (backed by `setInterval`) rather than `addCronJob` (which expects a cron string). The `@nestjs/schedule` v6.1.1 installed in this project exposes `SchedulerRegistry.addInterval(name, intervalId)` where we register a raw `setInterval` return value — giving us full runtime control over the interval period.

Duplicate dispatch prevention does NOT require a `processing` intermediate state for Phase 2. The simpler approach is: attempt the HTTP POST first, then immediately run `findOneAndUpdate` with `{ runStatus: 'waiting' }` as the filter. If two cycles race, only the one that wins the atomic update actually "owns" the run — the loser finds null and does nothing. This avoids the stuck-run recovery problem (v2 concern) while still being safe for a single-instance deployment.

**Primary recommendation:** Use `SchedulerRegistry.addInterval` with `setInterval` in `onModuleInit`, wrap the cycle handler in an `isRunning` guard, implement time gating with `new Date().getHours()` (TZ env set to America/Sao_Paulo), and use Node native `fetch` with `AbortSignal.timeout()` for HTTP dispatch.

---

## Standard Stack

### What Is Already Installed (no new packages needed)

| Library | Version | Purpose | Status |
|---------|---------|---------|--------|
| `@nestjs/schedule` | 6.1.1 | Interval scheduling, `SchedulerRegistry` | INSTALLED — verified in pnpm-lock.yaml |
| `@nestjs/config` | 4.0.3 | `ConfigService` for `CRON_INTERVAL` | INSTALLED — verified in pnpm-lock.yaml |
| `mongodb` | ^7.1.1 | `findOneAndUpdate`, `find`, `Db` handles | INSTALLED — MongoService already uses it |
| `cron` | 4.4.0 | Transitive dep of `@nestjs/schedule` | INSTALLED — pulled by schedule |
| Node.js built-in `fetch` | Node 22 | HTTP dispatch to webhooks | AVAILABLE — Node 22 has stable global `fetch` |
| `rxjs` | ^7.8.1 | Already installed, used by NestJS core | AVAILABLE — no new usage needed |

**No new `pnpm add` commands are required for Phase 2.** All dependencies are present.

### Peer Dependency Compatibility (verified)

`@nestjs/schedule@6.1.1` peer deps: `"@nestjs/common": "^10.0.0 || ^11.0.0"` and `"@nestjs/core": "^10.0.0 || ^11.0.0"`. Project has `@nestjs/common@11.1.17`. Compatible.

### Alternatives Considered

| Recommended | Alternative | Tradeoff |
|-------------|-------------|----------|
| `SchedulerRegistry.addInterval` | `@Interval()` decorator | `@Interval(n)` requires literal number at decoration time — cannot use `ConfigService` value. `addInterval` is the runtime-dynamic equivalent. |
| `SchedulerRegistry.addInterval` | `addCronJob` with CronJob | `CronJob` expects a cron string (e.g., `"*/10 * * * * *"`). `CRON_INTERVAL` is milliseconds. Converting ms → cron string is fragile; `setInterval` is the natural primitive. |
| Node built-in `fetch` | `@nestjs/axios` | `@nestjs/axios` is NOT installed. Node 22 `fetch` is stable, has `AbortSignal.timeout()`, serializes naturally. No new dependency needed. |
| `findOneAndUpdate` with `waiting` filter | Two-step read + update | Atomic — prevents duplicate dispatch without intermediate state. Single operation, no race window. |

---

## Architecture Patterns

### Recommended Module/File Structure for Phase 2

```
src/
├── scheduler/
│   ├── scheduler.module.ts        # imports ScheduleModule, DispatchModule; registers RunDispatchService
│   └── scheduler.service.ts       # onModuleInit: registers interval via SchedulerRegistry
├── dispatch/
│   ├── dispatch.module.ts         # feature module; exports RunDispatchService, WebhookDispatchService
│   ├── run-dispatch.service.ts    # orchestrates one cycle: iterate DBs, gate time, collect runs
│   └── webhook-dispatch.service.ts # HTTP POST + atomic status update + retry
├── database/                      # EXISTING — no changes needed
│   ├── database.module.ts
│   ├── database-scan.service.ts
│   └── database-scan.service.spec.ts
├── mongo/                         # EXISTING — no changes needed
│   ├── mongo.module.ts
│   └── mongo.service.ts
└── app.module.ts                  # ADD: import SchedulerModule
```

**New files:** `scheduler.module.ts`, `scheduler.service.ts`, `dispatch.module.ts`, `run-dispatch.service.ts`, `webhook-dispatch.service.ts`, plus spec files for each service.

### Pattern 1: Dynamic Interval Registration via SchedulerRegistry

**What:** Register a `setInterval` with the `SchedulerRegistry` inside `onModuleInit`. The interval value comes from `ConfigService.getOrThrow('CRON_INTERVAL')` at runtime — not at decoration time.

**When to use:** Whenever the interval period must come from configuration rather than a compile-time constant.

**Verified API** (from `/root/time-trigger-api/node_modules/@nestjs/schedule/dist/scheduler.registry.d.ts`):
```typescript
addInterval<T = any>(name: string, intervalId: T): void;
```

**Example:**
```typescript
// src/scheduler/scheduler.service.ts
import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { RunDispatchService } from '../dispatch/run-dispatch.service.js';

@Injectable()
export class SchedulerService implements OnModuleInit, OnModuleDestroy {
  constructor(
    private readonly schedulerRegistry: SchedulerRegistry,
    private readonly configService: ConfigService,
    private readonly runDispatchService: RunDispatchService,
  ) {}

  onModuleInit(): void {
    const intervalMs = this.configService.getOrThrow<number>('CRON_INTERVAL');
    const intervalId = setInterval(
      () => void this.runDispatchService.runCycle(),
      Number(intervalMs),
    );
    this.schedulerRegistry.addInterval('dispatch-cycle', intervalId);
  }

  onModuleDestroy(): void {
    this.schedulerRegistry.deleteInterval('dispatch-cycle');
  }
}
```

```typescript
// src/scheduler/scheduler.module.ts
import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { DispatchModule } from '../dispatch/dispatch.module.js';
import { SchedulerService } from './scheduler.service.js';

@Module({
  imports: [ScheduleModule.forRoot(), DispatchModule],
  providers: [SchedulerService],
})
export class SchedulerModule {}
```

### Pattern 2: Overlapping Cycle Guard

**What:** An `isRunning` boolean on `RunDispatchService` gates the cycle entry. Reset in `finally` to handle errors.

**Why it matters:** If a cycle takes longer than `CRON_INTERVAL` (e.g., slow webhooks + 60s retry), a second `setInterval` tick fires and would start a second cycle seeing the same `waiting` runs. The guard prevents this entirely.

**Example:**
```typescript
// src/dispatch/run-dispatch.service.ts (excerpt)
private isRunning = false;
private cycleCount = 0;

async runCycle(): Promise<void> {
  if (this.isRunning) {
    this.logger.warn('Cycle skipped — previous cycle still running');
    return;
  }
  this.isRunning = true;
  this.cycleCount++;
  try {
    await this.executeCycle(this.cycleCount);
  } finally {
    this.isRunning = false;
  }
}
```

### Pattern 3: Time-Window Gate (Timezone-Aware)

**What:** Compare current local hour against `morningLimit` and `nightLimit` from `vars`. The `TZ` env var (set to `America/Sao_Paulo`) makes `new Date().getHours()` return Brazil local time — matching how `morningLimit`/`nightLimit` are stored.

**Key insight:** Because `TZ=America/Sao_Paulo` is set as an env var, `new Date().getHours()` returns the correct Brazil hour. No timezone library is needed. This is the locked decision from D-02/D-03.

**Example:**
```typescript
private isWithinTimeWindow(morningLimit: number, nightLimit: number): boolean {
  const currentHour = new Date().getHours(); // Brazil time due to TZ env
  return currentHour >= morningLimit && currentHour < nightLimit;
}
```

**Edge case:** If `morningLimit` or `nightLimit` is missing/null from `vars`, skip the database (log a warning) rather than defaulting to "allow all". Failing open creates silent dispatch outside expected hours.

### Pattern 4: Per-Database Processing with Fresh Config Reads

**What:** Each database's processing block reads `vars` and `webhooks` fresh. Missing documents cause a skip with warning, not a crash.

**Example:**
```typescript
// src/dispatch/run-dispatch.service.ts (excerpt)
private async processDatabase(dbName: string): Promise<void> {
  const db = this.mongoService.db(dbName);

  // DETECT-02: fresh vars read every cycle
  const vars = await db.collection('vars').findOne<VarsDoc>({});
  if (!vars?.morningLimit || !vars?.nightLimit) {
    this.logger.warn(`[${dbName}] Missing morningLimit/nightLimit in vars — skipping`);
    return;
  }

  // DETECT-04: time gate
  if (!this.isWithinTimeWindow(vars.morningLimit, vars.nightLimit)) {
    return;
  }

  // DETECT-03: fresh webhooks read every cycle
  const webhookDoc = await db.collection('webhooks').findOne<WebhookDoc>({});
  const webhookUrl = webhookDoc?.['Processador de Runs'];
  if (!webhookUrl) {
    this.logger.warn(`[${dbName}] "Processador de Runs" URL missing from webhooks — skipping`);
    return;
  }

  // DETECT-01: find eligible runs
  const runs = await db
    .collection('runs')
    .find({ runStatus: 'waiting', waitUntil: { $lte: new Date() } })
    .toArray();

  for (const run of runs) {
    await this.webhookDispatchService.dispatch(db, run, webhookUrl);
  }
}
```

### Pattern 5: Atomic Dispatch with Single Retry

**What:** HTTP POST first, then atomically claim the run. If the atomic update returns null, another cycle already claimed it — skip silently. On HTTP failure, retry once after 60 seconds via `setTimeout` (non-blocking).

**Why atomic update comes AFTER the POST:** If we claim the run first (set `processing`) and then crash before updating to `queued`, the run is stuck. Post-first means: if the POST succeeds but the DB update fails, the downstream webhook is idempotent (it received the run), and the next cycle will attempt to claim the same run again. The duplicate POST risk is low on single-instance deployment; it is the lesser evil compared to stuck runs.

**Note on DISP-02 vs DISP-03:** The requirement says update on successful POST (DISP-02) and use `{runStatus: "waiting"}` as filter (DISP-03). This is consistent: post first, then `findOneAndUpdate({ _id, runStatus: 'waiting' }, { $set: { runStatus: 'queued', queuedAt: new Date() } })`.

**Example:**
```typescript
// src/dispatch/webhook-dispatch.service.ts
async dispatch(db: Db, run: Document, webhookUrl: string): Promise<void> {
  const success = await this.post(webhookUrl, run);

  if (success) {
    const result = await db.collection('runs').findOneAndUpdate(
      { _id: run._id, runStatus: 'waiting' },
      { $set: { runStatus: 'queued', queuedAt: new Date() } },
    );
    if (!result) {
      this.logger.warn(`Run ${String(run._id)} already claimed by another cycle`);
    }
    return;
  }

  // DISP-04: single non-blocking retry after 60s
  setTimeout(async () => {
    const retrySuccess = await this.post(webhookUrl, run);
    if (retrySuccess) {
      await db.collection('runs').findOneAndUpdate(
        { _id: run._id, runStatus: 'waiting' },
        { $set: { runStatus: 'queued', queuedAt: new Date() } },
      );
    }
    // DISP-05: if retry fails, leave as 'waiting' — next cycle picks up
  }, 60_000);
}

private async post(url: string, run: Document): Promise<boolean> {
  try {
    // DISP-06: explicit timeout prevents hanging webhook
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(run),  // serializes ObjectId safely via toJSON
      signal: AbortSignal.timeout(10_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}
```

### Pattern 6: AppModule Integration

Phase 1 `AppModule` already imports `MongoModule`, `DatabaseModule`, `ConfigModule`. Phase 2 adds `SchedulerModule`.

```typescript
// src/app.module.ts — add SchedulerModule to imports
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' }),
    MongoModule,
    DatabaseModule,
    SchedulerModule,  // NEW: imports ScheduleModule.forRoot() + DispatchModule
  ],
  ...
})
```

### Anti-Patterns to Avoid

- **Using `@Interval()` decorator with `ConfigService`:** The decorator is evaluated at class definition time. `ConfigService` is not available then. Use `SchedulerRegistry.addInterval` in `onModuleInit` instead.
- **Two-step read-then-update for run status:** Not atomic. Another cycle can read the same `waiting` run between your read and your write. Always use `findOneAndUpdate`.
- **`await sleep(60_000)` for retry:** Blocks the event loop, preventing other intervals from firing during the wait. Use `setTimeout` (fire-and-forget async callback).
- **No timeout on `fetch`:** Node 22 `fetch` has no default timeout. A hanging webhook holds the cycle slot and triggers the `isRunning` guard indefinitely. Always use `AbortSignal.timeout()`.
- **Calling `JSON.stringify` directly on the MongoDB Document without serialization:** MongoDB `Document` types contain `ObjectId` instances. `JSON.stringify` calls `.toJSON()` on them automatically (they serialize to 24-char hex strings). This is safe — but be aware the webhook receives `_id` as a string, not an object.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Millisecond interval scheduling | Custom `setInterval` wrapper | `SchedulerRegistry.addInterval` | Registry manages cleanup on app shutdown; NestJS owns lifecycle |
| Atomic "claim and dispatch" | Read `runStatus`, then write separately | `findOneAndUpdate` with filter | MongoDB guarantees atomicity at document level; two-step has a race window |
| HTTP with timeout | Manual `Promise.race` + `setTimeout` | `AbortSignal.timeout(10_000)` with `fetch` | Node 22 native API, no extra packages |
| Timezone-aware hour comparison | Custom timezone library (luxon, date-fns-tz) | `TZ` env var + `new Date().getHours()` | Node process inherits TZ; simpler and correct for single-timezone case |
| Retry queue | Bull, BullMQ, pg-boss | `setTimeout` with closure | Single retry, single instance — external queue is massive overkill |

**Key insight:** Every "custom" solution in this domain solves a problem that either MongoDB atomics or Node primitives already handle. The complexity is in using them correctly, not building alternatives.

---

## Common Pitfalls

### Pitfall 1: `@Interval()` Decorator Cannot Use ConfigService Value
**What goes wrong:** Developer writes `@Interval(this.configService.get('CRON_INTERVAL'))` — TypeScript rejects it because decorators run at class load time, `this` is not bound.
**Why it happens:** Decorator arguments are evaluated once when the class is defined, not when an instance is created.
**How to avoid:** Use `SchedulerRegistry.addInterval` inside `onModuleInit`. By that point DI is resolved and `ConfigService` is available.
**Warning signs:** TypeScript error "a class decorator cannot reference the class's own 'this'"; or interval never fires because `undefined` was passed to `@Interval()`.

### Pitfall 2: Overlapping Cycles Causing Duplicate Dispatch
**What goes wrong:** A slow webhook (or the 60-second retry) keeps the cycle running when the next tick fires. Without the guard, two cycles query `runs` simultaneously, both see the same `waiting` document, both POST to the webhook, and one loses the atomic update race — but the run was already dispatched twice.
**Why it happens:** `setInterval` fires on schedule regardless of previous invocation state.
**How to avoid:** `isRunning` flag in `try/finally`. Log a warning so the operator can detect when the interval is too short.
**Warning signs:** Two log entries "dispatching run X" for the same run ID; webhook receives duplicate payloads.

### Pitfall 3: `morningLimit`/`nightLimit` Comparison in Wrong Timezone
**What goes wrong:** Service runs in Docker without `TZ` env var. `new Date().getHours()` returns UTC hour. Brazilian clients set `morningLimit=8` meaning 8am Brazil time (UTC-3), but the service evaluates it as 8am UTC — a 3-hour drift.
**Why it happens:** Docker containers default to UTC unless `TZ` is explicitly set.
**How to avoid:** Set `TZ=America/Sao_Paulo` in `.env` and Dockerfile. Verified from D-03. Test: compare `new Date().getHours()` output inside Docker against expected Brazil hour.
**Warning signs:** Runs dispatch at unexpected local times; time-gate tests pass locally but fail in Docker.

### Pitfall 4: Missing Null Guard on `vars` / `webhooks` Read
**What goes wrong:** `const vars = await db.collection('vars').findOne({})` returns `null` for a database where the document was deleted. Next line `vars.morningLimit` throws `TypeError: Cannot read properties of null`.
**Why it happens:** `findOne` returns `null` when no document matches. TypeScript allows property access on `Document | null` if type narrowing is skipped.
**How to avoid:** Explicitly check `if (!vars?.morningLimit)` before using the value. Skip the database with a warning log. Never throw — one bad database must not crash the cycle for all others.
**Warning signs:** Entire cycle stops mid-execution; logs show unhandled TypeErrors from a specific DB name.

### Pitfall 5: HTTP Timeout Not Set — Cycle Stalls
**What goes wrong:** A webhook endpoint hangs. `fetch` awaits indefinitely. `isRunning` stays `true` for minutes. All subsequent interval ticks are skipped. Entire dispatch loop stalls.
**Why it happens:** Node 22 `fetch` has no default timeout. The connection may never time out at the application level.
**How to avoid:** `AbortSignal.timeout(10_000)` on every `fetch` call. 10 seconds is generous for internal webhooks.
**Warning signs:** Logs show cycle start but no cycle end for extended periods; `isRunning` warning appears on every subsequent tick.

### Pitfall 6: `webhooks` Document Field Path Unknown
**What goes wrong:** The webhook URL is stored in the `webhooks` collection but the exact field name is `"Processador de Runs"` — a key with spaces and a capital letter. Accessing it as `webhookDoc.processadorDeRuns` returns `undefined`.
**Why it happens:** MongoDB document field names can contain spaces; JavaScript property access requires bracket notation for non-identifier keys.
**How to avoid:** Access with bracket notation: `webhookDoc?.['Processador de Runs']`. The field name was noted in REQUIREMENTS.md as a concern to verify against real data.
**Warning signs:** `webhookUrl` is `undefined`; service logs "URL missing from webhooks" for all databases despite documents existing.

### Pitfall 7: `CRON_INTERVAL` from ConfigService Returns a String
**What goes wrong:** `ConfigService.getOrThrow('CRON_INTERVAL')` always returns a string (env vars are strings). Passing a string to `setInterval` calls `setInterval('some string', ...)` which is `setInterval(undefined, ...)` in strict mode and falls back to default behavior.
**Why it happens:** `process.env` values are always strings. `ConfigService` preserves that.
**How to avoid:** Cast explicitly: `Number(this.configService.getOrThrow<string>('CRON_INTERVAL'))`. Validate it is a positive integer before registering the interval.
**Warning signs:** Interval fires unexpectedly fast or throws a TypeError; `typeof intervalMs` is `'string'` at runtime.

---

## Code Examples

### Full SchedulerService (SCHED-01, SCHED-02)
```typescript
// src/scheduler/scheduler.service.ts
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { RunDispatchService } from '../dispatch/run-dispatch.service.js';

@Injectable()
export class SchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SchedulerService.name);

  constructor(
    private readonly schedulerRegistry: SchedulerRegistry,
    private readonly configService: ConfigService,
    private readonly runDispatchService: RunDispatchService,
  ) {}

  onModuleInit(): void {
    const intervalMs = Number(this.configService.getOrThrow<string>('CRON_INTERVAL'));
    const intervalId = setInterval(
      () => void this.runDispatchService.runCycle(),
      intervalMs,
    );
    this.schedulerRegistry.addInterval('dispatch-cycle', intervalId);
    this.logger.log(`Dispatch interval registered: ${intervalMs}ms`);
  }

  onModuleDestroy(): void {
    this.schedulerRegistry.deleteInterval('dispatch-cycle');
  }
}
```

### Cycle Guard (SCHED-03)
```typescript
// src/dispatch/run-dispatch.service.ts (guard section)
private isRunning = false;
private cycleCount = 0;

async runCycle(): Promise<void> {
  if (this.isRunning) {
    this.logger.warn(`Cycle skipped — previous cycle still running`);
    return;
  }
  this.isRunning = true;
  this.cycleCount++;
  const cycle = this.cycleCount;
  this.logger.log(`Cycle #${cycle} start`);
  try {
    await this.executeCycle();
    this.logger.log(`Cycle #${cycle} complete`);
  } catch (err) {
    this.logger.error(`Cycle #${cycle} error: ${String(err)}`);
  } finally {
    this.isRunning = false;
  }
}
```

### Time Gate (DETECT-04)
```typescript
// Returns true if current hour (in TZ-env timezone) is within [morningLimit, nightLimit)
private isWithinTimeWindow(morningLimit: number, nightLimit: number): boolean {
  const currentHour = new Date().getHours();
  return currentHour >= morningLimit && currentHour < nightLimit;
}
```

### MongoDB Queries (DETECT-01, DETECT-02, DETECT-03)
```typescript
// vars — fresh read each cycle (DETECT-02)
const vars = await db.collection('vars').findOne<{ morningLimit: number; nightLimit: number }>({});

// webhooks — fresh read each cycle (DETECT-03)
const webhookDoc = await db.collection('webhooks').findOne<Record<string, string>>({});
const webhookUrl = webhookDoc?.['Processador de Runs'];

// runs — eligible set (DETECT-01)
const runs = await db
  .collection('runs')
  .find({ runStatus: 'waiting', waitUntil: { $lte: new Date() } })
  .toArray();
```

### Atomic Status Update (DISP-02, DISP-03)
```typescript
// Atomic claim — prevents duplicate dispatch even if two cycles race
const result = await db.collection('runs').findOneAndUpdate(
  { _id: run._id, runStatus: 'waiting' },   // DISP-03: filter includes runStatus
  { $set: { runStatus: 'queued', queuedAt: new Date() } },  // DISP-02
);
// result is null if another cycle already claimed this run
if (!result) {
  this.logger.debug(`Run ${String(run._id)} already claimed — skipping`);
}
```

### HTTP POST with Timeout (DISP-01, DISP-06)
```typescript
private async post(url: string, run: Document): Promise<boolean> {
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(run),  // ObjectId serializes to hex string via toJSON()
      signal: AbortSignal.timeout(10_000),  // DISP-06: explicit 10s timeout
    });
    return response.ok;
  } catch {
    return false;
  }
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `@Cron()` static decorator | `SchedulerRegistry.addInterval()` at `onModuleInit` | `@nestjs/schedule` v2+ | Enables runtime-configured intervals; static decorator requires compile-time literal |
| `node-fetch` package | Node 22 built-in `fetch` with `AbortSignal.timeout()` | Node 18 (stable), Node 22 (default global) | Zero extra dependencies for HTTP; `AbortSignal.timeout` is clean timeout API |
| Mongoose + single-DB pattern | MongoDB native driver + `client.db(name)` | Architecture choice | Multi-database enumeration impossible with Mongoose's single-connection model |
| Intermediate `processing` state for lock | Post-first + `findOneAndUpdate` with `waiting` filter | Design simplification | Avoids stuck-run problem entirely for single-instance; cleaner recovery on restart |

**Deprecated/outdated:**
- `@Interval()` decorator with dynamic values: Not supported — decorator arguments are not lazy. Only works with literal numbers.
- `cron` package imported directly in service: `@nestjs/schedule` wraps it; use `SchedulerRegistry` API instead.

---

## Open Questions

1. **`webhooks` document field path — "Processador de Runs"**
   - What we know: REQUIREMENTS.md states the URL is identified by `"Processador de Runs"` key. This is the name in the requirements, but exact field structure in real MongoDB documents was flagged as a blocker in STATE.md.
   - What's unclear: Is it a top-level field `webhookDoc['Processador de Runs']`, a nested object field, or accessed via a different property path?
   - Recommendation: Verify against a real `webhooks` document before finalizing the query. The planner should include a task to inspect the real collection structure. For now, implement using bracket notation on the top-level document.

2. **`morningLimit`/`nightLimit` data type in `vars`**
   - What we know: Values are in Brazil timezone (D-02). Likely stored as integers (hours 0–23).
   - What's unclear: Could be stored as strings ("08", "22") instead of numbers.
   - Recommendation: Cast to `Number()` defensively when reading from MongoDB to handle both representations.

3. **`AbortSignal.timeout` availability**
   - What we know: Node 22 supports `AbortSignal.timeout()` — introduced in Node 17.3.
   - What's unclear: None — this project targets Node 22 (confirmed by `@types/node@^22`).
   - Recommendation: Use `AbortSignal.timeout(10_000)` directly; no polyfill needed.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `@nestjs/schedule` | SCHED-01, SCHED-02 | YES | 6.1.1 | — |
| `@nestjs/config` | SCHED-01 (CRON_INTERVAL) | YES | 4.0.3 | — |
| `mongodb` native driver | DETECT-01–04, DISP-02, DISP-03 | YES | ^7.1.1 | — |
| Node `fetch` + `AbortSignal.timeout` | DISP-01, DISP-06 | YES | Node 22 | — |
| `cron` (transitive) | SchedulerRegistry internals | YES | 4.4.0 | — |

**No missing dependencies.** All required packages are installed. No `pnpm add` commands needed before implementation.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Jest 30.0.0 with ts-jest |
| Config file | `package.json` → `"jest"` key |
| Quick run command | `pnpm test` |
| Full suite command | `pnpm test:cov` |

**Existing suite baseline:** 19 tests passing across 4 suites (verified 2026-03-25).

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SCHED-01 | Interval registered with correct ms value | unit | `pnpm test --testPathPattern=scheduler` | No — Wave 0 |
| SCHED-02 | `addInterval` called in `onModuleInit`, not via decorator | unit | `pnpm test --testPathPattern=scheduler` | No — Wave 0 |
| SCHED-03 | Guard skips cycle when `isRunning = true` | unit | `pnpm test --testPathPattern=run-dispatch` | No — Wave 0 |
| DETECT-01 | MongoDB query filters `runStatus:'waiting'` AND `waitUntil <= now` | unit | `pnpm test --testPathPattern=run-dispatch` | No — Wave 0 |
| DETECT-02 | `vars` read fresh each call (no cache) | unit | `pnpm test --testPathPattern=run-dispatch` | No — Wave 0 |
| DETECT-03 | `webhooks` read fresh each call (no cache) | unit | `pnpm test --testPathPattern=run-dispatch` | No — Wave 0 |
| DETECT-04 | DB skipped when hour outside `morningLimit`–`nightLimit` | unit | `pnpm test --testPathPattern=run-dispatch` | No — Wave 0 |
| DISP-01 | HTTP POST sent to webhook URL with run as JSON body | unit | `pnpm test --testPathPattern=webhook-dispatch` | No — Wave 0 |
| DISP-02 | Successful POST triggers `findOneAndUpdate` setting `queued`+`queuedAt` | unit | `pnpm test --testPathPattern=webhook-dispatch` | No — Wave 0 |
| DISP-03 | `findOneAndUpdate` filter includes `runStatus:'waiting'` | unit | `pnpm test --testPathPattern=webhook-dispatch` | No — Wave 0 |
| DISP-04 | Failed POST schedules retry via `setTimeout` after 60s | unit | `pnpm test --testPathPattern=webhook-dispatch` | No — Wave 0 |
| DISP-05 | Failed retry leaves run as `waiting` (no status update) | unit | `pnpm test --testPathPattern=webhook-dispatch` | No — Wave 0 |
| DISP-06 | `fetch` called with `AbortSignal.timeout(10_000)` | unit | `pnpm test --testPathPattern=webhook-dispatch` | No — Wave 0 |

### Sampling Rate
- **Per task commit:** `pnpm test --testPathPattern=<service-under-test>`
- **Per wave merge:** `pnpm test` (full suite)
- **Phase gate:** Full suite green (19 existing + all new tests passing) before `/gsd:verify-work`

### Wave 0 Gaps (files to create before implementation)

- [ ] `src/scheduler/scheduler.service.spec.ts` — covers SCHED-01, SCHED-02
- [ ] `src/dispatch/run-dispatch.service.spec.ts` — covers SCHED-03, DETECT-01–04
- [ ] `src/dispatch/webhook-dispatch.service.spec.ts` — covers DISP-01–06

No new framework install needed — Jest + ts-jest already configured.

---

## Project Constraints (from CLAUDE.md)

All items extracted from `./CLAUDE.md` that constrain implementation:

| Directive | Source | Impact on Phase 2 |
|-----------|--------|-------------------|
| All commits must follow Conventional Commits with emojis (e.g., `✨ feat: ...`) | CLAUDE.md Git Commit Guidelines | Every commit in this phase uses emoji + type prefix |
| NEVER include `Co-Authored-By: Claude` in commits | CLAUDE.md | Omit from all commit messages |
| Tech stack: NestJS 11, MongoDB native driver, TypeScript | CLAUDE.md Constraints | No Mongoose, no alternative frameworks |
| Reliability: No duplicate dispatches | CLAUDE.md Constraints | `findOneAndUpdate` atomic pattern is mandatory |
| Performance: Must handle dozens of databases efficiently | CLAUDE.md Constraints | Per-DB error isolation (one failing DB must not stop others); Phase 3 adds parallelism |
| Single quotes, trailing commas (Prettier) | CLAUDE.md Conventions | All new code uses single quotes and trailing commas |
| `private readonly` for DI constructor params | CLAUDE.md Conventions | All service dependencies injected as `private readonly` |
| All imports use `.js` extension (nodenext module resolution) | Phase 1 established pattern | `import ... from '../dispatch/run-dispatch.service.js'` |
| NestJS Logger only (no external logging library) | D-10 | `new Logger(ClassName.name)` in each service |
| Do not make direct repo edits outside a GSD workflow | CLAUDE.md GSD Workflow | Enforced by process, not by code |

---

## Sources

### Primary (HIGH confidence)
- `/root/time-trigger-api/node_modules/@nestjs/schedule/dist/scheduler.registry.d.ts` — `addInterval`, `deleteInterval`, `addCronJob` API signatures verified from installed package
- `/root/time-trigger-api/node_modules/@nestjs/schedule/dist/schedule.module.d.ts` — `ScheduleModule.forRoot()` signature verified
- `/root/time-trigger-api/node_modules/@nestjs/schedule/package.json` — version 6.1.1, peer deps `@nestjs/common ^10 || ^11`
- `/root/time-trigger-api/node_modules/.pnpm/cron@4.4.0/node_modules/cron/dist/job.d.ts` — `CronJob` constructor, `CronJobParams.cronTime: string | Date | DateTime` (confirms it does NOT accept milliseconds)
- `/root/time-trigger-api/package.json` — confirmed `@nestjs/schedule@6.1.1`, `@nestjs/config@4.0.3`, `mongodb@^7.1.1` installed
- `/root/time-trigger-api/src/mongo/mongo.service.ts` — confirmed `MongoService.db(name)`, `listDatabaseNames()` API as built
- `/root/time-trigger-api/src/database/database-scan.service.ts` — confirmed `getEligibleDatabases()` API as built
- `/root/time-trigger-api/src/app.module.ts` — confirmed `ConfigModule.forRoot({ isGlobal: true })`, `MongoModule`, `DatabaseModule` already imported
- Node.js 22 documentation — `AbortSignal.timeout()` and global `fetch` available since Node 17.3/18 respectively (HIGH — confirmed by `@types/node@^22` in package.json)

### Secondary (MEDIUM confidence)
- `ARCHITECTURE.md` in `.planning/research/` — component boundaries and data flow verified against actual built code
- `PITFALLS.md` in `.planning/research/` — pitfall patterns validated against installed package behavior
- `STACK.md` in `.planning/research/` — stack recommendations cross-verified against actual `package.json`

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all packages verified from installed node_modules and pnpm-lock.yaml; no new packages needed
- Architecture: HIGH — `SchedulerRegistry.addInterval` API verified from installed type definitions; MongoDB `findOneAndUpdate` is well-established
- Pitfalls: HIGH — drawn from installed package behavior (cron@4.4.0 CronTime only accepts string/Date/DateTime), Node 22 behavior, and project-specific blockers noted in STATE.md
- Time gating: HIGH — `TZ` env var approach verified by existing D-02/D-03 decisions; no library needed for single-timezone case

**Research date:** 2026-03-25
**Valid until:** 2026-04-25 (stable NestJS/MongoDB stack; Node 22 LTS)
