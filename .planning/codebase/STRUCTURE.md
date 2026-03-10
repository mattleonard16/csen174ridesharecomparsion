# Codebase Structure

**Analysis Date:** 2026-03-10

## Directory Layout

```
ridecomparsion/
├── app/                        # Next.js App Router pages and API routes
│   ├── api/                    # API route handlers
│   │   ├── auth/[...nextauth]/ # NextAuth.js catch-all
│   │   ├── compare-rides/      # Primary ride comparison endpoint
│   │   ├── cron/               # Scheduled job handlers (weather, cleanup, insights)
│   │   ├── dashboard/          # User analytics data
│   │   ├── health/             # Health check endpoint
│   │   ├── price-alerts/       # Price alert CRUD
│   │   └── recommendations/    # AI recommendation actions
│   ├── dashboard/              # Dashboard page
│   ├── demo/                   # Demo page (being removed)
│   ├── test/                   # Dev-only test pages (map-route harness)
│   ├── globals.css             # Global styles + Tailwind base
│   ├── layout.tsx              # Root layout (providers, fonts, nav bar)
│   ├── page.tsx                # Home page (delegates to HomePageClient)
│   └── providers.tsx           # Client-side provider tree
├── components/                 # React components
│   ├── ui/                     # Low-level UI primitives
│   └── *.tsx                   # Feature components
├── lib/                        # Server-side and shared utilities
│   ├── services/               # Business logic services
│   ├── hooks/                  # React hooks
│   ├── etl/                    # ETL scripts/utilities
│   ├── generated/prisma/       # Auto-generated Prisma Client (do not edit)
│   └── *.ts / *.tsx            # Utility modules
├── types/                      # Shared TypeScript types
│   └── index.ts                # Single type export file
├── prisma/                     # Database schema and migrations
│   ├── schema.prisma           # Prisma schema (source of truth)
│   └── migrations/             # SQL migration files
├── __tests__/                  # Jest unit and integration tests
│   ├── api/                    # API route tests
│   ├── app/                    # Page-level tests
│   ├── components/             # Component tests
│   ├── lib/                    # Library utility tests
│   ├── services/               # Service layer tests
│   └── fixtures/               # Test fixtures
├── e2e/                        # Playwright end-to-end tests
├── scripts/                    # One-off scripts (seed, fetch-quotes, etc.)
├── assets/                     # Static assets
├── public/                     # Publicly served files (icons, sw.js, manifest)
├── auth.ts                     # NextAuth.js configuration (root-level)
├── next.config.mjs             # Next.js config (PWA, standalone output)
├── tailwind.config.ts          # Tailwind CSS config
├── tsconfig.json               # TypeScript config with path aliases
├── jest.config.js              # Jest config
├── playwright.config.ts        # Playwright config
└── prisma/schema.prisma        # Prisma schema
```

## Directory Purposes

**`app/api/`:**

- Purpose: Next.js App Router API route handlers
- Contains: One `route.ts` per endpoint; handlers composed with `withCors` and `withRateLimit` at export
- Key files: `app/api/compare-rides/route.ts` (primary endpoint), `app/api/dashboard/route.ts`, `app/api/price-alerts/route.ts`

**`app/api/cron/`:**

- Purpose: Vercel Cron-triggered endpoints for background jobs
- Contains: `weather/route.ts` (weather ingestion), `aggregate-insights/route.ts` (RouteInsights aggregation), `cleanup/route.ts` (stale data purge)

**`components/ui/`:**

- Purpose: Low-level, reusable UI primitives (Radix UI based)
- Contains: `button.tsx`, `label.tsx`, `skeleton.tsx`, `map.tsx` (MapLibre wrapper), `map-markers.tsx`, `map-route.tsx`, `map-controls.tsx`, `map-cluster.tsx`, `3d-adaptive-navigation-bar.tsx`
- Key files: `components/ui/map.tsx` — MapLibre GL component with `Map`, `MapMarker`, `MapRoute`, `MapControls`, `useMap()` hook

**`components/` (root):**

