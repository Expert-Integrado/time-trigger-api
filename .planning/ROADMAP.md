# Roadmap: Time Trigger API

## Milestones

- ✅ **v1.0 MVP** - Phases 1-3 (shipped 2026-03-25)
- ✅ **v1.1 Per-Client Controls** - Phases 4-5 (shipped 2026-03-25)
- ✅ **v1.2 FUP Dispatch** - Phase 6 (shipped 2026-03-26)
- ✅ **v1.3 Messages Dispatch** - Phase 7 (shipped 2026-03-26)
- 🚧 **v1.4 Independent Cron Intervals** - Phase 8 (in progress)

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

<details>
<summary>✅ v1.1 Per-Client Controls (Phases 4-5) - SHIPPED 2026-03-25</summary>

### Phase 4: Database Targeting
**Goal**: Operators can limit which client databases are processed by specifying a list in `TARGET_DATABASES`, without changing any code — unlisted databases are skipped before any collection checks or dispatch logic runs
**Depends on**: Phase 3
**Requirements**: FILT-01, FILT-02, FILT-03
**Success Criteria** (what must be TRUE):
  1. When `TARGET_DATABASES=*` or is absent, all collection-eligible databases are processed (existing behavior unchanged)
  2. When `TARGET_DATABASES=sdr-4blue,dev`, only those two databases are considered for processing — all others are silently skipped
  3. The database name filter is applied before the collection-presence check, so unlisted databases never have their collections queried
  4. Structured log output shows which databases passed or were excluded by the `TARGET_DATABASES` filter
**Plans**: 1 plan

Plans:
- [x] 04-01-PLAN.md — Injetar ConfigService em DatabaseScanService, aplicar filtro TARGET_DATABASES antes do loop de coleções, testes TDD

### Phase 5: Per-Client Time Controls
**Goal**: Each client database controls whether Time Trigger runs at all, and during which hours and days, via a `timeTrigger` object in its `vars` document — replacing the old root-level fields with a dedicated, structured config
**Depends on**: Phase 4
**Requirements**: TRIG-01, TRIG-02, TRIG-03, TRIG-04, TRIG-05, TRIG-06
**Success Criteria** (what must be TRUE):
  1. A database whose `vars` document has no `timeTrigger` field is skipped — zero runs dispatched from it
  2. A database with `timeTrigger.enabled: false` is skipped — zero runs dispatched from it
  3. Runs are only dispatched within the window defined by `timeTrigger.morningLimit` and `timeTrigger.nightLimit` (root-level fields are not read)
  4. Runs are only dispatched on days present in `timeTrigger.allowedDays`; runs on excluded days are skipped and remain `waiting`
  5. Schema for the `timeTrigger` object is documented in `docs/vars-schema.md`
**Plans**: 1 plan

Plans:
- [x] 05-01-PLAN.md — Refatorar processDatabase() para usar timeTrigger (enabled, morningLimit, nightLimit, allowedDays); testes TDD cobrindo TRIG-01 a TRIG-06

</details>

<details>
<summary>✅ v1.2 FUP Dispatch (Phase 6) - SHIPPED 2026-03-26</summary>

### Phase 6: FUP Dispatch
**Goal**: Each cron cycle also processes the `fup` collection, detecting eligible FUP documents and dispatching them to the FUP webhook — atomically preventing duplicates, with a single retry on failure, reusing the same time and day gates already applied to runs
**Depends on**: Phase 5
**Requirements**: FUP-01, FUP-02, FUP-03, FUP-04, FUP-05, FUP-06, FUP-07, FUP-08, FUP-09
**Success Criteria** (what must be TRUE):
  1. Each cycle queries the `fup` collection for documents where `status: "on"` AND `nextInteractionTimestamp <= Date.now()` — only those documents are eligible for dispatch
  2. Eligible FUP documents are skipped (not dispatched) when the current time is outside `timeTrigger.morningLimit`/`nightLimit` or outside `timeTrigger.allowedDays` — the same gates used for runs
  3. An eligible FUP document is POSTed to the "FUP" webhook URL read from the `webhooks` collection; on success, `status` is updated atomically to `"queued"` via `findOneAndUpdate` with `{ status: "on" }` as the filter — concurrent cycles cannot dispatch the same FUP twice
  4. A failed FUP POST retries once after 1 minute; if the retry also fails, the document remains as `status: "on"` and is picked up in the next cycle
  5. FUP dispatch runs inside `processDatabase()` — same call path as runs, no separate cron or module required
**Plans**: 1 plan

Plans:
- [x] 06-01-PLAN.md — dispatchFup() em WebhookDispatchService + bloco FUP em processDatabase(); TDD cobrindo FUP-01 a FUP-09

