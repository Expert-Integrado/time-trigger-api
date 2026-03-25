# Phase 1: Foundation - Research

**Researched:** 2026-03-25
**Domain:** NestJS 11 + MongoDB native driver — env validation, connection bootstrap, multi-database discovery and collection filtering, structured logging
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Env & Config**
- D-01: `CRON_INTERVAL` is in milliseconds (e.g., `CRON_INTERVAL=10000` for 10 seconds)
- D-02: `morningLimit`/`nightLimit` values in `vars` collection are in Brazil timezone (America/Sao_Paulo)
- D-03: Add `TZ` environment variable (e.g., `TZ=America/Sao_Paulo`) — configurable, used for time-gate comparisons
- D-04: Three required env vars: `MONGODB_URI`, `CRON_INTERVAL`, `TZ` — fail fast with clear error if any is missing
- D-05: Use `@nestjs/config` with `.env` file support for env var management

**DB Discovery**
- D-06: Filter databases only by collection presence (`runs` + `webhooks` + `vars`) — no name-based filtering
- D-07: Re-list all databases every cron cycle (not cached) — picks up new client databases automatically
- D-08: Use single shared `MongoClient` instance — `client.db(dbName)` to access each database (no per-DB connections)
- D-09: Skip system databases (`admin`, `local`, `config`) before checking collections

**Logging**
- D-10: Use NestJS built-in Logger (no external logging library)
- D-11: Resumido: 1 summary line per cycle (e.g., "Cycle #42: 15 DBs scanned, 3 eligible, 0 errors")
- D-12: Log startup validation results (env vars loaded, MongoDB connected, initial DB count)

### Claude's Discretion
- Module structure (how to organize MongoService, DatabaseScanService, ConfigModule)
- Error handling patterns for MongoDB connection failures
- Exact log format and message wording

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CONN-01 | API connects to MongoDB replica set using `MONGODB_URI` from environment variables | `MongoClient` initialized in `MongoService.onModuleInit()` using `ConfigService.get('MONGODB_URI')` — Pattern 1 in Architecture Patterns section |
| CONN-02 | API dynamically enumerates all databases in the MongoDB cluster | `client.db('admin').command({ listDatabases: 1, nameOnly: true })` called per cycle — See Code Examples |
| CONN-03 | API filters databases — only processes those containing `runs`, `webhooks`, and `vars` collections | `db.listCollections().toArray()` per eligible DB; set intersection check — See Code Examples |
| CONN-04 | API fails fast at startup with clear error if `MONGODB_URI` is missing | `ConfigModule.forRoot({ validationSchema })` with Joi or manual validation guard in `main.ts` before `NestFactory.create()` |
| CONN-05 | API fails fast at startup with clear error if `CRON_INTERVAL` is missing | Same startup validation as CONN-04 — all three required vars (`MONGODB_URI`, `CRON_INTERVAL`, `TZ`) validated together |
| OPS-02 | Structured logging for cycle start/end, per-DB processing, dispatched runs, and errors | NestJS built-in `Logger` class — context-tagged log lines, one summary line per cycle (D-11) |
</phase_requirements>

---

## Summary

Phase 1 establishes the service skeleton: environment validation, MongoDB connection, multi-database discovery and eligibility filtering, and structured logging. No run detection, no webhook dispatch — this phase ends when the service can start up, connect to the replica set, enumerate all databases, log which ones have the three required collections, and emit a cycle summary.

The technical foundation is well-understood. All core libraries are either already installed (`mongodb@7.1.1`, `@nestjs/common@11.1.17`) or straightforwardly compatible (`@nestjs/config@4.0.3`, `@nestjs/schedule@6.1.1` — both verified to accept `@nestjs/common ^10 || ^11`). The primary build challenge is the startup validation sequence: `@nestjs/config` must be loaded and validated before `MongoService` attempts to connect, which requires attention to NestJS module initialization order.

