---
phase: 01-foundation
plan: 02
subsystem: database
tags: [mongodb, nestjs, mongoclient, dependency-injection, unit-testing]

# Dependency graph
requires:
  - phase: 01-foundation plan 01
    provides: ConfigModule global registration, ConfigService injectable project-wide

provides:
  - MongoService singleton with OnModuleInit/OnModuleDestroy lifecycle
  - db(name) accessor returning Db handle without new connections
  - listDatabaseNames() using admin command with nameOnly:true
  - MongoModule registered globally via @Global() decorator
  - AppModule wired to import MongoModule

affects:
  - 01-03-database-scan (depends on MongoService.db() and listDatabaseNames())
  - all Phase 2 services that call mongoService.db(name)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Single MongoClient singleton via OnModuleInit/OnModuleDestroy lifecycle hooks
    - ConfigService.getOrThrow() for fail-fast env var access in services
    - @Global() module pattern for project-wide service availability without re-importing
    - jest.mock('mongodb') module mock for unit testing MongoDB driver

key-files:
  created:
    - src/mongo/mongo.service.ts
    - src/mongo/mongo.module.ts
    - src/mongo/mongo.service.spec.ts
  modified:
    - src/app.module.ts

key-decisions:
  - "Single MongoClient instance with maxPoolSize:20, minPoolSize:5, serverSelectionTimeoutMS:5000, connectTimeoutMS:10000"
  - "@Global() on MongoModule so all Phase 2 feature modules receive MongoService via DI without importing MongoModule"
  - "listDatabaseNames uses nameOnly:true to avoid fetching storage stats (performance optimization)"

patterns-established:
  - "Pattern: OnModuleInit connects MongoClient, OnModuleDestroy closes it — all consumers use mongoService.db(name)"
  - "Pattern: jest.mock('mongodb') at module level for unit-testing MongoClient-dependent services without live DB"

requirements-completed: [CONN-01, CONN-02]

# Metrics
duration: 2min
completed: 2026-03-25
---

# Phase 01 Plan 02: MongoService Singleton and Global MongoModule Summary

**MongoClient singleton wrapped in NestJS injectable MongoService with connection pooling, global MongoModule, and 5 unit tests covering CONN-01 and CONN-02**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-25T15:25:35Z
- **Completed:** 2026-03-25T15:27:31Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- MongoService implemented with OnModuleInit (connect) and OnModuleDestroy (close) lifecycle hooks
- 5 unit tests using jest.mock('mongodb') confirm connection, disconnect, db(), and listDatabaseNames() behaviour
- MongoModule created as @Global() module so all feature modules get MongoService without importing MongoModule
- AppModule updated to import MongoModule — build and full 12-test suite pass

## Task Commits

Each task was committed atomically:

1. **Task 1: Write MongoService spec stubs (RED) then implement MongoService (GREEN)** - `576c594` (test)
2. **Task 2: Create MongoModule (global) and register it in AppModule** - `03b8f1a` (feat)

## Files Created/Modified

- `src/mongo/mongo.service.ts` - MongoClient singleton: onModuleInit, onModuleDestroy, db(), listDatabaseNames()
- `src/mongo/mongo.service.spec.ts` - 5 unit tests with mocked MongoClient covering CONN-01 and CONN-02
- `src/mongo/mongo.module.ts` - Global NestJS module exporting MongoService
- `src/app.module.ts` - Added MongoModule to imports array after ConfigModule

## Decisions Made

- Used `getOrThrow<string>('MONGODB_URI')` (not `get()`) for explicit fail-fast at service init level as secondary guard after main.ts
- Connection pool configured with `maxPoolSize: 20`, `minPoolSize: 5`, `serverSelectionTimeoutMS: 5000`, `connectTimeoutMS: 10000`
- `@Global()` decorator on MongoModule follows same pattern as `ConfigModule.forRoot({ isGlobal: true })` — both registered once in AppModule, available everywhere

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- `pnpm test --testPathPattern=mongo.service.spec` syntax invalid with Jest 30 (flag renamed to `--testPathPatterns`). Used `npx jest mongo.service.spec` for pattern-based filtering. No impact on implementation.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- MongoService and MongoModule are ready for Plan 03 (DatabaseScanService) to call `mongoService.listDatabaseNames()` and `mongoService.db(name)`
- All 12 tests pass, build clean, global DI wiring confirmed
- No blockers

## Self-Check: PASSED

- FOUND: src/mongo/mongo.service.ts
- FOUND: src/mongo/mongo.module.ts
- FOUND: src/mongo/mongo.service.spec.ts
- FOUND: .planning/phases/01-foundation/01-02-SUMMARY.md
- FOUND: commit 576c594 (Task 1)
- FOUND: commit 03b8f1a (Task 2)

---
*Phase: 01-foundation*
*Completed: 2026-03-25*
