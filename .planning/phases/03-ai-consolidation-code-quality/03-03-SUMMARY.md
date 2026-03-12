---
phase: 03-ai-consolidation-code-quality
plan: 03
subsystem: api
tags: [typescript, nextjs, zod, jest, coordinate-api]

# Dependency graph
requires:
  - phase: 03-01
    provides: Type safety consolidation — CoordinateComparisonRequest and constants established

provides:
  - "POST /api/compare-rides rejects legacy string payloads with HTTP 400"
  - "buildRequestBody throws when coordinates missing (no silent legacy fallback)"
  - "LegacyComparisonRequest type and isLegacyRequest function deleted"
  - "handlePost simplified to coordinate-only path"
  - "selectedRoute auto-submit uses precomputed route coordinates"
  - "All compare-rides tests updated to coordinate format"

affects: [phase-04, any future API consumer that tests POST handler]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Early return 400 guard: if (!isCoordinateRequest(body)) return 400 before any processing"
    - "Throw-not-fallback: buildRequestBody throws Error when preconditions not met"
    - "jest-environment node directive: add to test files that import @upstash/redis to avoid uncrypto ESM issue"
    - "LocationInput mock includes onSelect to simulate coordinate selection in component tests"

key-files:
  created: []
  modified:
    - app/api/compare-rides/route.ts
    - lib/hooks/useRideComparison.ts
    - types/index.ts
    - components/ride-comparison-form.tsx
    - __tests__/app/api/compare-rides.route.test.ts
    - __tests__/api/compare-rides-route.test.ts
    - __tests__/components/ride-comparison-form.test.tsx

key-decisions:
  - "selectedRoute auto-submit now extracts coordinates from findPrecomputedRouteByAddresses — avoids coordinate-less submission without requiring Route 4 architectural change"
  - "jest-environment node directive added to compare-rides.route.test.ts — resolves uncrypto ESM resolution to browser variant in jsdom environment"
  - "compare-rides-route.test.ts migrated from compareRidesByAddresses mock to compareRidesByCoordinates — tests now match the only active code path"

patterns-established:
  - "All POST requests to compare-rides must include from/to coordinate fields — no string-only fallback"
  - "buildRequestBody in useRideComparison always produces CoordinateComparisonRequest or throws"

requirements-completed: [FEAT-02]

# Metrics
duration: 8min
completed: 2026-03-10
---

# Phase 3 Plan 3: Remove Legacy API Request Format (FEAT-02) Summary

**POST /api/compare-rides now requires coordinate format (from/to) only — legacy string payload path removed from handler, hook, and types; test suite updated to assert HTTP 400 for legacy payloads**

## Performance

- **Duration:** 8 min
- **Started:** 2026-03-10T21:35:51Z
- **Completed:** 2026-03-10T21:43:51Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments

- Removed `isLegacyRequest` function and `LegacyComparisonRequest` type entirely
- `handlePost` now guards with `if (!isCoordinateRequest(body)) return 400` before any logic
- `buildRequestBody` in useRideComparison throws if pickupCoords/destinationCoords absent
- `compareRidesByAddresses` import kept in route.ts (still used by handleGet)
- All 348 tests pass; typecheck exits 0

## Task Commits

Each task was committed atomically:

1. **Task 1: Remove legacy path from handlePost and hook fallback** - `3ad8631` (feat)
2. **Task 2: Update compare-rides tests to assert 400 for legacy payloads** - `df0bf92` (test)

**Plan metadata:** (created as part of this summary)

_Note: TDD tasks — tests updated first (RED), then production code changed (GREEN)_

## Files Created/Modified

- `app/api/compare-rides/route.ts` - Removed isLegacyRequest, legacy path, sanitizeString import; simplified handlePost to coordinate-only
- `lib/hooks/useRideComparison.ts` - buildRequestBody now throws instead of returning legacy format; return type changed to CoordinateComparisonRequest
- `types/index.ts` - LegacyComparisonRequest interface deleted; ComparisonRequestBody simplified to alias for CoordinateComparisonRequest
- `components/ride-comparison-form.tsx` - selectedRoute auto-submit now reads coordinates from findPrecomputedRouteByAddresses
- `__tests__/app/api/compare-rides.route.test.ts` - Added jest-environment node; legacy test renamed and updated to assert 400; reCAPTCHA production test updated to use coordinate payload
- `__tests__/api/compare-rides-route.test.ts` - Migrated from compareRidesByAddresses to compareRidesByCoordinates mock; all request payloads use coordinate format
- `__tests__/components/ride-comparison-form.test.tsx` - Added findPrecomputedRouteByAddresses mock with coordinate fixture; LocationInput mock now calls onSelect with stub coordinates

