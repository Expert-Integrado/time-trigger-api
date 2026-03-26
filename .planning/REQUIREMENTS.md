# Requirements: Time Trigger API — Milestone v1.4

**Defined:** 2026-03-26
**Core Value:** Each dispatch type runs on its own independent interval — no cross-blocking.

## v1.4 Requirements

Requirements for Independent Cron Intervals milestone.

### Env Vars

- [ ] **CRON-01**: `CRON_INTERVAL_RUNS` env var controls interval for runs dispatch (in milliseconds)
- [ ] **CRON-02**: `CRON_INTERVAL_FUP` env var controls interval for FUP dispatch (in milliseconds)
- [ ] **CRON-03**: `CRON_INTERVAL_MESSAGES` env var controls interval for messages dispatch (in milliseconds)
- [ ] **CRON-04**: Old `CRON_INTERVAL` env var is removed — no longer read or validated

### Independent Scheduling

- [ ] **CRON-05**: Each dispatch type has its own `setInterval` registered via `SchedulerRegistry`
- [ ] **CRON-06**: Each dispatch type has its own `isRunning` guard — one slow dispatch does not block others
- [ ] **CRON-07**: Each interval can be different (e.g., messages every 5s, runs every 10s, FUP every 30s)

### Startup Validation

- [ ] **CRON-08**: Service fails fast if any of the 3 new env vars is missing
- [ ] **CRON-09**: Old `CRON_INTERVAL` validation removed from `validateEnv()`

### Documentation

- [ ] **CRON-10**: `.env.example` updated with new env vars
- [ ] **CRON-11**: `docs/vars-schema.md` updated with new env vars

## Out of Scope

| Feature | Reason |
|---------|--------|
| Dynamic interval changes at runtime | Intervals set at startup from env — restart to change |
| Per-database intervals | Interval is global per dispatch type, not per client |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| CRON-01 | Pending | Pending |
| CRON-02 | Pending | Pending |
| CRON-03 | Pending | Pending |
| CRON-04 | Pending | Pending |
| CRON-05 | Pending | Pending |
| CRON-06 | Pending | Pending |
| CRON-07 | Pending | Pending |
| CRON-08 | Pending | Pending |
| CRON-09 | Pending | Pending |
| CRON-10 | Pending | Pending |
| CRON-11 | Pending | Pending |

**Coverage:**
- v1.4 requirements: 11 total
- Mapped to phases: 0
- Unmapped: 11 ⚠️

---
*Requirements defined: 2026-03-26*
