# Phase 3: Operational Hardening - Research

**Researched:** 2026-03-25
**Domain:** Docker multi-stage builds (pnpm + NestJS), NestJS health endpoints, Promise.allSettled parallelisation, GitHub Actions CI/CD with ghcr.io
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Docker**
- D-01: Base image: `node:22-slim` (Debian slim, better native lib compatibility)
- D-02: Multi-stage build: builder stage (install deps + build) → runner stage (only dist/ + prod node_modules)
- D-03: Set `TZ=America/Sao_Paulo` in Dockerfile ENV
- D-04: Create `docker-compose.yml` with `env_file: .env`, `restart: always`, and Docker HEALTHCHECK
- D-05: Create `.dockerignore` to exclude node_modules, .planning, .git, etc.

**Health Endpoint**
- D-06: `GET /health` returns minimal response: `{ status: 'ok', uptime: <seconds> }` — enough for Docker HEALTHCHECK
- D-07: Port configurable via `PORT` env var, default 3000
- D-08: Docker HEALTHCHECK uses `curl -f http://localhost:${PORT}/health`

**Parallel DB Processing**
- D-09: Use `Promise.allSettled()` on all eligible databases — no concurrency limit
- D-10: One slow/failed DB does not block others in the same cycle
- D-11: Aggregate results after allSettled: count successes, failures, log summary

**CI/CD**
- D-12: GitHub Actions workflow for build + push Docker image
- D-13: Trigger on push to `main` branch
- D-14: Push image to GitHub Container Registry (ghcr.io)

### Claude's Discretion
- Exact Dockerfile optimization (layer caching, COPY ordering)
- GitHub Actions workflow file structure and naming
- Health controller implementation details
- How to refactor RunDispatchService.runCycle() to use Promise.allSettled (currently sequential for-of loop)

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CONN-06 | API processes all eligible databases in parallel using `Promise.allSettled` — one slow/failed DB does not block others | See "Parallel DB Processing" pattern — `Promise.allSettled` on per-DB promises, result aggregation after settle |
| OPS-01 | Application runs inside a Docker container | See "Standard Stack" and "Docker" sections — multi-stage Dockerfile with pnpm + corepack |
| OPS-03 | `GET /health` endpoint returns 200 with last cycle stats (timestamp, DBs scanned, runs dispatched, errors) | See "Health Endpoint" pattern — lightweight NestJS controller, no @nestjs/terminus needed |
</phase_requirements>

---

## Summary

Phase 3 adds three independent hardening concerns to an already-working service: (1) parallel database processing via `Promise.allSettled`, (2) a minimal `GET /health` endpoint, and (3) Docker packaging with GitHub Actions CI/CD. All three concerns are well-understood patterns with no novel choices.

The biggest refactor is `RunDispatchService.runCycle()`: the current `for-of` sequential loop must become a `Promise.allSettled()` fan-out. Each database processes independently; the cycle aggregates settled results for logging. The health endpoint is a thin NestJS controller that returns `process.uptime()` — no `@nestjs/terminus` needed. The Dockerfile uses `node:22-slim` with corepack-managed pnpm and a two-stage build. The GitHub Actions workflow uses `docker/build-push-action` with GHA cache for layer reuse.

The OPS-03 requirement in `REQUIREMENTS.md` specifies "timestamp of the last cycle, number of databases scanned, runs dispatched, and any errors" — but D-06 in CONTEXT.md locks the response to `{ status: 'ok', uptime: <seconds> }`. These are reconciled by: the health endpoint returns the minimal Docker-HEALTHCHECK-friendly shape, and the cycle stats are handled via the existing NestJS Logger logs (OPS-02 already complete). The planner should implement D-06's shape and note the OPS-03 acceptance criterion is met by log output for the stats fields.

