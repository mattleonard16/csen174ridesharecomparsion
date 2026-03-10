# Codebase Concerns

**Analysis Date:** 2026-03-10

---

## Tech Debt

**Duplicate COMMON_PLACES Constant:**

- Issue: `COMMON_PLACES` is defined independently in both `lib/constants.ts` and `components/ride-comparison-form.tsx` (lines 36–105). The component version is a local constant that shadows the exported one.
- Files: `lib/constants.ts`, `components/ride-comparison-form.tsx`
- Impact: Data drift — the two definitions can diverge silently. Adding a new common place to `lib/constants.ts` will not appear in the form until manually mirrored.
- Fix approach: Remove the local definition in `ride-comparison-form.tsx` and import `COMMON_PLACES` from `@/lib/constants`.

**Legacy Request Format Kept Alongside New Format:**

- Issue: `app/api/compare-rides/route.ts` maintains two parallel code paths — a legacy path (`body.pickup`/`body.destination` strings) and the new structured format (`body.from`/`body.to` with coordinates). The legacy path skips coordinate validation (`detectSuspiciousCoordinates`) and defaults `userId` to `null`, bypassing authenticated user tracking.
- Files: `app/api/compare-rides/route.ts` (lines 169–345)
- Impact: Legacy requests accumulate as permanent technical debt; any new feature added to the new path (e.g., per-user analytics) silently does not apply to legacy callers.
- Fix approach: Migrate any known legacy callers (the GET prefetch handler at line 95 also uses legacy string format) and remove the dual-path logic.

**`logSearch` Uses Untyped `any` for Results:**

- Issue: `lib/database-logging.ts:148` — `results: any` is passed directly as `results_shown` to Prisma, which stores it as a JSON blob with no type validation.
- Files: `lib/database-logging.ts`
- Impact: The schema for stored search results is implicit and invisible to consumers; refactoring the results shape will silently corrupt historical data.
- Fix approach: Define a typed `SearchResults` interface and validate before persisting.

**`sendToAxiom` Uses Untyped `any`:**

- Issue: `lib/monitoring.ts:87` — `logEntry: any` loses all type safety on the structured log context.
- Files: `lib/monitoring.ts`
- Impact: Log schema is invisible; typos and missing fields are not caught at compile time.
- Fix approach: Type `logEntry` as `LogContext & { timestamp: string; message: string }`.

**`hourlyAverages` State Typed as `any[]`:**

- Issue: `app/dashboard/page.tsx:30` — `useState<any[]>([])` for price history data rendered in the dashboard.
- Files: `app/dashboard/page.tsx`
- Impact: No compile-time safety on the array shape; a backend format change will silently break dashboard rendering.
- Fix approach: Define an `HourlyAverage` interface and use `useState<HourlyAverage[]>`.

---

## Known Bugs

**`mapCompareError` Does Not Handle `ROUTE_TIMEOUT` or `ROUTE_UNAVAILABLE`:**

- Symptoms: When the OSRM routing provider times out or is unavailable and the fallback estimated-metrics path is not taken (e.g., geocode phase error followed by route error), the `mapCompareError` switch statement in `app/api/compare-rides/route.ts` falls through to the `default` case returning HTTP 500 with message "Failed to compare rides" — not a descriptive 504/503.
- Files: `app/api/compare-rides/route.ts` (lines 24–50)
- Trigger: OSRM returns 5xx or times out AND the error propagates rather than falling into the `resolveRouteMetrics` fallback.
- Workaround: The `resolveRouteMetrics` function does catch `ROUTE_TIMEOUT`/`ROUTE_UNAVAILABLE` and falls back to estimated metrics, so in practice this is rarely surfaced. The gap is when that fallback itself errors.

**Health Check Database `checkDatabase` Is a Stub:**

- Symptoms: `/api/health` always reports `database: { healthy: true, latency: 10 }` as long as `DATABASE_URL` is set in env — it never actually connects to the database.
- Files: `lib/monitoring.ts` (lines 132–135)
- Trigger: Any database connectivity issue (wrong password, max connections, DB restart) will not be caught by the health check.
- Workaround: None. External monitoring tools would not detect DB degradation through this endpoint.

---

## Security Considerations

