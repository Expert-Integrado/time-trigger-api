# Project Research Summary

**Project:** Time Trigger API
**Domain:** Cron-based multi-database webhook dispatch service (headless background service)
**Researched:** 2026-03-25
**Confidence:** HIGH

## Executive Summary

The Time Trigger API is a headless cron service that polls multiple client MongoDB databases, identifies scheduled run documents whose time has come, and dispatches them via HTTP POST to per-client webhook endpoints. This is a well-understood pattern — the entire system reduces to a polling loop, a fan-out query over N databases, and idempotent HTTP dispatch. The recommended approach builds on the existing NestJS 11 + MongoDB native driver scaffold rather than introducing new infrastructure: `@nestjs/schedule` drives the cron loop, one shared `MongoClient` serves all databases via `client.db(dbName)`, and `axios` handles HTTP dispatch. No Redis, no queues, no external state — MongoDB's own `runs` collection is the durable job store.

The key architectural insight is that MongoDB's `findOneAndUpdate` with a `{ runStatus: "waiting" }` filter is both the eligibility check and the atomic claim in one operation. This single pattern prevents duplicate dispatch without any distributed locking infrastructure. Combined with a boolean `isRunning` guard on the cron handler (to prevent overlapping cycles), the service achieves reliable at-most-once dispatch. The `vars` and `webhooks` collections must be re-read fresh every cycle — no caching — because external systems mutate them at runtime.

The primary risks are operational rather than architectural: overlapping cron cycles causing duplicate dispatches if the atomic claim pattern is not used from day one; runs permanently stuck in an intermediate `processing` state after a crash unless a recovery path exists; timezone misconfiguration causing time-window checks to pass or fail at the wrong hours; and webhook HTTP calls without explicit timeouts causing one slow endpoint to stall an entire cycle. All of these are prevention-first problems — they are trivially avoidable if addressed during initial implementation and nearly impossible to debug after the fact in a headless service.

## Key Findings

### Recommended Stack

The project already has the right foundation installed: NestJS 11.1.17, MongoDB native driver 7.1.1, TypeScript 5.9.3, and Jest 30 are confirmed from the lockfile. Four packages must be added: `@nestjs/schedule` (v4.x for NestJS 11 compatibility), `@nestjs/config`, `@nestjs/axios`, and `axios`. Mongoose must never be used — it enforces a single-connection model that is architecturally incompatible with multi-database enumeration. The native driver's `client.db(dbName)` is the correct primitive.

**Core technologies:**
- **NestJS 11** (installed): Application framework — DI container, lifecycle hooks, module system; `@nestjs/schedule` integrates natively
- **MongoDB native driver 7.1.1** (installed): Multi-database access — `client.db(name)` on a single shared client handles all N databases over one connection pool
- **`@nestjs/schedule` v4.x** (to install): Cron scheduling — use `SchedulerRegistry.addCronJob()` at `onModuleInit` rather than `@Cron()` decorator, because `CRON_INTERVAL` is a runtime env var and `@Cron()` requires a decoration-time literal
- **`@nestjs/config` v3.x** (to install): Environment variable management — `ConfigService` over raw `process.env` for testability and centralized validation
- **`@nestjs/axios` / `axios`** (to install): HTTP webhook dispatch — explicit 10-15 second timeout required on every call; no default timeout in axios
- **Node.js 22 LTS**: Runtime — already targeted in lockfile engine constraints; use `node:22-alpine` in Docker

### Expected Features

See `.planning/research/FEATURES.md` for full prioritization matrix.

**Must have (v1 — table stakes):**
- Cron polling loop driven by `CRON_INTERVAL` env var — without this nothing triggers
- MongoDB multi-DB discovery with collection-presence filtering (`runs` + `webhooks` + `vars`) — discovers eligible client databases
- Run eligibility query: `runStatus: "waiting"` AND `waitUntil <= now()` — identifies what to dispatch
- Time-of-day gate using `morningLimit` / `nightLimit` from `vars` — per-client scheduling window (UTC hours, pinned)
- Webhook POST to "Processador de Runs" URL from `webhooks` collection — core dispatch action
- Atomic status transition via `findOneAndUpdate`: `waiting` → `processing` → `queued` — prevents duplicate dispatch
- Single retry after 1 minute on failure via non-blocking `setTimeout`; leave as `waiting` if retry also fails
- Config re-read every cycle — no caching of `vars` or `webhooks`
- Startup env validation for `MONGODB_URI` — fail fast rather than crashing mid-cycle
- Structured logging per cycle — minimum observability for a headless service
- Docker container with env-based config — delivery target

