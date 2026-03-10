# Architecture

**Analysis Date:** 2026-03-10

## Pattern Overview

**Overall:** Layered Next.js App Router application with a service-oriented backend

**Key Characteristics:**
- Next.js 14 App Router with React Server Components at the page level; client components opt-in with `'use client'`
- Thin API route handlers that delegate to a dedicated service layer (`lib/services/`)
- Middleware-style composition for cross-cutting concerns (CORS → rate limit → handler)
- Fire-and-forget async persistence: database writes never block the HTTP response
- Three-tier in-memory caching (geocode 5min, route 10min, recommendations 15min) with bounded Map sizes

## Layers

**Presentation Layer (React):**
- Purpose: Render UI, manage local form/display state, call API routes
- Location: `app/` (pages/layouts) and `components/` (reusable UI)
- Contains: Page components, feature components, Radix UI primitives, MapLibre map components
- Depends on: `lib/` utilities, `types/`, fetch calls to `/api/*`
- Used by: End users via browser

**API Route Layer:**
- Purpose: Validate input, enforce security (CORS, rate limiting, reCAPTCHA), route to service layer
- Location: `app/api/*/route.ts`
- Contains: `GET`/`POST` handler functions exported after composition with `withCors` and `withRateLimit`
- Depends on: `lib/services/`, `lib/validation.ts`, `lib/cors.ts`, `lib/rate-limiter.ts`, `auth.ts`
- Used by: Browser fetch calls from components

**Service Layer:**
- Purpose: Core business logic — orchestrating geocoding, routing, pricing, and persistence
- Location: `lib/services/` (4 modules: `ride-comparison.ts`, `recommendations.ts`, `ai-insights.ts`, `insights-aggregator.ts`, `weather-cron.ts`)
- Contains: Domain logic functions, typed error classes, in-memory caches
- Depends on: `lib/pricing.ts`, `lib/database.ts`, `lib/monitoring.ts`, external APIs (Nominatim, OSRM)
- Used by: API route handlers

**Pricing Engine:**
- Purpose: Deterministic fare calculation from configurable rules
- Location: `lib/pricing.ts`, `lib/pricing-config.json`
- Contains: `PricingEngine` class with `calculateFare()`, time-based surge schedule, traffic multipliers
- Depends on: `lib/airports.ts`, `lib/pricing-config.json`
- Used by: `lib/services/ride-comparison.ts`

**Database Layer:**
- Purpose: All Prisma/PostgreSQL access, split into focused modules
- Location: `lib/database.ts` (barrel), `lib/database-routes.ts`, `lib/database-logging.ts`, `lib/database-pricing-stats.ts`, `lib/prisma.ts`
- Contains: Route CRUD, price snapshot logging, search logging, geohash clustering queries
- Depends on: `lib/generated/prisma` (generated Prisma Client), `lib/service-mappings.ts`
- Used by: `lib/services/` only (never called directly from API routes)

**Authentication:**
- Purpose: Session management and user identity
- Location: `auth.ts` (root), `lib/auth-context.tsx`, `app/api/auth/[...nextauth]/`
- Contains: NextAuth v5 config with Credentials provider, JWT strategy, Prisma adapter
- Depends on: `lib/prisma.ts`, `bcryptjs`, `zod` (credential validation)
- Used by: API route handlers (`auth()` call), `Providers` wrapper in layout

## Data Flow

**Ride Comparison Request (primary flow):**

1. User submits pickup + destination in `components/ride-comparison-form.tsx`
2. Component POSTs to `POST /api/compare-rides` with reCAPTCHA token
3. `app/api/compare-rides/route.ts` handler: validates input (Zod), checks precomputed route, verifies reCAPTCHA, extracts userId from JWT session
4. Handler calls `compareRidesByAddresses()` in `lib/services/ride-comparison.ts`
5. Service checks precomputed routes (`lib/popular-routes-data.ts`) — if matched, skips geocoding
6. If not precomputed: parallel geocoding via Nominatim API (2 concurrent calls, 2.5s timeout, 1 retry)
7. Route metrics fetched from OSRM API (3s timeout, fallback to haversine estimation on failure)
8. `PricingEngine.calculateFare()` called concurrently for each service type (uber/lyft/taxi/waymo)
9. `findOrCreateRoute()` awaited (needed for routeId used by save/alert features)
10. `logPriceSnapshot()` + `logSearch()` fired asynchronously (`.catch(() => {})` — non-blocking)
11. AI recommendations generated via `generateRecommendations()` → `enhanceWithAI()` (also non-blocking via `.catch(() => [])`)
12. Response returned with comparisons, surge info, coordinates, AI recommendations

**Precomputed Route Fast Path:**
- `findPrecomputedRouteByAddresses()` matches normalized address strings against `PRECOMPUTED_ROUTES` in `lib/popular-routes-data.ts`
- On match: skips geocoding (Nominatim) and routing (OSRM) entirely
- reCAPTCHA verification also skipped for precomputed routes
- Cache-Control header set to `max-age=300` vs `max-age=30` for dynamic routes

