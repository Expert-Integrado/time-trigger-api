# Feature Research

**Domain:** Cron-based webhook dispatch API (headless background service)
**Researched:** 2026-03-25
**Confidence:** HIGH — requirements are fully specified in PROJECT.md; domain patterns are well-established

## Feature Landscape

### Table Stakes (Users Expect These)

Features the system must have to function at all. Missing any of these means the system fails its core purpose.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Cron-based polling loop | The entire trigger model depends on periodic evaluation; without it nothing fires | LOW | NestJS `@nestjs/schedule` or native `setInterval`; interval driven by `CRON_INTERVAL` env var |
| MongoDB connection + multi-DB enumeration | Data lives in MongoDB; must discover all client DBs dynamically | MEDIUM | Native driver required; must list all databases and filter by collection presence (`runs`, `webhooks`, `vars`) |
| Run eligibility detection | Core query: `runStatus: "waiting"` AND `waitUntil <= now()` | LOW | Standard MongoDB query; must be indexed on `runStatus` + `waitUntil` for performance across dozens of DBs |
| Time-of-day gating | Per-client `morningLimit` / `nightLimit` from `vars` collection; skip runs outside window | LOW | Read `vars` fresh every cycle (can change externally); compare current UTC/local hour against bounds |
| Webhook dispatch (HTTP POST) | Sends run document to "Processador de Runs" endpoint | LOW | Standard `fetch` or `axios`; POST full run document as JSON body |
| Status transition on success | `runStatus: "waiting"` → `"queued"`, set `queuedAt` timestamp | LOW | Single atomic update after confirmed webhook success; prevents re-dispatch |
| Single-retry on failure | Retry once after 1 minute; leave as `"waiting"` if retry also fails | MEDIUM | Requires delayed retry without blocking main cycle; use `setTimeout` or NestJS scheduler |
| Config re-read every cycle | `vars` and `webhooks` re-read each execution; external systems may change them at any time | LOW | No caching of config; always fetch fresh from MongoDB before processing |
| Database filtering by collection presence | Skip DBs missing `runs`, `webhooks`, or `vars` collections | LOW | List collections per DB and check for required set; avoids errors on partial-setup DBs |
| Environment variable configuration | `MONGODB_URI`, `CRON_INTERVAL` — all runtime config via env | LOW | Fail fast at startup if required env vars are missing |
| Duplicate dispatch prevention | Once `runStatus: "queued"`, run must never be dispatched again | MEDIUM | Query filter naturally excludes queued runs; status update must be atomic (no race between find and update) |
| Docker container operation | Must run as a headless Docker container | LOW | Dockerfile + `.env` injection; no interactive runtime dependencies |
| Startup env validation | Fail loudly at boot if `MONGODB_URI` is missing rather than crashing mid-cycle | LOW | Validate required env vars before NestJS bootstrap completes |
| Structured logging | Observability into which DBs were processed, which runs were dispatched, failures | LOW | NestJS Logger or Pino; log cycle start/end, per-DB counts, errors; critical for a headless service |

### Differentiators (Competitive Advantage)

Features that go beyond the minimum and deliver meaningful operational value.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Per-DB concurrency (parallel processing) | Process all client databases concurrently instead of serially; avoids one slow DB blocking others | MEDIUM | `Promise.allSettled()` over all eligible DBs; critical once you have dozens of DBs; individual DB errors must not abort the cycle |
| Graceful shutdown handling | SIGTERM/SIGINT causes the current cycle to complete before exit; prevents mid-cycle partial dispatches | LOW | NestJS lifecycle hooks (`onApplicationShutdown`); set a "shutting down" flag checked before each cycle |
| Health check endpoint | `GET /health` returns 200 with last-cycle stats; enables Docker HEALTHCHECK and monitoring integration | LOW | Minimal NestJS controller; expose last run time, DB count, errors — already have Express via NestJS |
| Idempotent status update (atomic find-and-update) | Use `findOneAndUpdate` with `{runStatus: "waiting"}` filter in the update query itself, not a separate find then update | LOW | Prevents race conditions if multiple instances ever run; a run can only transition if it is still `"waiting"` at update time |
| FUP time-window support | `vars` already contains `morningLimitFUP` / `nightLimitFUP` in some DBs; supporting a second time window for follow-up runs adds no new infrastructure | LOW | Only relevant for future run types; extend time-gate logic to check secondary window when present |
| Cycle metrics / summary log | Log a single summary line per cycle: DBs scanned, runs dispatched, runs skipped, errors — high signal-to-noise ratio | LOW | Accumulate counters during cycle, log at end; zero overhead |
| Configurable retry delay | `RETRY_DELAY_MS` env var (default 60000); allows tuning without code change | LOW | Simple env var; low complexity, high operational value |

