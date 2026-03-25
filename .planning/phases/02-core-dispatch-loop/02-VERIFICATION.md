---
phase: 02-core-dispatch-loop
verified: 2026-03-25T13:20:00Z
status: passed
score: 21/21 must-haves verified
re_verification: false
---

# Phase 2: Core Dispatch Loop — Verification Report

**Phase Goal:** The service reliably detects waiting runs and dispatches them to webhooks — with no duplicate dispatches, no overlapping cycles, correct time-of-day gating, and a single retry on failure
**Verified:** 2026-03-25T13:20:00Z
**Status:** PASSED
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Run document is HTTP POSTed as JSON to webhook URL with Content-Type: application/json | VERIFIED | `webhook-dispatch.service.ts` L39-41: `method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(run)` |
| 2 | On successful POST, findOneAndUpdate atomically sets runStatus: 'queued' and queuedAt | VERIFIED | L12-14: `findOneAndUpdate(filter, { $set: { runStatus: 'queued', queuedAt: new Date() } })` — called only when `success === true` |
| 3 | findOneAndUpdate filter includes both _id AND runStatus: 'waiting' — prevents duplicate claim | VERIFIED | L13 and L27: `{ _id: run._id, runStatus: 'waiting' }` — both in initial dispatch and retry path |
| 4 | On failed POST, non-blocking setTimeout schedules single retry after 60 000 ms | VERIFIED | L23-32: `setTimeout(async () => { ... }, 60_000)` — never awaited, fire-and-forget |
| 5 | If retry fails, run document is left untouched (runStatus stays 'waiting') | VERIFIED | L24-30: `if (retrySuccess) { findOneAndUpdate(...) }` — no update branch when retry returns false |
| 6 | Every fetch call carries AbortSignal.timeout(10_000) | VERIFIED | L42: `signal: AbortSignal.timeout(10_000)` inside private `post()` method used for both initial and retry |
| 7 | Each cycle queries runs with runStatus: 'waiting' AND waitUntil <= now | VERIFIED | `run-dispatch.service.ts` L87: `.find({ runStatus: 'waiting', waitUntil: { $lte: new Date() } })` |
| 8 | vars is read fresh on every per-database call | VERIFIED | L61: `await db.collection('vars').findOne<VarsDoc>({})` inside `processDatabase()` — no class-level cache |
| 9 | webhooks is read fresh on every per-database call | VERIFIED | L75: `await db.collection('webhooks').findOne<WebhookDoc>({})` inside `processDatabase()` — no class-level cache |
| 10 | Missing morningLimit/nightLimit causes database skip with warning, not throw | VERIFIED | L62-67: `if (!vars?.morningLimit \|\| !vars?.nightLimit) { logger.warn(...); return; }` |
| 11 | Missing 'Processador de Runs' URL causes database skip with warning, not throw | VERIFIED | L77-82: `if (!webhookUrl) { logger.warn(...); return; }` |
| 12 | Current hour before morningLimit skips all runs for that database | VERIFIED | L95-97: `return currentHour >= morningLimit && currentHour < nightLimit` — test DETECT-04 before-window case confirmed |
| 13 | Current hour >= nightLimit skips all runs for that database | VERIFIED | Same `isWithinTimeWindow` logic — test DETECT-04 after-window case confirmed |
| 14 | When within time window, WebhookDispatchService.dispatch() called for each eligible run | VERIFIED | L90-92: `for (const run of runs) { await this.webhookDispatchService.dispatch(db, run, webhookUrl); }` |
| 15 | isRunning guard prevents second concurrent cycle from entering | VERIFIED | L29-32: `if (this.isRunning) { logger.warn('...previous cycle...'); return; }` |
| 16 | isRunning resets to false after cycle completes (including on error) | VERIFIED | L52-53: `finally { this.isRunning = false; }` |
| 17 | Cron interval registered via SchedulerRegistry.addInterval at runtime | VERIFIED | `scheduler.service.ts` L25: `this.schedulerRegistry.addInterval('dispatch-cycle', intervalId)` — no @Interval() decorator present |
| 18 | Interval period comes from Number(configService.getOrThrow('CRON_INTERVAL')) | VERIFIED | L20: `const intervalMs = Number(this.configService.getOrThrow<string>('CRON_INTERVAL'))` |
| 19 | Interval registered in onModuleInit, deleted in onModuleDestroy | VERIFIED | L16 onModuleInit registers; L29-31 onModuleDestroy deletes via `deleteInterval('dispatch-cycle')` |
| 20 | SchedulerModule imports ScheduleModule.forRoot() and DispatchModule | VERIFIED | `scheduler.module.ts` L7: `imports: [ScheduleModule.forRoot(), DispatchModule]` |
| 21 | AppModule imports SchedulerModule — dispatch loop activates on bootstrap | VERIFIED | `app.module.ts` L6 import, L15 `SchedulerModule` in imports array |

