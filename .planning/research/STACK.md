# Stack Research

**Domain:** Cron-based webhook dispatcher with multi-database MongoDB monitoring
**Researched:** 2026-03-25
**Confidence:** HIGH (verified from installed lockfile + installed package versions; no web access available)

---

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| NestJS | 11.1.17 (installed) | Application framework | Already initialized; provides DI container, module system, lifecycle hooks. Cron scheduling integrates natively via `@nestjs/schedule`. DO NOT replace. |
| TypeScript | 5.9.3 (installed) | Type-safe language | Already configured with `nodenext` module resolution + `emitDecoratorMetadata`. Required for NestJS decorators. |
| mongodb (native driver) | 7.1.1 (installed) | Multi-database access | Already installed. Critical: Mongoose is intentionally avoided — this service must connect to dozens of client DBs dynamically; Mongoose's per-model, single-connection model is the wrong shape. Native driver exposes `MongoClient.db(name)` which is exactly what multi-database enumeration needs. |
| Node.js | >=22.0.0 (from lock engines) | Runtime | Node 22 LTS is the engine range already targeted in the project's angular-devkit constraints. Use 22 in Docker. |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @nestjs/schedule | ^4.1.x (verify on install — must be NestJS 11-compatible) | Cron scheduling | The only NestJS-native solution for `@Cron()` decorator-based scheduling. Wraps `cron` npm package. Use instead of raw `setInterval` or `node-cron` because it integrates with the NestJS lifecycle (graceful shutdown, dependency injection). |
| @nestjs/config | ^3.x | Environment variable loading | Loads `.env` into `ConfigService`. Required for `CRON_INTERVAL` and `MONGODB_URI`. Use `ConfigService` throughout rather than raw `process.env` to maintain testability. |
| @nestjs/axios | ^3.x | HTTP webhook dispatch | Thin RxJS wrapper around `axios`. Use for the `POST` to webhook URLs because it integrates with NestJS DI and produces Observables that compose naturally with retry logic. Alternatively use plain `axios` if RxJS overhead is unwanted — both are valid (see "Alternatives Considered"). |
| axios | ^1.7.x | HTTP client (underlying) | Required peer dependency of `@nestjs/axios`. Provides retry-able, interceptor-based HTTP. |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| Jest 30 (installed) | Unit and integration tests | Already configured via `ts-jest`. Use `--testPathPattern` to isolate unit tests from e2e. |
| @nestjs/testing (installed) | NestJS test harness | `createTestingModule` for unit testing services that use DI. Critical for testing the cron service without real MongoDB. |
| ESLint 9 + Prettier 3 (installed) | Code quality | Already configured via `eslint.config.mjs` flat config. Keep as-is; no changes needed. |
| Docker | Container runtime | Production target. Use `node:22-alpine` as base image — small footprint, matches Node 22 engine requirement. |

---

## Installation

The following packages need to be added to the existing NestJS 11 scaffold:

```bash
# Core additions — missing from current package.json
pnpm add @nestjs/schedule @nestjs/config @nestjs/axios axios

# No dev dependencies needed beyond what's already installed
```

Current installed dependencies that are already sufficient:
- `@nestjs/common@11.1.17` — provides `HttpService` integration
- `@nestjs/core@11.1.17` — lifecycle hooks
- `mongodb@7.1.1` — native driver
- `rxjs@7.8.2` — for Observable-based HTTP (used by @nestjs/axios)

---

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| `@nestjs/schedule` + `@Cron()` | Raw `setInterval` | Never for this project — `setInterval` does not integrate with NestJS lifecycle, skips graceful shutdown, and doesn't support cron expression syntax |
| `@nestjs/schedule` + `@Cron()` | `node-cron` (standalone) | Only if you're not using NestJS; `@nestjs/schedule` IS `node-cron` wrapped for NestJS, so there's no reason to use the raw package directly |
| `@nestjs/axios` / `axios` | `node-fetch` / `undici` | `undici` is the Node.js built-in HTTP client in Node 22 and is a valid alternative if you want zero extra dependencies. Use `undici`'s `fetch()` if you want to avoid the axios dep entirely; however `@nestjs/axios` provides better DI integration and interceptor support for debugging |
| `@nestjs/config` | Direct `process.env` access | Only acceptable in throwaway scripts; `ConfigService` keeps configuration centralized and makes injection/mocking in tests possible |
| MongoDB native driver | Mongoose | DO NOT use Mongoose. It enforces a single-connection, schema-per-model pattern. This service connects to dozens of databases discovered at runtime. The native driver's `client.db(dbName)` API is the correct shape for this use case. |