The two pieces requiring most care are (1) the env validation pattern — where to place the fail-fast check relative to `NestFactory.create()` — and (2) the `listDatabases` + `listCollections` query sequence, which has a known performance optimization (use `nameOnly: true` on `listDatabases`, batch the collection check per DB rather than issuing N+1 queries). Both are covered in Code Examples with verified patterns.

**Primary recommendation:** Build in dependency order — `ConfigModule` first, then `MongoService`, then `DatabaseScanService`. Each component can be independently unit-tested before the next layer is added.

---

## Standard Stack

### Core (already installed)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@nestjs/common` | 11.1.17 (installed) | DI container, Logger, lifecycle hooks | Already initialized; provides `OnModuleInit`, `OnModuleDestroy`, `Logger` |
| `@nestjs/core` | 11.1.17 (installed) | NestFactory, application bootstrap | Needed for `NestFactory.create()` |
| `mongodb` | 7.1.1 (installed) | Native MongoDB driver | Installed; exposes `MongoClient.db(name)` for multi-database access without Mongoose constraints |
| `rxjs` | 7.8.1 (installed) | Reactive streams (NestJS peer dep) | Required by NestJS; no direct usage in Phase 1 |

### Supporting (to install)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@nestjs/config` | 4.0.3 (latest) | `.env` loading via `ConfigService` | Required by D-05; wraps `dotenv`, integrates with NestJS DI; allows `ConfigService.get()` in injectable services |
| `@nestjs/schedule` | 6.1.1 (latest) | Cron scheduling with NestJS lifecycle | Not directly used in Phase 1, but install now — Phase 2 depends on it and its absence would affect module wiring decisions |

### Verified Compatibility

Both packages declare peer dependency `"@nestjs/common": "^10.0.0 || ^11.0.0"` — confirmed compatible with `@nestjs/common@11.1.17`.

`@nestjs/config` additionally requires `class-transformer >=0.4.1` and `class-validator >=0.13.2` **only if** Joi-based validation schema is used. If manual `process.env` validation is chosen for startup fail-fast (see Architecture Patterns), these peer deps are not needed.

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `@nestjs/config` | Raw `process.env` + manual check | `process.env` is fine for fail-fast guard in `main.ts`, but `ConfigService` is needed throughout for testability — install `@nestjs/config` |
| NestJS `Logger` | `winston`, `pino` | D-10 explicitly locks NestJS built-in Logger; no external logging library |
| MongoDB native driver | Mongoose | D-08 explicitly locks native driver; Mongoose's single-connection model does not support `client.db(name)` multi-database pattern |

**Installation:**
```bash
pnpm add @nestjs/config @nestjs/schedule
```

---

## Architecture Patterns

### Recommended Module Structure for Phase 1

```
src/
├── config/
│   └── (none needed — use @nestjs/config directly in AppModule)
├── mongo/
│   ├── mongo.module.ts          # Global module, exports MongoService
│   ├── mongo.service.ts         # MongoClient lifecycle + listDatabases + db() accessor
│   └── mongo.service.spec.ts    # Unit tests with mocked MongoClient
├── database/
│   ├── database.module.ts       # Imports MongoModule, exports DatabaseScanService
│   ├── database-scan.service.ts # Filters eligible databases by collection presence
│   └── database-scan.service.spec.ts
├── app.module.ts                # Root: imports ConfigModule, MongoModule, DatabaseModule
└── main.ts                      # Startup env validation, bootstrap
```

**Rationale:** Separate `mongo/` from `database/` to maintain the single-responsibility boundary defined in ARCHITECTURE.md. `MongoService` owns the connection; `DatabaseScanService` owns discovery logic. This makes Phase 2 additions (run detection, dispatch) non-disruptive.

### Pattern 1: Startup Fail-Fast Env Validation

**What:** Validate required env vars before `NestFactory.create()` so the process exits with a clear error message rather than a cryptic runtime failure.

**When to use:** D-04 requires fail fast for `MONGODB_URI`, `CRON_INTERVAL`, and `TZ`. Place the check at the very top of `main.ts` before creating the NestJS application.

