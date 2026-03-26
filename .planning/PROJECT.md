# Time Trigger API

## What This Is

A cron-based API that monitors multiple MongoDB databases, detects runs ready for execution (`runStatus: "waiting"` with `waitUntil` in the past), validates time-of-day constraints, and dispatches them to webhook endpoints. Each MongoDB database represents a different client/bot, and the API automatically discovers and processes all eligible databases.

## Core Value

Runs with `runStatus: "waiting"` must be detected and dispatched to their webhook reliably — no missed runs, no duplicate dispatches.

## Requirements

### Validated

- ✓ Connects to MongoDB replica set and lists all databases — Phase 1
- ✓ Filters databases: only process those with `runs`, `webhooks`, and `vars` collections — Phase 1
- ✓ Fail fast with clear error if `MONGODB_URI` or `CRON_INTERVAL` missing — Phase 1
- ✓ Structured logging for cycle and discovery activity — Phase 1
- ✓ Cron job runs at configurable interval via CRON_INTERVAL env var — Phase 2
- ✓ Finds runs where runStatus "waiting" AND waitUntil <= now — Phase 2
- ✓ Reads vars/webhooks fresh each cycle (no caching) — Phase 2
- ✓ Skips runs outside morningLimit/nightLimit time window — Phase 2
- ✓ POSTs run to "Processador de Runs" webhook URL — Phase 2
- ✓ Atomic findOneAndUpdate prevents duplicate dispatch — Phase 2
- ✓ Retry once after 1 min, leaves as "waiting" if fails — Phase 2
- ✓ HTTP timeout prevents hanging webhooks — Phase 2

## Current Milestone: v1.4 Independent Cron Intervals

**Goal:** Split single CRON_INTERVAL into 3 independent intervals — one per dispatch type, each with its own setInterval and isRunning guard.

**Target features:**
- Replace `CRON_INTERVAL` with `CRON_INTERVAL_RUNS`, `CRON_INTERVAL_FUP`, `CRON_INTERVAL_MESSAGES`
- Each dispatch type runs on its own independent setInterval
- Each has its own isRunning guard (no cross-blocking)
- Remove old `CRON_INTERVAL` env var
- Update validateEnv() to require the 3 new vars
- Update Dockerfile, .env.example, docs

### Active

- [ ] Replace `CRON_INTERVAL` with `CRON_INTERVAL_RUNS`, `CRON_INTERVAL_FUP`, `CRON_INTERVAL_MESSAGES`
- [ ] Each dispatch type has its own independent setInterval
- [ ] Each dispatch type has its own isRunning guard
- [ ] Remove old `CRON_INTERVAL` env var and validation
- [ ] Update .env.example with new env vars
- [ ] Update docs/vars-schema.md
- [ ] Uses `timeTrigger.allowedDays` for day-of-week gate

### Out of Scope

- Web UI / dashboard — this is a headless background service
- Managing or creating runs — other systems write runs to MongoDB
- Modifying `webhooks` or `vars` collections — managed externally
- Processing webhook responses beyond success/failure status
- Authentication/authorization — internal service, no public endpoints needed

## Context

- MongoDB is a replica set across 3 nodes (177.x.x.x:27017/27018/27019)
- There are dozens of client databases (e.g., `sdr-4blue`, `sdr-action360`, `acade-system`, `dev`)
- Each client DB has the same collection structure: `runs`, `webhooks`, `vars`, `chats`, `messages`, etc.
- Some databases only have partial collections (e.g., only `chats`) — these should be skipped
- The `webhooks` collection has one document per `botIdentifier` with named webhook URLs
- The `vars` collection now uses `timeTrigger` object for Time Trigger config (see `docs/vars-schema.md`)
- Legacy `morningLimit`/`nightLimit` at root level are for other systems — Time Trigger reads `timeTrigger.*`
- Run documents track their lifecycle: `waiting` → `queued` → (external processing) → `done`
- v1.0 milestone complete: cron dispatch loop, parallel DB processing, Docker, CI/CD (49 tests)

## Constraints

- **Tech stack**: NestJS 11, MongoDB native driver, TypeScript — already initialized
- **Deployment**: Must run in Docker container
- **Configuration**: All runtime config via environment variables (`.env`)
- **Performance**: Must handle dozens of databases efficiently without blocking
- **Reliability**: No duplicate dispatches — once a run is marked `queued`, it should not be sent again

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Use MongoDB native driver (not Mongoose) | Already installed, direct access to multiple databases needed | — Pending |
| Re-read vars/webhooks every cycle | Configs change externally, must always use latest | — Pending |
| Single retry with 1-min delay on failure | Simple retry policy, keeps run as "waiting" for next cycle if still failing | — Pending |
| Filter databases by collection presence | Only process DBs with runs + webhooks + vars, skip incomplete ones | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd:transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd:complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-03-26 after milestone v1.4 started*
