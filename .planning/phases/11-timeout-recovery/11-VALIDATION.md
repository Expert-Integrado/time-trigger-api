---
phase: 11
slug: timeout-recovery
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-30
---

# Phase 11 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Jest 30.x |
| **Config file** | `package.json` (jest config inline) |
| **Quick run command** | `pnpm test --testPathPattern="scheduler\|run-dispatch" --passWithNoTests` |
| **Full suite command** | `pnpm test --passWithNoTests` |
| **Estimated runtime** | ~4 seconds |

---

## Sampling Rate

- **After every task commit:** Run `pnpm test --testPathPattern="scheduler\|run-dispatch" --passWithNoTests`
- **After every plan wave:** Run `pnpm test --passWithNoTests`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 11-01-01 | 01 | 1 | TOUT-01, TOUT-02, TOUT-03, TOUT-04 | unit | `pnpm test --passWithNoTests` | ✅ existing | ⬜ pending |
| 11-01-02 | 01 | 1 | TOUT-01, TOUT-02, TOUT-03, TOUT-04 | unit | `pnpm test --passWithNoTests` | ✅ existing | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements.

---

## Manual-Only Verifications

All phase behaviors have automated verification.

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