**Example:**
```typescript
// src/main.ts
async function bootstrap() {
  const required = ['MONGODB_URI', 'CRON_INTERVAL', 'TZ'];
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    console.error(`[Bootstrap] Missing required environment variables: ${missing.join(', ')}`);
    process.exit(1);
  }

  const app = await NestFactory.create(AppModule);
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
```

**Why `main.ts` not `ConfigModule` validation schema:** Joi validation schema in `@nestjs/config` runs during module initialization, which is after `NestFactory.create()`. The guard in `main.ts` fires earlier and produces a cleaner log line. Both can coexist; the `main.ts` guard provides the first visible error.

### Pattern 2: Single MongoClient Singleton with Lifecycle Hooks

**What:** `MongoService` implements `OnModuleInit` to connect and `OnModuleDestroy` to close. All other services receive `MongoService` via DI and call `db(name)` — they never touch `MongoClient` directly.

**When to use:** Always. Required by D-08.

**Example:**
```typescript
// src/mongo/mongo.service.ts
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MongoClient, Db } from 'mongodb';

@Injectable()
export class MongoService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MongoService.name);
  private client: MongoClient;

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit(): Promise<void> {
    const uri = this.configService.getOrThrow<string>('MONGODB_URI');
    this.client = new MongoClient(uri, {
      maxPoolSize: 20,
      minPoolSize: 5,
      serverSelectionTimeoutMS: 5000,
    });
    await this.client.connect();
    this.logger.log('MongoDB connected');
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.close();
    this.logger.log('MongoDB connection closed');
  }

  db(name: string): Db {
    return this.client.db(name);
  }

  async listDatabaseNames(): Promise<string[]> {
    const result = await this.client
      .db('admin')
      .command({ listDatabases: 1, nameOnly: true });
    return result.databases.map((d: { name: string }) => d.name);
  }
}
```

**Why `getOrThrow`:** `ConfigService.getOrThrow()` (available in `@nestjs/config@2+`) throws a descriptive error if the key is absent. Provides a second layer of defense after the `main.ts` guard.

### Pattern 3: Collection-Presence Database Filtering

**What:** For each non-system database, call `db.listCollections().toArray()` once and check in memory whether `runs`, `webhooks`, and `vars` are all present. Skip the database if any are absent.

**When to use:** D-06 specifies collection-presence filtering (no name-based filtering). D-09 specifies system databases (`admin`, `local`, `config`) must be skipped first.

**Example:**
```typescript
// src/database/database-scan.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { MongoService } from '../mongo/mongo.service.js';

const SYSTEM_DATABASES = new Set(['admin', 'local', 'config']);
const REQUIRED_COLLECTIONS = ['runs', 'webhooks', 'vars'];

@Injectable()
export class DatabaseScanService {
  private readonly logger = new Logger(DatabaseScanService.name);

  constructor(private readonly mongoService: MongoService) {}

  async getEligibleDatabases(): Promise<string[]> {
    const allDbs = await this.mongoService.listDatabaseNames();
    const clientDbs = allDbs.filter((name) => !SYSTEM_DATABASES.has(name));

    const eligible: string[] = [];
    const skipped: string[] = [];

    for (const dbName of clientDbs) {
      const db = this.mongoService.db(dbName);
      const collections = await db.listCollections().toArray();
      const names = new Set(collections.map((c) => c.name));
      const hasAll = REQUIRED_COLLECTIONS.every((col) => names.has(col));

      if (hasAll) {
        eligible.push(dbName);
      } else {
        skipped.push(dbName);
      }
    }

    this.logger.log(
      `DB scan: ${clientDbs.length} client DBs, ${eligible.length} eligible, ${skipped.length} skipped`,
    );
    return eligible;
  }
}
```

### Pattern 4: ConfigModule Global Registration

**What:** Register `ConfigModule` as global in `AppModule` so `ConfigService` is available in all modules without re-importing `ConfigModule` everywhere.

**When to use:** Always for this project — `MongoService` and future services all need `ConfigService`.