**State Management:**
- No global client state library (no Redux/Zustand)
- Local `useState` in page-level client components (`HomePageClient.tsx`, `app/dashboard/page.tsx`)
- Auth state via React Context (`lib/auth-context.tsx`) wrapping NextAuth `SessionProvider`
- Server session obtained via `auth()` from NextAuth in API routes

## Key Abstractions

**CompareServiceError:**
- Purpose: Typed error with structured metadata for upstream failures
- Location: `lib/services/ride-comparison.ts`
- Pattern: Custom Error subclass with `code`, `provider`, `phase`, `timedOut` fields; API layer maps codes to HTTP status via `mapCompareError()`

**FetchPolicy / fetchWithPolicy:**
- Purpose: Configurable retry-with-backoff for external HTTP calls
- Location: `lib/services/ride-comparison.ts`
- Pattern: Policy objects (`GEOCODE_FETCH_POLICY`, `ROUTE_FETCH_POLICY`) passed to generic `fetchWithPolicy()` — decouples timeout/retry config from call sites

**PricingEngine:**
- Purpose: Stateless fare calculator instantiated once; all config loaded from `lib/pricing-config.json`
- Location: `lib/pricing.ts`
- Pattern: Class with `calculateFare(PricingInput): PricingResult`, returns full `PricingBreakdown` (every fee component exposed)

**withCors / withRateLimit:**
- Purpose: Higher-order functions composing security middleware onto route handlers
- Location: `lib/cors.ts`, `lib/rate-limiter.ts`
- Pattern: `export const GET = withCors(withRateLimit(handleGet))` — handlers are plain async functions, security is applied at export

**Database Barrel (`lib/database.ts`):**
- Purpose: Single import point for all DB operations
- Pattern: Re-exports from `database-routes.ts`, `database-logging.ts`, `database-pricing-stats.ts`; callers always import from `@/lib/database`, never from sub-modules directly

**Precomputed Routes:**
- Purpose: Eliminate external API latency for popular Bay Area routes
- Location: `lib/popular-routes-data.ts`
- Pattern: Static record of route slugs to `{pickup, destination, metrics}`; matched by `findPrecomputedRouteByAddresses()` before any network call

## Entry Points

**Root Layout:**
- Location: `app/layout.tsx`
- Triggers: All page requests
- Responsibilities: Font loading, `<Providers>` wrapper (ThemeProvider + SessionProvider + AuthProvider + Toaster), lazy-loaded `PillBase` navigation bar, Vercel Analytics

**Home Page:**
- Location: `app/page.tsx` → `components/HomePageClient.tsx`
- Triggers: GET /
- Responsibilities: Scroll-snap layout with Hero, RouteList (popular routes), FeatureGrid, RideFormSection

**API Handler Composition:**
- Location: `app/api/compare-rides/route.ts`
- Triggers: GET/POST /api/compare-rides
- Responsibilities: `export const GET = withCors(withRateLimit(handleGet))` and `export const POST = withCors(withRateLimit(handlePost))`

**NextAuth Handler:**
- Location: `app/api/auth/[...nextauth]/route.ts`
- Triggers: All /api/auth/* requests
- Responsibilities: Credential login, JWT issuance

**Cron Jobs:**
- Location: `app/api/cron/weather/route.ts`, `app/api/cron/aggregate-insights/route.ts`, `app/api/cron/cleanup/route.ts`
- Triggers: Vercel Cron (scheduled)
- Responsibilities: Weather data ingestion, RouteInsights aggregation, stale data cleanup

## Error Handling

**Strategy:** Structured typed errors at the service layer; HTTP status mapping at the API layer; fire-and-forget for non-critical async operations

**Patterns:**
- `CompareServiceError` with typed `code` field allows precise HTTP status mapping without string matching
- `isCompareServiceError()` type guard used in API handlers before generic error fallback
- Non-critical DB writes (price snapshots, search logs) use `.catch(() => {})` to never fail the response
- OSRM routing failures fall back to haversine-based estimation (`getEstimatedRouteMetrics()`); response includes `routeAccuracy: 'estimated'` and `routeWarning` string
- Upstream fetch retries implemented in `fetchWithPolicy()` with configurable exponential backoff

## Cross-Cutting Concerns

**Logging:** `lib/monitoring.ts` — `log()` (structured, sends to Axiom in production) and `logError()` (sends to Sentry in production); dev mode uses `console.debug`/`console.error`

**Validation:** Zod schemas in `lib/validation.ts`; `validateInput()` wrapper returns `{success, data, errors}` rather than throwing; additional `detectSpamPatterns()` and `detectSuspiciousCoordinates()` guards in API handlers

**Authentication:** `auth()` from `auth.ts` called inside handlers to get server-side session; userId always taken from JWT, never from request headers (explicitly noted as security fix in code)

**Rate Limiting:** `withRateLimit()` from `lib/rate-limiter.ts`; 2-tier (burst + hourly); Upstash Redis primary, in-memory Map fallback

**CORS:** `withCors()` from `lib/cors.ts`; allowlist-based (localhost:3000 + `NEXT_PUBLIC_APP_URL`); no wildcard

---

*Architecture analysis: 2026-03-10*
