# Architecture Research

**Domain:** Cron-based multi-database webhook dispatch service
**Researched:** 2026-03-25
**Confidence:** HIGH — NestJS scheduler patterns and MongoDB native driver multi-database patterns are well-established; no novel or speculative techniques required for this system.

## Standard Architecture

### System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        NestJS Application                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                    SchedulerModule                        │   │
│  │  @Cron / setInterval (CRON_INTERVAL env var)              │   │
│  └──────────────────────┬───────────────────────────────────┘   │
│                         │ triggers                              │
│  ┌──────────────────────▼───────────────────────────────────┐   │
│  │                   RunDispatchService                       │   │
│  │  - Orchestrates one full execution cycle                  │   │
│  │  - Iterates over eligible databases                       │   │
│  │  - Enforces time-of-day gate                              │   │
│  │  - Delegates to sub-services                              │   │
│  └───┬──────────────────┬───────────────────────────────────┘   │
│      │                  │                                        │
│  ┌───▼──────────┐  ┌────▼───────────────────────────────────┐   │
│  │ DatabaseScan │  │           WebhookDispatchService        │   │
│  │  Service     │  │  - POSTs run document to webhook URL    │   │
│  │  - Lists DBs │  │  - Handles HTTP success / failure       │   │
│  │  - Filters   │  │  - Executes single retry after 1 min    │   │
│  │    by        │  └────────────────────────────────────────┘   │
│  │  collections │                                               │
│  └───┬──────────┘                                               │
│      │                                                          │
│  ┌───▼──────────────────────────────────────────────────────┐   │
│  │                     MongoService                          │   │
│  │  - Owns single MongoClient (shared across all DBs)        │   │
│  │  - Provides Db handles by name                            │   │
│  │  - listDatabases(), getCollection() helpers               │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│                     External Boundaries                          │
│  ┌──────────────────────┐   ┌────────────────────────────────┐  │
│  │  MongoDB Replica Set │   │  Webhook Endpoints (HTTP POST) │  │
│  │  (3 nodes, N client  │   │  ("Processador de Runs" per DB)│  │
│  │   databases)         │   └────────────────────────────────┘  │
│  └──────────────────────┘                                       │
└─────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Notes |
|-----------|----------------|-------|
| **SchedulerModule** | Fires the cron trigger on configurable interval | Uses `@nestjs/schedule`; interval set from `CRON_INTERVAL` env var at startup |
| **RunDispatchService** | Orchestrates the full dispatch cycle end-to-end | Entry point of each cron tick; owns the per-database iteration loop |
| **DatabaseScanService** | Discovers and filters eligible client databases | Lists all MongoDB databases; keeps only those with `runs`, `webhooks`, and `vars` collections |
| **WebhookDispatchService** | Sends a single run to its webhook; handles retry | Issues HTTP POST; on failure, waits 1 minute and retries once; writes result back to MongoDB |
| **MongoService** | Manages the single shared `MongoClient` | Opened once at app startup; provides `Db` handles on demand; closed on app shutdown |
| **ConfigService** | Reads and validates environment variables | Wraps `process.env`; surfaces `MONGODB_URI`, `CRON_INTERVAL`; validated at startup |

## Recommended Project Structure

```
src/
├── scheduler/
│   └── scheduler.module.ts      # Imports @nestjs/schedule, registers RunDispatchService as cron handler
├── dispatch/
│   ├── dispatch.module.ts       # Feature module
│   ├── run-dispatch.service.ts  # Orchestrates one cycle: scan DBs → gate time → dispatch runs
│   └── webhook-dispatch.service.ts  # HTTP POST to webhook, retry logic, status update
├── database/
│   ├── database.module.ts       # Global module
│   ├── mongo.service.ts         # MongoClient lifecycle (connect/disconnect), Db accessors
│   └── database-scan.service.ts # listDatabases(), filter by required collections
├── config/
│   └── config.service.ts        # MONGODB_URI, CRON_INTERVAL, env validation
└── main.ts                      # Bootstrap, graceful shutdown hook
```

### Structure Rationale

