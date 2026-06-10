# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Comparative Rideshares: A Next.js 14 application that compares prices and wait times across Uber, Lyft, and Taxi services in the Bay Area. Features real-time surge pricing with time-based multipliers, interactive route mapping, price alerts, and comprehensive ride comparisons.

## Development Commands

### Setup

```bash
npm install              # Install dependencies
npm run db:migrate       # Apply Prisma migrations locally (creates schema)
npm run db:generate      # Regenerate Prisma Client after schema changes
npm run db:studio        # Open Prisma Studio data browser
```

### Development

```bash
npm run dev              # Start development server (localhost:3000)
npm run dev:https        # Start with HTTPS enabled
```

### Code Quality

```bash
npm run typecheck        # Run TypeScript compiler checks
npm run lint             # Run ESLint
npm run lint:fix         # Auto-fix linting issues
npm run format           # Format code with Prettier
npm run format:check     # Check formatting without changes
npm run quality          # Run all checks (typecheck + lint + format:check + test)
```

### Testing

```bash
npm test                 # Run Jest tests
npm test:watch           # Run tests in watch mode
npm run test:e2e         # Run Playwright E2E (dev server)
npm run test:e2e:ui      # Playwright UI mode
npm run test:e2e:headed  # Playwright headed mode
```

Playwright E2E runs against `npm run dev` and uses `/test/*` routes that are blocked in production via `app/test/layout.tsx`. Test pages may expose internal helpers (for example, `window.__testMap`) and must remain dev-only.

### Build & Deployment

```bash
npm run build            # Build for production (runs prisma generate + next build)
npm start                # Start production server
npm run db:deploy        # Deploy migrations in production
```

### Data Management

```bash
npm run seed             # Seed database with sample data
npm run fetch:quotes     # Fetch ride quotes (custom script)
```

### Docker

```bash
docker compose up --build -d        # Build and run full stack
docker compose up -d db             # Run database only (for local development)
```

## Architecture

### Database Layer (Prisma + PostgreSQL)

**Location**: `prisma/schema.prisma`

The database uses a custom Prisma Client output path at `lib/generated/prisma` (non-standard location). Key models:

- **Route**: Stores pickup/destination with geohash clustering for spatial queries. Uses `pickup_geohash` and `destination_geohash` fields with precision 8 for efficient location-based lookups
- **PriceSnapshot**: Historical price data with surge multipliers, traffic levels, weather conditions, and confidence scores
- **User/Account/Session**: NextAuth.js authentication (Credentials provider with bcrypt)
- **SavedRoute/PriceAlert**: User-saved routes and price notification system
- **SearchLog/RideHistory**: Analytics and user behavior tracking
- **WeatherLog/EventLog/TrafficLog**: External data for pricing intelligence

### Pricing Engine

**Location**: `lib/pricing.ts`

Core pricing calculation with configurable rules from `lib/pricing-config.json`. The `PricingEngine` class calculates fares using:

- Base fare + distance/time fees
- Airport fees (special handling for SJC with `sjcFee` config)
- Location surcharges (CBD, downtown SF/SJ detection)
- Time-based surge multipliers (weekday/weekend schedules)
- Traffic multipliers (compares OSRM duration vs expected)
- Data-driven calibration (optional `calibration` input; factors come from `lib/services/pricing-calibration.ts`, which aggregates median finalFare/estimatedFare ratios from `RideHistory` per service, clamped to 0.85–1.2, cached 6h)
- Confidence scoring (0.5-0.95 range based on uncertainty factors; well-sampled calibration adds a small boost)

Returns detailed `PricingBreakdown` with all fee components exposed (including `calibrationFactor`/`calibrationAdjustment`).

### Ride Comparison Service

**Location**: `lib/services/ride-comparison.ts`

Main business logic orchestrator:

1. **Geocoding pipeline**: Checks precomputed routes → airport codes → Nominatim API (with caching)
2. **Route metrics**: Fetches distance/duration from OSRM API with exponential retry
3. **Parallel pricing**: Calculates all services concurrently using `PricingEngine`
4. **Persistence**: Async database logging (non-blocking) for Route, PriceSnapshot, SearchLog
5. **Caching**: Three-tier in-memory cache (geocode: 5min, route: varies, comparison: 30min precomputed / 45sec dynamic)

The service uses `findPrecomputedRouteByAddresses` from `lib/popular-routes-data.ts` to serve cached results for common Bay Area routes.

### API Routes

**Location**: `app/api/`

#### Compare Rides (`compare-rides/route.ts`)

- `GET /api/compare-rides?pickup=...&destination=...`: Prefetch endpoint
- `POST /api/compare-rides`: Main comparison endpoint with reCAPTCHA verification (skipped for precomputed routes)
- Wrapped with CORS (`lib/cors.ts`) and rate limiting (`lib/rate-limiter.ts` using Upstash Redis)
- Input validation via Zod schemas in `lib/validation.ts`
- Supports legacy request format (pickup/destination strings) and new format (coordinate-based)

#### Dashboard (`dashboard/route.ts`)

- `GET /api/dashboard`: Returns user's saved routes, ride history, and price alerts
- Requires authentication (returns 401 if not logged in)

#### Price Alerts (`price-alerts/route.ts`)

- `GET /api/price-alerts`: List user's price alerts
- `POST /api/price-alerts`: Create new price alert
- `DELETE /api/price-alerts?id=...`: Delete a price alert
- All endpoints require authentication