**reCAPTCHA Is Optional for Precomputed Routes — Allows Score Bypass:**

- Risk: Any caller who knows a precomputed route string pair (e.g., "SFO" / "downtown san francisco") can bypass reCAPTCHA entirely by sending those values, as the POST handler skips token verification for precomputed routes (`isPrecomputedRoute` check at line 177).
- Files: `app/api/compare-rides/route.ts` (lines 169–222)
- Current mitigation: Rate limiting via Upstash Redis still applies to all requests.
- Recommendations: Consider whether reCAPTCHA bypass for precomputed routes is intentional (performance trade-off) or inadvertent. If intentional, document this explicitly. The precomputed route list in `lib/popular-routes-data.ts` is client-discoverable since it is imported by the frontend.

**GET `/api/compare-rides` Requires No Authentication and Persists to DB:**

- Risk: Unauthenticated GET requests trigger full geocoding + DB writes (`persist: true` at line 103) for any pickup/destination pair. An attacker can fill the database with arbitrary route records without rate limit resistance (GET may have less scrutiny than POST).
- Files: `app/api/compare-rides/route.ts` (lines 78–161)
- Current mitigation: Rate limiting applies; Nominatim geocoding limits throughput.
- Recommendations: Set `persist: false` for unauthenticated GET prefetches, or limit GET to precomputed routes only.

**Rate Limiter Client ID Is Trivially Spoofable:**

- Risk: `getClientId` in `lib/rate-limiter.ts` derives the identifier from `x-forwarded-for`, `x-real-ip`, or a hash of `user-agent + accept-language`. An attacker can rotate these headers to get a fresh rate limit window on every request.
- Files: `lib/rate-limiter.ts` (lines 84–104)
- Current mitigation: Redis-backed sliding window limits 3 burst / 50 per hour per derived ID; Upstash Redis required in production.
- Recommendations: Add HMAC signing of the IP or use a sticky identifier derived from a signed cookie for rate limit identity.

**Sentry Error Tracking Is Stubbed:**

- Risk: All `logError` calls in production silently discard errors if `NEXT_PUBLIC_SENTRY_DSN` is set but the Sentry SDK is not installed — the SDK import is commented out with a TODO.
- Files: `lib/monitoring.ts` (lines 57–63)
- Current mitigation: Axiom structured logging captures the error as a log entry (not an alert), so errors are visible in logs but no alerting fires.
- Recommendations: Either install and initialize `@sentry/nextjs` or remove the dead code path and Sentry env var reference to avoid false confidence that errors are tracked.

---

## Performance Bottlenecks

**AI `dailyCallCount` Is Module-Level State in a Serverless Environment:**

- Problem: `lib/services/ai-insights.ts` tracks Claude API call quota using module-level mutable variables (`dailyCallCount`, `lastResetDate`). In Vercel serverless functions, each cold start resets the counter to 0, meaning the effective daily quota is `AI_DAILY_QUOTA × number_of_cold_starts`, not `AI_DAILY_QUOTA` globally.
- Files: `lib/services/ai-insights.ts` (lines 12–13, 43, 150)
- Cause: No shared persistent counter; each instance tracks independently.
- Improvement path: Move quota tracking to Redis (already available via Upstash) with an atomic `INCR` + daily TTL key. Alternative: rely on Claude API rate limits rather than application-level counting.

**All In-Memory Caches Reset on Cold Start / Across Instances:**

- Problem: `GEOCODE_CACHE` and `ROUTE_CACHE` in `lib/services/ride-comparison.ts`, `REC_CACHE` in `lib/services/recommendations.ts`, and `AI_RESPONSE_CACHE` in `lib/services/ai-insights.ts` are all in-process `Map` instances. In Vercel serverless, each function instance has a separate cache; requests are not sticky.
- Files: `lib/services/ride-comparison.ts` (lines 22–23), `lib/services/recommendations.ts` (line 16), `lib/services/ai-insights.ts` (line 16)
- Cause: No shared cache layer; Upstash Redis is used only for rate limiting, not for data caching.
- Improvement path: Move geocode and route caches to Redis for cross-instance sharing. The geocode cache in particular saves 200–500ms per external Nominatim call.

**Recommendations Are Persisted to DB Synchronously on Every Request:**

