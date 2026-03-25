# Phase 3: Operational Hardening - Context

**Gathered:** 2026-03-25
**Status:** Ready for planning

<domain>
## Phase Boundary

The service processes all eligible databases in parallel, exposes a health endpoint for monitoring, runs correctly inside a Docker container with timezone enforcement, and has a CI/CD pipeline via GitHub Actions.

Requirements: CONN-06, OPS-01, OPS-03

</domain>

<decisions>
## Implementation Decisions

### Docker
- **D-01:** Base image: `node:22-slim` (Debian slim, better native lib compatibility)
- **D-02:** Multi-stage build: builder stage (install deps + build) → runner stage (only dist/ + prod node_modules)
- **D-03:** Set `TZ=America/Sao_Paulo` in Dockerfile ENV
- **D-04:** Create `docker-compose.yml` with `env_file: .env`, `restart: always`, and Docker HEALTHCHECK
- **D-05:** Create `.dockerignore` to exclude node_modules, .planning, .git, etc.

### Health Endpoint
- **D-06:** `GET /health` returns minimal response: `{ status: 'ok', uptime: <seconds> }` — enough for Docker HEALTHCHECK
- **D-07:** Port configurable via `PORT` env var, default 3000
- **D-08:** Docker HEALTHCHECK uses `curl -f http://localhost:${PORT}/health`

### Parallel DB Processing
- **D-09:** Use `Promise.allSettled()` on all eligible databases — no concurrency limit
- **D-10:** One slow/failed DB does not block others in the same cycle
- **D-11:** Aggregate results after allSettled: count successes, failures, log summary

### CI/CD
- **D-12:** GitHub Actions workflow for build + push Docker image
- **D-13:** Trigger on push to `main` branch
- **D-14:** Push image to GitHub Container Registry (ghcr.io)

### Claude's Discretion
- Exact Dockerfile optimization (layer caching, COPY ordering)
- GitHub Actions workflow file structure and naming
- Health controller implementation details
- How to refactor RunDispatchService.runCycle() to use Promise.allSettled (currently sequential)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project specs
- `.planning/PROJECT.md` — Core value, constraints, key decisions
- `.planning/REQUIREMENTS.md` — CONN-06, OPS-01, OPS-03 acceptance criteria
- `.planning/ROADMAP.md` §Phase 3 — Phase goal and success criteria

### Phase 1 decisions
- `.planning/phases/01-foundation/01-CONTEXT.md` — Env config, logging, DB discovery patterns

### Research findings
- `.planning/research/ARCHITECTURE.md` — Component boundaries, suggested build order
- `.planning/research/PITFALLS.md` — Timezone Docker behavior (TZ=UTC), Promise.allSettled isolation

### Existing code (must read before modifying)
- `src/dispatch/run-dispatch.service.ts` — Current sequential DB processing (needs parallelization)
- `src/app.controller.ts` — Existing controller (health endpoint goes here or new controller)
- `src/main.ts` — Bootstrap, port configuration
- `src/app.module.ts` — Module imports

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/dispatch/run-dispatch.service.ts` — `runCycle()` iterates DBs sequentially with for-of loop; needs refactoring to `Promise.allSettled()`
- `src/app.controller.ts` — Has `getHello()` on `GET /`; health endpoint can be added here or in a new controller
- `src/main.ts` — Bootstrap with `app.listen(3000)`; needs `PORT` env var support

### Established Patterns
- NestJS DI with `@Injectable()` and `private readonly` constructor injection
- NestJS Logger for all logging
- Single quotes, trailing commas (Prettier)
- `.js` extension on all relative imports (nodenext)

### Integration Points
- `RunDispatchService.runCycle()` — refactor from sequential to parallel
- `main.ts` — add PORT env var support
- `AppModule` or new `HealthModule` — register health controller

</code_context>

<specifics>
## Specific Ideas

- Docker image should be production-ready (no devDependencies, no source maps in runner stage)
- docker-compose.yml should make it easy to deploy with just `docker-compose up -d`
- GitHub Actions should use Docker layer caching for faster builds

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 03-operational-hardening*
*Context gathered: 2026-03-25*