### Anti-Features (Commonly Requested, Often Problematic)

Features to explicitly NOT build for this system.

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Web UI / dashboard | Visibility into what's running, which runs are queued | This is a headless background service; a UI is a separate product concern and adds deploy complexity | Export structured logs to an external log aggregator (e.g., Datadog, Grafana Loki) where dashboards already exist |
| REST API for run management (create/edit/delete runs) | "Manage everything in one place" appeal | Runs are written by other systems; this service is read-and-dispatch only; adding write APIs blurs ownership and creates coupling | Other systems own the `runs` collection; they write directly to MongoDB |
| Persistent retry queue (Redis/Bull) | "More reliable retries" | The existing retry model (leave as `"waiting"` → picked up next cycle) IS the persistent queue; MongoDB `runs` collection serves this role; adding Redis is unnecessary complexity | The single in-process retry handles transient failures; subsequent cycles handle persistent failures naturally |
| Webhook response processing | "Act on webhook response data" | Out of scope per PROJECT.md; the downstream system owns what happens after the run is received | Downstream webhook handler owns its own response logic |
| Authentication / public endpoints | "Secure the API" | This is an internal service with no public endpoints; adding auth creates operational overhead for zero security gain | Run inside private network / Docker network; no public surface exposed |
| Per-run retry configuration | "Fine-grained retry policies per run type" | Premature complexity; single retry policy handles 95% of real failures (transient network, downstream restart) | Re-evaluate if retry failure patterns emerge after deployment |
| Caching of `vars` / `webhooks` | "Reduce MongoDB reads" | Caching breaks the requirement to always use the latest config; a single collection read per cycle is negligible | Read fresh every cycle as specified |
| Multiple scheduler instances / distributed locking | "High availability" | For this use case (dozens of DBs, lightweight dispatch), a single reliable instance with Docker restart policy is sufficient; distributed locking adds Zookeeper/Redis dependency | Docker `restart: always`; if true HA is needed, revisit with evidence |

## Feature Dependencies

```
[MongoDB Connection]
    └──requires──> [Multi-DB Enumeration]
                       └──requires──> [Database Filtering by Collection Presence]
                                          └──requires──> [Run Eligibility Detection]
                                                             └──requires──> [Time-of-Day Gating]
                                                                                └──requires──> [Webhook Dispatch]
                                                                                                   └──requires──> [Status Transition on Success]
                                                                                                   └──requires──> [Single-Retry on Failure]

[Cron Polling Loop]
    └──drives──> [MongoDB Connection]
    └──drives──> [Config Re-Read Every Cycle]

[Status Transition on Success]
    └──depends-on──> [Duplicate Dispatch Prevention (atomic update)]

[Startup Env Validation]
    └──gates──> [Cron Polling Loop] (must pass before loop starts)

[Per-DB Concurrency]
    └──enhances──> [Multi-DB Enumeration] (parallelizes it)
    └──requires──> [Error isolation per DB] (one DB failure must not abort others)

[Health Check Endpoint]
    └──enhances──> [Structured Logging] (exposes same data via HTTP)

[FUP Time-Window Support]
    └──extends──> [Time-of-Day Gating]
```

### Dependency Notes

- **Run Eligibility Detection requires MongoDB Connection:** The query `{runStatus: "waiting", waitUntil: {$lte: now}}` executes against the `runs` collection of each discovered DB.
- **Status Transition requires Duplicate Dispatch Prevention:** The `findOneAndUpdate` pattern that gates the update on `{runStatus: "waiting"}` must be established before dispatch logic ships, not retrofitted.
- **Config Re-Read Every Cycle is a design constraint, not a feature:** It must be baked into the polling loop architecture from day one; caching cannot be introduced later without a policy review.
- **Per-DB Concurrency conflicts with serial error assumptions:** If parallelizing, per-DB error handling must be explicit (`Promise.allSettled`, not `Promise.all`) — a failing DB must never halt other DBs.

## MVP Definition

### Launch With (v1)

Minimum viable product — what's needed for the service to fulfill its core purpose reliably.

- [ ] Cron polling loop driven by `CRON_INTERVAL` env var — without this, nothing triggers
- [ ] MongoDB multi-DB discovery with collection-presence filtering — discovers all eligible client DBs
- [ ] Run eligibility query: `runStatus: "waiting"` AND `waitUntil <= now()` — identifies what to dispatch
- [ ] Time-of-day gate using `morningLimit` / `nightLimit` from `vars` — per-client scheduling window
- [ ] Webhook POST to "Processador de Runs" URL from `webhooks` collection — core dispatch action
- [ ] Atomic status transition: `waiting` → `queued` + `queuedAt` timestamp — prevents re-dispatch
- [ ] Single retry after 1 minute on failure, leave as `waiting` if retry fails — handles transient errors
- [ ] Config re-read every cycle (no caching of `vars`/`webhooks`) — respects external config changes
- [ ] Startup env validation for `MONGODB_URI` — fails fast rather than crashing mid-cycle
- [ ] Structured logging per cycle — minimum operational observability for a headless service
- [ ] Docker container with env-based config — delivery target