- Purpose: Feature-level components composed from `ui/` primitives
- Contains: `HomePageClient.tsx` (home page shell), `ride-comparison-form.tsx` (main form), `ride-comparison-results.tsx` (results display), `RouteMapClient.tsx` (map with route overlay), `RideFormSection.tsx`, `RouteList.tsx`, `Hero.tsx`, `FeatureGrid.tsx`, `location-input.tsx`, `airport-selector.tsx`, `user-menu.tsx`, `auth-dialog.tsx`, `recommendations-panel.tsx`, `price-alert.tsx`

**`lib/`:**

- Purpose: All non-component server-side and shared logic
- Contains: Services, utilities, database access, hooks, generated Prisma client

**`lib/services/`:**

- Purpose: Core business logic — the service layer
- Contains:
  - `ride-comparison.ts` — main orchestrator (geocoding, routing, pricing, persistence)
  - `recommendations.ts` — AI recommendation generation from RouteInsights
  - `ai-insights.ts` — AI enhancement of recommendations
  - `insights-aggregator.ts` — aggregates PriceSnapshot data into RouteInsights
  - `weather-cron.ts` — weather data fetching for cron job

**`lib/hooks/`:**

- Purpose: React hooks for client components
- Contains: `use-recaptcha.ts`, `useUserLocation.ts`, `useLocationSuggestions.ts`, `useIsMounted.ts`

**`lib/etl/`:**

- Purpose: ETL utilities for data pipeline (used by scripts)

**`lib/generated/prisma/`:**

- Purpose: Auto-generated Prisma Client
- Generated: Yes (via `prisma generate`)
- Committed: No — regenerated on `postinstall` and `prebuild`
- Note: Import Prisma types from here; access the client via `lib/prisma.ts`

**`types/`:**

- Purpose: Shared TypeScript type definitions for the whole app
- Contains: `types/index.ts` — all exported types (`ServiceType`, `RideResult`, `ComparisonResults`, `SurgeInfo`, `AIRecommendation`, `Coordinates`, `RouteAccuracy`, etc.)

**`prisma/`:**

- Purpose: Database schema and migration history
- Key files: `prisma/schema.prisma` (models: Route, PriceSnapshot, User, SavedRoute, PriceAlert, RideHistory, RouteInsights, Recommendation, SearchLog, WeatherLog, EventLog, TrafficLog)

**`__tests__/`:**

- Purpose: Jest test suite mirroring `lib/`, `components/`, and `app/api/` structure
- Contains: Co-located fixtures in `__tests__/fixtures/`

**`e2e/`:**

- Purpose: Playwright end-to-end tests
- Contains: `nav-smoke.spec.ts`, `popular-route-click.spec.ts`

**`scripts/`:**

- Purpose: Standalone Node scripts for data management
- Contains: `seed.ts` (DB seeding), `fetch-quotes.ts` (quote ingestion), `create-test-user.ts`

## Key File Locations

**Entry Points:**

- `app/layout.tsx`: Root HTML shell, font variables, `<Providers>`, lazy nav bar
- `app/page.tsx`: Home page (delegates to `HomePageClient`)
- `app/dashboard/page.tsx`: User dashboard (client component, auth-gated)
- `auth.ts`: NextAuth configuration (root of project, not in `app/` or `lib/`)

**API Routes:**

- `app/api/compare-rides/route.ts`: `GET` (prefetch) and `POST` (main comparison)
- `app/api/dashboard/route.ts`: User analytics
- `app/api/price-alerts/route.ts`: Price alert CRUD
- `app/api/recommendations/actions/route.ts`: Recommendation action tracking

**Core Logic:**

- `lib/services/ride-comparison.ts`: Main business orchestrator — `compareRidesByAddresses()`, `compareRidesByCoordinates()`
- `lib/pricing.ts`: `PricingEngine` class and helpers — always use `pricingEngine.calculateFare()` for fares
- `lib/pricing-config.json`: All pricing constants (base fares, per-mile rates, surge schedules, airport fees)
- `lib/popular-routes-data.ts`: `PRECOMPUTED_ROUTES` static data and `findPrecomputedRouteByAddresses()`
- `lib/database.ts`: Barrel export for all DB operations — import from here, not from sub-modules

**Configuration:**

