# Roadmap: Time Trigger API

## Overview

Three phases that go from "can connect to MongoDB" to "reliably dispatches runs in Docker." Phase 1 establishes the foundation — MongoDB connection, database discovery, and startup validation. Phase 2 delivers the entire dispatch loop with all reliability guarantees (atomic claim, cycle guard, time gate, retry). Phase 3 hardens operations — parallelizes DB processing, adds the health endpoint, and validates Docker packaging.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Foundation** - MongoDB connection, database discovery, startup env validation, and structured logging (completed 2026-03-25)
- [ ] **Phase 2: Core Dispatch Loop** - Scheduling, run detection, time gate, atomic webhook dispatch, and retry
- [ ] **Phase 3: Operational Hardening** - Parallel DB processing, health endpoint, and Docker packaging

## Phase Details

### Phase 1: Foundation
**Goal**: The service can connect to MongoDB, enumerate and filter eligible client databases, and log what it finds — proving the infrastructure works against real data before any dispatch logic is written
**Depends on**: Nothing (first phase)
**Requirements**: CONN-01, CONN-02, CONN-03, CONN-04, CONN-05, OPS-02
**Success Criteria** (what must be TRUE):
  1. Service fails to start with a clear error message when `MONGODB_URI` or `CRON_INTERVAL` is missing from environment
  2. Service connects to the MongoDB replica set and logs the full list of discovered databases on startup
  3. Service logs which databases were accepted (have `runs`, `webhooks`, and `vars` collections) and which were skipped
  4. All connection and discovery activity produces structured log lines (cycle start, DB scan results, errors)
**Plans**: 3 plans

Plans:
- [x] 01-01-PLAN.md — Install deps, wire ConfigModule globally, extract validateEnv(), prove fail-fast with unit tests
- [x] 01-02-PLAN.md — Build MongoService singleton (connect, listDatabaseNames, db()) and MongoModule; wire into AppModule
- [x] 01-03-PLAN.md — Build DatabaseScanService (collection-presence filter, structured log), DatabaseModule, startup scan hook in AppModule

### Phase 2: Core Dispatch Loop
**Goal**: The service reliably detects waiting runs and dispatches them to webhooks — with no duplicate dispatches, no overlapping cycles, correct time-of-day gating, and a single retry on failure
**Depends on**: Phase 1
**Requirements**: SCHED-01, SCHED-02, SCHED-03, DETECT-01, DETECT-02, DETECT-03, DETECT-04, DISP-01, DISP-02, DISP-03, DISP-04, DISP-05, DISP-06
**Success Criteria** (what must be TRUE):
  1. Cron fires at the interval specified by `CRON_INTERVAL` and does not start a new cycle while a previous one is still running
  2. Runs with `runStatus: "waiting"` and `waitUntil` in the past are dispatched via HTTP POST to the webhook URL read from the `webhooks` collection
  3. After a successful dispatch, the run transitions atomically to `runStatus: "queued"` with `queuedAt` set — a second concurrent cycle cannot dispatch the same run
  4. Runs outside the `morningLimit`–`nightLimit` window are skipped without being dispatched
  5. A failed dispatch retries once after 1 minute; if the retry also fails the run stays as `waiting` and is picked up in the next cycle
**Plans**: 3 plans

Plans:
- [x] 02-01-PLAN.md — WebhookDispatchService: HTTP POST dispatch, atomic run claim, single non-blocking retry, 10s fetch timeout
- [x] 02-02-PLAN.md — RunDispatchService + DispatchModule: cycle guard, fresh config reads, time gate, run detection
- [x] 02-03-PLAN.md — SchedulerService + SchedulerModule: dynamic interval via SchedulerRegistry, AppModule wiring

### Phase 3: Operational Hardening
**Goal**: The service processes all eligible databases in parallel, exposes a health endpoint for monitoring, and runs correctly inside a Docker container with UTC time enforcement
**Depends on**: Phase 2
**Requirements**: CONN-06, OPS-01, OPS-03
**Success Criteria** (what must be TRUE):
  1. A slow or failing database does not block other databases from being processed in the same cycle
  2. `GET /health` returns 200 with the timestamp of the last cycle, number of databases scanned, runs dispatched, and any errors
  3. The service runs inside a Docker container and dispatches runs correctly against a real MongoDB replica set with `TZ=UTC` enforced
**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation | 3/3 | Complete   | 2026-03-25 |
| 2. Core Dispatch Loop | 2/3 | In Progress|  |
| 3. Operational Hardening | 0/TBD | Not started | - |