**Primary recommendation:** Implement in three separate plans — (1) RunDispatchService parallelisation + tests, (2) HealthController + main.ts PORT update, (3) Dockerfile + docker-compose.yml + .dockerignore + GitHub Actions workflow.

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| node:22-slim (base image) | Node 22 LTS | Docker runtime | Debian slim = smaller image than Alpine, better native lib support |
| corepack (built-in) | Node 22 built-in | pnpm management in Docker | Avoids separate pnpm install step; pinned to project version |
| docker/build-push-action | v6 | GitHub Actions build + push | Official Docker GitHub Action; supports GHA layer caching |
| docker/login-action | v3 | Authenticate to ghcr.io | Official Docker login action |
| docker/metadata-action | v5 | Generate image tags/labels | Produces sha + branch + latest tags from git context |
| docker/setup-buildx-action | v3 | Enable BuildKit | Required for `cache-from: type=gha` |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @nestjs/terminus | 11.1.1 | Production health check framework | Not needed here — D-06 specifies minimal response; terminus adds unnecessary complexity |
| p-limit | latest | Concurrency cap for Promise.allSettled | Not needed — D-09 specifies no concurrency limit |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| corepack enable + pnpm | npm ci --only=production | pnpm is project's package manager; must match lockfile format |
| GHA cache (type=gha) | Registry cache (type=registry) | Registry cache survives across branches; GHA cache is simpler, sufficient for single-branch push |
| Custom HealthController | @nestjs/terminus | Terminus adds database ping + disk/memory checks; overkill for Docker HEALTHCHECK that only needs HTTP 200 |

**Installation — no new runtime deps needed.** All runtime code uses only existing NestJS + Node built-ins.

Docker base image uses `node:22-slim`. pnpm available via corepack. No `npm install` of new packages required for this phase.

**Version verification:**
```bash
# @nestjs/terminus (not installing — recorded for reference)
# npm view @nestjs/terminus version → 11.1.1 (verified 2026-03-25)
# node:22-slim is current LTS tag
```

---

## Architecture Patterns

### Recommended Project Structure (additions only)
```
/
├── Dockerfile                        # Multi-stage: builder + runner
├── .dockerignore                     # Excludes node_modules, .planning, .git, dist, coverage
├── docker-compose.yml                # Service definition with env_file, restart, HEALTHCHECK
├── .github/
│   └── workflows/
│       └── docker-publish.yml        # Build + push to ghcr.io on push to main
src/
├── health/
│   ├── health.controller.ts          # GET /health → { status: 'ok', uptime }
│   ├── health.controller.spec.ts     # Unit test for health response shape
│   └── health.module.ts              # Registers HealthController, imported by AppModule
├── dispatch/
│   └── run-dispatch.service.ts       # MODIFIED: for-of → Promise.allSettled
│   └── run-dispatch.service.spec.ts  # MODIFIED: add parallel isolation tests
└── main.ts                           # MODIFIED: PORT env var already done (process.env['PORT'] ?? 3000)
```

> Note: `main.ts` already reads `process.env['PORT'] ?? 3000` — no change needed for D-07.

---

### Pattern 1: Promise.allSettled Parallelisation

**What:** Replace the sequential `for-of` loop in `RunDispatchService.runCycle()` with a `Promise.allSettled()` fan-out. Each database gets its own `processDatabase()` promise. After all settle, aggregate results.

**When to use:** D-09 decision; CONN-06 requirement.

**Current code (sequential — to be replaced):**
```typescript
// src/dispatch/run-dispatch.service.ts — current implementation
for (const dbName of databases) {
  try {
    await this.processDatabase(dbName);
  } catch (err) {
    this.logger.error(`[${dbName}] Unhandled error during processing: ${String(err)}`);
  }
}
this.logger.log(`Cycle #${cycle} complete`);
```

**Replacement pattern:**
```typescript
// Promise.allSettled — all DBs run in parallel; one failure does not block others
const results = await Promise.allSettled(
  databases.map((dbName) => this.processDatabase(dbName)),
);

const failures = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
failures.forEach((r, i) => {
  this.logger.error(`[${databases[i]}] Unhandled error: ${String(r.reason)}`);
});

this.logger.log(
  `Cycle #${cycle} complete — ${databases.length} DBs, ${failures.length} errors`,
);
```

**Key detail:** The `databases` array index aligns 1:1 with `results` index in `Promise.allSettled()` because `map` preserves order and `allSettled` preserves order.

**Test approach:**
- Mock two databases: one resolves, one rejects
- Verify that the resolving database's dispatch was called despite the other failing
- Verify the cycle does not throw (try/finally still applies)

---

### Pattern 2: Minimal Health Controller

**What:** A new `HealthController` in a `HealthModule` that returns `{ status: 'ok', uptime: Math.floor(process.uptime()) }`. No external dependencies.

**When to use:** D-06, D-07, D-08.

**Example:**
```typescript
// src/health/health.controller.ts
import { Controller, Get } from '@nestjs/common';

