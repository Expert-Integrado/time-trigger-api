---
phase: 08-independent-cron-intervals
plan: "03"
subsystem: infra
tags: [env-vars, validation, cron, startup, fail-fast]

requires:
  - phase: 08-independent-cron-intervals
    provides: "Independent cron intervals (CRON_INTERVAL_RUNS, CRON_INTERVAL_FUP, CRON_INTERVAL_MESSAGES) wired in scheduler"

provides:
  - "validateEnv() requires 3 new cron interval vars instead of old CRON_INTERVAL"
  - "Fail-fast startup for CRON_INTERVAL_RUNS, CRON_INTERVAL_FUP, CRON_INTERVAL_MESSAGES (CRON-08)"
  - "CRON_INTERVAL fully removed from required vars (CRON-09)"
  - ".env.example documents the 3 new vars with per-type comments (CRON-10)"
  - "docs/vars-schema.md Env Vars section listing all required env vars (CRON-11)"

affects: [deployment, docker, env-config, documentation]

tech-stack:
  added: []
  patterns:
    - "REQUIRED_ENV_VARS const array as single source of truth for startup validation"

key-files:
  created: []
  modified:
    - src/main.ts
    - src/main.spec.ts
    - .env.example
    - docs/vars-schema.md

key-decisions:
  - "CRON_INTERVAL completely removed from REQUIRED_ENV_VARS — no backward compat needed since v1.4 is a breaking config change"
  - "3 new vars are all required (not optional) — absent var must hard-fail startup to prevent silent misconfiguration"

patterns-established:
  - "TDD pattern: write failing spec first (RED), update implementation (GREEN), verify 9/9 pass"

requirements-completed:
  - CRON-08
  - CRON-09
  - CRON-10
  - CRON-11

duration: 5min
completed: "2026-03-26"
---

# Phase 08 Plan 03: Update validateEnv and Docs for 3 Independent Cron Vars Summary

**validateEnv() fail-fast startup now requires CRON_INTERVAL_RUNS, CRON_INTERVAL_FUP, CRON_INTERVAL_MESSAGES — CRON_INTERVAL fully removed, docs updated with Env Vars section**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-03-26T18:30:00Z
- **Completed:** 2026-03-26T18:35:00Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- `validateEnv()` in main.ts now validates the 3 new independent cron interval env vars and rejects startup if any is missing (CRON-08)
- Old `CRON_INTERVAL` removed from required vars — absence no longer triggers exit (CRON-09)
- `main.spec.ts` rewritten with 9 tests covering each new var, CRON-09 behavior, and error message content
- `.env.example` replaced single `CRON_INTERVAL` line with 3 annotated entries (CRON-10)
- `docs/vars-schema.md` gained a new "Env Vars da API" section listing all 7 required/optional vars with deprecation note for CRON_INTERVAL (CRON-11)

## Task Commits

Each task was committed atomically:

1. **Task 1: Update validateEnv() in main.ts and main.spec.ts** - `1e2f017` (feat)
2. **Task 2: Update .env.example and docs/vars-schema.md** - `984cf4b` (docs)

**Plan metadata:** (docs: complete plan — see final commit)

_Note: Task 1 followed TDD pattern: spec written first (RED), main.ts updated (GREEN), 9/9 tests pass._

## Files Created/Modified

- `src/main.ts` - REQUIRED_ENV_VARS replaced CRON_INTERVAL with 3 new vars
- `src/main.spec.ts` - Rewritten with 9 tests: all required vars, CRON-08/09, error messages
- `.env.example` - CRON_INTERVAL replaced with CRON_INTERVAL_RUNS/FUP/MESSAGES with comments
- `docs/vars-schema.md` - Added "Env Vars da API" section before existing content

## Decisions Made

- CRON_INTERVAL completely removed from REQUIRED_ENV_VARS — no backward compat needed since v1.4 is an intentional breaking config change
- All 3 new vars are required (not optional) — absent var must hard-fail startup to prevent silent misconfiguration

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- `pnpm test -- --testPathPattern="main.spec"` syntax from the plan did not work with Jest 30 (double-dash causes args to be misrouted). Ran tests directly with `pnpm jest --testPathPatterns="main.spec"` instead. All 9 tests passed.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- All 4 requirements (CRON-08, CRON-09, CRON-10, CRON-11) satisfied
- Phase 08 complete: independent cron intervals wired in scheduler (plan 02), validated at startup (plan 03), documented (plan 03)
- Operators must update their `.env` to replace `CRON_INTERVAL=10000` with the 3 new vars before deploying v1.4

---
*Phase: 08-independent-cron-intervals*
*Completed: 2026-03-26*
