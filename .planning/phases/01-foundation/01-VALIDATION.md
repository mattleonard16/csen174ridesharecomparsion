---
phase: 1
slug: foundation
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-10
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | jest 29.7.0 + @testing-library/react 16.x |
| **Config file** | `jest.config.js` |
| **Quick run command** | `npm test -- --bail` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm test -- --bail`
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 1-01-01 | 01 | 1 | TEST-01 | unit | `npm test -- --bail` | ✅ | ⬜ pending |
| 1-01-02 | 01 | 1 | TEST-02 | unit | `npm test -- --coverage` | ✅ | ⬜ pending |
| 1-02-01 | 02 | 1 | OBSV-01 | unit | `npm test -- lib/monitoring` | ❌ W0 | ⬜ pending |
| 1-02-02 | 02 | 1 | OBSV-02 | unit | `npm test -- lib/monitoring` | ❌ W0 | ⬜ pending |
| 1-02-03 | 02 | 1 | OBSV-03 | unit | `npm test -- lib/monitoring` | ❌ W0 | ⬜ pending |
| 1-02-04 | 02 | 1 | OBSV-04 | manual | Axiom log inspection | N/A | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `__tests__/lib/monitoring.test.ts` — stubs for OBSV-01, OBSV-02, OBSV-03
- [ ] Existing `jest.setup.ts` and test infrastructure covers TEST-01, TEST-02

*Wave 0 test file creation is part of Plan 02 (observability) task list.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Cache hit/miss events visible in Axiom | OBSV-04 | Requires Axiom dashboard access | Deploy to staging, make 2 identical comparison requests, verify structured log entries with `event: cache_hit` in Axiom |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