- `lib/constants.ts`: API endpoints (`NOMINATIM_BASE_URL`, `OSRM_BASE_URL`), cache TTLs, common Bay Area places
- `lib/validation.ts`: Zod schemas (`RideComparisonRequestSchema`, `LatitudeSchema`, `LongitudeSchema`) and guards
- `lib/cors.ts`: `withCors()` HOF
- `lib/rate-limiter.ts`: `withRateLimit()` HOF
- `lib/monitoring.ts`: `log()` and `logError()` structured logging

**Authentication:**

- `auth.ts`: NextAuth config with `handlers`, `auth`, `signIn`, `signOut` exports
- `lib/auth-context.tsx`: React context wrapping NextAuth session for client components
- `lib/prisma.ts`: Singleton Prisma client — always import from here

**Testing:**

- `jest.config.js`: Jest config with jsdom environment and `@/` path alias
- `jest.setup.ts`: `@testing-library/jest-dom` setup
- `playwright.config.ts`: Playwright config pointing at `npm run dev`

## Naming Conventions

**Files:**

- React components: PascalCase `.tsx` (e.g., `HomePageClient.tsx`, `RideFormSection.tsx`)
- UI primitives: kebab-case `.tsx` (e.g., `ride-comparison-form.tsx`, `map-controls.tsx`)
- Library utilities: kebab-case `.ts` (e.g., `rate-limiter.ts`, `api-helpers.ts`, `popular-routes-data.ts`)
- Database modules: `database-*.ts` prefix pattern
- Hooks: `use*.ts` or `use-*.ts` (e.g., `useUserLocation.ts`, `use-recaptcha.ts`)
- Services: flat name inside `lib/services/` (e.g., `ride-comparison.ts`)

**Directories:**

- Pages: lowercase (`dashboard`, `demo`, `test`)
- API routes: kebab-case (`compare-rides`, `price-alerts`, `aggregate-insights`)

**Types:**

- All shared types defined in `types/index.ts` using `export type` or `export interface`
- Service-specific types declared inline in service files, not exported to `types/`

## Where to Add New Code

**New API endpoint:**

- Create `app/api/<endpoint-name>/route.ts`
- Compose exports: `export const GET = withCors(withRateLimit(handleGet))`
- Business logic goes in `lib/services/`, not in the route handler

**New service (business logic):**

- Add file to `lib/services/<service-name>.ts`
- Import from `@/lib/database` for DB access, `@/lib/pricing` for fares, `@/lib/monitoring` for logging

**New React page:**

- Add `app/<page-name>/page.tsx` (server component by default)
- Extract client interactivity into a `components/<PageName>Client.tsx` with `'use client'`

**New React component:**

- Low-level UI primitive → `components/ui/<component-name>.tsx` (kebab-case)
- Feature component → `components/<ComponentName>.tsx` (PascalCase)

**New shared type:**

- Add to `types/index.ts` as `export type` or `export interface`

**New utility function:**

- Small focused utilities → `lib/<utility-name>.ts`
- If related to an existing module (geo, airports, validation), add to that file

**New database operation:**

- Route CRUD → `lib/database-routes.ts`
- Logging/snapshots → `lib/database-logging.ts`
- Stats/aggregates → `lib/database-pricing-stats.ts`
- Re-export from `lib/database.ts` barrel

**New test:**

- Unit/integration → `__tests__/<mirror-of-source-path>.test.ts(x)`
- E2E → `e2e/<flow-name>.spec.ts`
- Shared fixtures → `__tests__/fixtures/`

**New hook:**

- Add to `lib/hooks/<hookName>.ts` using camelCase with `use` prefix

## Special Directories

**`.planning/`:**

- Purpose: GSD planning documents and phase plans
- Generated: No (hand-maintained and AI-generated)
- Committed: Yes

**`lib/generated/prisma/`:**

- Purpose: Prisma Client output (generated from `prisma/schema.prisma`)
- Generated: Yes — via `prisma generate` (runs on `postinstall` and `prebuild`)
- Committed: No (in `.gitignore`)

**`.next/`:**

- Purpose: Next.js build output cache
- Generated: Yes
- Committed: No

**`playwright-report/` and `test-results/`:**

- Purpose: Playwright test output
- Generated: Yes
- Committed: No

**`public/`:**

- Purpose: Statically served files accessible at `/`
- Contains: `icons/`, `sw.js` (service worker), `manifest.json`
- Committed: Yes

---

_Structure analysis: 2026-03-10_