**Example:**
```typescript
// src/app.module.ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongoModule } from './mongo/mongo.module.js';
import { DatabaseModule } from './database/database.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    MongoModule,
    DatabaseModule,
  ],
})
export class AppModule {}
```

### Pattern 5: Startup Discovery Log (OPS-02 / D-12)

**What:** After MongoDB connects and the initial database scan completes, log a structured startup summary. This satisfies D-12 and provides immediate visibility into what the service found.

**When to use:** In a dedicated startup service or in `AppModule`'s `onApplicationBootstrap()` hook.

**Example:**
```typescript
// src/app.module.ts — add a startup hook
import { Module, OnApplicationBootstrap, Logger } from '@nestjs/common';
import { DatabaseScanService } from './database/database-scan.service.js';

@Module({ ... })
export class AppModule implements OnApplicationBootstrap {
  private readonly logger = new Logger('Bootstrap');

  constructor(private readonly databaseScanService: DatabaseScanService) {}

  async onApplicationBootstrap(): Promise<void> {
    const eligible = await this.databaseScanService.getEligibleDatabases();
    this.logger.log(
      `Startup scan complete: ${eligible.length} eligible databases found`,
    );
  }
}
```

### Anti-Patterns to Avoid

- **One MongoClient per database:** Opens separate TCP connections per database. Use `client.db(name)` on a single shared client. (Pitfall 4)
- **Caching database list between cycles:** D-07 requires re-listing every cycle to pick up new client databases.
- **Logging `MONGODB_URI` at startup:** Exposes credentials to log aggregation. Log only a sanitized form (e.g., number of databases found).
- **`@Cron()` static decorator for configurable interval:** `@Cron()` resolves at class decoration time; env vars are not yet available. Phase 2 uses `SchedulerRegistry` with a dynamic `CronJob` instead.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| `.env` file loading | Custom `fs.readFileSync('.env')` parser | `@nestjs/config` with `ConfigModule.forRoot()` | Handles quoting, comments, multiline values, precedence correctly; integrates with NestJS DI for testability |
| Environment variable validation | Manual `if (!process.env.X) throw` in every service | `ConfigService.getOrThrow()` + `main.ts` guard | `getOrThrow` provides consistent error format; single guard in `main.ts` provides early-exit before DI graph is constructed |
| MongoDB multi-database list | Parsing `show dbs` output or MongoDB HTTP API | `client.db('admin').command({ listDatabases: 1, nameOnly: true })` | Official driver command; `nameOnly: true` returns metadata without full stats; returns `{ databases: [{name}] }` |
| Collection existence check | Per-collection `find({}).limit(1)` probe | `db.listCollections().toArray()` then set membership test | One round-trip per database instead of three; no document access needed — metadata-only operation |

**Key insight:** MongoDB's admin commands (`listDatabases`, `listCollections`) are metadata operations — they do not scan document data and are inexpensive compared to any query-based probe.

---

## Common Pitfalls

### Pitfall 1: Connection Pool Exhaustion (One Client Per Database)

**What goes wrong:** Creating a `new MongoClient(uri)` per client database. With 30+ databases, each cron cycle opens 30+ connections to the replica set, exhausting the pool and causing `MongoServerSelectionError`.

**Why it happens:** Developers assume `client.db(name)` does something database-specific to the connection. It does not — it returns a `Db` handle that routes queries over the same pool.

**How to avoid:** Single `MongoService` instance owns one `MongoClient`. All consumers call `mongoService.db(name)`. Configure `maxPoolSize: 20` and `minPoolSize: 5` on `MongoClient` options.

**Warning signs:** Growing connection count in MongoDB logs; `serverSelectionTimeoutMS` errors under load.

### Pitfall 2: `listDatabases` Returns Full Stats (Slow)

**What goes wrong:** Calling `client.db('admin').command({ listDatabases: 1 })` without `nameOnly: true` returns full storage statistics for every database. On clusters with many large databases this is noticeably slower.

**Why it happens:** Default `listDatabases` includes `sizeOnDisk` and `empty` per entry.

