---
phase: 10
slug: message-run-dependency
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-30
---

# Phase 10 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Jest 30.0.0 |
| **Config file** | `package.json` (`jest` key) |
| **Quick run command** | `pnpm run test -- --testPathPattern="message-check\|run-dispatch\|webhook-dispatch" --no-coverage` |
| **Full suite command** | `pnpm run test` |
| **Estimated runtime** | ~10 seconds |

---

## Sampling Rate

- **After every task commit:** Run `pnpm run test -- --testPathPattern="message-check\|run-dispatch\|webhook-dispatch" --no-coverage`
- **After every plan wave:** Run `pnpm run test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** ~10 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 10-01-01 | 01 | 1 | DEP-01 | unit | `pnpm run test -- --testPathPattern="webhook-dispatch" --no-coverage` | ✅ | ⬜ pending |
| 10-01-02 | 01 | 1 | DEP-02, DEP-03, DEP-04, DEP-05 | unit | `pnpm run test -- --testPathPattern="run-dispatch" --no-coverage` | ✅ | ⬜ pending |
| 10-02-01 | 02 | 1 | DEP-04, DEP-05 | unit | `pnpm run test -- --testPathPattern="message-check" --no-coverage` | ❌ W0 | ⬜ pending |
| 10-02-02 | 02 | 1 | DEP-01 | unit | `pnpm run test -- --testPathPattern="webhook-dispatch" --no-coverage` | ✅ | ⬜ pending |
| 10-02-03 | 02 | 1 | DEP-02, DEP-03 | unit | `pnpm run test -- --testPathPattern="run-dispatch" --no-coverage` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/dispatch/message-check.service.spec.ts` — stubs for DEP-04, DEP-05 (MessageCheckService unit tests)

*Wave 0 creates the test file stubs before implementation work begins.*

---

## Manual-Only Verifications

*All phase behaviors have automated verification.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
