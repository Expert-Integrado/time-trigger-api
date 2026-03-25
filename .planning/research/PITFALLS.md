# Pitfalls Research

**Domain:** Cron-based multi-database webhook dispatch API (NestJS + MongoDB + HTTP webhooks)
**Researched:** 2026-03-25
**Confidence:** HIGH — drawn from established failure patterns in distributed cron systems, MongoDB native driver behavior, and HTTP dispatch reliability

---

## Critical Pitfalls

### Pitfall 1: Duplicate Dispatch via Race Condition (No Atomic Status Transition)

**What goes wrong:**
Two cron cycles overlap — the first cycle finds a run as `waiting`, posts to the webhook, but before it writes `queued`, the second cycle also finds the same run as `waiting` and posts again. The run is dispatched twice.

**Why it happens:**
Developers check status and then update status as two separate MongoDB operations. Between the read and the write, another cron cycle (or a restart) can see the same document. NestJS `@Cron` does not prevent overlapping executions if the previous tick is still running.

**How to avoid:**
Use `findOneAndUpdate` with a filter that includes `runStatus: "waiting"` as an atomic claim operation. The update sets `runStatus` to an intermediate state (e.g., `"processing"`) before the HTTP call. Only dispatch if the update returns a document (meaning this cycle won the race).

```
db.collection('runs').findOneAndUpdate(
  { _id: runId, runStatus: 'waiting' },
  { $set: { runStatus: 'processing', claimedAt: new Date() } },
  { returnDocument: 'after' }
)
```

If no document is returned, another cycle already claimed it — skip.

**Warning signs:**
- Downstream webhook reports receiving the same run payload twice
- Logs show two cycles querying overlapping time windows
- `queuedAt` timestamps are duplicated across webhook delivery logs
- Cron interval is shorter than the time to process all databases

**Phase to address:**
Core dispatch logic phase — must be the very first implementation concern before any real MongoDB is touched.

---

### Pitfall 2: Cron Fires While Previous Tick Is Still Running (No Concurrency Guard)

**What goes wrong:**
If processing dozens of databases takes 8 seconds and the cron fires every 10 seconds, over time the system accumulates inflight cycles. Under load or network latency spikes, cycles pile up, causing memory growth, connection pool exhaustion, and duplicate processing.

**Why it happens:**
NestJS `@Cron` (via `@nestjs/schedule`) fires on schedule regardless of whether the previous invocation completed. There is no built-in mutex or "skip if busy" behavior.

**How to avoid:**
Implement a simple boolean lock flag (`isRunning`) checked at the start of each cron handler. If `true`, log and return immediately. Reset the flag in a `finally` block to handle errors. This is safe for a single-instance service.

```typescript
if (this.isRunning) {
  this.logger.warn('Cron tick skipped — previous cycle still running');
  return;
}
this.isRunning = true;
try {
  await this.processAllDatabases();
} finally {
  this.isRunning = false;
}
```

**Warning signs:**
- Memory usage grows slowly over time during high-load periods
- MongoDB connection count creeps up beyond expected maximum
- Logs show cron firing with no "cycle complete" log before the next fire
- Webhook timeouts cascade into accumulated cycle backlog

**Phase to address:**
Core dispatch logic phase — add the guard before wiring up the real cron handler.

---

### Pitfall 3: Stuck Runs in "Processing" State After a Crash

**What goes wrong:**
Pitfall 1's fix introduces an intermediate `processing` state. If the service crashes or is restarted after claiming a run but before updating it to `queued` or reverting to `waiting`, that run is permanently stuck in `processing`. On every subsequent cycle it is invisible (the query filters for `waiting` only) and never dispatched.

**Why it happens:**
An intermediate claim state has no TTL or recovery path. The service uses it correctly during normal operation but provides no mechanism to recover from ungraceful shutdown.

**How to avoid:**
Either:
1. Add a `claimedAt` timestamp to `processing` documents and include a recovery query at startup (or in each cycle) that resets runs where `runStatus: "processing"` and `claimedAt < (now - safeTimeout)` back to `waiting`.
2. Skip the intermediate state entirely — use optimistic update + post-hoc idempotency check (if webhook returns 200 and DB update fails, retry the DB update; the webhook must be idempotent).

Option 1 is simpler for this architecture. Safe timeout should be longer than the maximum expected webhook round-trip (e.g., 5 minutes).

**Warning signs:**
- Run count in `waiting` drops but downstream system shows fewer deliveries than expected
- Runs with `runStatus: "processing"` and old `claimedAt` timestamps accumulate in MongoDB
- Service was restarted and some clients report missing runs

**Phase to address:**
Core dispatch logic phase — handle in the same code that introduces the atomic claim.