- **scheduler/:** Isolates the cron trigger setup. The only concern here is "when to fire" — nothing else. Makes it trivial to change schedule mechanism later.
- **dispatch/:** Owns the business logic. Two services with a clear split: `run-dispatch` is the coordinator; `webhook-dispatch` owns I/O to the external HTTP endpoint. Testing each independently is straightforward.
- **database/:** Owns all MongoDB concerns. A single `MongoService` singleton means one connection pool shared across all operations. `DatabaseScanService` only handles discovery/filtering — it never touches run documents.
- **config/:** Central validation at startup prevents runtime surprises from missing env vars. Keeps service constructors clean.

## Architectural Patterns

### Pattern 1: Single MongoClient, Multiple Db Handles

**What:** One `MongoClient` instance is created at app startup (via `OnModuleInit`) and destroyed at shutdown (via `OnModuleDestroy`). Per-database access is done by calling `client.db(dbName)` — no separate connections per database.

**When to use:** Any system that needs to address multiple databases on the same MongoDB deployment. The native driver's connection pool handles multiplexing; opening separate clients per database wastes sockets and adds handshake latency.

**Trade-offs:** Single point of connection failure (acceptable — if Mongo is down, all databases are unreachable anyway). Connection pool is shared so large parallel query volumes must be monitored against `maxPoolSize`.

**Example:**
```typescript
@Injectable()
export class MongoService implements OnModuleInit, OnModuleDestroy {
  private client: MongoClient;

  async onModuleInit() {
    this.client = new MongoClient(process.env.MONGODB_URI);
    await this.client.connect();
  }

  async onModuleDestroy() {
    await this.client.close();
  }

  db(name: string): Db {
    return this.client.db(name);
  }

  async listDatabases(): Promise<string[]> {
    const result = await this.client.db('admin').command({ listDatabases: 1 });
    return result.databases.map((d: { name: string }) => d.name);
  }
}
```

### Pattern 2: Re-read Config Collections Every Cycle

**What:** `vars` and `webhooks` documents are fetched fresh on every cron tick, not cached. Each database's `vars` collection is queried for `morningLimit`/`nightLimit` and `webhooks` is queried for the "Processador de Runs" URL immediately before processing that database's runs.

**When to use:** When external systems can mutate configuration at any time and stale config would cause incorrect behavior (dispatching runs outside allowed hours, or to a stale URL).

**Trade-offs:** Adds 2 extra MongoDB reads per database per cycle. For dozens of databases this is tens of milliseconds of extra latency — negligible compared to the cron interval. Correctness wins.

**Example:**
```typescript
async procesDatabase(dbName: string): Promise<void> {
  const db = this.mongoService.db(dbName);
  const vars = await db.collection('vars').findOne({});
  const webhookDoc = await db.collection('webhooks').findOne({ botIdentifier: { $exists: true } });

  if (!this.isWithinTimeWindow(vars?.morningLimit, vars?.nightLimit)) return;

  const runs = await db.collection('runs').find({
    runStatus: 'waiting',
    waitUntil: { $lte: new Date() },
  }).toArray();

  for (const run of runs) {
    await this.webhookDispatchService.dispatch(db, run, webhookDoc.url);
  }
}
```

### Pattern 3: Optimistic Status Update with Single Retry

**What:** On a successful webhook POST, the run document is immediately updated to `runStatus: "queued"` with `queuedAt: new Date()`. On failure, a single retry fires after 1 minute (via `setTimeout`). If the retry also fails, the run is left as `runStatus: "waiting"` — it will be picked up again on the next cron tick.

**When to use:** When duplicate dispatch is a hard constraint (idempotency via status field) and retry complexity must be kept minimal.

**Trade-offs:** The 1-minute retry window means a run may be dispatched slightly late. However the next cron cycle would also pick it up, so the retry is purely a best-effort fast-path. The `runStatus: "queued"` guard prevents double dispatch.