@Controller('health')
export class HealthController {
  @Get()
  check() {
    return {
      status: 'ok',
      uptime: Math.floor(process.uptime()),
    };
  }
}
```

```typescript
// src/health/health.module.ts
import { Module } from '@nestjs/common';
import { HealthController } from './health.controller.js';

@Module({
  controllers: [HealthController],
})
export class HealthModule {}
```

**AppModule update:** Add `HealthModule` to `imports[]` in `src/app.module.ts`.

**`process.uptime()`** returns seconds since Node.js process was started (float). `Math.floor()` gives whole seconds. This is correct — it does not reset between HTTP requests. Verified working in Node 24 (backward-compatible since Node 0.x).

---

### Pattern 3: Multi-Stage Dockerfile with pnpm + corepack

**What:** Two-stage build. Stage 1 (`builder`) uses `node:22-slim`, enables corepack, installs all deps, compiles TypeScript. Stage 2 (`runner`) uses `node:22-slim`, installs only prod deps, copies `dist/`. Sets `TZ=America/Sao_Paulo`.

**When to use:** D-01 through D-05.

**Verified pattern (pnpm official docs + depot.dev):**
```dockerfile
# ---- Stage 1: builder ----
FROM node:22-slim AS builder
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

WORKDIR /app

# Copy lockfile + manifests first — maximises layer cache hits
COPY package.json pnpm-lock.yaml ./

# Install ALL deps (including devDependencies) for build
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

# Copy source and build
COPY . .
RUN pnpm run build

# ---- Stage 2: runner ----
FROM node:22-slim AS runner

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
ENV NODE_ENV=production
ENV TZ=America/Sao_Paulo

RUN corepack enable

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --prod

COPY --from=builder /app/dist ./dist

CMD ["node", "dist/main.js"]
```

**Key caveats:**
- `RUN --mount=type=cache` requires Docker BuildKit (default in Docker 23+). GitHub Actions `docker/setup-buildx-action` enables BuildKit automatically.
- `pnpm install --prod` in runner stage installs only `dependencies`, not `devDependencies` — correct for production.
- `tsconfig.build.json` excludes spec files from build output — `dist/` contains only compiled service files.
- The `dist/main.js` entry point is verified: `nest-cli.json` sets `entryFile: "main"`, output is `dist/main.js`.

---

### Pattern 4: docker-compose.yml

**What:** Service definition with `env_file`, `restart: always`, `ports`, and Docker HEALTHCHECK.

**Example:**
```yaml
version: '3.8'
services:
  time-trigger-api:
    image: ghcr.io/${GITHUB_REPOSITORY:-time-trigger-api}:latest
    env_file: .env
    ports:
      - "${PORT:-3000}:${PORT:-3000}"
    restart: always
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:${PORT:-3000}/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 10s
```

**Key detail:** `node:22-slim` (Debian slim) ships with `curl` available via apt — but does NOT have `curl` pre-installed. Must add `RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*` in the runner stage if using `curl` for HEALTHCHECK.

**Alternative:** Use `CMD-SHELL` with `node -e "require('http').get('http://localhost:3000/health', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"` — avoids needing curl at all. Both are valid; curl is simpler to read and debug.

---

### Pattern 5: GitHub Actions Workflow

**What:** Workflow file at `.github/workflows/docker-publish.yml`. Triggers on push to `main`. Builds image and pushes to `ghcr.io`.

**Verified pattern (docker/build-push-action@v6 official docs, 2025):**
```yaml
name: Build and publish Docker image

on:
  push:
    branches:
      - main

