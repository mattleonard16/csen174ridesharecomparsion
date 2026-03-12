---
phase: 02-redis-cache-layer
plan: 02
subsystem: infra
tags: [redis, upstash, cache, ride-comparison, getCached, jest]

# Dependency graph
requires:
  - phase: 02-redis-cache-layer
    plan: 01
    provides: getCached<T> and clearCacheNamespace from lib/cache/redis-cache.ts

provides:
  - GEOCODE_CACHE, ROUTE_CACHE, COMPARISON_CACHE Maps removed from ride-comparison.ts
  - geocodeWithCache, getRouteMetrics, getComparisonCore migrated to getCached<T>
  - resetRideComparisonCaches() calls clearCacheNamespace (not Map.clear())
  - Jest mock for @/lib/cache/redis-cache with in-process store for test isolation
  - L2 hit path test: verifies Nominatim bypassed when cache pre-populated

affects:
  - 02-03 (recommendations and AI cache migration — same getCached pattern)
  - Any feature touching ride-comparison.ts geocode/route/comparison paths

# Tech tracking
tech-stack:
  added: []
  patterns:
    - getCached<T> call pattern with namespaced keys (geocode:, route:, comparison:)
    - jest.mock factory with internal Map store + exposed clearAll/prePopulate helpers
    - getEstimatedRouteMetrics as pure synchronous computation (no cache needed)

key-files:
  created: []
  modified:
    - lib/services/ride-comparison.ts
    - __tests__/services/ride-comparison.test.ts

key-decisions:
  - "route: prefix added explicitly to getRouteCacheKey output — original function returns exact:/estimated: without route: prefix; adding it ensures correct namespace for L1_MAX_SIZES and clearCacheNamespace"
  - "getEstimatedRouteMetrics kept synchronous and uncached — haversine computation is trivial, no network call, caching adds complexity with no benefit"
  - "jest.mock factory with internal Map store (clearAll/prePopulate helpers) — avoids jest.resetModules overhead while allowing test lifecycle control and L2 hit simulation"
  - "Removed log assertion from caching test — getCached mock is self-contained and doesnt call monitoring.log; the log behavior is tested in redis-cache.test.ts"

patterns-established:
  - "L2 hit simulation: jest.mock factory exposes prePopulate(key, value) helper; tests call it in arrange phase to set up cache hits before exercising the service"
  - "Cache mock clearAll() called in beforeEach alongside resetRideComparisonCaches() to ensure full isolation between tests"

requirements-completed:
  - INFR-01
  - INFR-02
  - INFR-03

# Metrics
duration: 11min
completed: 2026-03-10
---

# Phase 02 Plan 02: Ride Comparison Cache Migration Summary

**GEOCODE_CACHE, ROUTE_CACHE, and COMPARISON_CACHE Maps replaced with getCached<T> calls in ride-comparison.ts, enabling cross-instance Redis persistence for all three high-traffic cache paths**

## Performance

- **Duration:** 11 min
- **Started:** 2026-03-10T20:37:59Z
- **Completed:** 2026-03-10T20:49:00Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- Removed three module-level Map declarations and their associated `maintainCache`/`cleanupCache` helpers from `lib/services/ride-comparison.ts`
- Migrated `geocodeWithCache`, `getRouteMetrics`, and `getComparisonCore` to use `getCached<T>` from `@/lib/cache/redis-cache` with correct namespaced keys and TTLs
- Updated `resetRideComparisonCaches()` to call `clearCacheNamespace` instead of `Map.clear()`
- Added a self-contained `jest.mock` for `@/lib/cache/redis-cache` that simulates L1 caching behaviour with internal store and test lifecycle helpers
- Added L2 hit path test that pre-populates the mock cache and verifies Nominatim is not called
- All 28 ride-comparison tests pass; 341 of 341 non-pre-existing tests pass (7 pre-existing failures in compare-rides.route.test.ts due to ESM/Upstash parsing issue unrelated to this plan)

## Task Commits

Each task was committed atomically:

