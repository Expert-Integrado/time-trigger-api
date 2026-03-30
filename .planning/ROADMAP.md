# Roadmap: Time Trigger API

## Milestones

- ✅ **v1.0 MVP** - Phases 1-3 (shipped 2026-03-25)
- ✅ **v1.1 Per-Client Controls** - Phases 4-5 (shipped 2026-03-25)
- ✅ **v1.2 FUP Dispatch** - Phase 6 (shipped 2026-03-26)
- ✅ **v1.3 Messages Dispatch** - Phase 7 (shipped 2026-03-26)
- ✅ **v1.4 Independent Cron Intervals** - Phase 8 (shipped 2026-03-29)
- 🚧 **v1.5 Rate Limiting and Message-Run Dependency** - Phases 9-11 (planned)

## Phases

<details>
<summary>✅ v1.0 MVP (Phases 1-3) - SHIPPED 2026-03-25</summary>

- [x] Phase 1: Foundation (3/3 plans) — completed 2026-03-25
- [x] Phase 2: Core Dispatch Loop (3/3 plans) — completed 2026-03-25
- [x] Phase 3: Operational Hardening (3/3 plans) — completed 2026-03-25

[Full details: .planning/milestones/v1.0-ROADMAP.md]

</details>

<details>
<summary>✅ v1.1 Per-Client Controls (Phases 4-5) - SHIPPED 2026-03-25</summary>

- [x] Phase 4: Database Targeting (1/1 plan) — completed 2026-03-25
- [x] Phase 5: Per-Client Time Controls (1/1 plan) — completed 2026-03-25

[Full details: .planning/milestones/v1.1-ROADMAP.md]

</details>

<details>
<summary>✅ v1.2 FUP Dispatch (Phase 6) - SHIPPED 2026-03-26</summary>

- [x] Phase 6: FUP Dispatch (1/1 plan) — completed 2026-03-26

[Full details: .planning/milestones/v1.2-ROADMAP.md]

</details>

<details>
<summary>✅ v1.3 Messages Dispatch (Phase 7) - SHIPPED 2026-03-26</summary>

- [x] Phase 7: Messages Dispatch (1/1 plan) — completed 2026-03-26

[Full details: .planning/milestones/v1.3-ROADMAP.md]

</details>

<details>
<summary>✅ v1.4 Independent Cron Intervals (Phase 8) - SHIPPED 2026-03-29</summary>

- [x] Phase 8: Independent Cron Intervals (3/3 plans) — completed 2026-03-26

[Full details: .planning/milestones/v1.4-ROADMAP.md]

</details>

### 🚧 v1.5 Rate Limiting and Message-Run Dependency (Planned)

**Milestone Goal:** Dispatch rate is controlled per database per cycle, and runs never overtake in-flight messages for the same conversation.

- [x] **Phase 9: Rate Limiting** - Cap webhook dispatches per database per cycle across all three dispatch types (completed 2026-03-30)
- [ ] **Phase 10: Message-Run Dependency** - Block run dispatch when matching messages are actively processing, with timestamp tracking
- [ ] **Phase 11: Timeout Recovery** - Automatically reset stuck "processing" messages to "pending" via an independent recovery interval

## Phase Details

### Phase 9: Rate Limiting
**Goal**: Each dispatch type enforces a configurable per-database cap on webhooks sent per cycle, preventing any single client from consuming unbounded webhook capacity.
**Depends on**: Phase 8
**Requirements**: RATE-01, RATE-02, RATE-03, RATE-04, RATE-05, RATE-06, RATE-07
**Success Criteria** (what must be TRUE):
  1. When a database reaches its configured limit for a dispatch type, remaining eligible items are skipped and the cycle completes without error
  2. A high-volume client reaching its limit does not reduce the dispatch capacity available to any other client in the same cycle
  3. Rate limit counters for all three dispatch types reset to zero at the start of every new cycle
  4. The counter increments only when `findOneAndUpdate` returns a document — failed atomic claims do not consume quota
  5. Cycle logs record how many items were dispatched and what the configured limit was for each database and dispatch type
