# Time Trigger API

## What This Is

A cron-based API that monitors multiple MongoDB databases, detects runs ready for execution (`runStatus: "waiting"` with `waitUntil` in the past), validates time-of-day constraints, and dispatches them to webhook endpoints. Each MongoDB database represents a different client/bot, and the API automatically discovers and processes all eligible databases.

## Core Value

Runs with `runStatus: "waiting"` must be detected and dispatched to their webhook reliably — no missed runs, no duplicate dispatches.

## Current State

**Shipped:** v1.5 — Rate Limiting and Message-Run Dependency (2026-03-30)

Per-database webhook rate limits, message-run dependency guard (runs wait for in-flight messages), and automatic timeout recovery for stuck messages. 148 tests, 0 failures.

**Tech Stack:**
- NestJS 11
- MongoDB native driver
- TypeScript 5.7.3
- Docker deployment
- ~800 LOC (src/)

**Capabilities:**
- Multi-database MongoDB monitoring with automatic discovery
- Per-client time controls via `timeTrigger` (enabled, morningLimit, nightLimit, allowedDays)
- Atomic dispatch prevention (no duplicates)
- Parallel database processing
- Four independent intervals: runs, FUP, messages, timeout recovery
- Per-database rate limiting (RATE_LIMIT_RUNS/FUP/MESSAGES, default 10)
- Message-run dependency guard (botIdentifier + chatDataId)
- Automatic timeout recovery for stuck messages (MESSAGE_TIMEOUT_MINUTES, default 10)
- Single retry on failure with 1-min delay
- Docker containerization with TZ=America/Sao_Paulo
- Health endpoint for monitoring

## Requirements

### Validated

- ✓ Connects to MongoDB replica set and lists all databases — v1.0
- ✓ Filters databases: only process those with `runs`, `webhooks`, and `vars` collections — v1.0
- ✓ Structured logging for cycle and discovery activity — v1.0
- ✓ Fail fast with clear error if required env vars missing — v1.0, v1.4
- ✓ Cron job runs at configurable intervals via env vars — v1.0, v1.4
- ✓ Finds runs where runStatus "waiting" AND waitUntil <= now — v1.0
- ✓ Reads vars/webhooks fresh each cycle (no caching) — v1.0
- ✓ Skips runs outside timeTrigger morningLimit/nightLimit window — v1.0, v1.1
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
- ✓ Per-database rate limiting for all dispatch types (RATE_LIMIT_RUNS/FUP/MESSAGES) — v1.5
- ✓ Dispatch methods return Promise<boolean> enabling accurate per-cycle counters — v1.5
- ✓ Message-run dependency guard (botIdentifier + chatDataId) — v1.5
- ✓ processingStartedAt timestamp on message claim — v1.5
- ✓ Automatic timeout recovery for stuck messages (MESSAGE_TIMEOUT_MINUTES, default 10) — v1.5
- ✓ CRON_INTERVAL_RECOVERY required env var for recovery interval — v1.5

### Active

*(empty — no committed requirements for next milestone yet)*

### Out of Scope

- Web UI / dashboard — headless background service
- Managing or creating runs — other systems write runs to MongoDB
- Modifying `webhooks` or `vars` collections — managed externally
- Processing webhook responses beyond success/failure status
- Authentication/authorization — internal service, no public endpoints
- Dynamic interval changes at runtime — restart to change
- Per-database intervals — global per dispatch type
- Per-database rate limit overrides (in vars collection) — global limits sufficient
- Per-database timeout threshold overrides — global timeout sufficient
- Redis or BullMQ for rate limiting — in-memory counters are correct for cycle-scoped limits

## Context

- MongoDB is a replica set across 3 nodes (177.x.x.x:27017/27018/27019)
- There are dozens of client databases (e.g., `sdr-4blue`, `sdr-action360`, `acade-system`, `dev`)
- Each client DB has the same collection structure: `runs`, `webhooks`, `vars`, `chats`, `messages`, etc.
- Some databases only have partial collections (e.g., only `chats`) — these are skipped
- The `webhooks` collection has one document per `botIdentifier` with named webhook URLs
- The `vars` collection uses `timeTrigger` object for Time Trigger config (see `docs/vars-schema.md`)
- Legacy `morningLimit`/`nightLimit` at root level are for other systems — Time Trigger reads `timeTrigger.*`
- Run documents track their lifecycle: `waiting` → `queued` → (external processing) → `done`
- **Open question:** Confirm that run documents contain `chatDataId` field in production data (assumed yes for v1.5 dependency guard)

**Milestones shipped:**
- v1.0 MVP: Foundation, core dispatch loop, operational hardening (Phases 1-3, 9 plans, 2026-03-25)
- v1.1 Per-Client Controls: Database targeting, per-client time controls (Phases 4-5, 2 plans, 2026-03-25)
- v1.2 FUP Dispatch: FUP collection processing (Phase 6, 1 plan, 2026-03-26)
- v1.3 Messages Dispatch: Messages collection processing (Phase 7, 1 plan, 2026-03-26)
- v1.4 Independent Cron Intervals: 3 independent setIntervals (Phase 8, 3 plans, 2026-03-29)
- v1.5 Rate Limiting and Message-Run Dependency: rate limits + dependency guard + timeout recovery (Phases 9-11, 5 plans, 2026-03-30)

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
| Rate limit counters as local variables (v1.5) | Per-cycle and per-database scope satisfied naturally; no Redis/external state | ✓ Good — simple, correct |
| RATE_LIMIT_* as optional vars with default 10 (v1.5) | Tuning knob — safe default, not a startup requirement | ✓ Good — consistent with MESSAGE_TIMEOUT_MINUTES pattern |
| MessageCheckService uses findOne not countDocuments (v1.5) | Stops at first match — more efficient | ✓ Good — avoids full collection scan |
| $lte filter only on processingStartedAt, no $exists (v1.5) | MongoDB $lte naturally evaluates false for missing fields | ✓ Good — simpler query, correct semantics |
| MESSAGE_TIMEOUT_MINUTES as optional var with default 10 (v1.5) | Tuning knob, not a startup requirement | ✓ Good — consistent with RATE_LIMIT_* pattern |
| CRON_INTERVAL_RECOVERY as required var (v1.5) | Interval frequency must be explicit — no safe default for scheduling | ✓ Good — fail-fast, consistent with other CRON_INTERVAL_* vars |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition:**
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
*Last updated: 2026-03-30 after v1.5 milestone complete*