- Problem: `lib/services/recommendations.ts` (lines 324–347) awaits `Promise.all` of `prisma.recommendation.create()` for every recommendation before returning. This adds sequential DB write latency to the API response path.
- Files: `lib/services/recommendations.ts`
- Cause: The persistence was intended to be "non-blocking" (comment at line 323) but the code uses `await` inside the main function body, not fire-and-forget.
- Improvement path: Move the `Promise.all` persistence block to fire-and-forget (`.catch(console.warn)` and no `await`), or use a background queue.

**`insights-aggregator.ts` Queries Up to 5000 Price Snapshots Per Request:**

- Problem: `aggregateRouteInsights` in `lib/services/insights-aggregator.ts` fetches up to `take: 5000` rows per route+service pair. With 4 services this could load 20,000 rows from Postgres per recommendations request.
- Files: `lib/services/insights-aggregator.ts` (line 48)
- Cause: No summary table update strategy; each insight generation re-reads raw snapshots.
- Improvement path: The `RouteInsights` model in the schema already exists for pre-aggregation. The cron job at `app/api/cron/aggregate-insights/` should be verified to run regularly so the on-demand aggregation path is rarely hit.

---

## Fragile Areas

**`ride-comparison-form.tsx` and `ride-comparison-results.tsx` Exceed 800 Line Limit:**

- Files: `components/ride-comparison-form.tsx` (791 lines), `components/ride-comparison-results.tsx` (815 lines)
- Why fragile: Files at this size are hard to review, prone to merge conflicts, and frequently need full re-renders on unrelated state changes. Both mix UI layout, business logic (surge formatting, recommendation rendering), and data fetching.
- Safe modification: Changes to one feature often require reading most of the file. Add state changes at the top of the file; be careful of hooks order.
- Test coverage: `ride-comparison-form.test.tsx` is 369 lines; results test is only 107 lines — the larger results component has thin coverage.

**`components/ui/3d-adaptive-navigation-bar.tsx` at 709 Lines:**

- Files: `components/ui/3d-adaptive-navigation-bar.tsx`
- Why fragile: Complex animated navigation with scroll physics, glassmorphism effects, and adaptive sizing all in one file. It was recently added (commit `98fa59d`) and has limited test coverage (146 lines in its test file, likely mostly smoke tests).
- Safe modification: Changes to animation timing or scroll thresholds can affect UX across all viewport sizes. Test at mobile breakpoints.
- Test coverage: `__tests__/components/3d-adaptive-navigation-bar.test.tsx` — extent of behavioral coverage is unclear.

**`checkDatabase` Health Check Returns Fake Latency:**

- Files: `lib/monitoring.ts` (line 135)
- Why fragile: Returns `{ healthy: !!process.env.DATABASE_URL, latency: 10 }` — hardcoded 10ms latency regardless of real DB state. Any system that relies on this endpoint to make routing decisions (e.g., load balancers, uptime monitors) will be misled.
- Safe modification: Replace with a real `SELECT 1` via Prisma before trusting the health endpoint for operational decisions.

**`app/demo/page.tsx` Was Deleted But Referenced in Git Status:**

- Files: The git status shows `D app/demo/page.tsx` (deleted) but the file was tracked. Any external link or bookmark to `/demo` will now 404.
- Why fragile: If `app/demo` was used as a showcase or share link, deleting the route without a redirect is a broken user experience.
- Safe modification: Verify no active links point to `/demo`, or add a redirect in `next.config.mjs`.

---

## Scaling Limits

**Nominatim Geocoding Rate Limits (External Dependency):**

- Current capacity: The public Nominatim API (`https://nominatim.openstreetmap.org`) imposes 1 request/second per IP.
- Limit: At moderate traffic, concurrent geocoding requests from multiple serverless instances sharing the same egress IP will be throttled or blocked by Nominatim's ToS.
- Scaling path: Self-host Nominatim, switch to a commercial geocoding provider (Google Maps, Mapbox Geocoding), or expand the precomputed routes dataset to cover common queries.

**OSRM Public Instance Dependency:**

- Current capacity: `router.project-osrm.org` is a public demo instance with no SLA.
- Limit: High traffic will encounter rate limiting or timeouts, degrading to estimated route metrics for most requests.
- Scaling path: Self-host OSRM for the Bay Area region (small dataset), or integrate a commercial routing API with SLA guarantees.