### Authentication

**Location**: `auth.ts` (root)

NextAuth.js v5 with:

- Prisma adapter pointing to custom client path (`lib/generated/prisma`)
- JWT session strategy (not database sessions)
- Credentials provider with bcrypt password hashing
- Custom callbacks for session/token with user ID injection

### Frontend Architecture

**Next.js App Router** structure:

- `app/page.tsx`: Main ride comparison UI
- `app/dashboard/page.tsx`: User dashboard
- `app/demo/page.tsx`: Demo/testing page
- `app/providers.tsx`: Client-side provider wrapper

**UI Components**: Radix UI primitives in `components/ui/` (button, input, label, switch, alert, card, map)

### Map Component

**Location**: `components/ui/map.tsx`

MapLibre GL-based map component (via mapcn/shadcn) with:

- `Map`: Root container with theme-aware CARTO basemap tiles (auto light/dark switching)
- `MapMarker` + `MarkerContent`: Custom markers with Tailwind-styled pins
- `MapRoute`: GeoJSON line rendering for route visualization
- `MapControls`: Zoom, compass, locate, and fullscreen controls
- `useMap()`: Hook for programmatic map access (fitBounds, flyTo, etc.)

Used by `RouteMapClient.tsx` for route visualization with OSRM-fetched driving directions.

### PWA Configuration

**Location**: `next.config.mjs`

Progressive Web App enabled in production only (disabled in dev to avoid babel issues):

- Caches OpenStreetMap tiles (7 days, CacheFirst)
- Caches Nominatim API (1 day, NetworkFirst)
- Caches OSRM API (1 hour, NetworkFirst)

### Key Utilities

- **lib/geo.ts**: Geospatial utilities (likely geohash operations)
- **lib/airports.ts**: Airport detection by code/coordinates
- **lib/redis.ts**: Upstash Redis client for rate limiting
- **lib/monitoring.ts**: Application monitoring/telemetry
- **lib/constants.ts**: API endpoints, cache TTLs, configuration

## Environment Variables

Required in `.env.local`:

```bash
DATABASE_URL="postgresql://..."         # Prisma connection string
DIRECT_URL="postgresql://..."           # Direct database connection (for migrations)
UPSTASH_REDIS_REST_URL="https://..."   # Rate limiting
UPSTASH_REDIS_REST_TOKEN="..."         # Rate limiting
RECAPTCHA_SECRET_KEY="..."             # reCAPTCHA v3 verification
NEXTAUTH_SECRET="..."                  # NextAuth.js JWT signing
NEXTAUTH_URL="http://localhost:3000"   # Auth callback URL
```

See `ENV_EXAMPLE.md` for complete reference.

## Important Patterns

### Database Access

Always import Prisma client from `lib/prisma.ts` (not from generated folder). The generated client is at `lib/generated/prisma` due to custom `output` setting in schema.

### Pricing Calculations

Use `pricingEngine.calculateFare()` for full breakdown or helper functions (`calculateEnhancedFare`, `getTimeBasedMultiplier`) for simplified use cases. Never hardcode pricing logic outside `lib/pricing.ts`.

### API Error Handling

APIs use non-blocking async logging that catches and logs errors without failing the request. Database operations use `.catch()` with warning logs for non-critical operations (see `ride-comparison.ts:188-196`).

### Geohash Clustering

Routes use geohash prefixes for location clustering (precision 8). When querying by area, use prefix matching on `pickup_geohash` and `destination_geohash` fields.

### Caching Strategy

External API calls (Nominatim, OSRM) are cached in-memory with TTL. Precomputed routes have longer TTL (30min). Always check cache before external API calls.

## Deployment Notes

- Runs on Vercel with `output: 'standalone'` in next.config.mjs
- TypeScript and ESLint checks enforced at build time (no silent failures)
- Prisma generation runs automatically on `postinstall` and before `build`
- Rate limiting requires Upstash Redis (cannot run locally without credentials)
- reCAPTCHA v3 verifies POST requests but allows degraded operation on verification failures (logs warnings)

## Testing Strategy

Jest configuration in `jest.config.js` with:

- Test environment: jsdom
- Path aliases: `@/` maps to root
- Setup file: `jest.setup.ts` (with @testing-library/jest-dom)

Run specific test file:

```bash
npm test -- path/to/test.spec.ts
```

## Codex Integration

### CLI Invocation

```bash
# STANDARD PATTERN - suppresses reasoning traces, returns only final answer
codex exec "prompt" 2>/dev/null

# Resume latest session
codex exec resume --last "follow-up prompt" 2>/dev/null

# Resume specific session by ID
codex exec resume <SESSION_ID> "follow-up prompt" 2>/dev/null
```

**IMPORTANT: Always run in background** using `run_in_background: true` parameter on Bash tool. This allows conversation to continue while Codex analyzes. Wait for `<bash-notification>` completion signal, then retrieve with `TaskOutput`. Never set explicit timeouts - Codex analysis is thorough and should complete naturally.

**CRITICAL: Always use `2>/dev/null`**. Without it, Codex outputs verbose reasoning traces to stderr that bloat Claude's context window by 10x or more. The `2>/dev/null` suffix:

- Suppresses stderr (where all `thinking` + `exec` traces go)
- Returns only stdout (the clean final answer)
- Reduces a ~15KB trace to ~1.5KB answer

**Sandbox**: Read-only by default. Claude executes all file modifications.