**Example:**
```typescript
async dispatch(db: Db, run: Document, webhookUrl: string): Promise<void> {
  const success = await this.post(webhookUrl, run);
  if (success) {
    await db.collection('runs').updateOne(
      { _id: run._id },
      { $set: { runStatus: 'queued', queuedAt: new Date() } },
    );
    return;
  }
  // Single retry after 1 minute
  setTimeout(async () => {
    const retrySuccess = await this.post(webhookUrl, run);
    if (retrySuccess) {
      await db.collection('runs').updateOne(
        { _id: run._id },
        { $set: { runStatus: 'queued', queuedAt: new Date() } },
      );
    }
    // If retry fails: leave as "waiting", next cron cycle will pick up
  }, 60_000);
}
```

## Data Flow

### Cron Cycle Flow

```
CRON_INTERVAL fires
    |
    v
RunDispatchService.runCycle()
    |
    v
DatabaseScanService.getEligibleDatabases()
    |  -- listDatabases() on MongoClient
    |  -- filter: has runs + webhooks + vars collections
    |
    v
For each eligible database:
    |
    +-- db.collection('vars').findOne({})         -- read morningLimit, nightLimit
    +-- isWithinTimeWindow()?                     -- skip if outside hours
    +-- db.collection('webhooks').findOne(...)    -- read "Processador de Runs" URL
    +-- db.collection('runs').find({              -- find eligible runs
    |       runStatus: "waiting",
    |       waitUntil: { $lte: now }
    |   })
    |
    v
For each eligible run:
    |
    +-- WebhookDispatchService.dispatch(run, url)
    |       -- HTTP POST run document to webhook URL
    |       -- SUCCESS: UPDATE run runStatus="queued", queuedAt=now
    |       -- FAILURE: setTimeout(retry, 60s)
    |                   retry: HTTP POST again
    |                   SUCCESS: UPDATE run runStatus="queued"
    |                   FAILURE: leave as "waiting" (next cycle picks up)
    v
Cycle complete — wait for next cron tick
```

### Status Lifecycle

```
[External writer sets]        [This service sets]    [External processor sets]
  runStatus: "waiting"   -->   runStatus: "queued"  -->  runStatus: "done"
  waitUntil: <timestamp>       queuedAt: <timestamp>
```

### Key Data Flows

1. **Config discovery:** `vars` document read per database per cycle — time gate values always current. No in-process caching.
2. **Webhook URL resolution:** `webhooks` document read per database per cycle — URL always current. URL identified by the `"Processador de Runs"` key within the document.
3. **Run status guard:** `runStatus: "waiting"` filter in MongoDB query is the primary idempotency guard. Once updated to `"queued"`, a run will not appear in future queries.
4. **Database eligibility filter:** Collection presence check runs on every cycle. A database that gains the required collections mid-operation becomes eligible on the next cycle.

## Scaling Considerations

This is a headless background service, not a request-serving API. "Scale" here means: more databases to process, more runs per database, or shorter cron intervals.

| Scale | Architecture Adjustments |
|-------|--------------------------|
| Tens of databases, low run volume | Sequential per-database iteration is fine. Simple and debuggable. |
| Hundreds of databases OR high run volume | Process databases in parallel batches (`Promise.allSettled` with concurrency limit). Keep batch size configurable. |
| Sub-minute cron intervals with many DBs | Add a cycle-already-running guard (`isRunning` flag) so overlapping cycles don't pile up if one cycle takes longer than the interval. |

### Scaling Priorities

1. **First bottleneck:** Sequential database iteration. With 50+ databases each requiring 3 MongoDB reads before any dispatching starts, latency accumulates. Fix: parallelise database processing with a concurrency cap (e.g. 10 at a time via `p-limit`).
2. **Second bottleneck:** MongoDB connection pool exhaustion under parallel load. Fix: configure `maxPoolSize` on `MongoClient` options to match expected concurrency.

## Anti-Patterns

### Anti-Pattern 1: One MongoClient Per Database

**What people do:** Open a new `MongoClient(uri + '/' + dbName)` for each client database, then close it after processing.

**Why it's wrong:** Creates a new TCP connection + TLS handshake + auth round-trip per database per cycle. With dozens of databases this becomes hundreds of connection setups per minute, slamming the replica set.