**Plans**: 2 plans

Plans:
- [x] 09-01-PLAN.md — Add per-database rate limit counters and env vars to `processDatabase*` methods in RunDispatchService
- [x] 09-02-PLAN.md — Add unit tests for rate limiting behavior (per-database isolation, counter reset, increment-on-success only)

### Phase 10: Message-Run Dependency
**Goal**: Runs are blocked from dispatching while messages for the same `botIdentifier` + `chatDataId` are actively in `"processing"` state, and messages gain a `processingStartedAt` timestamp when claimed.
**Depends on**: Phase 9
**Requirements**: DEP-01, DEP-02, DEP-03, DEP-04, DEP-05
**Success Criteria** (what must be TRUE):
  1. A run whose `chatDataId` has a matching `"processing"` message (same `botIdentifier`) stays `"waiting"` and is retried next cycle automatically
  2. A run whose `chatDataId` has only `"pending"` messages (or no messages) is dispatched normally without delay
  3. Every message document that transitions to `"processing"` has its `processingStartedAt` field set to the current timestamp at the moment of the atomic claim
  4. The dependency check always filters on both `botIdentifier` AND `chatDataId` — never one field alone
**Plans**: 2 plans

Plans:
- [ ] 10-01-PLAN.md — Create `MessageCheckService`, add dependency check to `processDatabaseRuns`, and set `processingStartedAt` in `dispatchMessage`
- [ ] 10-02-PLAN.md — Add unit tests for dependency check logic and `processingStartedAt` timestamp behavior

### Phase 11: Timeout Recovery
**Goal**: Messages stuck in `"processing"` for longer than `MESSAGE_TIMEOUT_MINUTES` are automatically reset to `"pending"` by an independent recovery interval, preventing permanent run-blocking.
**Depends on**: Phase 10
**Requirements**: TOUT-01, TOUT-02, TOUT-03, TOUT-04
**Success Criteria** (what must be TRUE):
  1. Messages in `"processing"` state for longer than the configured timeout are reset to `"pending"` without manual intervention
  2. Messages that have no `processingStartedAt` field are never touched by the recovery mechanism
  3. The recovery logic runs on its own interval, independent of the messages dispatch hot path — a slow recovery pass does not delay message dispatch
  4. Running recovery multiple times against the same set of already-recovered messages produces no additional state changes
**Plans**: 1 plan

Plans:
- [ ] 11-01-PLAN.md — Add `recoverTimedOutMessages` to SchedulerService with `MESSAGE_TIMEOUT_MINUTES` env var, independent interval, and unit tests

## Progress

**Execution Order:**
Phases 1-8 complete. Phases 9-11 planned for v1.5.

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Foundation | v1.0 | 3/3 | Complete | 2026-03-25 |
| 2. Core Dispatch Loop | v1.0 | 3/3 | Complete | 2026-03-25 |
| 3. Operational Hardening | v1.0 | 3/3 | Complete | 2026-03-25 |
| 4. Database Targeting | v1.1 | 1/1 | Complete | 2026-03-25 |
| 5. Per-Client Time Controls | v1.1 | 1/1 | Complete | 2026-03-25 |
| 6. FUP Dispatch | v1.2 | 1/1 | Complete | 2026-03-26 |
| 7. Messages Dispatch | v1.3 | 1/1 | Complete | 2026-03-26 |
| 8. Independent Cron Intervals | v1.4 | 3/3 | Complete | 2026-03-26 |
| 9. Rate Limiting | v1.5 | 2/2 | Complete    | 2026-03-30 |
| 10. Message-Run Dependency | v1.5 | 0/2 | Not started | - |
| 11. Timeout Recovery | v1.5 | 0/1 | Not started | - |