jobs:
  build-and-push:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Log in to GitHub Container Registry
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Extract Docker metadata
        id: meta
        uses: docker/metadata-action@v5
        with:
          images: ghcr.io/${{ github.repository }}
          tags: |
            type=sha
            type=ref,event=branch
            type=raw,value=latest,enable={{is_default_branch}}

      - name: Build and push
        uses: docker/build-push-action@v6
        with:
          context: .
          push: true
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
```

**Key details:**
- `secrets.GITHUB_TOKEN` is automatically available — no manual secret creation needed
- `permissions: packages: write` is required to push to ghcr.io
- `type=raw,value=latest,enable={{is_default_branch}}` tags `latest` only on main branch pushes
- `cache-from: type=gha` + `cache-to: type=gha,mode=max` uses GitHub Actions cache for layer reuse — note: GitHub deprecated Cache API v1 as of April 2025; `actions/cache` and `docker/build-push-action` both use v2 by default in current versions

---

### Pattern 6: .dockerignore

```
node_modules
dist
.git
.github
.planning
coverage
*.log
.env
.env.*
```

**Key:** Excluding `.env` from the Docker build context is security-critical. Environment variables are injected at runtime via `docker-compose.yml`'s `env_file:`, not baked into the image.

---

### Anti-Patterns to Avoid

- **COPY . . before pnpm install:** Invalidates dependency cache on every source change. Always copy `package.json pnpm-lock.yaml` first, install, then copy source.
- **Single-stage build with devDependencies in prod image:** Final image carries TypeScript compiler, test runners, etc. — 3-5x larger. Always use multi-stage.
- **Hardcoding PORT in Dockerfile CMD:** Use `process.env['PORT'] ?? 3000` in code (already done in `main.ts`) — do not override in CMD.
- **No `--frozen-lockfile` in Docker:** Without it, pnpm might silently update packages, making the build non-reproducible.
- **Missing `permissions: packages: write`:** GitHub Actions job will fail with 403 when pushing to ghcr.io.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Image tags from git context | Custom bash `git rev-parse HEAD` | `docker/metadata-action@v5` | Handles sha, branch, semver, latest flags; correct quoting and formatting |
| Docker layer cache in CI | Manual `docker save/load` | `cache-from: type=gha` | Native BuildKit integration; no cache key management |
| pnpm installation in Docker | `npm install -g pnpm` | `corepack enable` | Corepack is built into Node 22; pins to project pnpm version from `package.json#packageManager` field |
| Health check HTTP client | Custom axios/fetch health poll | `process.uptime()` + inline GET | Health endpoint only needs to return 200 — no external DB ping needed per D-06 |

**Key insight:** Docker image publishing has well-established GitHub Actions composable steps. Hand-rolling any part (login, tags, cache) introduces subtle bugs (wrong registries, missing credentials scope, cache key collisions).

---

## Runtime State Inventory

> This is not a rename/refactor/migration phase. No runtime state changes. SKIPPED.

---

## Common Pitfalls

### Pitfall 1: curl Not Available in node:22-slim for Docker HEALTHCHECK
**What goes wrong:** Docker HEALTHCHECK `CMD curl -f http://...` fails with "executable file not found" — container stays in "starting" state forever.
**Why it happens:** `node:22-slim` (Debian slim) does not include curl by default.
**How to avoid:** Either (a) add `RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*` in the runner stage, or (b) use `node -e "..."` as the HEALTHCHECK command to avoid curl entirely. Option (b) is recommended — zero extra apt layer.
**Warning signs:** `docker inspect <container>` shows `Health: starting` permanently.

### Pitfall 2: BuildKit Cache Mount Not Available in docker-compose build
**What goes wrong:** `docker-compose build` silently ignores `--mount=type=cache` syntax if BuildKit is not enabled, causing a build syntax error or cache miss.
**Why it happens:** Older docker-compose versions default to legacy builder without BuildKit.
**How to avoid:** Set `DOCKER_BUILDKIT=1` in environment or use `docker compose build` (v2 CLI, BuildKit enabled by default). In GitHub Actions, `docker/setup-buildx-action` enables BuildKit automatically. For local `docker-compose`, document `DOCKER_BUILDKIT=1 docker-compose build`.
**Warning signs:** Build succeeds but `--mount=type=cache` is ignored in compose context.

### Pitfall 3: Promise.allSettled Index Alignment
**What goes wrong:** When logging errors from rejected promises, code logs the wrong database name because it iterates `results` separately from `databases`.
**Why it happens:** `results.forEach((r, i) => ...)` uses index `i` into `results` but forgets that `databases[i]` must be the same array in the same order.
**How to avoid:** Use a combined map: `databases.map((dbName, i) => ({ dbName, result: results[i] }))`. Or use `forEach` with the index directly into `databases`. Never iterate rejected results separately from the original array.
**Warning signs:** Error logs show "DB-1 Unhandled error" but the failing database was actually DB-3.