### Add After Validation (v1.x)

Features to add once core dispatch loop is proven stable.

- [ ] Per-DB concurrent processing (`Promise.allSettled`) — add when timing data shows serial processing creates lag across DB count
- [ ] Graceful shutdown handling — add when first unexpected mid-cycle termination is observed in production
- [ ] Health check endpoint (`GET /health`) — add when Docker HEALTHCHECK or external monitoring is configured
- [ ] Cycle summary metrics log — add immediately if log volume from per-run logging becomes noisy

### Future Consideration (v2+)

Features to defer until post-deployment evidence warrants them.

- [ ] FUP time-window support (`morningLimitFUP` / `nightLimitFUP`) — defer until a client DB actually requires it and the run type is defined
- [ ] Configurable retry delay via env var — defer until the 1-minute default proves wrong in production
- [ ] Idempotent multi-instance dispatch — defer unless a second instance is ever deployed; current single-instance model with `restart: always` is sufficient

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Cron polling loop | HIGH | LOW | P1 |
| MongoDB multi-DB enumeration + filtering | HIGH | MEDIUM | P1 |
| Run eligibility detection | HIGH | LOW | P1 |
| Time-of-day gating | HIGH | LOW | P1 |
| Webhook dispatch (HTTP POST) | HIGH | LOW | P1 |
| Atomic status transition (waiting → queued) | HIGH | LOW | P1 |
| Duplicate dispatch prevention | HIGH | LOW | P1 |
| Single-retry on failure | HIGH | MEDIUM | P1 |
| Config re-read every cycle | HIGH | LOW | P1 |
| Startup env validation | MEDIUM | LOW | P1 |
| Structured logging | HIGH | LOW | P1 |
| Docker deployment | HIGH | LOW | P1 |
| Per-DB concurrent processing | MEDIUM | LOW | P2 |
| Graceful shutdown | MEDIUM | LOW | P2 |
| Health check endpoint | MEDIUM | LOW | P2 |
| Cycle summary log | MEDIUM | LOW | P2 |
| FUP time-window support | LOW | LOW | P3 |
| Configurable retry delay | LOW | LOW | P3 |

**Priority key:**
- P1: Must have for launch — service cannot reliably fulfill its purpose without it
- P2: Should have — operational quality, add early in v1.x
- P3: Nice to have — defer until evidence demands it

## Competitor Feature Analysis

This is an internal headless dispatch service, not a commercial product competing in a market. The meaningful comparison is against alternative implementation approaches rather than competing products.

| Feature | DIY setInterval | NestJS @nestjs/schedule | Commercial (Inngest, Trigger.dev) | Our Approach |
|---------|-----------------|------------------------|-----------------------------------|--------------|
| Cron execution | Manual, no lifecycle management | Decorator-driven, lifecycle-aware | Managed, durable, at-least-once | NestJS schedule module — lifecycle management without external dependency |
| Multi-tenant / multi-DB | Manual loop | Manual loop | Per-tenant queues | Manual `Promise.allSettled` loop per DB — fits the "discover from MongoDB" model |
| Retry logic | Manual setTimeout | Manual setTimeout | Built-in with backoff | Single in-process setTimeout — matches project's explicitly simple retry spec |
| Persistent job state | Must build | Must build | Built-in (Redis/DB backed) | MongoDB `runs` collection IS the persistent state — no separate job store needed |
| Observability | None by default | NestJS Logger | Full dashboard | Structured logs via NestJS Logger — sufficient for internal service |
| Deployment | Process + env | Docker-friendly | SaaS or self-hosted complexity | Docker container — fits stated constraints |

## Sources

- PROJECT.md — authoritative requirements source; all table-stakes features map directly to stated requirements
- `.planning/codebase/CONCERNS.md` — identifies implementation gaps (no scheduling, no DB layer, no env validation) that inform complexity estimates
- Domain knowledge: cron/webhook dispatch patterns (at-most-once vs at-least-once semantics, atomic state transitions, fan-out polling across multi-tenant data) — HIGH confidence based on established patterns

---
*Feature research for: Cron-based webhook dispatch API (Time Trigger API)*
*Researched: 2026-03-25*
