# Requirements: Time Trigger API — Milestone v1.5

**Defined:** 2026-03-29
**Core Value:** Dispatch is rate-controlled per tenant and runs never race ahead of in-flight messages.

## v1.5 Requirements

### Rate Limiting (RATE-*)

- [x] **RATE-01**: Each database has its own independent webhook dispatch limit per cycle (not a global shared counter)
- [x] **RATE-02**: `RATE_LIMIT_RUNS` env var controls max runs dispatched per database per cycle (default: 10)
- [x] **RATE-03**: `RATE_LIMIT_FUP` env var controls max FUPs dispatched per database per cycle (default: 10)
- [x] **RATE-04**: `RATE_LIMIT_MESSAGES` env var controls max messages dispatched per database per cycle (default: 10)
- [x] **RATE-05**: Soft limit behavior — when limit is reached, logs and skips remaining items without failing the cycle
- [x] **RATE-06**: Rate limit counter increments only after a successful dispatch (findOneAndUpdate returned a document)
- [x] **RATE-07**: Counter resets at the start of each new cycle, independently per dispatch type

### Message-Run Dependency (DEP-*)

- [ ] **DEP-01**: `processingStartedAt` timestamp field is set on message documents when `messageStatus` changes to `"processing"`
- [ ] **DEP-02**: Before dispatching a run, check if any messages exist with `messageStatus: "processing"` matching same `botIdentifier` + `chatDataId`
- [ ] **DEP-03**: If a blocking message exists: run is skipped, stays `"waiting"`, next cycle retries automatically
- [ ] **DEP-04**: Dependency filter always uses both `botIdentifier` AND `chatDataId` — never one without the other
- [ ] **DEP-05**: Only `"processing"` messages block runs — `"pending"` messages do not block runs

### Timeout Recovery (TOUT-*)

- [ ] **TOUT-01**: Messages with `messageStatus: "processing"` for longer than `MESSAGE_TIMEOUT_MINUTES` are reset to `"pending"`
- [ ] **TOUT-02**: `MESSAGE_TIMEOUT_MINUTES` env var controls the timeout threshold (default: 10)
- [ ] **TOUT-03**: Timeout recovery runs on an independent interval — not embedded in the messages dispatch hot path
- [ ] **TOUT-04**: Recovery is idempotent — messages without `processingStartedAt` field are not affected

## Out of Scope

| Feature | Reason |
|---------|--------|
| Per-database rate limit overrides (in vars collection) | Global per-type limits sufficient for v1.5 |
| Per-database timeout threshold overrides | Global timeout sufficient for v1.5 |
| Timeout recovery dry-run mode | Debugging feature, add if needed later |
| Adaptive/dynamic rate limits | Over-engineered, static env var limits are sufficient |
| Redis or BullMQ for rate limiting | In-memory Map is correct for cycle-scoped limits |
| Persisted rate limit state across restarts | Acceptable transient violation on restart |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| RATE-01 | Phase 9 | Not started |
| RATE-02 | Phase 9 | Not started |
| RATE-03 | Phase 9 | Not started |
| RATE-04 | Phase 9 | Not started |
| RATE-05 | Phase 9 | Not started |
| RATE-06 | Phase 9 | Not started |
| RATE-07 | Phase 9 | Not started |
| DEP-01 | Phase 10 | Not started |
| DEP-02 | Phase 10 | Not started |
| DEP-03 | Phase 10 | Not started |
| DEP-04 | Phase 10 | Not started |
| DEP-05 | Phase 10 | Not started |
| TOUT-01 | Phase 11 | Not started |
| TOUT-02 | Phase 11 | Not started |
| TOUT-03 | Phase 11 | Not started |
| TOUT-04 | Phase 11 | Not started |

**Coverage:**
- v1.5 requirements: 16 total
- Mapped to phases: 16
- Unmapped: 0 ✓

---
*Requirements defined: 2026-03-29*