---

### Pitfall 4: MongoDB Connection Pool Exhaustion Across Dozens of Databases

**What goes wrong:**
The service creates one MongoClient connection per database, or opens new connections per cycle. With 30+ client databases, each holding connections open, the MongoDB replica set hits its connection limit. Queries begin timing out or failing.

**Why it happens:**
Developers instantiate `client.db('database-name')` and think it creates a separate connection. It does not — `db()` on a single client returns a handle to a different logical database over the same connection pool. But if developers create one `MongoClient` instance per database, or reconnect each cycle, they exhaust the pool.

**How to avoid:**
Use a single `MongoClient` instance connected to the replica set. Call `client.db(dbName)` to get per-database handles. The native driver manages the connection pool internally. Never create a new `MongoClient` per database or per cycle.

Set explicit pool options appropriate to the workload:
```
maxPoolSize: 20
minPoolSize: 5
serverSelectionTimeoutMS: 5000
```

**Warning signs:**
- MongoDB logs show connection count growing past `maxPoolSize`
- `MongoServerSelectionError` or timeout errors during cycles
- Memory usage scales linearly with number of databases processed
- Error: "connection refused" or "too many connections" from replica set nodes

**Phase to address:**
MongoDB connection setup phase — get the singleton pattern right before any database iteration logic is written.

---

### Pitfall 5: Incorrect Time-Zone Handling Causes Window Misses or Wrong-Hour Dispatches

