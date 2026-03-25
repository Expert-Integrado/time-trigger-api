---
phase: 2
slug: core-dispatch-loop
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-25
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | jest 30.x + ts-jest 29.x |
| **Config file** | `package.json` (jest section) |
| **Quick run command** | `pnpm test` |
| **Full suite command** | `pnpm test --coverage` |
| **Estimated runtime** | ~8 seconds |

---

## Sampling Rate

- **After every task commit:** Run `pnpm test`
- **After every plan wave:** Run `pnpm test --coverage`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 8 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 02-01-01 | 01 | 1 | SCHED-01, SCHED-02, SCHED-03 | unit | `pnpm test` | ❌ W0 | ⬜ pending |
| 02-02-01 | 02 | 2 | DETECT-01, DETECT-02, DETECT-03, DETECT-04 | unit | `pnpm test` | ❌ W0 | ⬜ pending |
| 02-03-01 | 03 | 3 | DISP-01, DISP-02, DISP-03, DISP-04, DISP-05, DISP-06 | unit | `pnpm test` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/scheduler/run-dispatch.service.spec.ts` — stubs for SCHED-01, SCHED-02, SCHED-03
- [ ] `src/dispatcher/run-detector.service.spec.ts` — stubs for DETECT-01 through DETECT-04
- [ ] `src/dispatcher/webhook-dispatch.service.spec.ts` — stubs for DISP-01 through DISP-06

*Existing jest infrastructure covers framework needs — no additional installs required.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Cron fires at configured interval against live MongoDB | SCHED-01 | Requires live MongoDB + time observation | Run `pnpm start:dev` with real MONGODB_URI, observe cycle logs |
| Atomic dispatch prevents duplicates under real concurrency | DISP-03 | Requires concurrent cycles hitting same run | Simulate with two processes or rapid interval |
| Time gate skips runs outside morningLimit/nightLimit | DETECT-04 | Requires real vars data with time constraints | Run during off-hours, verify runs are skipped |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 8s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