</details>

<details>
<summary>✅ v1.3 Messages Dispatch (Phase 7) - SHIPPED 2026-03-26</summary>

### Phase 7: Messages Dispatch
**Goal**: Each cron cycle also processes the `messages` collection, detecting documents with `messageStatus: "pending"` and dispatching them to the "mensagens pendentes" webhook — with no time or day restrictions, atomic duplicate prevention, and a single retry on failure
**Depends on**: Phase 6
**Requirements**: MSG-01, MSG-02, MSG-03, MSG-04, MSG-05, MSG-06, MSG-07, MSG-08, MSG-09
**Success Criteria** (what must be TRUE):
  1. Each cycle queries the `messages` collection for documents with `messageStatus: "pending"` — regardless of the current hour, day, or whether `timeTrigger` gates would block runs
  2. An eligible message document is POSTed to the "mensagens pendentes" webhook URL read from the `webhooks` collection; on success, `messageStatus` is updated atomically to `"processing"` via `findOneAndUpdate` with `{ messageStatus: "pending" }` as the filter — a concurrent cycle cannot dispatch the same message twice
  3. A failed message POST retries once after 1 minute; if the retry also fails, the document remains as `messageStatus: "pending"` and is picked up in the next cycle
  4. Messages dispatch runs inside `processDatabase()` in the same cron cycle as runs and FUP — no separate cron, scheduler, or module is required
**Plans**: 1 plan

Plans:
- [x] 07-01-PLAN.md — dispatchMessage() em WebhookDispatchService + bloco messages em processDatabase() sem time/day gate; TDD cobrindo MSG-01 a MSG-09

</details>

### 🚧 v1.4 Independent Cron Intervals (In Progress)

**Milestone Goal:** Split the single `CRON_INTERVAL` into 3 independent intervals — one per dispatch type — each with its own `setInterval` and `isRunning` guard, so a slow runs cycle never delays FUP or messages.

#### Phase 8: Independent Cron Intervals
**Goal**: The scheduler is refactored from one shared interval into three independent intervals — one for runs, one for FUP, one for messages — each with its own env var, its own `setInterval`, and its own `isRunning` guard so no dispatch type can block another
**Depends on**: Phase 7
**Requirements**: CRON-01, CRON-02, CRON-03, CRON-04, CRON-05, CRON-06, CRON-07, CRON-08, CRON-09, CRON-10, CRON-11
**Success Criteria** (what must be TRUE):
  1. Service fails to start with a clear error if any of `CRON_INTERVAL_RUNS`, `CRON_INTERVAL_FUP`, or `CRON_INTERVAL_MESSAGES` is missing — and `CRON_INTERVAL` is no longer read or validated
  2. Three independent `setInterval` timers fire at their respective configured intervals, each triggering its own dispatch cycle (`runRunsCycle`, `runFupCycle`, `runMessagesCycle`)
  3. A slow or hung runs cycle does not delay or block FUP or messages cycles — each has its own `isRunning` guard that only prevents overlap within that same dispatch type
  4. `.env.example` documents `CRON_INTERVAL_RUNS`, `CRON_INTERVAL_FUP`, and `CRON_INTERVAL_MESSAGES` with no reference to the old `CRON_INTERVAL`
  5. `docs/vars-schema.md` reflects the new env vars
**Plans**: 3 plans

Plans:
- [ ] 08-01-PLAN.md — Split RunDispatchService.runCycle() into runRunsCycle(), runFupCycle(), runMessagesCycle() with independent isRunning guards; TDD cobrindo CRON-06/07
- [ ] 08-02-PLAN.md — Refatorar SchedulerService: 3 setIntervals independentes com CRON_INTERVAL_RUNS/FUP/MESSAGES; TDD cobrindo CRON-01 a CRON-05/07
- [ ] 08-03-PLAN.md — Atualizar validateEnv() (main.ts), main.spec.ts, .env.example e docs/vars-schema.md; cobre CRON-08/09/10/11

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Foundation | v1.0 | 3/3 | Complete | 2026-03-25 |
| 2. Core Dispatch Loop | v1.0 | 3/3 | Complete | 2026-03-25 |
| 3. Operational Hardening | v1.0 | 3/3 | Complete | 2026-03-25 |
| 4. Database Targeting | v1.1 | 1/1 | Complete | 2026-03-25 |
| 5. Per-Client Time Controls | v1.1 | 1/1 | Complete | 2026-03-25 |
| 6. FUP Dispatch | v1.2 | 1/1 | Complete | 2026-03-26 |
| 7. Messages Dispatch | v1.3 | 1/1 | Complete | 2026-03-26 |
| 8. Independent Cron Intervals | v1.4 | 0/3 | Not started | - |