**How to avoid:** Always pass `nameOnly: true`: `command({ listDatabases: 1, nameOnly: true })`. Returns only `name` per entry.

**Warning signs:** Startup scan taking unexpectedly long relative to database count.

### Pitfall 3: Env Validation After NestJS Bootstraps

**What goes wrong:** Relying solely on Joi validation inside `ConfigModule` to fail-fast. Joi validation throws inside `NestFactory.create()`, but the error message may be buried in NestJS's bootstrap error output. The service may appear to hang briefly before failing.

**Why it happens:** `ConfigModule.forRoot({ validationSchema })` runs during the DI container construction phase inside `NestFactory.create()`.

**How to avoid:** Add an explicit check at the top of `main.ts` before `NestFactory.create()`. Produces a clean, unambiguous error line and calls `process.exit(1)` immediately.

**Warning signs:** `Error: Config validation error` messages mixed with NestJS startup output instead of a clear early exit.

### Pitfall 4: `module: "nodenext"` Requires `.js` Extensions in Imports

**What goes wrong:** Writing `import { MongoService } from './mongo/mongo.service'` (no extension) fails at runtime with Node.js `ERR_MODULE_NOT_FOUND` when `module: "nodenext"` is set in `tsconfig.json`.

**Why it happens:** `nodenext` module resolution requires explicit file extensions in ESM imports. TypeScript source files use `.ts` but the compiled output is `.js` — so the import must reference `.js`.

**How to avoid:** Always use `.js` extension in relative imports in source files: `import { MongoService } from './mongo/mongo.service.js'`. TypeScript with `nodenext` resolves `.js` imports to the corresponding `.ts` file during compilation.

**Warning signs:** `ERR_MODULE_NOT_FOUND` at runtime despite the file existing; works in `ts-node` but fails after `nest build`.

### Pitfall 5: System Database Included in Scan

**What goes wrong:** Passing `admin`, `local`, or `config` through the collection-presence filter. These system databases do not have `runs`, `webhooks`, or `vars` collections, so they get skipped — but the `listCollections` call is wasted, and `admin` in particular has unusual permission requirements.

**Why it happens:** Forgetting to skip system databases before the collection check loop.

**How to avoid:** Filter out system databases by name (`SYSTEM_DATABASES = new Set(['admin', 'local', 'config'])`) before issuing any `listCollections` queries.

---

## Code Examples

### Verified: listDatabases with nameOnly

```typescript
// Equivalent to: db.adminCommand({ listDatabases: 1, nameOnly: true })
const result = await this.client
  .db('admin')
  .command({ listDatabases: 1, nameOnly: true });
// result.databases = [ { name: 'sdr-4blue' }, { name: 'acade-system' }, ... ]
const names: string[] = result.databases.map((d: { name: string }) => d.name);
```

Source: MongoDB Node.js driver v7 — `admin.listDatabases()` is also available but wraps the same command.

### Verified: listCollections per database

```typescript
const collections = await db.listCollections().toArray();
// collections = [ { name: 'runs', type: 'collection', ... }, ... ]
const collectionNames = new Set(collections.map((c) => c.name));
const isEligible = ['runs', 'webhooks', 'vars'].every((name) =>
  collectionNames.has(name),
);
```

Source: MongoDB Node.js driver v7 `Db.listCollections()` — returns `ListCollectionsCursor<CollectionInfo>`.

### Verified: ConfigModule global registration

```typescript
ConfigModule.forRoot({
  isGlobal: true,   // ConfigService available everywhere without re-importing
  envFilePath: '.env',  // default, explicit for clarity
})
```

Source: `@nestjs/config@4.0.3` README. `isGlobal: true` is the standard pattern for application-wide config.

### Verified: NestJS Logger contextual usage

```typescript
// Standard pattern from @nestjs/common documentation
import { Logger } from '@nestjs/common';

@Injectable()
export class DatabaseScanService {
  private readonly logger = new Logger(DatabaseScanService.name);
  // Produces log lines: [DatabaseScanService] DB scan: 15 client DBs, 3 eligible, 12 skipped
}
```

