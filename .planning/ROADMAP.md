# Roadmap: Time Trigger API

## Milestones

- ✅ **v1.0 MVP** - Phases 1-3 (shipped 2026-03-25)
- 🚧 **v1.1 Per-Client Controls** - Phases 4-5 (in progress)

## Phases

<details>
<summary>✅ v1.0 MVP (Phases 1-3) - SHIPPED 2026-03-25</summary>

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
**Goal**: The service processes all eligible databases in parallel, exposes a health endpoint for monitoring, and runs correctly inside a Docker container with TZ=America/Sao_Paulo enforced
**Depends on**: Phase 2
**Requirements**: CONN-06, OPS-01, OPS-03
**Success Criteria** (what must be TRUE):
  1. A slow or failing database does not block other databases from being processed in the same cycle
  2. `GET /health` returns 200 with `{ status: 'ok', uptime: <seconds> }` — sufficient for Docker HEALTHCHECK
  3. The service runs inside a Docker container with `TZ=America/Sao_Paulo` enforced
**Plans**: 3 plans

Plans:
- [x] 03-01-PLAN.md — Refactor RunDispatchService.runCycle() from for-of to Promise.allSettled; add CONN-06 parallel isolation tests
- [x] 03-02-PLAN.md — Create HealthController + HealthModule (GET /health), wire into AppModule
- [x] 03-03-PLAN.md — Dockerfile (multi-stage node:22-slim), .dockerignore, docker-compose.yml, GitHub Actions workflow (ghcr.io)

</details>

### 🚧 v1.1 Per-Client Controls (In Progress)

**Milestone Goal:** Granular per-client control — operators can restrict which databases the service processes via `TARGET_DATABASES` env var, and each client database can independently enable/disable Time Trigger and configure its own time-of-day and day-of-week constraints via a `timeTrigger` object in the `vars` collection.

#### Phase 4: Database Targeting
**Goal**: Operators can limit which client databases are processed by specifying a list in `TARGET_DATABASES`, without changing any code — unlisted databases are skipped before any collection checks or dispatch logic runs
**Depends on**: Phase 3
**Requirements**: FILT-01, FILT-02, FILT-03
**Success Criteria** (what must be TRUE):
  1. When `TARGET_DATABASES=*` or is absent, all collection-eligible databases are processed (existing behavior unchanged)
  2. When `TARGET_DATABASES=sdr-4blue,dev`, only those two databases are considered for processing — all others are silently skipped
  3. The database name filter is applied before the collection-presence check, so unlisted databases never have their collections queried
  4. Structured log output shows which databases passed or were excluded by the `TARGET_DATABASES` filter
**Plans**: TBD

Plans:
- [ ] 04-01: TBD

#### Phase 5: Per-Client Time Controls
**Goal**: Each client database controls whether Time Trigger runs at all, and during which hours and days, via a `timeTrigger` object in its `vars` document — replacing the old root-level fields with a dedicated, structured config
**Depends on**: Phase 4
**Requirements**: TRIG-01, TRIG-02, TRIG-03, TRIG-04, TRIG-05, TRIG-06
**Success Criteria** (what must be TRUE):
  1. A database whose `vars` document has no `timeTrigger` field is skipped — zero runs dispatched from it
  2. A database with `timeTrigger.enabled: false` is skipped — zero runs dispatched from it
  3. Runs are only dispatched within the window defined by `timeTrigger.morningLimit` and `timeTrigger.nightLimit` (root-level fields are not read)
  4. Runs are only dispatched on days present in `timeTrigger.allowedDays`; runs on excluded days are skipped and remain `waiting`
  5. Schema for the `timeTrigger` object is documented in `docs/vars-schema.md`
**Plans**: TBD

Plans:
- [ ] 05-01: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Foundation | v1.0 | 3/3 | Complete | 2026-03-25 |
| 2. Core Dispatch Loop | v1.0 | 3/3 | Complete | 2026-03-25 |
| 3. Operational Hardening | v1.0 | 3/3 | Complete | 2026-03-25 |
| 4. Database Targeting | v1.1 | 0/? | Not started | - |
| 5. Per-Client Time Controls | v1.1 | 0/? | Not started | - |
