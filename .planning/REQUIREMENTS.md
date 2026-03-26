# Requirements: Time Trigger API — Milestone v1.2

**Defined:** 2026-03-26
**Core Value:** Runs and FUPs must be detected and dispatched reliably — no missed dispatches, no duplicates.

## v1.2 Requirements

Requirements for FUP Dispatch milestone.

### FUP Detection

- [ ] **FUP-01**: Each cycle queries `fup` collection for documents with `status: "on"` AND `nextInteractionTimestamp <= Date.now()`
- [ ] **FUP-02**: FUP detection uses same `timeTrigger.morningLimit`/`nightLimit` time gate as runs
- [ ] **FUP-03**: FUP detection uses same `timeTrigger.allowedDays` day-of-week gate as runs

### FUP Dispatch

- [ ] **FUP-04**: Eligible FUP document is POSTed as JSON to the "FUP" URL from `webhooks` collection
- [ ] **FUP-05**: On successful POST, FUP is updated atomically via `findOneAndUpdate` to `status: "queued"`
- [ ] **FUP-06**: Atomic update uses `{ status: "on" }` as filter condition to prevent duplicate dispatch
- [ ] **FUP-07**: On failed POST, retries once after 1 minute delay
- [ ] **FUP-08**: If retry also fails, FUP remains as `status: "on"` (picked up in next cycle)

### Integration

- [ ] **FUP-09**: FUP dispatch runs in the same cron cycle as runs dispatch (within `processDatabase()`)

## Out of Scope

| Feature | Reason |
|---------|--------|
| Separate cron for FUP | Runs in same cycle as runs — simpler, same time gates |
| FUP-specific time gates | Uses same timeTrigger as runs (morningLimit, nightLimit, allowedDays) |
| FUP status management beyond queued | Downstream webhook handles lifecycle after queued |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| FUP-01 | Phase 6 | Pending |
| FUP-02 | Phase 6 | Pending |
| FUP-03 | Phase 6 | Pending |
| FUP-04 | Phase 6 | Pending |
| FUP-05 | Phase 6 | Pending |
| FUP-06 | Phase 6 | Pending |
| FUP-07 | Phase 6 | Pending |
| FUP-08 | Phase 6 | Pending |
| FUP-09 | Phase 6 | Pending |

**Coverage:**
- v1.2 requirements: 9 total
- Mapped to phases: 9
- Unmapped: 0 ✓

---
*Requirements defined: 2026-03-26*