Source: NestJS documentation — Logger class with context string.

### Verified: MongoClient connection options for multi-database workload

```typescript
new MongoClient(uri, {
  maxPoolSize: 20,        // Limits total connections in pool
  minPoolSize: 5,         // Keeps connections warm
  serverSelectionTimeoutMS: 5000,  // Fail fast if replica set unreachable
  connectTimeoutMS: 10000,
})
```

Source: MongoDB Node.js driver v7 `MongoClientOptions` interface.

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `@Cron()` static decorator | `SchedulerRegistry` + `CronJob` for runtime intervals | NestJS v7+ | Required for `CRON_INTERVAL` from env — `@Cron()` cannot accept runtime values |
| `process.env` directly in services | `ConfigService.get()` / `getOrThrow()` | NestJS v6+ with `@nestjs/config` | Testability — `ConfigService` can be mocked in test modules; `process.env` cannot |
| `MongoClient` per database or per request | Single `MongoClient` with `client.db(name)` | MongoDB Node.js driver v3+ | Connection pooling is per-client; multiple clients multiply socket usage without benefit |
| `module: "commonjs"` in NestJS scaffolds | `module: "nodenext"` in NestJS 11 | NestJS 11 + Node.js 22 | Requires `.js` extensions in relative imports; scripts that worked in CJS may need adjustment |

---

## Open Questions

1. **`@nestjs/config` validation schema vs. manual guard in `main.ts`**
   - What we know: Both approaches work; `main.ts` guard fires before NestJS bootstrap for cleaner error output
   - What's unclear: Whether Joi validation schema adds enough value for three required vars to justify the `class-validator`/`class-transformer` peer deps
   - Recommendation: Use `main.ts` guard for fail-fast (simple, clean, zero deps); add `ConfigService.getOrThrow()` in `MongoService` as secondary defense. Skip Joi schema for Phase 1.

2. **Startup scan location: `AppModule.onApplicationBootstrap` vs. dedicated `StartupService`**
   - What we know: `onApplicationBootstrap` fires after all modules initialize; a dedicated service keeps `AppModule` clean
   - What's unclear: Whether future phases will need the startup scan wired differently
   - Recommendation: Implement in `AppModule.onApplicationBootstrap()` for Phase 1; extract to `StartupService` in Phase 2 if scan must integrate with the cron cycle.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Runtime | Yes | 22.x (inferred from `@types/node ^22`) | — |
| pnpm | Package manager | Yes | lockfile present | npm |
| MongoDB replica set | CONN-01 | Unknown (external) | — | Must be provided via `MONGODB_URI` |
| `@nestjs/config` | D-05 | Not installed | — | Install: `pnpm add @nestjs/config` |
| `@nestjs/schedule` | Phase 2, install now | Not installed | — | Install: `pnpm add @nestjs/schedule` |
| `mongodb` driver | CONN-01 | Installed | 7.1.1 | — |

**Missing dependencies with no fallback:**
- MongoDB replica set: service is inoperable without a real `MONGODB_URI`. Required for integration testing. Unit tests can use a mocked `MongoService`.

**Missing dependencies with fallback:**
- `@nestjs/config`: not installed; must be added before Phase 1 implementation begins.
- `@nestjs/schedule`: not installed; install now to avoid module wiring surprises in Phase 2.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Jest 30.0.0 + ts-jest 29.2.5 |
| Config file | Embedded in `package.json` (`jest` key) |
| Quick run command | `pnpm test` |
| Full suite command | `pnpm run test:cov` |
| E2E run command | `pnpm run test:e2e` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CONN-04 | Service exits with error when `MONGODB_URI` missing | unit | `pnpm test --testPathPattern=main` | No — Wave 0 |
| CONN-05 | Service exits with error when `CRON_INTERVAL` missing | unit | `pnpm test --testPathPattern=main` | No — Wave 0 |
| CONN-01 | `MongoService` connects using URI from `ConfigService` | unit | `pnpm test --testPathPattern=mongo.service` | No — Wave 0 |
| CONN-02 | `listDatabaseNames()` returns non-system DB names | unit | `pnpm test --testPathPattern=mongo.service` | No — Wave 0 |
| CONN-03 | `getEligibleDatabases()` filters by collection presence | unit | `pnpm test --testPathPattern=database-scan.service` | No — Wave 0 |
| OPS-02 | Log line emitted on scan with DB counts | unit | `pnpm test --testPathPattern=database-scan.service` | No — Wave 0 |