**What goes wrong:**
The `morningLimit` and `nightLimit` values in `vars` are intended as local hour boundaries (e.g., hour 8 and hour 22 in the client's timezone). If the service compares them against `new Date().getHours()` in UTC, runs may be dispatched at the wrong real-world time for clients in non-UTC timezones. Worse, the logic may silently pass when it should block, or block when it should pass.

**Why it happens:**
JavaScript's `Date.getHours()` returns the local hour of the machine running the process. Inside Docker with no `TZ` env var, this is UTC. Developers assume "now's hour" is meaningful without pinning a timezone.

**How to avoid:**
Explicitly handle timezone in the `vars` comparison. If `morningLimit`/`nightLimit` are always in a single consistent timezone (e.g., UTC or America/Sao_Paulo), document and enforce that. Set `TZ=UTC` in the Docker environment and normalize all hour comparisons to UTC. Never rely on the container's implicit locale.

If clients can have per-database timezones in future, store a `timezone` field in `vars` now and use a library like `luxon` for all time-window math.

**Warning signs:**
- Runs dispatch at unexpected hours in production but tests pass locally
- Clients in Brazil report runs executing at 3am (UTC midnight)
- Time-window checks pass correctly in local development but not in Docker
- No `TZ` env var set in `Dockerfile` or `docker-compose.yml`

**Phase to address:**
Core dispatch logic phase — pin the timezone and test the window logic explicitly before deploying.

---

### Pitfall 6: Webhook HTTP Timeout Not Set — One Slow Endpoint Blocks All Databases

**What goes wrong:**
A single slow or unresponsive webhook endpoint causes the HTTP POST to hang indefinitely. Because the cycle awaits the HTTP call before moving to the next database, one bad endpoint can stall the entire cycle for all client databases until Node's default socket timeout (often 2+ minutes) triggers.

**Why it happens:**
Node's `fetch` / `axios` / `http` module has no default request timeout. Developers write `await axios.post(url, payload)` without a timeout option and assume reasonable behavior.

**How to avoid:**
Always set an explicit timeout on every outbound HTTP call. 10–15 seconds is appropriate for internal webhook endpoints. Use `AbortController` with `fetch` or the `timeout` option in `axios`.

```typescript
await axios.post(url, payload, { timeout: 10_000 });
```

Consider also processing databases concurrently with `Promise.allSettled` rather than sequentially, so one slow database cannot block others.

**Warning signs:**
- Cron cycle duration varies wildly (1s vs. 90s) for the same number of databases
- One client's webhook URL changed and now cycles take much longer
- `isRunning` flag stays true for many minutes, causing subsequent cycles to be skipped
- No timeout-related errors in logs despite known-slow endpoints

**Phase to address:**
HTTP dispatch phase — set timeouts before any real webhook calls.

---

### Pitfall 7: Re-reading Webhooks/Vars Per Cycle Is Correct but Partial Reads Corrupt State

**What goes wrong:**
The design correctly re-reads `vars` and `webhooks` each cycle to pick up config changes. But if the read fails (MongoDB transient error, missing document, malformed data), the code silently uses a `null` or `undefined` value for the webhook URL or hour limits — and either throws a cryptic error mid-cycle or dispatches to an empty/wrong URL.

**Why it happens:**
Developers write `const webhook = await col.findOne(...)` and then immediately use `webhook.url` without null-checking. A database that recently had its `webhooks` document deleted now throws `TypeError: Cannot read property 'url' of null`.

**How to avoid:**
Validate every read from `vars` and `webhooks` before using the values. If a required document is missing or malformed, skip that database and log a structured warning (not a thrown error that crashes the cycle). Required fields: `morningLimit`, `nightLimit`, webhook URL for "Processador de Runs".

**Warning signs:**
- A single database's missing document crashes processing for all subsequent databases in the cycle
- TypeErrors in logs referencing `.url` or `.morningLimit` on null
- Some client databases silently stop receiving dispatches after a config change

**Phase to address:**
Core dispatch logic phase — validation logic for every config read, tested with null/missing-document scenarios.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Sequential database processing (no concurrency) | Simpler to reason about | Cycle time grows linearly with database count; 30 DBs × 200ms = 6s per cycle | MVP only — migrate to `Promise.allSettled` before production load |
| Hard-coded "Processador de Runs" webhook name | No config needed | Breaks if webhook document schema changes; other webhook types need separate code | MVP only — extract to constant or config |
| No structured logging | Faster to implement | Production debugging is very hard; can't correlate run IDs across cycles | Never — add structured logging from day one |
| Single retry with fixed 1-minute delay in-process | Simple | If service restarts during the 1-minute wait, the retry is lost | Acceptable per spec — just ensure it is a non-blocking setTimeout, not a blocking sleep |
| No dead-letter / alerting for persistent failures | No infra needed | Silent data loss — runs stuck as `waiting` forever without anyone knowing | Never in production without some form of alert |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| MongoDB replica set connection string | Connecting to a single node (`mongodb://177.x.x.x:27017`) instead of all replica set members | Include all three nodes in the URI with `replicaSet` param: `mongodb://host1:27017,host2:27018,host3:27019/?replicaSet=rs0` |
| MongoDB `listDatabases` | Calling it without the `nameOnly: true` flag returns full stats per database — slow | Use `client.db('admin').admin().listDatabases({ nameOnly: true })` |
| MongoDB `listCollections` | Using a separate query per database to check collection existence is N+1 | Use `db.listCollections().toArray()` once per database and filter in memory |
| HTTP webhook POST | Sending the full MongoDB document including `_id` as ObjectId — some endpoints reject non-serializable types | Explicitly serialize the document: `JSON.parse(JSON.stringify(doc))` or map to a plain object before POST |
| NestJS `@Cron` with `CRON_INTERVAL` env var | `@Cron()` decorator requires the expression at decoration time; env vars are not available at class decoration | Use `CronExpression` constants or inject the schedule via `SchedulerRegistry` dynamically at module init |
| Docker TZ | Assuming container uses local timezone | Set `ENV TZ=UTC` in Dockerfile and document that all time limits in `vars` must be UTC hours |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Sequential database processing | Cycle time grows with client count; at 30 DBs × avg 300ms = 9s/cycle; at 50 DBs approaches cron interval | Use `Promise.allSettled` with bounded concurrency (e.g., `p-limit` at 10 concurrent) | At ~20 databases with any network latency |
| Per-cycle `listDatabases` with full stats | Each cycle does a metadata-heavy admin query | Use `nameOnly: true` flag | Noticeable overhead at all scales — just always use `nameOnly` |
| Unbounded `find` on `runs` collection | If `runs` accumulates millions of documents, a query for `runStatus: "waiting"` without an index does a full collection scan | Create compound index: `{ runStatus: 1, waitUntil: 1 }` | Without index, degrades at ~10k+ documents per collection |
| MongoDB connection per cycle | Connection setup latency adds per-cycle; at scale, connection exhaustion | Singleton `MongoClient` with persistent connection | Any scale — always use singleton |
| Logging entire run document at DEBUG level | Large run documents flood log aggregation, disk, or memory | Log only `_id`, `runStatus`, `waitUntil` per run | At production log volumes |

---

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Logging MongoDB connection string (including credentials) | Credentials leak to log aggregation systems | Never log `process.env.MONGODB_URI`; use a sanitized string in startup logs |
| Logging full webhook URL (may contain auth tokens as query params) | Tokens leak to logs | Log only the webhook hostname or a truncated URL |
| No validation of webhook URLs from `webhooks` collection | If the collection is compromised, the service becomes an SSRF vector — can be directed to internal network endpoints | Validate that webhook URLs match an expected pattern (e.g., `https://` prefix, allowlisted domain suffix) before POSTing |
| Trusting webhook response bodies | Malicious response body is parsed and logged or processed | Discard response body after checking status code; never `JSON.parse` untrusted webhook responses |

---

## "Looks Done But Isn't" Checklist

- [ ] **Duplicate prevention:** Verify via `findOneAndUpdate` atomic claim — not just a read-then-update pair
- [ ] **Concurrency guard:** Verify `isRunning` flag is reset in a `finally` block — not just the happy path
- [ ] **Stuck processing recovery:** Verify that runs with old `claimedAt` + `processing` status are reset at startup
- [ ] **Timezone:** Verify `TZ=UTC` is set in Dockerfile AND that `vars` documents use UTC hours — test with a non-UTC system clock
- [ ] **HTTP timeouts:** Verify every `axios.post` or `fetch` call has an explicit `timeout` — search codebase for unguarded HTTP calls
- [ ] **Replica set connection string:** Verify all three replica set nodes are in `MONGODB_URI` — not just one
- [ ] **Null guard on vars/webhooks reads:** Verify that a database with no `vars` document skips gracefully — not crashes
- [ ] **Index on runs:** Verify `{ runStatus: 1, waitUntil: 1 }` index exists on every client database's `runs` collection (or that the service creates it on startup)
- [ ] **Cron dynamic config:** Verify `CRON_INTERVAL` env var is actually applied at runtime — not silently ignored because `@Cron()` was called at decoration time
- [ ] **Retry is non-blocking:** Verify the 1-minute retry uses `setTimeout` asynchronously — not `await sleep(60000)` which blocks the event loop

---

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Duplicate dispatches sent | MEDIUM | Identify duplicated run IDs from webhook receiver logs; coordinate with downstream to deduplicate or revert; add `findOneAndUpdate` atomic claim to prevent recurrence |
| Runs stuck in `processing` | LOW | Run a one-time MongoDB update: `db.runs.updateMany({ runStatus: 'processing', claimedAt: { $lt: new Date(Date.now() - 300000) } }, { $set: { runStatus: 'waiting' } })` across affected databases |
| Connection pool exhausted | MEDIUM | Restart service; verify singleton MongoClient pattern; check for leaked connections in code; add `maxPoolSize` cap |
| Runs dispatched at wrong hours (timezone bug) | LOW-MEDIUM | Identify affected time window; check if runs need re-dispatch; fix TZ env var and redeploy |
| Webhook endpoint hanging / cycle stall | LOW | Identify the slow webhook from logs; add HTTP timeout; restart service; stuck `isRunning` flag resets on restart |
| `vars` or `webhooks` document missing | LOW | Log makes the problem visible; no code change needed if null guard is in place; fix the MongoDB document externally |

---

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Duplicate dispatch (no atomic claim) | Core dispatch logic | Integration test: two concurrent cycles both see same `waiting` run — only one dispatches |
| Overlapping cron cycles | Core dispatch logic | Load test: set short interval, verify logs show "skipped" messages, no duplicate dispatches |
| Stuck `processing` runs after crash | Core dispatch logic | Kill service mid-cycle in dev, restart, verify runs return to `waiting` within one cycle |
| Connection pool exhaustion | MongoDB setup phase | Connect to all test databases simultaneously; monitor connection count stays bounded |
| Timezone window errors | Core dispatch logic | Unit test `isWithinWindow()` with UTC edge cases; run service in Docker with explicit `TZ=UTC` and verify |
| Missing HTTP timeout | HTTP dispatch phase | Point one webhook URL at a server that never responds; verify cycle completes within timeout + buffer |
| Null on missing vars/webhooks | Core dispatch logic | Integration test: run against a database with no `vars` document; verify cycle skips it with a warning, not a crash |
| Dynamic cron interval from env | Cron setup phase | Set `CRON_INTERVAL` to a non-default value in Docker env, verify actual fire interval matches |

---

## Sources

- MongoDB Node.js driver documentation (connection pooling, `findOneAndUpdate`, `listDatabases`) — HIGH confidence, based on official driver behavior
- NestJS `@nestjs/schedule` known limitation: `@Cron()` decorator resolves at class load time, not at runtime — HIGH confidence, directly observable from NestJS source
- Node.js `fetch`/`axios` default timeout behavior (no timeout by default) — HIGH confidence, documented behavior
- JavaScript `Date.getHours()` UTC vs. local behavior in Docker — HIGH confidence, standard JS/Docker behavior
- Distributed cron duplicate execution patterns — HIGH confidence, well-documented problem class in job scheduling systems
- MongoDB replica set connection string requirements — HIGH confidence, from official MongoDB documentation

---

*Pitfalls research for: cron-based multi-database webhook dispatch API (NestJS + MongoDB)*
*Researched: 2026-03-25*
