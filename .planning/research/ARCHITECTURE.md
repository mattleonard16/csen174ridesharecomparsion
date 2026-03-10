# Architecture Research

**Domain:** Next.js 14 service-oriented app — reliability milestone (caching, alerting, error tracking, testing)
**Researched:** 2026-03-10
**Confidence:** HIGH (derived from reading all source files directly)

---

## Standard Architecture

### System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        Browser / PWA                             │
│  ┌─────────────────┐  ┌──────────────┐  ┌────────────────────┐  │
│  │ ride-comparison  │  │  RouteMap    │  │  Dashboard /       │  │
│  │ -form.tsx        │  │  Client.tsx  │  │  Alerts UI         │  │
│  └────────┬─────────┘  └──────┬───────┘  └─────────┬──────────┘  │
└───────────┼────────────────────┼──────────────────────┼───────────┘
            │ POST/GET            │ tiles/OSRM           │ GET/POST
┌───────────┼────────────────────┼──────────────────────┼───────────┐
│                     Next.js App Router (Vercel)                   │
│  ┌─────────────────┐  ┌──────────────┐  ┌────────────────────┐  │
│  │ /api/compare-   │  │ /api/dash-   │  │ /api/price-alerts  │  │
│  │ rides/route.ts  │  │ board/route  │  │ /api/health        │  │
│  └────────┬─────────┘  └──────┬───────┘  └─────────┬──────────┘  │
│           │ withCors+RateLimit │              │                   │
├───────────┼────────────────────┼──────────────┼────────────────────┤
│                       Service Layer                               │
│  ┌──────────────────┐  ┌──────────────────┐  ┌────────────────┐  │
│  │ ride-comparison  │  │ recommendations  │  │ ai-insights    │  │
│  │ .ts              │  │ .ts              │  │ .ts            │  │
│  └────────┬─────────┘  └──────┬───────────┘  └───────┬────────┘  │
│           │                   │                       │           │
│  ┌────────┴─────────┐  ┌──────┴───────────────────────┘           │
│  │ In-Memory Caches │  │ insights-aggregator.ts                   │
│  │ (GEOCODE_CACHE,  │  │ (DB-backed RouteInsights)                │
│  │ ROUTE_CACHE,     │  └──────────────────────────────────────────┘
│  │ COMPARISON_CACHE,│
│  │ REC_CACHE,       │
│  │ AI_RESPONSE_CACHE│
│  └──────────────────┘
├─────────────────────────────────────────────────────────────────┤
│                     Infrastructure Layer                          │
│  ┌──────────────┐  ┌───────────────┐  ┌─────────────────────┐  │
│  │ Prisma /     │  │ Upstash Redis │  │ External APIs       │  │
│  │ PostgreSQL   │  │ (rate-limit   │  │ Nominatim + OSRM    │  │
│  │              │  │  only today)  │  │ (no SLA, retried)   │  │
│  └──────────────┘  └───────────────┘  └─────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Reliability Gap |
|-----------|----------------|-----------------|
| `lib/services/ride-comparison.ts` | Geocode → route → price → persist (938 lines) | In-memory caches lost on cold start; module-level state untestable across instances |
| `lib/services/recommendations.ts` | Data-driven recs from RouteInsights | In-memory REC_CACHE lost on cold start |
| `lib/services/ai-insights.ts` | Anthropic Claude call with template fallback | Module-level `dailyCallCount` resets on cold start — quota ineffective on Vercel |
| `lib/services/insights-aggregator.ts` | DB queries for hourly price statistics | No cache — hits DB on every recommendations call |
| `lib/rate-limiter.ts` | Redis-backed sliding window; in-memory fallback | Already correct — Redis path is live |
| `lib/redis.ts` | Upstash client initialisation | Reuse for caches; single instance already provisioned |
| `lib/monitoring.ts` | Axiom logging + Sentry stub | Sentry stub is a TODO comment; no real error capture |
| `app/api/price-alerts/route.ts` | CRUD for PriceAlert rows | No check loop — alerts are created but never evaluated |
| `prisma/schema.prisma` | PriceAlert model has `isActive`, `lastTriggeredAt`, `triggerCount` | Fields exist but nothing writes them |
| `jest.config.js` | Jest config | `setupFilesAfterSetup` typo breaks all test setup; coverage only covers ~30% of codebase |
| E2E (`e2e/nav-smoke.spec.ts`) | Navigation bar smoke | No comparison flow, map interaction, or error state coverage |

---

## Reliability Features — Integration Points

### 1. Redis Cache Layer Migration

**Current state:** Five separate `Map<string, {value, expiresAt}>` objects live in module scope across `ride-comparison.ts`, `recommendations.ts`, and `ai-insights.ts`. Every cold start on Vercel (which is frequent with serverless) empties all caches, defeating their purpose.

**Target state:** Redis as the durable cache; in-memory Map as a hot L1 in front of it (same pattern already used by `rate-limiter.ts`).

**Integration boundary:**

```
Service function
    → check L1 Map (microseconds, same process lifetime)
    → check Redis (1–3ms, cross-instance, survives cold starts)
    → compute
    → write Redis (async, fire-and-forget acceptable)
    → write L1 Map
```

**Key naming convention (use these consistently):**

```
geocode:{lowercase-address}              TTL: 5 min
route:exact:{lon1},{lat1}-{lon2},{lat2}  TTL: 10 min
route:estimated:{...}                    TTL: 10 min
comparison:v2:{...}:{time-bucket}        TTL: 30 min (precomputed) / 45s (dynamic)
rec:v2:{routeId}:{dayType}:{hourBlock}:... TTL: 15 min
ai:{cacheKey-hash}                       TTL: 2 hr
ai-quota:{YYYY-MM-DD}                    TTL: 48 hr (counter, INCR)
```

**Build order implication:** Redis cache layer must be built before AI quota tracking because the quota counter is a Redis INCR key. Fix the `redis.ts` export signature first (it already exports `redis` and `isRedisAvailable`); add a `getCached`/`setCached` helper so callers do not write raw Redis calls.

### 2. In-App Price Alert Delivery

**Current state:** `PriceAlert` rows are created in the database with all necessary fields (`isActive`, `targetPrice`, `service`, `alertType`, `lastTriggeredAt`). Nothing ever reads them to check conditions. The schema is complete; only the evaluation loop is missing.

**Architecture decision: polling on comparison completion, not a cron.**

Why: Vercel has no persistent cron runtime in the hobby tier. Vercel Cron requires Pro. The natural trigger for alert evaluation is already happening — a comparison just computed fresh prices. Evaluate active alerts for the route as a non-blocking fire-and-forget after `persistComparison` returns.

**Data flow:**

```
POST /api/compare-rides
    → compareRidesByCoordinates()
        → persistComparison() → returns routeId
    → evaluateAlertsForRoute(routeId, priceSnapshots)   ← NEW, non-blocking
        → query PriceAlert WHERE routeId matches savedRoute
          AND isActive=true
          AND (lastTriggeredAt IS NULL OR > cooldown)
        → for each alert: check condition against snapshot price
        → if triggered: write AlertNotification row + update lastTriggeredAt
    → Dashboard GET /api/dashboard
        → returns unread AlertNotifications alongside saved routes
```

**Schema additions needed:**

```sql
-- New model
model AlertNotification {
  id          String    @id @default(cuid())
  alert       PriceAlert @relation(...)
  alertId     String
  user        User       @relation(...)
  userId      String
  routeId     String
  service     ServiceType
  triggeredPrice Float
  targetPrice    Float
  isRead      Boolean   @default(false)
  createdAt   DateTime  @default(now())
}
```

`PriceAlert` already has `savedRouteId` which links to `SavedRoute.routeId`. The evaluation query joins `PriceAlert → SavedRoute → Route` to find alerts for the current route.

**Build order implication:** AlertNotification model must be migrated before the evaluation function is wired in. Write and test `evaluateAlertsForRoute` in isolation (takes routeId + snapshots, returns notifications created) before plugging it into the comparison path.

### 3. Error Tracking Integration

**Current state:** `lib/monitoring.ts` has a `logError` function that checks `NEXT_PUBLIC_SENTRY_DSN` and then does nothing with it (the Sentry SDK is never imported). Axiom logging is real and working. The monitoring file uses `any` types throughout.

**Architecture decision: use Axiom as the error sink, not Sentry.**

Rationale from PROJECT.md: "Axiom already integrated for logging; need alerting, not full APM." Adding Sentry SDK to a Next.js 14 App Router project requires `instrumentation.ts` + `sentry.server.config.ts` + `sentry.client.config.ts` — meaningful surface area for a stub replacement. Axiom already receives every `logError` call. Configure Axiom alerts on `level: error` instead.

**Integration point:** `lib/monitoring.ts` is the single integration point. Changes needed:

1. Replace `any` types with concrete `LogContext` and `ErrorContext` interfaces
2. Add `route` field to the structured log envelope (already passed by callers via context)
3. Remove the Sentry conditional block entirely — `logError` just calls `log` with `level: 'error'`
4. Ensure `sendToAxiom` is called synchronously from `logError` (it already is, via `log`)

No new SDK. No new environment variable. One file to edit.

**Build order implication:** Fix monitoring types first (unblocks TypeScript `any` replacement across the codebase). Error tracking is a prerequisite for reliable health checks because `healthCheck()` in the same file should emit structured errors through `logError`.

### 4. Health Check Endpoint

**Current state:** `healthCheck()` exists in `lib/monitoring.ts` and probes DB + OSRM. There is no `/api/health` route that calls it.

**Integration:** One new file: `app/api/health/route.ts`. The route calls `healthCheck()` and adds Redis probe.

```
GET /api/health
    → healthCheck() [existing]
        → prisma.$queryRawUnsafe('SELECT 1')
        → fetch OSRM probe URL
    → checkRedis()  [new, inline in route]
        → redis?.ping()
    → return { status, checks, timestamp }
```

No rate limiting on this endpoint (monitoring systems need unrestricted access). No auth. Response time target: < 2s.

### 5. Test Architecture

**Current state problems:**

- `setupFilesAfterSetup` typo in `jest.config.js` means `jest.setup.ts` never runs, so `@testing-library/jest-dom` matchers are missing from every test
- `collectCoverageFrom` covers only `app/api/**`, `lib/services/**`, `lib/monitoring.ts` — excludes `lib/pricing.ts`, `lib/geo.ts`, `lib/validation.ts`, `lib/rate-limiter.ts`
- E2E tests cover only nav bar; no comparison flow, no map interaction, no error states

**Jest fix (single-line):** `setupFilesAfterSetup` → `setupFilesAfterFramework` in `jest.config.js`.

**Coverage expansion — add to `collectCoverageFrom`:**
```
'lib/pricing.ts',
'lib/geo.ts',
'lib/validation.ts',
'lib/rate-limiter.ts',
'lib/airports.ts',
'components/**/*.{ts,tsx}',
'!components/ui/**'   // third-party Radix wrappers
```

**Unit test gaps to fill in priority order:**

1. `lib/services/ride-comparison.ts` — cache migration (Redis path), fallback to haversine, error codes
2. `lib/services/ai-insights.ts` — Redis quota counter, template fallback when over quota
3. `lib/monitoring.ts` — after `any` types removed, ensure `logError` always calls `log`
4. `app/api/price-alerts/route.ts` — alert evaluation after adding the new evaluation function

**E2E architecture for comparison flow:**

The existing pattern (Playwright against `npm run dev`) is correct. Extend it with:

```typescript
// e2e/comparison-flow.spec.ts
test('full comparison happy path', async ({ page }) => {
  // Mock external APIs via route interception
  await page.route('**/nominatim.openstreetmap.org/**', route =>
    route.fulfill({ json: [{ lat: '37.7749', lon: '-122.4194' }] })
  )
  await page.route('**/router.project-osrm.org/**', route =>
    route.fulfill({ json: { code: 'Ok', routes: [{ distance: 5000, duration: 600 }] } })
  )

  // Fill form → submit → assert results table visible
  // Assert MapRoute renders (check for canvas or svg element inside map container)
  // Assert surge badge visible or absent
})

test('OSRM unavailable shows estimated route warning', async ({ page }) => {
  await page.route('**/router.project-osrm.org/**', route => route.abort())
  // Fill form → submit → assert warning banner text
})
```

**MapLibre testing approach:** MapLibre renders to a WebGL canvas. Do not test canvas pixel output. Test the surrounding DOM:

- Assert map container div is present and has non-zero dimensions
- Assert route warning banner when `routeWarning` is set in API response
- Assert marker elements in the DOM (MapLibre injects `.maplibregl-marker` for custom markers)
- For unit tests of `RouteMapClient.tsx`, mock `maplibre-gl` entirely — the component's logic is about prop handling and fitBounds calls, not rendering fidelity

**OSRM/Nominatim mocking strategy:** Use `jest.mock` at the module boundary for unit tests:

```typescript
// Mock the fetch calls at the service boundary
global.fetch = jest.fn().mockImplementation((url: string) => {
  if (url.includes('nominatim')) return Promise.resolve({ ok: true, json: () => [...] })
  if (url.includes('osrm')) return Promise.resolve({ ok: true, json: () => ({...}) })
})
```

For E2E, use `page.route()` interception (Playwright's network layer) — this is already demonstrated in the existing test pattern.

### 6. Large File Refactoring Strategy

**Files over 400 lines that need splitting:**

| File | Lines | Split strategy |
|------|-------|----------------|
| `lib/services/ride-comparison.ts` | 938 | Extract: `lib/services/geocoding.ts` (geocodeWithCache), `lib/services/routing.ts` (getRouteMetrics + resolveRouteMetrics + fetchWithPolicy), `lib/services/comparison-cache.ts` (cache Maps + maintainCache + keys) |
| `app/api/compare-rides/route.ts` | 425 | Already near limit; extract request parsers (`lib/api/comparison-parsers.ts`) if it grows |
| `lib/rate-limiter.ts` | 358 | Acceptable; do not split |

**Refactoring rule:** Extract leaf utilities first (no inbound dependencies), then wire them back. The split for `ride-comparison.ts`:

```
lib/services/
├── geocoding.ts          # geocodeWithCache, airport shortcut
├── routing.ts            # getRouteMetrics, resolveRouteMetrics, fetchWithPolicy
├── comparison-cache.ts   # cache Maps, maintainCache, cleanupCache, keys
└── ride-comparison.ts    # compareRidesByAddresses, compareRidesByCoordinates
                          # (imports from above 3, stays as orchestrator)
```

Public API surface (`compareRidesByAddresses`, `compareRidesByCoordinates`, `CompareServiceError`, `isCompareServiceError`, `resetRideComparisonCaches`) must remain re-exported from `ride-comparison.ts` for zero import-site changes.

---

## Recommended Project Structure (post-refactor)

```
lib/
├── services/
│   ├── ride-comparison.ts      # Orchestrator only (target: <300 lines)
│   ├── geocoding.ts            # Extracted geocode + airport logic
│   ├── routing.ts              # Extracted OSRM + haversine fallback
│   ├── comparison-cache.ts     # Cache Maps + Redis L2 wrapper
│   ├── recommendations.ts      # Recommendation engine
│   ├── ai-insights.ts          # AI message enhancement (OpenAI after migration)
│   └── insights-aggregator.ts  # RouteInsights DB queries
├── cache/
│   └── redis-cache.ts          # getCached<T> / setCached<T> helper wrapping redis.ts
├── alerts/
│   └── evaluate-alerts.ts      # evaluateAlertsForRoute() — pure function
├── monitoring.ts               # Fix any types; remove Sentry stub
├── redis.ts                    # Unchanged — already correct
├── rate-limiter.ts             # Unchanged — already correct
├── prisma.ts                   # Unchanged
└── constants.ts                # Deduplicate API_CONFIG / DEFAULT_SERVICES

app/api/
├── compare-rides/route.ts      # Unchanged structure; call evaluateAlerts after persist
├── price-alerts/route.ts       # Add GET for unread notifications
├── health/route.ts             # NEW — calls healthCheck()
└── dashboard/route.ts          # Include AlertNotification unread count

__tests__/
├── services/
│   ├── geocoding.test.ts       # After extraction
│   ├── routing.test.ts         # After extraction
│   └── ride-comparison.test.ts # Orchestration tests (existing, extend)
├── alerts/
│   └── evaluate-alerts.test.ts # Pure function, easily unit-tested
└── api/
    └── health.test.ts          # NEW

e2e/
├── nav-smoke.spec.ts           # Existing
├── comparison-flow.spec.ts     # NEW — full happy path + OSRM error state
└── popular-route-click.spec.ts # Existing (untracked)
```

---

## Data Flow

### Comparison Request Flow (Current)

```
User submits form
    → ride-comparison-form.tsx
    → POST /api/compare-rides
        → withCors(withRateLimit(handlePost))
        → isPrecomputedRequest? → skip reCAPTCHA
        → auth() for userId
        → compareRidesByCoordinates() or compareRidesByAddresses()
            → geocodeWithCache()          → [L1 Map] → Nominatim
            → resolveRouteMetrics()       → [L1 Map] → OSRM → haversine fallback
            → getComparisonCore()         → [L1 Map] → pricingEngine.calculateFare()
            → persistComparison()         → Prisma (async, non-blocking)
        → resolveAiRecommendations()
            → generateRecommendations()   → [L1 Map] → RouteInsights DB
            → enhanceWithAI()             → [L1 Map] → Anthropic API
        → return ComparisonApiResponse
```

### Comparison Request Flow (Target — post-reliability)

```
User submits form
    → POST /api/compare-rides
        → withCors(withRateLimit(handlePost))
        → compareRidesByCoordinates()
            → geocodeWithCache()          → [L1 Map] → [Redis L2] → Nominatim
            → resolveRouteMetrics()       → [L1 Map] → [Redis L2] → OSRM
            → getComparisonCore()         → [L1 Map] → [Redis L2] → pricingEngine
            → persistComparison()         → Prisma (async, non-blocking)
        → evaluateAlertsForRoute()        ← NEW, fire-and-forget
            → Prisma: find active alerts
            → compare against snapshots
            → write AlertNotification rows
        → resolveAiRecommendations()
            → generateRecommendations()   → [L1 Map] → [Redis L2] → RouteInsights DB
            → enhanceWithAI()
                → isWithinQuota()         → Redis INCR counter (atomic)
                → [L1 Map] → [Redis L2]  → OpenAI API
        → return ComparisonApiResponse
```

### Alert Delivery Flow (Target)

```
Dashboard page load
    → GET /api/dashboard
        → auth() — 401 if not logged in
        → Prisma: savedRoutes, rideHistory, priceAlerts (existing)
        → Prisma: AlertNotification WHERE userId AND isRead=false  ← NEW
        → return { savedRoutes, rideHistory, priceAlerts, notifications }

User views notification
    → PATCH /api/price-alerts/notifications/:id
        → Prisma: update AlertNotification SET isRead=true
```

---

## Component Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| `ride-comparison.ts` ↔ `geocoding.ts` | Direct import (after refactor) | geocoding.ts owns the L1+L2 cache for geocode keys |
| `ride-comparison.ts` ↔ `routing.ts` | Direct import (after refactor) | routing.ts owns the L1+L2 cache for route keys |
| `api/compare-rides` ↔ `alerts/evaluate-alerts.ts` | Direct import, fire-and-forget `.catch()` | Evaluation must never block the comparison response |
| `services/` ↔ `lib/cache/redis-cache.ts` | Import `getCached` / `setCached` | Single Redis abstraction; all services use this, not raw `redis` client |
| `monitoring.ts` ↔ Axiom | HTTP POST via `sendToAxiom()` | Already async, already fire-and-forget |
| `rate-limiter.ts` ↔ `redis.ts` | Direct import | Unchanged — already correct architecture |
| `ai-insights.ts` ↔ OpenAI | SDK call after migration | Replace Anthropic SDK import only; function signatures stay the same |
| Jest tests ↔ external APIs | `global.fetch = jest.fn()` at module scope | Established pattern in existing tests |
| E2E tests ↔ external APIs | `page.route()` interception | Network-layer mock, no dev server changes needed |

---

## Build Order (Dependency Chain)

The reliability features have clear dependencies that determine sequencing:

**Phase 1 — Foundation (unblocks everything)**
1. Fix `jest.config.js` typo (`setupFilesAfterSetup` → `setupFilesAfterFramework`) — unblocks all unit test work
2. Fix `lib/monitoring.ts` `any` types, remove Sentry stub — unblocks TypeScript-clean error tracking
3. Add `lib/cache/redis-cache.ts` helper — unblocks all Redis cache migration work

**Phase 2 — Core reliability (can parallelise within phase)**
4. Migrate `ride-comparison.ts` caches to Redis L2 — requires Phase 1.3
5. Migrate `recommendations.ts` / `ai-insights.ts` caches to Redis L2 — requires Phase 1.3
6. Replace `dailyCallCount` module variable with Redis INCR — requires Phase 1.3
7. Add `AlertNotification` schema + migration — no dependencies

**Phase 3 — Features using Phase 2 work**
8. `evaluateAlertsForRoute()` function — requires Phase 2.7 (schema)
9. Wire alert evaluation into `compare-rides` route — requires Phase 3.8
10. Add GET for unread notifications to dashboard — requires Phase 3.8
11. Add `app/api/health/route.ts` — requires Phase 1.2 (monitoring clean)

**Phase 4 — Refactoring (safe after tests are green)**
12. Extract `geocoding.ts` and `routing.ts` from `ride-comparison.ts` — requires Phase 1.1 (tests to validate no regression)
13. Consolidate duplicate `DEFAULT_SERVICES` constants — safe any time

**Phase 5 — Test coverage expansion**
14. Expand `collectCoverageFrom` in `jest.config.js` — requires Phase 1.1
15. Add E2E comparison flow tests — requires Phase 2.4 (cache stable) and Phase 3.9 (alerts wired)

---

## Scaling Considerations

This app runs on Vercel serverless. The relevant scaling question is cold-start frequency, not horizontal scale.

| Scale | Architecture concern |
|-------|---------------------|
| Current (demo/portfolio) | Cold starts every few minutes; in-memory caches are useless. Redis L2 fixes this completely. |
| 0–1k users | Upstash Redis free tier (10k requests/day) is sufficient. Rate limiter + cache combined. |
| 1k–10k users | Upstash Redis paid tier. Add Prisma connection pooling (PgBouncer). No architecture change. |
| 10k+ users | Consider Next.js Edge Runtime for comparison endpoint; move pricing calculation to edge. Out of scope for this milestone. |

**First bottleneck at current scale:** Nominatim and OSRM are public APIs with no SLA. They are the only unavoidable external latency. Redis geocode caching (5 min TTL) is the primary mitigation. Precomputed routes already address the highest-traffic paths.

---

## Anti-Patterns

### Anti-Pattern 1: Evaluating Alerts in a Cron

**What people do:** Add a Vercel Cron Job (`vercel.json` schedules) that runs every 15 minutes and queries all active alerts against current prices.

**Why it's wrong for this app:** Requires fetching fresh prices for every alert's route on a schedule, meaning N geocode + OSRM calls per cron run with no user-driven cache warming. Prices are deterministic from the pricing engine — a cron would call OSRM speculatively. The comparison endpoint already has the fresh price; evaluate then.

**Do this instead:** Trigger `evaluateAlertsForRoute` from the comparison path, non-blocking. The price is already computed; just compare it against stored targets.

### Anti-Pattern 2: One Redis Client Per Service File

**What people do:** Import `redis` directly from `lib/redis.ts` in every service that needs caching, then write `await redis?.get(key)` / `await redis?.set(key, value, {ex: ttl})` inline.

**Why it's wrong:** Scatters key naming, TTL management, and serialisation across 5+ files. When the cache shape needs to change (e.g., adding a prefix version), every file needs updates.

**Do this instead:** `lib/cache/redis-cache.ts` exports `getCached<T>(key, ttl, compute)` — a single function that handles L1 Map check, Redis get, compute on miss, Redis set, L1 set. Services call this one function.

### Anti-Pattern 3: Testing MapLibre by Asserting Canvas Output

**What people do:** Try to screenshot or pixel-compare the map canvas in E2E tests.

**Why it's wrong:** WebGL rendering varies by machine, GPU driver, and headless Chrome version. Screenshots of canvas elements are flaky across CI environments.

**Do this instead:** Assert DOM surrounding the map: marker elements (`.maplibregl-marker`), container visibility, and that the component's JS-level state (via `window.__testMap` which already exists in the codebase for `/test/*` routes) reflects the expected camera position.

### Anti-Pattern 4: Growing `ride-comparison.ts` Further

**What people do:** Add the Redis cache migration directly into the existing 938-line file.

**Why it's wrong:** The file already has too many responsibilities. Adding cache infrastructure makes it harder to test each concern in isolation.

**Do this instead:** Extract `geocoding.ts` and `routing.ts` first (pure refactor, no behaviour change), then add Redis calls in the extracted files where cache lookup is already isolated.

---

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| Upstash Redis | HTTP REST via `@upstash/redis` SDK | Already in `lib/redis.ts`; extend, don't replace |
| Nominatim | `fetch` with AbortController timeout | Cached aggressively; public instance, no auth |
| OSRM | `fetch` with retry policy | Cached; haversine fallback already implemented |
| Axiom | `fetch` to ingest API | Already in `monitoring.ts`; no SDK needed |
| OpenAI | SDK after Anthropic removal | Drop-in: same prompt shape, different client |
| PostgreSQL | Prisma ORM | Custom output path at `lib/generated/prisma` — always import from `lib/prisma.ts` |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| API routes ↔ services | Direct TypeScript import | No HTTP; services are pure functions or class instances |
| services ↔ Prisma | `lib/prisma.ts` singleton | Non-blocking for analytics writes (`.catch()` pattern) |
| services ↔ Redis | `lib/cache/redis-cache.ts` wrapper | Never import `redis` directly in service files |
| `evaluateAlertsForRoute` ↔ comparison path | Fire-and-forget (`.catch(() => {})`) | Evaluation failure must never surface to user |
| Next.js middleware ↔ auth | `auth()` from `@/auth` | Per-handler pattern; no global middleware |

---

## Sources

- Source code read directly: `lib/services/ride-comparison.ts`, `app/api/compare-rides/route.ts`, `lib/rate-limiter.ts`, `lib/redis.ts`, `lib/monitoring.ts`, `lib/services/recommendations.ts`, `lib/services/ai-insights.ts`, `app/api/price-alerts/route.ts`, `prisma/schema.prisma`, `jest.config.js`, `e2e/nav-smoke.spec.ts`, `lib/constants.ts`, `types/index.ts`
- Project context: `.planning/PROJECT.md`
- Confidence: HIGH — all findings are grounded in the actual source, not assumptions

---

*Architecture research for: ride comparison app — reliability milestone*
*Researched: 2026-03-10*