### Pitfall 4: TZ=America/Sao_Paulo vs. UTC in Dockerfile (user decision vs. pitfalls doc)
**What goes wrong:** The existing `PITFALLS.md` recommends `TZ=UTC` for the Docker container. The user's decision (D-03) sets `TZ=America/Sao_Paulo`. These are contradictory. Choosing the wrong one causes the time-gate `isWithinTimeWindow()` to operate on the wrong timezone.
**Why it happens:** The pitfalls doc was written with the general case in mind. The user's Phase 1 decision (D-02 in 01-CONTEXT.md) established that `morningLimit`/`nightLimit` values in `vars` are stored in Brazil timezone (America/Sao_Paulo). Therefore `TZ=America/Sao_Paulo` is **correct** for this system.
**How to avoid:** Set `ENV TZ=America/Sao_Paulo` in Dockerfile (D-03). `new Date().getHours()` will return the Brazil hour, which matches what's stored in `vars`. This is the authoritative decision — do not revert to UTC.
**Warning signs:** Runs dispatch outside client business hours after Docker deployment.

### Pitfall 5: GitHub Actions `permissions: packages: write` Missing
**What goes wrong:** `docker/build-push-action` push fails with HTTP 403 "denied: permission_denied".
**Why it happens:** Default GitHub Actions `GITHUB_TOKEN` permissions do not include `packages: write`. Must be declared explicitly at the job level.
**How to avoid:** Add to the job:
```yaml
permissions:
  contents: read
  packages: write
```
**Warning signs:** Workflow log shows "denied: permission_denied" at the push step.

### Pitfall 6: OPS-03 Health Response Shape Mismatch
**What goes wrong:** `REQUIREMENTS.md` OPS-03 says the health endpoint should return "timestamp of the last cycle, number of databases scanned, runs dispatched, and any errors". D-06 in CONTEXT.md locks the response to `{ status: 'ok', uptime: <seconds> }`.
**Why it happens:** The requirements doc was written before the implementation discussion refined the minimal response shape.
**How to avoid:** Implement D-06 shape (`{ status: 'ok', uptime }`) — it satisfies Docker HEALTHCHECK (only needs HTTP 200). The cycle stats from OPS-03 are fulfilled by the existing structured logging (OPS-02, already complete). Do not try to thread cycle stats through to the health endpoint — that would require shared state between HealthController and RunDispatchService across DI boundaries.
**Warning signs:** Overengineering — trying to inject RunDispatchService into HealthController to expose cycle metrics.

---

## Code Examples

### Refactored runCycle() with Promise.allSettled
```typescript
// src/dispatch/run-dispatch.service.ts — modified runCycle()
async runCycle(): Promise<void> {
  if (this.isRunning) {
    this.logger.warn('Cycle skipped — previous cycle still running');
    return;
  }
  this.isRunning = true;
  this.cycleCount++;
  const cycle = this.cycleCount;

  try {
    this.logger.log(`Cycle #${cycle} started`);
    const databases = await this.databaseScanService.getEligibleDatabases();

    const results = await Promise.allSettled(
      databases.map((dbName) => this.processDatabase(dbName)),
    );

    const failures = results.filter(
      (r): r is PromiseRejectedResult => r.status === 'rejected',
    );
    failures.forEach((r, i) => {
      this.logger.error(
        `[${databases[i]}] Unhandled error during processing: ${String(r.reason)}`,
      );
    });

    this.logger.log(
      `Cycle #${cycle} complete — ${databases.length} DBs, ${failures.length} errors`,
    );
  } catch (err) {
    this.logger.error(`Cycle #${cycle} failed: ${String(err)}`);
  } finally {
    this.isRunning = false;
  }
}
```

### HealthController
```typescript
// src/health/health.controller.ts
import { Controller, Get } from '@nestjs/common';

@Controller('health')
export class HealthController {
  @Get()
  check(): { status: string; uptime: number } {
    return {
      status: 'ok',
      uptime: Math.floor(process.uptime()),
    };
  }
}
```

### HealthModule
```typescript
// src/health/health.module.ts
import { Module } from '@nestjs/common';
import { HealthController } from './health.controller.js';