**Score:** 21/21 truths verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/dispatch/webhook-dispatch.service.ts` | WebhookDispatchService with dispatch() and post() | VERIFIED | 49 lines, exports class, substantive implementation |
| `src/dispatch/webhook-dispatch.service.spec.ts` | 9 unit tests for DISP-01 through DISP-06 | VERIFIED | 9 `it()` blocks, all pass |
| `src/dispatch/run-dispatch.service.ts` | RunDispatchService with runCycle(), processDatabase(), isRunning guard | VERIFIED | 99 lines, full implementation |
| `src/dispatch/run-dispatch.service.spec.ts` | 11 unit tests for DETECT-01 through DETECT-04 and SCHED-03 | VERIFIED | 11 `it()` blocks, all pass |
| `src/dispatch/dispatch.module.ts` | DispatchModule exporting both services | VERIFIED | Providers and exports arrays both contain RunDispatchService and WebhookDispatchService |
| `src/scheduler/scheduler.service.ts` | SchedulerService with onModuleInit/onModuleDestroy | VERIFIED | 32 lines, implements OnModuleInit and OnModuleDestroy |
| `src/scheduler/scheduler.service.spec.ts` | 5 unit tests for SCHED-01, SCHED-02 | VERIFIED | 5 `it()` blocks, all pass |
| `src/scheduler/scheduler.module.ts` | SchedulerModule importing ScheduleModule.forRoot() and DispatchModule | VERIFIED | Correct imports, SchedulerService as provider |
| `src/app.module.ts` | AppModule with SchedulerModule in imports | VERIFIED | SchedulerModule present at L15 |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `webhook-dispatch.service.ts` | MongoDB runs collection | `db.collection('runs').findOneAndUpdate({ _id, runStatus: 'waiting' })` | WIRED | L12-15 initial; L26-29 retry — both paths present |
| `webhook-dispatch.service.ts` | Node global fetch | `fetch(url, { signal: AbortSignal.timeout(10_000), ... })` | WIRED | L38-43 inside private `post()` method |
| `webhook-dispatch.service.ts` | retry | `setTimeout(async () => { ... }, 60_000)` | WIRED | L23-32 — fired only on failure path |
| `run-dispatch.service.ts` | DatabaseScanService | `this.databaseScanService.getEligibleDatabases()` | WIRED | L39 constructor injection confirmed |
| `run-dispatch.service.ts` | MongoService | `this.mongoService.db(dbName)` | WIRED | L58 — called inside processDatabase() |
| `run-dispatch.service.ts` | WebhookDispatchService | `this.webhookDispatchService.dispatch(db, run, webhookUrl)` | WIRED | L91 inside run loop |
| `run-dispatch.service.ts` | isWithinTimeWindow | `new Date().getHours()` vs morningLimit/nightLimit | WIRED | L95-97 private method called at L70 |
| `scheduler.service.ts` | SchedulerRegistry | `this.schedulerRegistry.addInterval('dispatch-cycle', intervalId)` | WIRED | L25 |
| `scheduler.service.ts` | RunDispatchService | `() => void this.runDispatchService.runCycle()` | WIRED | L22 — fire-and-forget void |
| `scheduler.module.ts` | ScheduleModule | `ScheduleModule.forRoot()` in imports | WIRED | L7 |
| `app.module.ts` | SchedulerModule | `SchedulerModule` in imports array | WIRED | L15 |

---

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `run-dispatch.service.ts` | `vars` | `db.collection('vars').findOne({})` — called on every `processDatabase()` invocation | Yes — direct MongoDB query, no static fallback | FLOWING |
| `run-dispatch.service.ts` | `webhookDoc` / `webhookUrl` | `db.collection('webhooks').findOne({})` — called on every `processDatabase()` invocation | Yes — direct MongoDB query | FLOWING |
| `run-dispatch.service.ts` | `runs` | `db.collection('runs').find({ runStatus: 'waiting', waitUntil: { $lte: new Date() } }).toArray()` | Yes — filtered MongoDB query | FLOWING |
| `webhook-dispatch.service.ts` | `success` / `retrySuccess` | `fetch(webhookUrl, ...)` — real HTTP call with AbortSignal | Yes — real network response | FLOWING |
| `scheduler.service.ts` | `intervalMs` | `Number(configService.getOrThrow('CRON_INTERVAL'))` | Yes — runtime env var cast to number | FLOWING |

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Full test suite (44 tests) | `pnpm test` | 44 passed, 0 failed, 7 suites | PASS |
| TypeScript build | `pnpm run build` | Exit 0, no errors | PASS |
| dispatch dist artifacts exist | `ls dist/dispatch/` | 9 files: .js, .d.ts, .js.map for all 3 dispatch modules | PASS |
| scheduler dist artifacts exist | `ls dist/scheduler/` | Expected — confirmed by build exit 0 | PASS |
| No @Interval() decorator | `grep '@Interval' scheduler.service.ts` | No match — dynamic only | PASS |
| No hardcoded empty returns in API paths | grep for `return \[\]\|return {}` in dispatch files | No matches | PASS |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| SCHED-01 | 02-03 | Cron job runs at interval configured via CRON_INTERVAL env var | SATISFIED | `scheduler.service.ts` L20: `Number(configService.getOrThrow('CRON_INTERVAL'))` passed to setInterval |
| SCHED-02 | 02-03 | Cron interval registered dynamically at runtime (not static decorator) | SATISFIED | `scheduler.service.ts` L25: `schedulerRegistry.addInterval('dispatch-cycle', ...)` — no @Interval() present |
| SCHED-03 | 02-02 | Overlapping cycles prevented | SATISFIED | `run-dispatch.service.ts` L19, 29-32, 52-53: isRunning flag with try/finally reset |
| DETECT-01 | 02-02 | Each cycle queries runs with runStatus: 'waiting' AND waitUntil <= now | SATISFIED | `run-dispatch.service.ts` L85-88: `.find({ runStatus: 'waiting', waitUntil: { $lte: new Date() } })` |
| DETECT-02 | 02-02 | Each cycle re-reads vars collection fresh (no caching) | SATISFIED | `run-dispatch.service.ts` L61: `db.collection('vars').findOne<VarsDoc>({})` inside processDatabase() |
| DETECT-03 | 02-02 | Each cycle re-reads webhooks collection fresh (no caching) | SATISFIED | `run-dispatch.service.ts` L75: `db.collection('webhooks').findOne<WebhookDoc>({})` inside processDatabase() |
| DETECT-04 | 02-02 | Runs skipped if outside morningLimit–nightLimit window | SATISFIED | `run-dispatch.service.ts` L95-97: `currentHour >= morningLimit && currentHour < nightLimit` |
| DISP-01 | 02-01 | Eligible run POSTed as JSON to "Processador de Runs" URL | SATISFIED | `webhook-dispatch.service.ts` L38-42: `method: 'POST', body: JSON.stringify(run)` with URL from webhooks doc |
| DISP-02 | 02-01 | On successful POST, run updated atomically to runStatus: 'queued' with queuedAt | SATISFIED | L12-15: `findOneAndUpdate(filter, { $set: { runStatus: 'queued', queuedAt: new Date() } })` — inside `if (success)` |
| DISP-03 | 02-01 | Atomic update uses runStatus: 'waiting' as filter condition | SATISFIED | L13, L27: `{ _id: run._id, runStatus: 'waiting' }` — both dispatch paths |
| DISP-04 | 02-01 | On failed POST, retry once after 1 minute delay | SATISFIED | L23-32: `setTimeout(async () => { ... }, 60_000)` |
| DISP-05 | 02-01 | If retry fails, run stays as runStatus: 'waiting' | SATISFIED | L24-30: `if (retrySuccess) { findOneAndUpdate }` — no update when retry returns false |
| DISP-06 | 02-01 | HTTP requests have explicit timeout | SATISFIED | L42: `signal: AbortSignal.timeout(10_000)` on every fetch call in `post()` |

All 13 requirements satisfied. No orphaned requirements found.

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| — | — | — | — | No anti-patterns found |

Scan covered: TODO/FIXME/XXX/HACK, placeholder strings, empty returns, hardcoded empty arrays/objects, console.log stubs. All clean.

---

### Human Verification Required

#### 1. TZ Environment Variable in Production

**Test:** Deploy the service and confirm `TZ=America/Sao_Paulo` is set in the container environment, then trigger a run with a `waitUntil` time that is within the morningLimit–nightLimit window for Brazil time but outside UTC time. Verify the run is dispatched correctly.
**Expected:** `new Date().getHours()` returns Brazil local time, and the time gate correctly allows or rejects the run.
**Why human:** The code relies entirely on the process `TZ` env var for timezone correctness. Unit tests mock `Date.prototype.getHours` directly. Cannot verify environment variable propagation programmatically without a running container.

#### 2. Real Webhook Delivery and Response

**Test:** Point a test database's "Processador de Runs" webhook URL at a request capture service (e.g., webhook.site). Start the service with a short CRON_INTERVAL (e.g., 5000 ms). Insert a run document with `runStatus: 'waiting'` and `waitUntil` in the past. Wait one cycle.
**Expected:** The request capture service receives a POST with `Content-Type: application/json` and the run document as body. The run document in MongoDB changes to `runStatus: 'queued'` with a `queuedAt` timestamp.
**Why human:** End-to-end dispatch through a real MongoDB instance and real HTTP requires a running environment. Unit tests mock both.

#### 3. Retry Behavior Under Real Network Conditions

**Test:** Configure a webhook URL that returns a 500 error. Observe that after 60 seconds, a retry is sent. Then make it return a 200. Verify the run is updated to 'queued' after the retry succeeds.
**Expected:** One retry 60 seconds after initial failure, run claimed on retry success.
**Why human:** The setTimeout retry is non-blocking. Verifying the 60-second wall-clock delay and the retry's MongoDB update requires a real running environment.

---

### Gaps Summary

No gaps found. All 21 observable truths are VERIFIED, all 9 artifacts pass all four levels (exists, substantive, wired, data-flowing), all 11 key links are WIRED, all 13 requirement IDs are SATISFIED, and no anti-patterns were detected.

The full test suite passes with 44 tests across 7 spec files. The TypeScript build exits 0 with no errors. The dispatch loop chain is fully wired end-to-end: SchedulerModule → SchedulerService → RunDispatchService → WebhookDispatchService → MongoDB atomic update.

Three items are routed to human verification: TZ env var correctness in production, real webhook delivery behavior, and retry timing under real network conditions. These are environmental concerns that cannot be verified programmatically without a running container.

---

_Verified: 2026-03-25T13:20:00Z_
_Verifier: Claude (gsd-verifier)_
