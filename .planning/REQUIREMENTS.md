# Requirements: Time Trigger API — Milestone v1.1

**Defined:** 2026-03-25
**Core Value:** Runs with `runStatus: "waiting"` must be detected and dispatched to their webhook reliably — no missed runs, no duplicate dispatches.

## v1.1 Requirements

Requirements for Per-Client Controls milestone.

### Database Filtering

- [ ] **FILT-01**: `TARGET_DATABASES` env var accepts `*` (all) or comma-separated list (e.g., `sdr-4blue,dev`)
- [ ] **FILT-02**: If `TARGET_DATABASES` is absent or `*`, all eligible databases are processed (current behavior preserved)
- [ ] **FILT-03**: If a list is specified, only databases in the list are processed (filter applied before collection check)

### Time Trigger Config

- [ ] **TRIG-01**: Reads `timeTrigger` object from each database's `vars` document
- [ ] **TRIG-02**: If `timeTrigger` does not exist in vars, database is skipped (no runs processed)
- [ ] **TRIG-03**: If `timeTrigger.enabled` is `false`, database is skipped
- [ ] **TRIG-04**: Uses `timeTrigger.morningLimit` and `timeTrigger.nightLimit` for time-of-day gating (replaces root-level fields)
- [ ] **TRIG-05**: Uses `timeTrigger.allowedDays` array to filter by day of week (0=Sunday...6=Saturday)
- [ ] **TRIG-06**: Runs are skipped if current day of week is not in `allowedDays`

## Out of Scope

| Feature | Reason |
|---------|--------|
| Per-run time config | timeTrigger is per-database (per-client), not per-run |
| Admin API to modify vars | vars is managed externally (other systems) |
| Fallback to root-level morningLimit/nightLimit | Clean break — new structure only |
| Caching timeTrigger config | Re-read every cycle (existing design decision) |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| FILT-01 | Phase 4 | Pending |
| FILT-02 | Phase 4 | Pending |
| FILT-03 | Phase 4 | Pending |
| TRIG-01 | Phase 5 | Pending |
| TRIG-02 | Phase 5 | Pending |
| TRIG-03 | Phase 5 | Pending |
| TRIG-04 | Phase 5 | Pending |
| TRIG-05 | Phase 5 | Pending |
| TRIG-06 | Phase 5 | Pending |

**Coverage:**
- v1.1 requirements: 9 total
- Mapped to phases: 9
- Unmapped: 0 ✓

---
*Requirements defined: 2026-03-25*
*Last updated: 2026-03-25 after roadmap creation*
