# Time Trigger API

## What This Is

A cron-based API that monitors multiple MongoDB databases, detects runs ready for execution (`runStatus: "waiting"` with `waitUntil` in the past), validates time-of-day constraints, and dispatches them to webhook endpoints. Each MongoDB database represents a different client/bot, and the API automatically discovers and processes all eligible databases.

## Core Value

Runs with `runStatus: "waiting"` must be detected and dispatched to their webhook reliably — no missed runs, no duplicate dispatches.

## Current State

**Shipped:** v1.4 Independent Cron Intervals (2026-03-29)

The service now runs 3 independent cron intervals — one for runs dispatch, one for FUP dispatch, one for messages dispatch — each with its own `setInterval`, env var, and `isRunning` guard. This eliminates cross-blocking between dispatch types.

**Tech Stack:**
- NestJS 11
- MongoDB native driver
- TypeScript 5.7.3
- Docker deployment
- 746 LOC (src/)

**Capabilities:**
- Multi-database MongoDB monitoring with automatic discovery
- Per-client time controls via `timeTrigger` (enabled, morningLimit, nightLimit, allowedDays)
- Atomic dispatch prevention (no duplicates)
- Parallel database processing
- Three independent dispatch types: runs, FUP, messages
- Single retry on failure with 1-min delay
- Docker containerization with TZ=America/Sao_Paulo
- Health endpoint for monitoring

## Requirements

### Validated

- ✓ Connects to MongoDB replica set and lists all databases — v1.0
- ✓ Filters databases: only process those with `runs`, `webhooks`, and `vars` collections — v1.0
- ✓ Structured logging for cycle and discovery activity — v1.0
- ✓ Fail fast with clear error if required env vars missing — v1.0, v1.4 (updated for 3 intervals)
- ✓ Cron job runs at configurable intervals via env vars — v1.0, v1.4 (now 3 independent intervals)
- ✓ Finds runs where runStatus "waiting" AND waitUntil <= now — v1.0
- ✓ Reads vars/webhooks fresh each cycle (no caching) — v1.0
- ✓ Skips runs outside timeTrigger morningLimit/nightLimit window — v1.0, v1.1 (migrated to timeTrigger)
- ✓ Skips runs on excluded days per timeTrigger.allowedDays — v1.1
- ✓ POSTs run to "Processador de Runs" webhook URL — v1.0
- ✓ Atomic findOneAndUpdate prevents duplicate dispatch — v1.0
- ✓ Retry once after 1 min, leaves as "waiting" if fails — v1.0
- ✓ HTTP timeout prevents hanging webhooks — v1.0
- ✓ Parallel database processing (no blocking) — v1.0
- ✓ Health endpoint returns 200 with status/uptime — v1.0
- ✓ Docker deployment with TZ=America/Sao_Paulo — v1.0
- ✓ TARGET_DATABASES env var for database filtering — v1.1
- ✓ Per-client timeTrigger controls (enabled, hours, days) — v1.1
- ✓ FUP dispatch with atomic status update and retry — v1.2
- ✓ Messages dispatch (no time/day gates) — v1.3
- ✓ Independent cron intervals for runs, FUP, messages — v1.4
- ✓ Each dispatch type has own isRunning guard (no cross-blocking) — v1.4
- ✓ CRON_INTERVAL_RUNS, CRON_INTERVAL_FUP, CRON_INTERVAL_MESSAGES env vars — v1.4

### Active

(No active requirements — ready for next milestone planning)

### Out of Scope

- Web UI / dashboard — this is a headless background service
- Managing or creating runs — other systems write runs to MongoDB
- Modifying `webhooks` or `vars` collections — managed externally
- Processing webhook responses beyond success/failure status
- Authentication/authorization — internal service, no public endpoints needed
- Dynamic interval changes at runtime — intervals set at startup from env, restart to change
- Per-database intervals — interval is global per dispatch type, not per client

## Context

- MongoDB is a replica set across 3 nodes (177.x.x.x:27017/27018/27019)
- There are dozens of client databases (e.g., `sdr-4blue`, `sdr-action360`, `acade-system`, `dev`)
- Each client DB has the same collection structure: `runs`, `webhooks`, `vars`, `chats`, `messages`, etc.
- Some databases only have partial collections (e.g., only `chats`) — these should be skipped
- The `webhooks` collection has one document per `botIdentifier` with named webhook URLs
- The `vars` collection uses `timeTrigger` object for Time Trigger config (see `docs/vars-schema.md`)
- Legacy `morningLimit`/`nightLimit` at root level are for other systems — Time Trigger reads `timeTrigger.*`
- Run documents track their lifecycle: `waiting` → `queued` → (external processing) → `done`

**Milestones shipped:**
- v1.0 MVP: Foundation, core dispatch loop, operational hardening (Phases 1-3, 9 plans, shipped 2026-03-25)
- v1.1 Per-Client Controls: Database targeting, per-client time controls (Phases 4-5, 2 plans, shipped 2026-03-25)
- v1.2 FUP Dispatch: FUP collection processing (Phase 6, 1 plan, shipped 2026-03-26)
- v1.3 Messages Dispatch: Messages collection processing (Phase 7, 1 plan, shipped 2026-03-26)
- v1.4 Independent Cron Intervals: 3 independent setIntervals (Phase 8, 3 plans, shipped 2026-03-29)

## Constraints

- **Tech stack**: NestJS 11, MongoDB native driver, TypeScript — already initialized
- **Deployment**: Must run in Docker container
- **Configuration**: All runtime config via environment variables (`.env`)
- **Performance**: Must handle dozens of databases efficiently without blocking
- **Reliability**: No duplicate dispatches — once a run is marked `queued`, it should not be sent again

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Use MongoDB native driver (not Mongoose) | Already installed, direct access to multiple databases needed | ✓ Good — clean DB enumeration, no ORM overhead |
| Re-read vars/webhooks every cycle | Configs change externally, must always use latest | ✓ Good — fresh config per cycle |
| Single retry with 1-min delay on failure | Simple retry policy, keeps run as "waiting" for next cycle if still failing | ✓ Good — resilient without complexity |
| Filter databases by collection presence | Only process DBs with runs + webhooks + vars, skip incomplete ones | ✓ Good — skips non-eligible DBs early |
| Migrate to timeTrigger object in vars | Dedicated, structured config separate from other systems' fields | ✓ Good — clear ownership, v1.1 |
| runRunsCycle dispatches both runs AND FUPs | They share same timeTrigger gate and same webhookDoc read | ✓ Good — efficient, preserves behavior |
| 3 independent setIntervals (v1.4) | Slow runs cycle cannot block FUP or messages | ✓ Good — eliminates cross-blocking |
| CRON_INTERVAL_* as required vars | Absent var must hard-fail startup to prevent silent misconfiguration | ✓ Good — fail-fast design |

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
*Last updated: 2026-03-29 after v1.4 milestone complete*
