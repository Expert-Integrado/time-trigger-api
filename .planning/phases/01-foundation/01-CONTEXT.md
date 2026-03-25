# Phase 1: Foundation - Context

**Gathered:** 2026-03-25
**Status:** Ready for planning

<domain>
## Phase Boundary

The service can connect to MongoDB, enumerate and filter eligible client databases, validate required environment variables at startup, and log what it finds. This proves the infrastructure works against real data before any dispatch logic is written.

Requirements: CONN-01, CONN-02, CONN-03, CONN-04, CONN-05, OPS-02

</domain>

<decisions>
## Implementation Decisions

### Env & Config
- **D-01:** `CRON_INTERVAL` is in milliseconds (e.g., `CRON_INTERVAL=10000` for 10 seconds)
- **D-02:** `morningLimit`/`nightLimit` values in `vars` collection are in Brazil timezone (America/Sao_Paulo)
- **D-03:** Add `TZ` environment variable (e.g., `TZ=America/Sao_Paulo`) — configurable, used for time-gate comparisons
- **D-04:** Three required env vars: `MONGODB_URI`, `CRON_INTERVAL`, `TZ` — fail fast with clear error if any is missing
- **D-05:** Use `@nestjs/config` with `.env` file support for env var management

### DB Discovery
- **D-06:** Filter databases only by collection presence (`runs` + `webhooks` + `vars`) — no name-based filtering
- **D-07:** Re-list all databases every cron cycle (not cached) — picks up new client databases automatically
- **D-08:** Use single shared `MongoClient` instance — `client.db(dbName)` to access each database (no per-DB connections)
- **D-09:** Skip system databases (`admin`, `local`, `config`) before checking collections

### Logging
- **D-10:** Use NestJS built-in Logger (no external logging library)
- **D-11:** Resumido: 1 summary line per cycle (e.g., "Cycle #42: 15 DBs scanned, 3 eligible, 0 errors")
- **D-12:** Log startup validation results (env vars loaded, MongoDB connected, initial DB count)

### Claude's Discretion
- Module structure (how to organize MongoService, DatabaseScanService, ConfigModule)
- Error handling patterns for MongoDB connection failures
- Exact log format and message wording

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project specs
- `.planning/PROJECT.md` — Core value, constraints, key decisions
- `.planning/REQUIREMENTS.md` — CONN-01 through CONN-05, OPS-02 acceptance criteria
- `.planning/ROADMAP.md` §Phase 1 — Phase goal and success criteria

### Research findings
- `.planning/research/STACK.md` — Recommended packages (`@nestjs/config`, `@nestjs/schedule`), version guidance
- `.planning/research/ARCHITECTURE.md` — Component boundaries, MongoService singleton pattern, build order
- `.planning/research/PITFALLS.md` — MongoDB connection pool sizing, timezone Docker behavior

### Codebase reference
- `.planning/codebase/CONVENTIONS.md` — NestJS naming patterns, DI conventions
- `.planning/codebase/STRUCTURE.md` — Current directory layout

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/app.module.ts` — Root module, will be extended with new module imports (ConfigModule, MongoModule)
- `src/main.ts` — Bootstrap entry point, may need env validation before `NestFactory.create()`
- `mongodb` package already installed (v7.1.1) — native driver ready to use

### Established Patterns
- NestJS DI with `@Injectable()` and `private readonly` constructor injection
- Module registration via `@Module({ imports, controllers, providers })`
- Single quotes, trailing commas (Prettier config)

### Integration Points
- `AppModule.imports[]` — where ConfigModule and new MongoModule will be registered
- `main.ts` — startup validation happens before or during bootstrap

</code_context>

<specifics>
## Specific Ideas

- MongoDB connection string connects to a 3-node replica set (177.x.x.x:27017/27018/27019)
- Real production data has dozens of databases with names like `sdr-4blue`, `acade-system`, `n8n-papalotla`, `dev`
- Some databases only have partial collections (e.g., `n8-santosbarrosadvogados` only has `chats`) — these must be skipped

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 01-foundation*
*Context gathered: 2026-03-25*
