# Project Retrospective

*A living document updated after each milestone. Lessons feed forward into future planning.*

## Milestone: v1.5 — Rate Limiting and Message-Run Dependency

**Shipped:** 2026-03-30
**Phases:** 3 | **Plans:** 5 | **Tasks:** 8

### What Was Built
- Per-database webhook rate limiting (RATE_LIMIT_RUNS/FUP/MESSAGES, default 10) — local counters, no Redis
- Message-run dependency guard: runs blocked when matching message is `"processing"` (same `botIdentifier` + `chatDataId`)
- `processingStartedAt` timestamp on atomic message claim (prerequisite for recovery)
- Automatic timeout recovery: independent `recover-messages` interval resets stuck messages after `MESSAGE_TIMEOUT_MINUTES` (default 10)

### What Worked
- Splitting Phase 10 and 11 into separate phases (dependency guard vs. timeout recovery) kept plans small and focused
- TDD pattern: write tests first → RED → implement → GREEN — caught the `$exists` anti-pattern before it shipped
- `Promise<boolean>` return from dispatch methods was a clean contract for rate limit counting
- Worktree isolation per agent prevented parallel execution conflicts

### What Was Inefficient
- Worktree merge introduced two regressions: missing `MessageCheckService` mock and removed DEP-* tests — required manual recovery after merge
- REQUIREMENTS.md traceability table was not auto-updated after phase verification — had to fix checkboxes manually at milestone close
- The `gsd-tools phase complete` CLI left TOUT-* checkboxes unchecked even after verification passed

### Patterns Established
- Optional env vars with sensible defaults (`RATE_LIMIT_*`, `MESSAGE_TIMEOUT_MINUTES`) — no startup failure, tunable at runtime
- Required env vars for interval frequency (`CRON_INTERVAL_*`) — absent = hard startup failure
- `$lte` filter on timestamp fields naturally excludes documents without the field — no `$exists` guard needed
- `findOne` over `countDocuments` for dependency checks — stops at first match

### Key Lessons
1. **Always verify worktree merges immediately** — run full test suite + lint before treating a worktree merge as done. Conflict resolution with `--theirs` can silently lose test coverage.
2. **Phases 10 and 11 must ship together in production** — dependency guard without timeout recovery creates permanent run-blocking. The roadmap note was correct.
3. **Boolean dispatch returns enable clean counters** — the v1.5 refactor to `Promise<boolean>` was the right foundation for rate limiting.

### Cost Observations
- Model: Sonnet 4.6 throughout
- Sessions: 1 per phase (phases 9-11)
- Notable: Phase 11 executor removed pre-existing DEP-* tests during spec rewrite — manual recovery added ~10 min overhead

---

## Cross-Milestone Trends

### Process Evolution

| Milestone | Phases | Plans | Key Change |
|-----------|--------|-------|------------|
| v1.0 | 3 | 9 | Foundation — NestJS + MongoDB + dispatch loop |
| v1.1 | 2 | 2 | Per-client config via timeTrigger |
| v1.2 | 1 | 1 | FUP dispatch type added |
| v1.3 | 1 | 1 | Messages dispatch type added |
| v1.4 | 1 | 3 | Split into 3 independent cron intervals |
| v1.5 | 3 | 5 | Rate limiting + dependency guard + recovery |

### Cumulative Quality

| Milestone | Tests | Notes |
|-----------|-------|-------|
| v1.0 | ~40 | Baseline |
| v1.4 | ~120 | After interval split |
| v1.5 | 148 | +28 tests (rate limiting, dependency, recovery) |

### Top Lessons (Verified Across Milestones)

1. **Small plans execute cleanly** — plans with 2 tasks and clear `<action>` blocks rarely deviate
2. **Fail-fast env validation at startup** — `process.exit(1)` on missing vars catches misconfiguration before it causes silent failures
3. **Verify merge results immediately** — worktree merges can silently drop test coverage; always run full suite post-merge
