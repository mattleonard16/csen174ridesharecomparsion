---
phase: 3
slug: ai-consolidation-code-quality
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-10
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | jest 29.7.0 |
| **Config file** | `jest.config.js` |
| **Quick run command** | `npm test -- --testPathPattern=<file>` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm test -- --testPathPattern=<affected-file>`
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 03-01-01 | 01 | 1 | QUAL-01 | typecheck | `npm run typecheck` | ✅ | ⬜ pending |
| 03-01-02 | 01 | 1 | QUAL-02 | unit + grep | `npm test` + `grep -r "DEFAULT_SERVICES" lib app` | ✅ | ⬜ pending |
| 03-01-03 | 01 | 1 | QUAL-03 | typecheck + grep | `npm run typecheck` + `grep -rn "nominatim.openstreetmap.org\|router.project-osrm.org" lib app --include="*.ts" --include="*.tsx"` | ✅ | ⬜ pending |
| 03-02-01 | 02 | 2 | INFR-07 | unit | `npm test -- --testPathPattern=ai-insights` | ✅ needs update | ⬜ pending |
| 03-03-01 | 03 | 2 | FEAT-02 | unit | `npm test -- --testPathPattern=compare-rides.route` | ✅ needs update | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

*Existing infrastructure covers all phase requirements.*

No new test files need to be created. The two test files that need updating (`ai-insights.test.ts`, `compare-rides.route.test.ts`) already exist.

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