**Should have (v1.x — add early after validation):**
- Per-DB concurrent processing via `Promise.allSettled` — prevents one slow DB from blocking others; needed before production at any meaningful DB count
- Cycle-running guard (`isRunning` boolean in `finally` block) — prevents overlapping cron cycles
- Graceful shutdown handling — NestJS lifecycle hooks; prevents mid-cycle partial dispatches
- Health check endpoint (`GET /health`) — enables Docker HEALTHCHECK and monitoring

**Defer (v2+):**
- FUP time-window support (`morningLimitFUP` / `nightLimitFUP`) — defer until a client DB actually requires it
- Configurable retry delay via env var — defer until 1-minute default proves wrong in production
- Multi-instance idempotent dispatch — single instance with `restart: always` is sufficient for now

### Architecture Approach

The system maps cleanly to five NestJS services in three modules, built in strict dependency order. `MongoService` is the foundation — a singleton that opens one `MongoClient` at startup and provides `db(name)` handles. `DatabaseScanService` uses it to enumerate and filter eligible client databases each cycle. `WebhookDispatchService` owns the HTTP POST, the retry, and the MongoDB status update. `RunDispatchService` orchestrates a full cycle: scan DBs, check time gate, query runs, dispatch each via `WebhookDispatchService`. The `SchedulerModule` wires the cron trigger to `RunDispatchService.runCycle()` and is the last thing assembled.

**Major components:**
1. **MongoService** — singleton `MongoClient`; provides `Db` handles by name; opened once at `onModuleInit`, closed at `onModuleDestroy`
2. **DatabaseScanService** — `listDatabases()` + collection-presence filter; returns eligible DB names per cycle
3. **WebhookDispatchService** — HTTP POST with explicit timeout; atomic `findOneAndUpdate` claim; single retry via `setTimeout`
4. **RunDispatchService** — cycle orchestrator; reads `vars`/`webhooks` fresh per DB; enforces time gate; iterates runs; delegates to `WebhookDispatchService`
5. **SchedulerModule** — wires `CRON_INTERVAL` env var to `RunDispatchService.runCycle()` via `SchedulerRegistry.addCronJob()` at `onModuleInit`
6. **ConfigService** (`@nestjs/config`) — validates `MONGODB_URI` and `CRON_INTERVAL` at startup; no raw `process.env` in service constructors

### Critical Pitfalls

1. **Duplicate dispatch via non-atomic status transition** — use `findOneAndUpdate({ runStatus: "waiting" }, { $set: { runStatus: "processing" } })` as the claim operation; skip the run if no document is returned (another cycle claimed it); this is a day-one requirement, not a retrofit
2. **Runs stuck in `processing` after a crash** — add a startup recovery pass that resets `{ runStatus: "processing", claimedAt: { $lt: now - 5min } }` back to `waiting`; without this, a service restart orphans in-flight runs permanently
3. **Overlapping cron cycles causing duplicate processing and memory growth** — gate the cycle function with `isRunning` boolean, reset in `finally`; log a warning when a tick is skipped so operators know the interval is too short
4. **Timezone misconfiguration** — set `TZ=UTC` in Dockerfile; document that all `morningLimit`/`nightLimit` values in `vars` are UTC hours; test the time-window logic against UTC edge cases explicitly
5. **No HTTP timeout on webhook calls** — set `timeout: 10_000` on every `axios.post`; without this, one unresponsive endpoint stalls the entire cycle until Node's socket timeout fires (2+ minutes)

## Implications for Roadmap

Based on the component dependency graph (ARCHITECTURE.md "Build Order") and the pitfall-to-phase mapping (PITFALLS.md), the natural build order is bottom-up: foundation first, dispatch logic second, integration and hardening third, operational layer last. The "looks done but isn't" checklist from PITFALLS.md should be the acceptance gate for Phase 2.

### Phase 1: Foundation — Config, MongoDB Connection, Database Discovery

