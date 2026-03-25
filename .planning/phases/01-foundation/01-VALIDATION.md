---
phase: 1
slug: foundation
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-25
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | jest 30.x + ts-jest 29.x |
| **Config file** | `package.json` (jest section) |
| **Quick run command** | `pnpm test` |
| **Full suite command** | `pnpm test --coverage` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `pnpm test`
- **After every plan wave:** Run `pnpm test --coverage`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 01-01-01 | 01 | 1 | CONN-04, CONN-05 | unit | `pnpm test` | ❌ W0 | ⬜ pending |
| 01-01-02 | 01 | 1 | CONN-01 | unit | `pnpm test` | ❌ W0 | ⬜ pending |
| 01-02-01 | 02 | 1 | CONN-02, CONN-03 | unit | `pnpm test` | ❌ W0 | ⬜ pending |
| 01-02-02 | 02 | 1 | OPS-02 | unit | `pnpm test` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/config/config.service.spec.ts` — stubs for CONN-04, CONN-05 env validation
- [ ] `src/mongo/mongo.service.spec.ts` — stubs for CONN-01 connection
- [ ] `src/database/database-scan.service.spec.ts` — stubs for CONN-02, CONN-03 discovery/filter

*Existing jest infrastructure covers framework needs — no additional installs required.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Connects to real MongoDB replica set | CONN-01 | Requires live MongoDB cluster | Run `pnpm start:dev` with real MONGODB_URI, check startup logs |
| Discovers real client databases | CONN-02 | Requires production-like data | Run against staging/prod MongoDB, verify DB list in logs |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