1. **Task 1: Migrate three Map caches to getCached** - `0c10e0c` (feat)
2. **Task 2: Extend ride-comparison tests and confirm no regressions** - `57ce98e` (test)

## Files Created/Modified

- `lib/services/ride-comparison.ts` - Removed three Map caches; migrated geocodeWithCache, getRouteMetrics, getComparisonCore, resetRideComparisonCaches; removed maintainCache/cleanupCache helpers
- `__tests__/services/ride-comparison.test.ts` - Added getCached mock with in-process store; added L2 hit path test suite; updated beforeEach to clear mock store

## Decisions Made

- Added `route:` prefix explicitly to `getRouteCacheKey` output when calling `getCached`. The existing function returns `exact:...` or `estimated:...` — without the `route:` prefix, the namespace extracted by `extractNamespace()` would be `exact` or `estimated`, missing from `L1_MAX_SIZES` and not cleared by `clearCacheNamespace('route')`.
- `getEstimatedRouteMetrics` kept synchronous and uncached. The function computes metrics via haversine (cheap math, no network) — wrapping it in `getCached` would require making it `async` and awaiting it in `resolveRouteMetrics`. The performance benefit of caching a microsecond computation is negligible.
- Jest mock factory with `clearAll`/`prePopulate` helpers. The factory-internal Map is stable across test re-evaluations without `jest.resetModules()` overhead, following the getter-based mock pattern noted in STATE.md decisions.
- Removed `log('Cache hit', ...)` assertion from the existing `should cache geocoding results` test. After migration, cache hit logging occurs inside `getCached` (the real implementation), which is mocked in tests. The `log` call behavior is covered in `__tests__/lib/cache/redis-cache.test.ts`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Added route: namespace prefix to getRouteCacheKey output**
- **Found during:** Task 1 (Migrate three Map caches to getCached)
- **Issue:** Plan stated `getRouteCacheKey` is "already prefixed with 'route:'", but the actual implementation returns `exact:...` or `estimated:...` without the `route:` prefix. This would cause the L1 namespace to be `exact` or `estimated` (not in `L1_MAX_SIZES`) and `clearCacheNamespace('route')` would not clear these keys.
- **Fix:** Prepended `route:` to the key when calling `getCached`: `` `route:${getRouteCacheKey('exact', pickup, destination)}` ``
- **Files modified:** `lib/services/ride-comparison.ts`
- **Verification:** TypeScript check passes; caching tests confirm second OSRM call is not made
- **Committed in:** `0c10e0c` (Task 1 commit)

**2. [Rule 1 - Bug] Removed stale log assertion from caching test**
- **Found during:** Task 2 (Extend tests)
- **Issue:** Existing test asserted `log('Cache hit', { cacheLayer: 'memory' })` was called — but after migration, `getCached` is fully mocked and its `log` calls do not execute. The test would fail.
- **Fix:** Removed the `expect(mockLog).toHaveBeenCalledWith('Cache hit', ...)` assertion. The cache hit behaviour is still verified by the `callsAfterSecond === 0` assertion.
- **Files modified:** `__tests__/services/ride-comparison.test.ts`
- **Verification:** All 28 tests pass
- **Committed in:** `57ce98e` (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (2 x Rule 1 bug)
**Impact on plan:** Both fixes necessary for correctness. No scope creep.

## Issues Encountered

- `jest.mock` factory hoisting caused `ReferenceError: Cannot access '...' before initialization` when trying to reference module-level `const` inside the factory. Resolved by defining the cache store inside the factory itself and exposing test controls via exported `clearAll`/`prePopulate` helper functions.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- All three high-traffic cache paths in `ride-comparison.ts` now use `getCached<T>` with Redis L2 persistence
- `resetRideComparisonCaches()` signature unchanged — existing test call sites unaffected
- Plan 02-03 (recommendations and AI cache) can use the same `getCached` pattern established here

## Self-Check: PASSED

All created files present on disk. All task commits found in git log.

---
*Phase: 02-redis-cache-layer*
*Completed: 2026-03-10*