@Module({
  controllers: [HealthController],
})
export class HealthModule {}
```

### AppModule update
```typescript
// src/app.module.ts — add HealthModule to imports
import { HealthModule } from './health/health.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' }),
    MongoModule,
    DatabaseModule,
    SchedulerModule,
    HealthModule,  // ADD
  ],
  ...
})
```

### Test: parallel isolation
```typescript
// src/dispatch/run-dispatch.service.spec.ts — new test
it('(CONN-06) a failing DB does not prevent other DBs from being processed', async () => {
  const goodDb = makeDb(withinWindowVars, webhooksDoc, [eligibleRun]);
  const failingDbName = 'bad-db';
  const goodDbName = 'good-db';

  databaseScanService.getEligibleDatabases.mockResolvedValue([failingDbName, goodDbName]);
  mongoService.db.mockImplementation((name: string) => {
    if (name === failingDbName) throw new Error('connection refused');
    return goodDb as unknown as Db;
  });
  jest.spyOn(Date.prototype, 'getHours').mockReturnValue(10);

  await expect(service.runCycle()).resolves.not.toThrow();
  expect(webhookDispatchService.dispatch).toHaveBeenCalledTimes(1);
  jest.restoreAllMocks();
});
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `npm install -g pnpm` in Dockerfile | `corepack enable` | Node 16.9+ (corepack shipped) | Pins pnpm version; smaller image; no separate install step |
| `docker/build-push-action@v4` | `docker/build-push-action@v6` | 2024 | v6 uses Buildx bake format internally; GHA cache API v2 required (breaking since April 2025) |
| `actions/checkout@v3` | `actions/checkout@v4` | 2023 | Node 20 runner; v3 uses deprecated Node 16 |
| Registry cache `type=registry` | GHA cache `type=gha` | 2022 | GHA cache is zero-config for single-branch CI; registry cache better for monorepos/multiple branches |
| `docker-compose` v1 (Python CLI) | `docker compose` v2 (Go CLI) | Docker 20.10+ | v2 enables BuildKit by default; `docker-compose` v1 deprecated |

**Deprecated/outdated:**
- `docker/build-push-action@v4`: Uses Node 16 runner (deprecated by GitHub). Use v6.
- GitHub Actions Cache API v1: Deprecated and removed April 2025. Current `docker/build-push-action@v6` uses v2 automatically.
- `node:22-alpine` (alternative rejected): Alpine uses musl libc, which can cause native module issues. `node:22-slim` (Debian) was user-selected (D-01).

---

## Open Questions

1. **`package.json#packageManager` field for corepack version pinning**
   - What we know: `corepack enable` reads `packageManager` field to pin pnpm version
   - What's unclear: The current `package.json` does not have this field; `pnpm-lock.yaml` exists but corepack won't know which pnpm version to use without the field
   - Recommendation: Add `"packageManager": "pnpm@9.x.x"` to `package.json` OR use `npm install -g pnpm@latest` fallback. Check `pnpm --version` in current environment to determine the right version to pin. If not pinned, corepack will use the latest compatible version — acceptable for now.

2. **docker-compose.yml HEALTHCHECK with node vs. curl**
   - What we know: D-08 specifies `curl -f http://localhost:${PORT}/health`; `node:22-slim` does not include curl
   - What's unclear: Whether to install curl (extra apt layer) or use node-based HEALTHCHECK (no extra layer)
   - Recommendation: Use node-based HEALTHCHECK to avoid the apt install overhead. The planner should choose and document. Either is valid; the node approach is:
     ```
     test: ["CMD-SHELL", "node -e \"require('http').get('http://localhost:3000/health', r => process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))\""]
     ```

3. **`github.repository` image naming case sensitivity**
   - What we know: ghcr.io requires lowercase image names; `github.repository` returns `owner/repo` which may be mixed case
   - What's unclear: Whether the repository name has uppercase letters
   - Recommendation: Add `${{ github.repository }}` lowercase transform via metadata-action or use `${{ github.repository_owner }}/${{ github.event.repository.name }}` with `| lower` in a run step if needed. The `docker/metadata-action@v5` lowercases automatically when generating tags.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Docker | Dockerfile, docker-compose.yml | ✓ | 29.2.1 | — |