**Rationale:** Every other component depends on `ConfigService` and `MongoService`. Getting the singleton MongoDB connection pattern right before any iteration logic is written prevents the connection pool exhaustion pitfall. Database discovery is purely read-only and has no dispatch risk.

**Delivers:** A running NestJS application that can connect to MongoDB, enumerate client databases, filter by collection presence, and log the results. No dispatch logic yet. Proves the infrastructure works against real MongoDB.

**Addresses:** MongoDB multi-DB enumeration, startup env validation, Docker container operation, structured logging

**Avoids:** Connection pool exhaustion (Pitfall 4) — singleton pattern established before any parallel database access is written

**Research flag:** Standard patterns — no additional research needed; MongoDB native driver singleton and NestJS config patterns are well-documented

---

### Phase 2: Core Dispatch Loop — Scheduling, Time Gate, Atomic Claim, Webhook POST, Retry

**Rationale:** This is the highest-risk phase; all critical pitfalls concentrate here. The atomic claim pattern, the `isRunning` guard, the timezone handling, and the HTTP timeout must all be built correctly together. The "looks done but isn't" checklist from PITFALLS.md is the acceptance criterion for this phase.

**Delivers:** A fully functional dispatch loop: cron fires, eligible databases are identified, time window is checked, runs are atomically claimed and dispatched via HTTP POST, status is updated to `queued`, and failures get a single 1-minute retry. The service can run in Docker against real data.

**Addresses:** Cron polling loop, run eligibility detection, time-of-day gating, webhook dispatch, atomic status transition, duplicate dispatch prevention, single-retry on failure, config re-read every cycle

**Avoids:**
- Duplicate dispatch (Pitfall 1) — `findOneAndUpdate` atomic claim required from the first commit of dispatch logic
- Stuck `processing` runs (Pitfall 3) — startup recovery pass required in same phase
- Overlapping cron cycles (Pitfall 2) — `isRunning` guard required before the scheduler is wired
- Timezone errors (Pitfall 5) — `TZ=UTC` in Dockerfile; time-window unit tests against UTC edge cases
- Webhook timeout (Pitfall 6) — `timeout: 10_000` on every `axios.post` from day one

**Uses:** `@nestjs/schedule` via `SchedulerRegistry.addCronJob()` (not `@Cron()` decorator — env var interval requires runtime registration)

**Research flag:** Standard patterns — dispatch loop, atomic MongoDB update, NestJS scheduler patterns are all well-documented. No additional research needed; the PITFALLS.md checklist is the key reference.

---

### Phase 3: Operational Hardening — Concurrency, Graceful Shutdown, Health Check, Observability

**Rationale:** Once the core loop is proven correct in production or staging, sequential database processing should be parallelized before load grows. This phase adds production-quality operational features with no dispatch logic changes — only the execution model and observability layer change.

**Delivers:** Parallel per-DB processing via `Promise.allSettled` (with concurrency cap), graceful shutdown via NestJS lifecycle hooks, `GET /health` endpoint with last-cycle stats, cycle summary log (single line: DBs scanned, runs dispatched, runs skipped, errors).

**Addresses:** Per-DB concurrent processing, graceful shutdown, health check endpoint, cycle summary metrics

**Avoids:** Sequential processing bottleneck — serial iteration at 30+ DBs × 300ms approaches the cron interval and causes the `isRunning` guard to fire constantly

**Research flag:** Standard patterns — `Promise.allSettled`, NestJS `onApplicationShutdown`, minimal NestJS controller; no additional research needed

---

### Phase 4: Docker Packaging and Deployment Validation

**Rationale:** Docker packaging should be validated as a dedicated step, not assumed to work. The `TZ=UTC` environment variable, connection string with all replica set nodes, and env-based configuration must all be verified in a container environment before declaring the service production-ready.

**Delivers:** Production Dockerfile (`node:22-alpine`), Docker Compose for local testing, verified `TZ=UTC` behavior, validated replica set connection string format, deployment documentation.

**Addresses:** Docker container operation, replica set connection string format (all 3 nodes), `TZ=UTC` enforcement

**Avoids:** Silent timezone divergence between local dev (where `Date.getHours()` uses local TZ) and Docker (UTC); single-node MongoDB URI that loses connections on primary failover

**Research flag:** Standard patterns — Docker, NestJS deployment patterns are well-documented; no additional research needed

