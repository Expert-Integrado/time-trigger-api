# Milestones

## v1.5 Rate Limiting and Message-Run Dependency (Shipped: 2026-04-01)

**Phases completed:** 3 phases, 5 plans, 8 tasks

**Key accomplishments:**

- Unit tests proving per-database isolation, counter-reset-per-cycle, increment-on-success-only, limit enforcement with break, and boolean return semantics for all dispatch methods
- MessageCheckService injectable with hasProcessingMessage query, processingStartedAt added to both dispatchMessage $set paths, and run dispatch loop guarded against in-flight messages by botIdentifier + chatDataId
- 9 new unit tests covering all 5 DEP requirements: MessageCheckService query logic, dependency guard in run dispatch, and processingStartedAt timestamp in message dispatch
- One-liner:

---

## v1.4 Independent Cron Intervals (Shipped: 2026-03-29)

**Phases completed:** 1 phases, 3 plans, 2 tasks

**Key accomplishments:**

- One-liner:
- One-liner:
- validateEnv() fail-fast startup now requires CRON_INTERVAL_RUNS, CRON_INTERVAL_FUP, CRON_INTERVAL_MESSAGES — CRON_INTERVAL fully removed, docs updated with Env Vars section

---