All behaviors are unit-testable with mocked `MongoClient` and mocked `ConfigService`. No live MongoDB connection required for the test suite.

### Sampling Rate

- **Per task commit:** `pnpm test` (unit tests only, < 10s)
- **Per wave merge:** `pnpm run test:cov`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `src/mongo/mongo.service.spec.ts` — covers CONN-01, CONN-02
- [ ] `src/database/database-scan.service.spec.ts` — covers CONN-03, OPS-02
- [ ] `src/main.spec.ts` or startup guard test — covers CONN-04, CONN-05 (note: testing `process.exit` in `main.ts` requires mocking; consider extracting validation to a testable `validateEnv()` function)

---

## Project Constraints (from CLAUDE.md)

| Directive | Applies To |
|-----------|-----------|
| Use MongoDB native driver (not Mongoose) | All MongoDB interactions |
| All commits must follow Conventional Commits with emojis (e.g., `✨ feat:`, `🐛 fix:`) | Every commit |
| NEVER include `Co-Authored-By: Claude` or `Generated with Claude Code` in commits | Every commit |
| Tech stack is NestJS 11, MongoDB native driver, TypeScript — already initialized | Entire project |
| Use pnpm (not npm or yarn) | Package installs |
| Single quotes, trailing commas (Prettier) | All source files |
| `private readonly` for constructor-injected services | All NestJS services |
| All imports use relative paths (no path aliases) | All source files |
| Use `.js` extension in relative imports (module: nodenext) | All source files |
| NestJS built-in Logger only — no external logging library (D-10) | Logging |

---

## Sources

### Primary (HIGH confidence)

- `/root/time-trigger-api/pnpm-lock.yaml` — Verified installed versions: `mongodb@7.1.1`, `@nestjs/common@11.1.17`, `@nestjs/testing@11.1.17`
- `/root/time-trigger-api/package.json` — Confirmed dependency set and missing packages
- `/root/time-trigger-api/tsconfig.json` — Confirmed `module: "nodenext"`, `target: ES2023`
- `npm view @nestjs/config version` — Confirmed latest: 4.0.3
- `npm view @nestjs/schedule version` — Confirmed latest: 6.1.1
- `npm view @nestjs/config peerDependencies` — Confirmed `@nestjs/common ^10 || ^11` compatibility
- `npm view @nestjs/schedule peerDependencies` — Confirmed `@nestjs/common ^10 || ^11` compatibility
- `.planning/research/STACK.md` — Existing stack research (HIGH confidence, lockfile-verified)
- `.planning/research/ARCHITECTURE.md` — Component boundaries and build order
- `.planning/research/PITFALLS.md` — Connection pool, timezone, and query pitfalls

### Secondary (MEDIUM confidence)

- `.planning/phases/01-foundation/01-CONTEXT.md` — User decisions D-01 through D-12 (authoritative for this phase)
- NestJS documentation patterns for `ConfigModule.forRoot({ isGlobal: true })` — standard usage, training data corroborated by published API

### Tertiary (LOW confidence)

- None — all claims are grounded in installed package inspection or official API patterns.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all versions verified from installed lockfile and live npm registry
- Architecture: HIGH — NestJS DI lifecycle patterns and MongoDB native driver multi-DB access are well-established
- Pitfalls: HIGH — drawn from PITFALLS.md which cites MongoDB driver documentation and observable NestJS behavior

**Research date:** 2026-03-25
**Valid until:** 2026-06-25 (stable ecosystem; NestJS 11 and MongoDB 7.x are not in rapid flux)