## Decisions Made

- `selectedRoute` auto-submit reads coordinates from `findPrecomputedRouteByAddresses` — for precomputed routes this works perfectly; for dynamic routes (no precomputed data), coords will be null and buildRequestBody throws (acceptable — selectedRoute is only used for popular/precomputed routes in practice)
- `jest-environment node` directive added to `compare-rides.route.test.ts` — fixes uncrypto ESM module resolution issue where jsdom environment causes `uncrypto` to resolve to the browser variant (`.web.mjs`) which contains ESM export syntax Jest cannot parse
- `compare-rides-route.test.ts` migrated from `compareRidesByAddresses` to `compareRidesByCoordinates` — the file was testing the old code path; now tests the only active path

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Pre-existing ESM module failure in compare-rides.route.test.ts**
- **Found during:** Task 1 (RED phase test verification)
- **Issue:** `__tests__/app/api/compare-rides.route.test.ts` was already failing for all 7 tests before our changes; `@upstash/redis` uses `uncrypto` which resolves to `crypto.web.mjs` in jsdom environment causing SyntaxError on `export` statement
- **Fix:** Added `/** @jest-environment node */` directive to the test file, switching to Node.js environment where `uncrypto` correctly resolves to `crypto.node.cjs`
- **Files modified:** `__tests__/app/api/compare-rides.route.test.ts`
- **Verification:** 7/7 tests in the file pass after directive added
- **Committed in:** df0bf92 (Task 2 test commit)

**2. [Rule 1 - Bug] compare-rides-route.test.ts was testing the deleted legacy path**
- **Found during:** Task 2 (GREEN phase — running full suite)
- **Issue:** `__tests__/api/compare-rides-route.test.ts` used legacy `{ pickup, destination }` payloads and mocked `compareRidesByAddresses`; all 6 tests failed after legacy path removed
- **Fix:** Rewrote tests to use coordinate payloads and mock `compareRidesByCoordinates`
- **Files modified:** `__tests__/api/compare-rides-route.test.ts`
- **Verification:** All 6 tests pass with new coordinate format
- **Committed in:** df0bf92 (Task 2 test commit)

**3. [Rule 1 - Bug] ride-comparison-form.test.tsx tests failed because selectedRoute had no coordinates**
- **Found during:** Task 2 (GREEN phase — running full suite)
- **Issue:** Form component tests using `selectedRoute` prop triggered auto-submit, which now calls `buildRequestBody` without coordinates (throwing Error); 5 tests failed
- **Fix:** (a) Updated `LocationInput` mock to call `onSelect` with stub coordinates on change; (b) Added `findPrecomputedRouteByAddresses` mock returning coordinate fixture; (c) Updated form component `selectedRoute` useEffect to extract and pass coordinates from precomputed route data
- **Files modified:** `__tests__/components/ride-comparison-form.test.tsx`, `components/ride-comparison-form.tsx`
- **Verification:** All 8 form tests pass
- **Committed in:** df0bf92 (Task 2 test commit)

---

**Total deviations:** 3 auto-fixed (1 blocking pre-existing issue, 2 bugs caused by removing legacy path)
**Impact on plan:** All fixes necessary for correct test suite operation. No scope creep — changes are direct consequences of removing the legacy code path.

## Issues Encountered

None beyond the auto-fixed deviations above.

## Next Phase Readiness

- FEAT-02 complete: POST /api/compare-rides is coordinate-only
- All 348 tests pass; typecheck clean
- No blockers for remaining phase 3 plans

## Self-Check: PASSED

- SUMMARY.md: FOUND at `.planning/phases/03-ai-consolidation-code-quality/03-03-SUMMARY.md`
- route.ts: FOUND at `app/api/compare-rides/route.ts`
- useRideComparison.ts: FOUND at `lib/hooks/useRideComparison.ts`
- Commit 3ad8631: FOUND
- Commit df0bf92: FOUND
- All 348 tests: PASS
- TypeScript: PASS

---
*Phase: 03-ai-consolidation-code-quality*
*Completed: 2026-03-10*
