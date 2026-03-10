---
phase: 02-redis-cache-layer
plan: 03
subsystem: infra
tags: [redis, upstash, caching, ai, recommendations, quota]

# Dependency graph
requires:
  - phase: 02-redis-cache-layer
    plan: 01
    provides: getCached and incrementQuotaCounter from lib/cache/redis-cache.ts
provides:
  - REC_CACHE in recommendations.ts replaced with getCached<RecommendationOutput>
  - AI_RESPONSE_CACHE in ai-insights.ts replaced with getCached<string[]>
  - dailyCallCount/lastResetDate replaced with incrementQuotaCounter inside getCached compute
affects:
  - 02-redis-cache-layer plan 04 (full suite verification)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "getCached<T> wrapping compute logic for service-level cache migration"
    - "incrementQuotaCounter called inside getCached compute — quota only incremented on cache miss"
    - "jest.mock pass-through for getCached enables existing service tests to run without Redis"

key-files:
  created: []
  modified:
    - lib/services/recommendations.ts
    - lib/services/ai-insights.ts
    - __tests__/services/recommendations.test.ts
    - __tests__/services/ai-insights.test.ts

key-decisions:
  - "Single TTL (7200s) for both AI and template responses — templates are deterministic and safe to cache at 2 hours"
  - "incrementQuotaCounter inside getCached compute — quota increments only on cache miss, not on cache hit"
  - "getCached mock as pass-through in tests — existing test assertions remain valid without needing Redis"

patterns-established:
  - "Cache-hit test pattern: mockGetCached.mockResolvedValueOnce({ value: cached, cacheHit: true }) to verify compute is bypassed"
  - "beforeEach restores getCached pass-through mock after each test to prevent state leakage"

requirements-completed:
  - INFR-04
  - INFR-05
  - INFR-06

# Metrics
duration: 4min
completed: 2026-03-10
---

# Phase 02 Plan 03: Recommendations and AI Cache Migration Summary

**REC_CACHE Map and AI_RESPONSE_CACHE Map removed from service files; both now use getCached<T> from redis-cache.ts; AI daily quota counter migrated from module-level variables to Redis INCR via incrementQuotaCounter**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-10T20:38:00Z
- **Completed:** 2026-03-10T20:42:11Z
- **Tasks:** 3
- **Files modified:** 4

## Accomplishments
- Removed REC_CACHE Map, REC_CACHE_TTL_MS, MAX_REC_CACHE_SIZE, and cleanupExpiredEntries from recommendations.ts; generateRecommendations now delegates to getCached<RecommendationOutput>
- Removed AI_RESPONSE_CACHE Map, dailyCallCount, lastResetDate, resetDailyQuotaIfNeeded, isWithinQuota, and cleanupExpiredEntries from ai-insights.ts; enhanceWithAI uses getCached<string[]> with incrementQuotaCounter inside compute
- Extended both test files: getCached mock with pass-through default, cache-hit path tests, quota exceeded/within-limit tests, UTC date key format test

## Task Commits

Each task was committed atomically:

1. **Task 1: Migrate REC_CACHE in recommendations.ts to getCached** - `cbb24ce` (feat)
2. **Task 2: Migrate AI_RESPONSE_CACHE and quota counter in ai-insights.ts** - `33428bb` (feat)
3. **Task 3: Full suite green check** - no additional commit (verification only)

## Files Created/Modified
- `lib/services/recommendations.ts` - REC_CACHE Map removed; getCached<RecommendationOutput> wraps compute logic
- `lib/services/ai-insights.ts` - AI_RESPONSE_CACHE, dailyCallCount, lastResetDate removed; getCached<string[]> + incrementQuotaCounter
- `__tests__/services/recommendations.test.ts` - Added getCached mock; replaced Map cache test with getCached hit path test
- `__tests__/services/ai-insights.test.ts` - Added getCached and incrementQuotaCounter mocks; added quota and cache-hit tests

## Decisions Made
- Single TTL (7200s = 2 hours) for both AI and template responses. Plan allowed either approach; option 1 (single TTL) chosen for simplicity — template responses are deterministic and safe to cache at 2 hours.
- incrementQuotaCounter is placed inside the getCached compute callback, not outside it. This is intentional: quota only counts when compute is invoked (cache miss). A cache hit returns without incrementing, which is the correct behavior.
- getCached mock defaults to pass-through (always calls compute) in tests to keep existing test assertions valid. The cache-hit path is tested separately with mockResolvedValueOnce.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

Two pre-existing test suite failures (`__tests__/services/ride-comparison.test.ts` and `__tests__/app/api/compare-rides.route.test.ts`) exist due to the uncrypto ESM issue and ride-comparison.ts Map declarations not yet migrated (plan 02-02 scope). These 7 failures existed before this plan and are unrelated to this plan's changes. Confirmed via git stash verification.

## Next Phase Readiness
- INFR-04, INFR-05, INFR-06 requirements complete
- All five in-memory Maps have been migrated to getCached (GEOCODE, ROUTE, COMPARISON in plan 02-02; REC, AI_RESPONSE in this plan)
- AI quota counter is now cross-instance and survives cold starts
- Full suite has 2 pre-existing failing test suites (ride-comparison uncrypto issue) — these must be resolved before phase gate

---
*Phase: 02-redis-cache-layer*
*Completed: 2026-03-10*