---

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| Mongoose | Designed for single-database, schema-first workflows. `MongooseModule.forRoot()` registers one connection; using `forFeature()` per dynamic DB would require dynamic module gymnastics that fight the framework. The native driver already installed does this trivially. | `mongodb` native driver (already installed) |
| `@nestjs/mongoose` | Couples you to Mongoose's connection model, which is wrong for multi-database enumeration | `mongodb` native driver with a custom `MongoService` provider |
| `bull` / `BullMQ` | Overkill queue infrastructure for what is effectively a polling loop. Would require Redis, adds operational complexity, and provides no benefit over a simple cron-triggered loop with a single retry. | `@nestjs/schedule` with inline retry logic |
| `@nestjs/microservices` | Adds pub/sub complexity. This service has no consumer role — it only polls and dispatches. | Plain HTTP (`@nestjs/axios`) |
| `cron` (raw npm package) | `@nestjs/schedule` wraps this — use the wrapper so NestJS manages the lifecycle | `@nestjs/schedule` |
| Dynamic cron expressions from DB | Storing cron interval in MongoDB creates a chicken-and-egg problem — you need the cron running to read from Mongo, but the cron interval controls when you connect. | Read `CRON_INTERVAL` from env via `@nestjs/config` |

---

## Stack Patterns by Variant

**For the configurable cron interval via `CRON_INTERVAL` env var:**
- Use `SchedulerRegistry` from `@nestjs/schedule` to create a dynamic `CronJob` at `onModuleInit()` time rather than a static `@Cron()` decorator
- Because `@Cron()` requires a literal string or enum, not a runtime value from `ConfigService`
- Pattern: `schedulerRegistry.addCronJob(name, new CronJob(interval, handler))`

**For connecting to multiple MongoDB databases:**
- Maintain a single `MongoClient` instance per replica set (one connection string for the whole set)
- Call `client.db(dbName)` for each discovered database — this reuses the same connection pool
- Never create per-database `MongoClient` instances — connection pool exhaustion risk at dozens of DBs

**For duplicate-dispatch prevention:**
- Use MongoDB's `findOneAndUpdate` with a filter on `runStatus: "waiting"` AND `waitUntil: { $lte: new Date() }` with `$set: { runStatus: "queued" }` and `returnDocument: "before"` or use atomic update with a conditional
- This is the correct primitive — no external locking service needed

**For the 1-minute retry:**
- Do NOT use `setTimeout` (runs in process memory, lost on restart)
- Instead: Leave `runStatus: "waiting"` on HTTP failure; the next cron tick will retry it naturally
- If a shorter-than-cron-interval retry is required: use `setTimeout` scoped to the service instance — acceptable because this is an in-process background service, not a durable queue

---

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| `@nestjs/schedule@4.x` | `@nestjs/common@11.x`, `@nestjs/core@11.x` | Schedule v4 targets NestJS 11. Do NOT use `@nestjs/schedule@3.x` — it targets NestJS 10. Verify on npm before installing. |
| `@nestjs/config@3.x` | `@nestjs/common@11.x` | Config v3 is compatible with NestJS 11. |
| `@nestjs/axios@3.x` | `@nestjs/common@11.x`, `axios@1.x`, `rxjs@7.x` | Axios v3 targets NestJS 11. Note: `rxjs@7.8.2` is already installed. |
| `mongodb@7.1.1` | Node.js 22, no NestJS peer dep | Version 7.x is the current major (confirmed installed). No NestJS integration layer needed — used directly via a custom provider. |
| TypeScript `5.9.3` | `module: "nodenext"` | Already configured. Note: `nodenext` requires explicit `.js` extensions in relative imports at the TypeScript source level — this is a known NestJS 11 configuration and the scaffold already handles it. |

---

## Sources

- `/root/time-trigger-api/pnpm-lock.yaml` — authoritative installed versions for NestJS 11.1.17, mongodb 7.1.1, TypeScript 5.9.3, Jest 30.3.0 (HIGH confidence — exact lock file)
- `/root/time-trigger-api/node_modules/@nestjs/common/package.json` — confirmed NestJS 11.1.17 (HIGH confidence)
- `/root/time-trigger-api/node_modules/mongodb/package.json` — confirmed mongodb 7.1.1 (HIGH confidence)
- `/root/time-trigger-api/package.json` — confirmed base dependency set, pnpm toolchain (HIGH confidence)
- `/root/time-trigger-api/tsconfig.json` — confirmed `nodenext` module resolution, `emitDecoratorMetadata: true`, `target: ES2023` (HIGH confidence)
- `@nestjs/schedule` version compatibility with NestJS 11 — MEDIUM confidence (training data: v4.x is the NestJS 11-compatible major; **verify on npm before installing**)

---

*Stack research for: Time Trigger API — cron-based webhook dispatcher with multi-MongoDB monitoring*
*Researched: 2026-03-25*
