---
phase: 3
slug: operational-hardening
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-25
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | jest 30.x + ts-jest 29.x |
| **Config file** | `package.json` (jest section) |
| **Quick run command** | `pnpm test` |
| **Full suite command** | `pnpm test --coverage` |
| **Estimated runtime** | ~10 seconds |

---

## Sampling Rate

- **After every task commit:** Run `pnpm test`
- **After every plan wave:** Run `pnpm test --coverage`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 10 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 03-01-01 | 01 | 1 | CONN-06 | unit | `pnpm test` | ❌ W0 | ⬜ pending |
| 03-02-01 | 02 | 1 | OPS-03 | unit | `pnpm test` | ❌ W0 | ⬜ pending |
| 03-03-01 | 03 | 2 | OPS-01 | build | `docker build .` | N/A | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/dispatch/run-dispatch.service.spec.ts` — update tests for Promise.allSettled behavior (CONN-06)
- [ ] `src/health/health.controller.spec.ts` — stubs for OPS-03

*Existing jest infrastructure covers framework needs.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Docker container runs and dispatches | OPS-01 | Requires Docker runtime + live MongoDB | `docker-compose up`, check logs |
| GitHub Actions pipeline succeeds | CI/CD | Requires GitHub push | Push to main, check Actions tab |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
