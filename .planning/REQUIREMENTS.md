# Requirements: Time Trigger API — Milestone v1.3

**Defined:** 2026-03-26
**Core Value:** Runs, FUPs, and messages must be detected and dispatched reliably — no missed dispatches, no duplicates.

## v1.3 Requirements

Requirements for Messages Dispatch milestone.

### Message Detection

- [x] **MSG-01**: Each cycle queries `messages` collection for documents with `messageStatus: "pending"`
- [x] **MSG-02**: Messages dispatch has NO time gate — runs every cycle regardless of morningLimit/nightLimit
- [x] **MSG-03**: Messages dispatch has NO day gate — runs every cycle regardless of allowedDays

### Message Dispatch

- [x] **MSG-04**: Eligible message document is POSTed as JSON to the "mensagens pendentes" URL from `webhooks` collection
- [x] **MSG-05**: On successful POST, message is updated atomically via `findOneAndUpdate` to `messageStatus: "processing"`
- [x] **MSG-06**: Atomic update uses `{ messageStatus: "pending" }` as filter condition to prevent duplicate dispatch
- [x] **MSG-07**: On failed POST, retries once after 1 minute delay
- [x] **MSG-08**: If retry also fails, message remains as `messageStatus: "pending"` (picked up in next cycle)

### Integration

- [x] **MSG-09**: Messages dispatch runs in the same cron cycle as runs and FUP dispatch (within `processDatabase()`)

## Out of Scope

| Feature | Reason |
|---------|--------|
| Time gate for messages | Messages run 24/7 — no timeTrigger restrictions |
| Day gate for messages | Messages run every day |
| Message response processing | Downstream webhook handles lifecycle after processing |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| MSG-01 | Phase 7 | Complete |
| MSG-02 | Phase 7 | Complete |
| MSG-03 | Phase 7 | Complete |
| MSG-04 | Phase 7 | Complete |
| MSG-05 | Phase 7 | Complete |
| MSG-06 | Phase 7 | Complete |
| MSG-07 | Phase 7 | Complete |
| MSG-08 | Phase 7 | Complete |
| MSG-09 | Phase 7 | Complete |

**Coverage:**
- v1.3 requirements: 9 total
- Mapped to phases: 9
- Unmapped: 0 ✓

---
*Requirements defined: 2026-03-26*
