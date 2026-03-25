---
phase: 01-foundation
plan: "01"
subsystem: infra
tags: [nestjs, config, environment-validation, fail-fast, jest, typescript]

# Dependency graph
requires: []
provides:
  - "@nestjs/config and @nestjs/schedule installed and available project-wide"
  - "ConfigModule registered globally so ConfigService injectable everywhere"
  - "validateEnv() exported from main.ts: exits with code 1 if MONGODB_URI, CRON_INTERVAL, or TZ are absent"
  - "Jest moduleNameMapper configured for nodenext .js extension resolution"
affects:
  - "02-foundation" # MongoService needs ConfigService (provided by global ConfigModule)
  - "03-foundation" # CronModule needs @nestjs/schedule (installed here)

# Tech tracking
tech-stack:
  added:
    - "@nestjs/config@4.0.3 — global environment configuration via ConfigService"
    - "@nestjs/schedule@6.1.1 — cron job scheduling framework"
  patterns:
    - "Fail-fast env validation: validateEnv() runs before NestFactory.create()"
    - "Testable bootstrap: guard bootstrap() with require.main === module to prevent test side-effects"
    - "Jest + nodenext: moduleNameMapper strips .js extension for ts-jest resolution"

key-files:
  created:
    - src/main.spec.ts
  modified:
    - src/main.ts
    - src/app.module.ts
    - package.json
    - pnpm-lock.yaml

key-decisions:
  - "Guard bootstrap() with require.main === module — enables clean test import without spawning a server"
  - "moduleNameMapper in jest config strips .js extensions — required for ts-jest + nodenext module resolution"
  - "envFilePath: '.env' in ConfigModule.forRoot — supports local development without exporting vars"

patterns-established:
  - "Pattern: nodenext .js imports in source, moduleNameMapper in jest config for test resolution"
  - "Pattern: named export of testable functions from main.ts (validateEnv), bootstrap guarded from auto-run"

requirements-completed: [CONN-04, CONN-05]

# Metrics
duration: 3min
completed: 2026-03-25
---

# Phase 01 Plan 01: Env Validation and ConfigModule Summary

**@nestjs/config + @nestjs/schedule installed; ConfigModule wired globally; validateEnv() fail-fast guard with 6 passing unit tests covering CONN-04 and CONN-05**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-25T15:20:18Z
- **Completed:** 2026-03-25T15:23:03Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments

- Installed `@nestjs/config@4.0.3` and `@nestjs/schedule@6.1.1` as production dependencies
- Registered `ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' })` in AppModule so ConfigService is injectable in every downstream module
- Extracted `validateEnv()` as named export from `src/main.ts` — exits with code 1 and logs missing variable names when MONGODB_URI, CRON_INTERVAL, or TZ are absent
- Wrote 6 unit tests in `src/main.spec.ts` — all pass (RED confirmed, GREEN confirmed)

## Task Commits

Each task was committed atomically:

1. **Task 1: Install dependencies and wire ConfigModule globally** - `e298ccd` (build)
2. **Task 2: Extract validateEnv() and write failing-then-passing tests** - `3ab419d` (test)

**Plan metadata:** committed after SUMMARY and state updates.

_Note: TDD tasks had RED (module not found) confirmed before GREEN implementation._

## Files Created/Modified

- `src/main.ts` — added `validateEnv()` named export, REQUIRED_ENV_VARS constant, bootstrap() guard
- `src/main.spec.ts` — 6 unit tests for validateEnv() covering all env vars and error message
- `src/app.module.ts` — added ConfigModule.forRoot global registration, .js extensions on imports
- `package.json` — added @nestjs/config and @nestjs/schedule deps; added moduleNameMapper for jest
- `pnpm-lock.yaml` — lockfile updated with new packages

## Decisions Made

- **require.main === module guard on bootstrap():** Prevents NestFactory from being instantiated when Jest imports `main.ts` to test `validateEnv()`. Without this guard, the module auto-executes and calls `process.exit(1)` (because TZ env var is not set in test env) before any test spy is active.
- **moduleNameMapper `^(\\.{1,2}/.*)\\.js$ -> $1`:** ts-jest does not resolve `.js` imports to `.ts` source files by default under `module: nodenext`. This mapper is the standard fix, stripping the `.js` extension so Jest resolves the TypeScript file.
- **envFilePath: '.env':** Convenience for local dev — allows `.env` file usage without requiring shell exports.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] bootstrap() auto-execution prevented test isolation**
- **Found during:** Task 2 (GREEN phase — tests failed after writing main.ts)
- **Issue:** `bootstrap()` at module level called `validateEnv()` at import time before test spies were registered, causing `process.exit(1)` to be called by the real implementation instead of the mock
- **Fix:** Wrapped `bootstrap()` in `if (require.main === module)` guard so it only runs when executed as entry point, not when imported in tests
- **Files modified:** `src/main.ts`
- **Verification:** All 6 tests pass; build still succeeds
- **Committed in:** `3ab419d` (Task 2 commit)

**2. [Rule 3 - Blocking] ts-jest could not resolve .js imports under nodenext**
- **Found during:** Task 2 (RED phase — test suite failed with "Cannot find module './main.js'")
- **Issue:** ts-jest with `module: nodenext` in tsconfig does not automatically remap `.js` imports to `.ts` source files, so importing `from './main.js'` in the spec failed
- **Fix:** Added `moduleNameMapper: { "^(\\.{1,2}/.*)\\.js$": "$1" }` to Jest config in `package.json`
- **Files modified:** `package.json`
- **Verification:** Test suite loads and runs all 6 tests successfully
- **Committed in:** `3ab419d` (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (1 bug, 1 blocking)
**Impact on plan:** Both fixes are standard nodenext + ts-jest patterns, necessary for testability. No scope creep.

## Issues Encountered

- Jest 30 deprecated `--testPathPattern` flag — the plan's verify command uses it. Used `pnpm test -- main.spec` (positional pattern argument) instead. Both fixes committed in Task 2.

## User Setup Required

None — no external service configuration required for this plan.

## Next Phase Readiness

- ConfigService is available project-wide via global ConfigModule
- @nestjs/schedule is installed and ready for ScheduleModule registration in Phase 01-02 or 01-03
- Fail-fast env validation ensures the service refuses to start without MONGODB_URI, CRON_INTERVAL, and TZ
- All downstream plans can use `ConfigService.get('MONGODB_URI')` etc. without additional module wiring

---
*Phase: 01-foundation*
*Completed: 2026-03-25*

## Self-Check: PASSED

- src/main.ts: FOUND
- src/main.spec.ts: FOUND
- src/app.module.ts: FOUND
- 01-01-SUMMARY.md: FOUND
- commit e298ccd: FOUND
- commit 3ab419d: FOUND