---

### Phase Ordering Rationale

- **Foundation before dispatch:** `MongoService` and `ConfigService` are dependencies of every other component; building them first allows all subsequent phases to import them without mocks
- **All critical pitfalls in Phase 2:** Duplicate dispatch, stuck processing states, overlapping cycles, timezone errors, and HTTP timeouts are all impossible to retrofit safely into an already-deployed service; they must be built correctly in the same phase that introduces dispatch logic
- **Concurrency after correctness:** Parallel database processing (`Promise.allSettled`) changes the error isolation model; it should only be added once the sequential loop is verified correct, so bugs are not attributed to concurrency
- **Docker last:** Packaging validation requires the full application to exist; doing it earlier produces a container that gets rebuilt with every Phase 2 change

### Research Flags

Phases likely needing deeper research during planning:
- **None identified** — all patterns are well-established for this domain. The PITFALLS.md "Looks Done But Isn't" checklist should be the Phase 2 acceptance gate, and ARCHITECTURE.md provides code-level patterns with examples.

Phases with standard patterns (skip research-phase):
- **All phases** — NestJS scheduler, MongoDB native driver multi-DB, `Promise.allSettled`, Docker packaging are all thoroughly documented. Implementation can proceed directly from the research files.

One area to validate during Phase 2 implementation: whether `@nestjs/schedule` v4.x's `SchedulerRegistry.addCronJob()` API differs from v3.x in any way relevant to dynamic interval registration. Verify against npm before installing.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Verified directly from installed lockfile and `node_modules`; only `@nestjs/schedule` v4.x compatibility is MEDIUM — verify on npm before installing |
| Features | HIGH | Requirements fully specified in PROJECT.md; all features map directly to stated requirements; domain patterns well-established |
| Architecture | HIGH | NestJS scheduler and MongoDB multi-database patterns are well-documented; component boundaries are clear with no novel techniques required |
| Pitfalls | HIGH | All pitfalls drawn from established failure patterns in distributed cron systems and MongoDB native driver behavior; directly applicable to this architecture |

**Overall confidence:** HIGH

### Gaps to Address

- **`@nestjs/schedule` v4.x version compatibility:** Training data indicates v4.x targets NestJS 11, but this should be verified on npm before running `pnpm add @nestjs/schedule`. Install the wrong major and NestJS module resolution will fail silently.
- **`morningLimit`/`nightLimit` timezone convention:** The research recommends UTC, but the actual convention used in existing client `vars` documents is unknown. This must be confirmed before deploying the time-gate logic — wrong assumption here means runs dispatch at wrong hours in production without any error.
- **MongoDB replica set topology:** The `MONGODB_URI` must include all three replica set nodes. The actual connection string format in use (whether it already includes all nodes or points to a single host) should be confirmed before production deployment.
- **"Processador de Runs" webhook document structure:** The `webhooks` collection key that identifies the dispatch URL must be confirmed against a real database document. The research assumes a `botIdentifier`-keyed lookup, but the exact field path needs validation in Phase 2.

## Sources

### Primary (HIGH confidence)
- `/root/time-trigger-api/pnpm-lock.yaml` — authoritative installed versions (NestJS 11.1.17, mongodb 7.1.1, TypeScript 5.9.3, Jest 30)
- `/root/time-trigger-api/node_modules/@nestjs/common/package.json` — confirmed NestJS 11.1.17
- `/root/time-trigger-api/node_modules/mongodb/package.json` — confirmed mongodb 7.1.1
- `/root/time-trigger-api/.planning/PROJECT.md` — authoritative requirements source for all features
- MongoDB Node.js driver documentation — `MongoClient` connection pooling, `findOneAndUpdate`, `listDatabases`
- NestJS official documentation — `@nestjs/schedule` task scheduling patterns, lifecycle hooks
- Node.js / axios default timeout behavior — documented absence of default timeout

### Secondary (MEDIUM confidence)
- `@nestjs/schedule` v4.x compatibility with NestJS 11 — training data consensus; verify on npm before installing
- `SchedulerRegistry.addCronJob()` API for dynamic interval at runtime — established pattern for env-var-driven cron intervals in NestJS

---
*Research completed: 2026-03-25*
*Ready for roadmap: yes*