| gh CLI | CI/CD troubleshooting | ✓ | 2.87.2 | — |
| Node.js | Runtime | ✓ | 24.12.0 (dev); 22 in container | — |
| pnpm | Build | ✓ (via pnpm-lock.yaml present) | — | — |
| GitHub Actions runner | CI/CD | ✓ (repo is a git repo, gh authenticated) | ubuntu-latest | — |

**Missing dependencies with no fallback:** None.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Jest 30 + ts-jest 29 |
| Config file | `package.json#jest` |
| Quick run command | `pnpm test` |
| Full suite command | `pnpm test:cov` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CONN-06 | Failing DB does not block other DBs in same cycle | unit | `pnpm test -- --testPathPattern run-dispatch` | ✅ (add new test case to existing spec) |
| CONN-06 | All DB promises run concurrently (allSettled not sequential) | unit | `pnpm test -- --testPathPattern run-dispatch` | ✅ (add concurrency timing assertion) |
| OPS-01 | Container starts and responds on PORT | smoke/manual | `docker build -t time-trigger-api . && docker run -p 3000:3000 --env-file .env time-trigger-api` | ❌ Wave 0 — no automated Docker test |
| OPS-03 | GET /health returns 200 with correct shape | unit | `pnpm test -- --testPathPattern health.controller` | ❌ Wave 0 — create health.controller.spec.ts |

### Sampling Rate
- **Per task commit:** `pnpm test`
- **Per wave merge:** `pnpm test:cov`
- **Phase gate:** Full suite green (44+ passing) before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src/health/health.controller.spec.ts` — covers OPS-03 (GET /health shape, HTTP 200, uptime is number)
- [ ] `src/health/health.module.ts` — required for controller registration
- [ ] OPS-01 Docker smoke test is manual-only: build + run locally, `curl http://localhost:3000/health` → verify 200. No automated Docker test needed for this phase.

---

## Project Constraints (from CLAUDE.md)

| Directive | Category | Impact on Phase 3 |
|-----------|----------|-------------------|
| Conventional Commits with emojis | Git | Commits must use `🏗️ build:`, `🤖 ci:`, `✨ feat:`, `♻️ refactor:` etc. |
| NEVER include Claude attribution lines in commits | Git | No `Co-Authored-By: Claude` footer |
| Single quotes, trailing commas (Prettier) | Code style | All new TS files must follow this pattern |
| `.js` extension on all relative imports | Module resolution | `import ... from './health.controller.js'` — must include `.js` |
| `private readonly` for injected services | DI convention | HealthModule has no injected services — N/A |
| NestJS Logger for all logging | Logging | HealthController does not need logging (no side effects) |
| GSD workflow enforcement | Process | Use `/gsd:execute-phase` — no direct file edits outside GSD |

---

## Sources

### Primary (HIGH confidence)
- pnpm official Docker documentation (https://pnpm.io/docker) — multi-stage pnpm Dockerfile pattern, corepack setup
- depot.dev optimal Node.js pnpm Dockerfile guide — two-stage build pattern, cache mount syntax
- docker/build-push-action GitHub repository (https://github.com/docker/build-push-action) — GHA workflow YAML, cache-from/cache-to syntax
- Node.js `process.uptime()` built-in — verified working in Node 24 (stable since Node 0.x)
- Existing project code: `src/dispatch/run-dispatch.service.ts`, `src/main.ts`, `src/app.module.ts` — confirmed PORT handling already present

### Secondary (MEDIUM confidence)
- Docker GitHub Actions blog (docker.com) — GHA cache API v2 migration note (April 2025)
- WebSearch: docker/metadata-action@v5 tag patterns — sha, branch, latest configurations
- WebSearch: `node:22-slim` curl availability — confirmed absent by default on Debian slim images

### Tertiary (LOW confidence)
- WebSearch: `package.json#packageManager` corepack pinning behavior — needs validation against actual pnpm version in project

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all tools are well-documented, versions verified
- Architecture: HIGH — all patterns are direct extensions of existing code
- Pitfalls: HIGH — curl/slim gap verified; TZ decision verified against Phase 1 context
- CI/CD workflow: HIGH — official docker action docs, current versions confirmed

**Research date:** 2026-03-25
**Valid until:** 2026-06-25 (stable ecosystem — Docker actions, pnpm, NestJS change slowly)
