# Requirements: Time Trigger API

**Defined:** 2026-03-25
**Core Value:** Runs with `runStatus: "waiting"` must be detected and dispatched to their webhook reliably — no missed runs, no duplicate dispatches.

## v1 Requirements

Requirements for initial release. Each maps to roadmap phases.

### Connection & Discovery

- [x] **CONN-01**: API connects to MongoDB replica set using `MONGODB_URI` from environment variables
- [x] **CONN-02**: API dynamically enumerates all databases in the MongoDB cluster
- [x] **CONN-03**: API filters databases — only processes those containing `runs`, `webhooks`, and `vars` collections
- [x] **CONN-04**: API fails fast at startup with clear error if `MONGODB_URI` is missing
- [x] **CONN-05**: API fails fast at startup with clear error if `CRON_INTERVAL` is missing
- [ ] **CONN-06**: API processes all eligible databases in parallel using `Promise.allSettled` (one slow/failed DB does not block others)

### Scheduling

- [x] **SCHED-01**: Cron job runs at an interval configured via `CRON_INTERVAL` environment variable
- [x] **SCHED-02**: Cron interval is registered dynamically at runtime (not via static `@Cron()` decorator)
- [x] **SCHED-03**: Overlapping cron cycles are prevented (guard flag ensures previous cycle completes before next starts)

### Run Detection

- [x] **DETECT-01**: Each cycle queries `runs` collection for documents with `runStatus: "waiting"` AND `waitUntil <= Date.now()`
- [x] **DETECT-02**: Each cycle re-reads `vars` collection fresh (no caching — configs change externally)
- [x] **DETECT-03**: Each cycle re-reads `webhooks` collection fresh (no caching — configs change externally)
- [x] **DETECT-04**: Runs are skipped if current hour is before `morningLimit` or after `nightLimit` from `vars`

### Webhook Dispatch

- [x] **DISP-01**: Eligible run document is POSTed as JSON to the "Processador de Runs" URL from `webhooks` collection
- [x] **DISP-02**: On successful POST, run is updated atomically via `findOneAndUpdate` to `runStatus: "queued"` with `queuedAt` set to current timestamp
- [x] **DISP-03**: Atomic update uses `{runStatus: "waiting"}` as filter condition to prevent duplicate dispatch
- [x] **DISP-04**: On failed POST, system retries once after 1 minute delay
- [x] **DISP-05**: If retry also fails, run remains as `runStatus: "waiting"` (picked up in next cycle)
- [x] **DISP-06**: HTTP requests have explicit timeout to prevent hanging webhook from blocking the cycle

### Operational

- [ ] **OPS-01**: Application runs inside a Docker container
- [x] **OPS-02**: Structured logging for cycle start/end, per-DB processing, dispatched runs, and errors
- [ ] **OPS-03**: `GET /health` endpoint returns 200 with last cycle stats (timestamp, DBs scanned, runs dispatched, errors)

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Resilience

- **RES-01**: Graceful shutdown — complete current cycle before stopping on SIGTERM
- **RES-02**: Stuck run recovery — detect runs in intermediate state on startup and reset them
- **RES-03**: Configurable retry delay via `RETRY_DELAY_MS` env var (default 60000ms)

### Extended Time Gating

- **TIME-01**: Support `morningLimitFUP` / `nightLimitFUP` secondary time window from `vars`

### Observability

- **OBS-01**: Cycle summary log line (DBs scanned, runs dispatched, runs skipped, errors)

## Out of Scope

| Feature | Reason |
|---------|--------|
| Web UI / dashboard | Headless background service — use log aggregator for visibility |
| REST API for run CRUD | Other systems own the `runs` collection — this service is read-and-dispatch only |
| Redis / Bull queue | MongoDB `runs` collection IS the persistent queue — no need for external state |
| Webhook response processing | Downstream webhook handler owns its response logic |
| Authentication / public endpoints | Internal service, no public surface exposed |
| Per-run retry configuration | Premature complexity — single policy handles 95% of failures |
| Caching `vars` / `webhooks` | Breaks requirement to always use latest config |
| Distributed locking / multi-instance | Single instance with Docker restart policy is sufficient for this scale |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| CONN-01 | Phase 1 | Complete |
| CONN-02 | Phase 1 | Complete |
| CONN-03 | Phase 1 | Complete |
| CONN-04 | Phase 1 | Complete |
| CONN-05 | Phase 1 | Complete |
| CONN-06 | Phase 3 | Pending |
| SCHED-01 | Phase 2 | Complete |
| SCHED-02 | Phase 2 | Complete |
| SCHED-03 | Phase 2 | Complete |
| DETECT-01 | Phase 2 | Complete |
| DETECT-02 | Phase 2 | Complete |
| DETECT-03 | Phase 2 | Complete |
| DETECT-04 | Phase 2 | Complete |
| DISP-01 | Phase 2 | Complete |
| DISP-02 | Phase 2 | Complete |
| DISP-03 | Phase 2 | Complete |
| DISP-04 | Phase 2 | Complete |
| DISP-05 | Phase 2 | Complete |
| DISP-06 | Phase 2 | Complete |
| OPS-01 | Phase 3 | Pending |
| OPS-02 | Phase 1 | Complete |
| OPS-03 | Phase 3 | Pending |

**Coverage:**
- v1 requirements: 22 total
- Mapped to phases: 22
- Unmapped: 0 ✓

---
*Requirements defined: 2026-03-25*
*Last updated: 2026-03-25 after roadmap creation*