**Do this instead:** One shared `MongoClient` connected to the replica set. Use `client.db(dbName)` to switch databases on the same connection pool.

### Anti-Pattern 2: Caching vars/webhooks Between Cycles

**What people do:** Read `morningLimit`, `nightLimit`, and webhook URL once at startup (or at the first cycle), store them in service fields, and reuse across cycles.

**Why it's wrong:** External systems change these values at runtime. A stale `morningLimit` causes runs to be dispatched outside allowed hours. A stale webhook URL silently dispatches to the wrong endpoint.

**Do this instead:** Read `vars` and `webhooks` at the start of each database's processing block within every cycle. The additional MongoDB reads are cheap.

### Anti-Pattern 3: Blocking the Event Loop During Per-DB Iteration

**What people do:** Use a synchronous `for` loop with `await` inside, processing 50 databases sequentially before returning.

**Why it's wrong:** A single slow database (network hiccup, large cursor) blocks all other databases for the entire cycle duration. With a short cron interval, cycles start piling up.

**Do this instead:** Use `Promise.allSettled` with a concurrency limiter. Each database processes independently; one slow database does not delay others.

### Anti-Pattern 4: Skipping the Cycle-Running Guard

**What people do:** Fire the cron tick function unconditionally regardless of whether the previous cycle is still executing.

**Why it's wrong:** If a cycle takes longer than `CRON_INTERVAL` (e.g., slow webhooks + retries in flight), the next tick launches a second parallel cycle that reads the same `runStatus: "waiting"` documents before the first cycle finishes updating them. This creates duplicate dispatches.

**Do this instead:** Gate the cycle function with an `isRunning` boolean flag. Skip the tick if a cycle is already in progress. Log a warning so the operator knows the interval is too short.

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| MongoDB Replica Set | Native driver `MongoClient` with replica set URI | URI includes all 3 nodes (`host1:port,host2:port,host3:port`); driver handles primary election automatically |
| Webhook Endpoints | HTTP POST via Node `fetch` (Node 18+) or `axios` | One unique URL per client database; URL read from `webhooks` collection each cycle |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| SchedulerModule → RunDispatchService | Direct method call (NestJS DI) | Scheduler calls `runCycle()` on the service; no events or queues needed |
| RunDispatchService → DatabaseScanService | Direct method call (injected dependency) | Returns list of eligible DB names; pure query, no side effects |
| RunDispatchService → WebhookDispatchService | Direct method call (injected dependency) | Passes `Db` handle, run document, and webhook URL; service owns all I/O for that run |
| RunDispatchService → MongoService | Direct method call (injected dependency) | Calls `db(name)` to get a `Db` handle; no raw `MongoClient` access outside this service |
| WebhookDispatchService → MongoService | Direct method call (injected dependency) | Updates run status after dispatch; uses the `Db` handle passed in from the orchestrator |

## Build Order

The component dependency graph drives implementation order:

```
1. ConfigService          -- no dependencies; needed by everything
2. MongoService           -- depends on ConfigService; needed by database + dispatch layers
3. DatabaseScanService    -- depends on MongoService
4. WebhookDispatchService -- depends on MongoService (for status updates)
5. RunDispatchService     -- depends on DatabaseScanService + WebhookDispatchService
6. SchedulerModule        -- depends on RunDispatchService; wired last
```

Build in this order: each component can be implemented and tested before the ones that depend on it exist. The scheduler is wired last because it is the trigger layer — everything it calls must be complete first.

## Sources

- NestJS official documentation: Task Scheduling (`@nestjs/schedule`) — patterns confirmed from training data (HIGH confidence for NestJS 11 patterns)
- MongoDB Node.js Driver documentation: multi-database access via single `MongoClient`, `listDatabases` command — well-established pattern (HIGH confidence)
- Project requirements: `/root/time-trigger-api/.planning/PROJECT.md` — all component responsibilities and data flows derived directly from stated requirements

---
*Architecture research for: cron-based multi-database webhook dispatch service*
*Researched: 2026-03-25*
