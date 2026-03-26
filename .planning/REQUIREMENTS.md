# Requirements: Time Trigger API — Milestone v1.4

**Defined:** 2026-03-26
**Core Value:** Each dispatch type runs on its own independent interval — no cross-blocking.

## v1.4 Requirements

Requirements for Independent Cron Intervals milestone.

### Env Vars

- [x] **CRON-01**: `CRON_INTERVAL_RUNS` env var controls interval for runs dispatch (in milliseconds)
- [x] **CRON-02**: `CRON_INTERVAL_FUP` env var controls interval for FUP dispatch (in milliseconds)
- [x] **CRON-03**: `CRON_INTERVAL_MESSAGES` env var controls interval for messages dispatch (in milliseconds)
- [x] **CRON-04**: Old `CRON_INTERVAL` env var is removed — no longer read or validated

### Independent Scheduling

- [x] **CRON-05**: Each dispatch type has its own `setInterval` registered via `SchedulerRegistry`
- [x] **CRON-06**: Each dispatch type has its own `isRunning` guard — one slow dispatch does not block others
- [x] **CRON-07**: Each interval can be different (e.g., messages every 5s, runs every 10s, FUP every 30s)

### Startup Validation

- [x] **CRON-08**: Service fails fast if any of the 3 new env vars is missing
- [x] **CRON-09**: Old `CRON_INTERVAL` validation removed from `validateEnv()`

### Documentation

- [x] **CRON-10**: `.env.example` updated with new env vars
- [x] **CRON-11**: `docs/vars-schema.md` updated with new env vars

## Out of Scope

| Feature | Reason |
|---------|--------|
| Dynamic interval changes at runtime | Intervals set at startup from env — restart to change |
| Per-database intervals | Interval is global per dispatch type, not per client |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| CRON-01 | Phase 8 | Complete |
| CRON-02 | Phase 8 | Complete |
| CRON-03 | Phase 8 | Complete |
| CRON-04 | Phase 8 | Complete |
| CRON-05 | Phase 8 | Complete |
| CRON-06 | Phase 8 | Complete |
| CRON-07 | Phase 8 | Complete |
| CRON-08 | Phase 8 | Complete |
| CRON-09 | Phase 8 | Complete |
| CRON-10 | Phase 8 | Complete |
| CRON-11 | Phase 8 | Complete |

**Coverage:**
- v1.4 requirements: 11 total
- Mapped to phases: 11
- Unmapped: 0 ✓

---
*Requirements defined: 2026-03-26*