**In-Memory Rate Limiter Does Not Persist Across Restarts:**

- Current capacity: When Redis is unavailable, the in-memory fallback (`lib/rate-limiter.ts`) holds state only within a single process lifetime.
- Limit: A process restart or Vercel cold start resets all rate limit counters, allowing burst abuse during restarts.
- Scaling path: Ensure Upstash Redis credentials are always configured in production; add health-check assertion that Redis is reachable on startup.

---

## Dependencies at Risk

**Public OSRM Instance (`router.project-osrm.org`):**

- Risk: No SLA, hobby/demo tier. The service has experienced outages in the past.
- Impact: Route calculation falls back to haversine estimation; price accuracy degrades silently.
- Migration plan: Self-host OSRM for the Bay Area bounding box (small extract) or adopt Valhalla/GraphHopper open-source alternatives.

**Nominatim Public API:**

- Risk: Strict usage policy prohibits bulk or automated requests. Commercial use may violate ToS.
- Impact: Geocoding throttled or IP blocked; no addresses resolve.
- Migration plan: Adopt a commercial geocoder behind the `geocodeWithCache` interface — no service-wide changes needed due to the abstraction layer in `lib/services/ride-comparison.ts`.

---

## Missing Critical Features

**Sentry Error Alerting Never Fires:**

- Problem: `NEXT_PUBLIC_SENTRY_DSN` is checked but the SDK import is commented out. Production errors are logged to Axiom as log entries, not sent to Sentry for alerting.
- Blocks: On-call error alerting; automatic error grouping and deduplication.

**Database Health Check Is Non-Functional:**

- Problem: `/api/health` always reports database healthy as long as env var is set.
- Blocks: Reliable uptime monitoring; fast detection of connection pool exhaustion or DB restart.

**No Real-Time Price Alert Delivery:**

- Problem: `PriceAlert` records are created but no mechanism checks alerts against incoming price snapshots and delivers notifications (email, push, webhook).
- Blocks: The core "notify me when price drops" user-facing feature. Alerts are stored but never acted on.
- Files: `lib/database-logging.ts` (alert creation), `app/api/price-alerts/route.ts`

---

## Test Coverage Gaps

**`ride-comparison-results.tsx` Has Minimal Test Coverage:**

- What's not tested: Surge pricing display, AI recommendation rendering, price alert creation flow, historical stats section, `routeWarning` banner display.
- Files: `__tests__/components/ride-comparison-results.test.tsx` (107 lines vs 815-line component)
- Risk: UI regressions in results rendering pass undetected.
- Priority: High

**No Tests for `lib/database-logging.ts` or `lib/database-routes.ts`:**

- What's not tested: `logPriceSnapshot`, `logSearch`, `logWeatherData`, `getRoutePriceHistory`, `findOrCreateRoute` — all database write paths.
- Files: `lib/database-logging.ts`, `lib/database-routes.ts`
- Risk: DB schema changes or Prisma API changes silently break persistence; no regression detection.
- Priority: High

**No Tests for `app/dashboard/page.tsx`:**

- What's not tested: Authentication redirect logic, saved routes loading, price history chart rendering, savings data calculation.
- Files: `app/dashboard/page.tsx` (421 lines)
- Risk: Dashboard regressions after auth changes or API shape changes are undetected.
- Priority: Medium

**`app/api/compare-rides/route.ts` GET Handler Untested:**

- What's not tested: Prefetch endpoint (GET) — reCAPTCHA bypass for precomputed routes, cache-control header variations, unauthenticated persist behavior.
- Files: `__tests__/api/compare-rides-route.test.ts` — existing tests focus on POST only.
- Risk: GET prefetch regressions are invisible.
- Priority: Medium

**E2E Tests Cover Only Smoke Navigation:**

- What's not tested: Full ride comparison flow (form submit → results → map), price alert creation, dashboard data loading, error states (geocode failure, OSRM timeout).
- Files: `e2e/nav-smoke.spec.ts`, `e2e/popular-route-click.spec.ts`
- Risk: Critical happy-path regressions in the comparison flow go undetected.
- Priority: High

---

_Concerns audit: 2026-03-10_
