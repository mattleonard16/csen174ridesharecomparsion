# Architecture

How the rideshare comparison system works — components, relationships, data flows, invariants.

## What belongs here

High-level system understanding: components, relationships, data flows, invariants. NOT implementation details.

---

## System Overview

Comparative Rideshares is a Next.js 14 App Router application that compares prices across Uber, Lyft, Taxi, and Waymo in the Bay Area. It uses algorithmic pricing (no real rideshare API integration).

## Core Data Flow

```
User submits comparison request
  → POST /api/compare-rides
    → Geocode pickup/destination (Nominatim + precomputed routes)
    → Fetch route metrics (OSRM: distance, duration)
    → Calculate prices for all services (PricingEngine)
    → Persist to DB (Route, PriceSnapshot, SearchLog) — non-blocking
    → Return ComparisonResults
```

## Key Components

### Pricing Engine (`lib/pricing.ts`)
- Calculates fares using base fare + distance/time fees + modifiers
- Modifiers: airport fees, location surcharges, time-based surge, traffic multipliers
- Returns `PricingBreakdown` with all fee components
- Confidence scoring (0.5-0.9 range)

### Ride Comparison Service (`lib/services/ride-comparison.ts`)
- Orchestrator: geocoding → route metrics → parallel pricing → persistence
- Three-tier in-memory cache (geocode: 5min, route: varies, comparison: 45sec)
- Precomputed routes bypass external API calls

### Database Layer
- **Prisma ORM** with PostgreSQL (custom client output at `lib/generated/prisma`)
- Always import from `@/lib/prisma` — never from generated folder
- Write operations use `isDatabaseAvailable()` guard + `reportPersistenceError()` — never throw
- Read failures return fallback values (empty arrays, null)

### Authentication
- NextAuth.js v5 with JWT sessions (not database sessions)
- Credentials provider with bcrypt password hashing
- Custom callbacks inject user ID into session/token

## Data Models (key ones for this mission)

### PriceSnapshot
- Stores historical price data with rich context
- Fields: final_price, base_price, surge_multiplier, wait_time_minutes, weather_condition, traffic_level, hour_of_day, day_of_week, confidence
- Indexed on `[routeId, service, createdAt]` — efficient for time-range queries

### RouteInsights (pre-aggregated)
- Pre-computed hourly patterns per route+service
- `avgPriceByHour`: JSON object mapping hours (0-23) to average prices
- `surgeProbabilityByHour`: JSON object mapping hours to surge probability
- Updated by cron job (`app/api/cron/aggregate-insights/route.ts`)

### RideHistory
- Tracks rides users actually took from comparison results
- Includes comparisonSnapshot (full ComparisonResults at booking time)
- IDOR protection via `{ id, userId }` compound where clause

### AlertNotification
- Created when price alerts trigger (BELOW/ABOVE threshold)
- Has `isRead` flag for notification badge tracking

## API Patterns

All API routes follow these conventions:
- **Auth**: Check session, return 401 if missing
- **CORS**: Wrapped with `withCors()` for cross-origin support
- **Rate limiting**: Wrapped with `withRateLimit()` (Upstash Redis)
- **Validation**: Zod `safeParse` on all inputs
- **Error handling**: Route-level catch block, `logError()` with context
- **Response headers**: `x-request-id` via `getRequestId()` + `createResponseHeaders()`
- **IDOR**: Ownership verified via `{ id, userId }` for user-scoped resources

## Frontend Architecture

- Next.js App Router with `'use client'` pages
- Auth guard pattern: `useAuth()` → redirect if unauthenticated
- Data fetching: client-side `fetch()` in `useEffect`/`useCallback`
- UI: Radix UI primitives + Tailwind CSS
- Theming: `next-themes` for light/dark mode (CSS variables)
- Toast notifications: `sonner` library
- Maps: MapLibre GL via `components/ui/map.tsx`

## Caching Strategy

| Cache Type | TTL | Purpose |
|-----------|-----|---------|
| Geocode | 5 min | Nominatim results |
| Route metrics | Varies | OSRM distance/duration |
| Comparison results | 45 sec | Full API response |
| Precomputed routes | 30 min | Popular Bay Area routes |

## Invariants

1. Database write operations NEVER throw — they catch and return null/false
2. Pricing calculations MUST go through `PricingEngine` — never hardcode
3. Prisma client import MUST be from `@/lib/prisma`
4. All API responses MUST include `x-request-id` header
5. User-scoped resources MUST have IDOR protection
6. Chart components MUST be client-side with dynamic imports (Recharts requires DOM)
