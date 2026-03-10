---
phase: 2
slug: redis-cache-layer
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-10
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | jest 29.7.0 + @testing-library/react 16.x |
| **Config file** | `jest.config.js` |
| **Quick run command** | `npm test -- --testPathPattern=lib/cache --bail` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm test -- --testPathPattern=lib/cache --bail`
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 2-01-01 | 01 | 1 | INFR-01 | unit | `npm test -- --testPathPattern=lib/cache` | ❌ W0 | ⬜ pending |
| 2-01-02 | 01 | 1 | INFR-02 | unit | `npm test -- --testPathPattern=lib/cache` | ❌ W0 | ⬜ pending |
| 2-01-03 | 01 | 1 | INFR-03 | unit | `npm test -- --testPathPattern=lib/cache` | ❌ W0 | ⬜ pending |
| 2-01-04 | 01 | 1 | INFR-04 | unit | `npm test -- --testPathPattern=services/recommendations` | ✅ (extend) | ⬜ pending |
| 2-01-05 | 01 | 1 | INFR-05 | unit | `npm test -- --testPathPattern=services/ai-insights` | ✅ (extend) | ⬜ pending |
| 2-01-06 | 01 | 1 | INFR-06 | unit | `npm test -- --testPathPattern=lib/cache` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `__tests__/lib/cache/redis-cache.test.ts` — stubs for getCached L1 hit, L2 hit, miss, Redis null fallback, incrementQuotaCounter

*Wave 0 test file creation is part of the Plan 01 task list.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Cache TTLs visible in Upstash console | INFR-01–05 | Requires Upstash dashboard access | Deploy to staging, make comparison request, check Upstash console for keys with TTL values |
| AI quota key `quota:ai:YYYY-MM-DD` visible with daily TTL | INFR-06 | Requires Upstash dashboard access | Deploy to staging, trigger AI insight, verify key exists with midnight expiration in Upstash console |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
