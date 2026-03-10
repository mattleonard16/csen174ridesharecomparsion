# External Integrations

**Analysis Date:** 2026-03-10

## APIs & External Services

**Geocoding:**
- Nominatim (OpenStreetMap) - Convert addresses to coordinates
  - Endpoint: `https://nominatim.openstreetmap.org/search`
  - Auth: None (public API, User-Agent header required: `RideCompareApp/1.0`)
  - Timeout: 2500ms, 1 retry with 200ms backoff
  - Cache TTL: 5 minutes in-memory (`lib/services/ride-comparison.ts`)
  - PWA cache: NetworkFirst, 1 day, 50 entries max

**Routing:**
- OSRM (Open Source Routing Machine) - Driving distance and duration
  - Endpoint: `https://router.project-osrm.org/route/v1/driving`
  - Auth: None (public API)
  - Timeout: 3000ms, 1 retry with 250ms backoff
  - Fallback: Haversine straight-line distance estimation when unavailable
  - Cache TTL: 10 minutes in-memory (`lib/services/ride-comparison.ts`)
  - PWA cache: NetworkFirst, 1 hour, 50 entries max

**Map Tiles:**
- CARTO Basemap - Vector map tiles for MapLibre GL
  - Endpoint: `https://basemaps.cartocdn.com` (light/dark variants)
  - Auth: None (public CDN)
  - PWA cache: CacheFirst, 7 days, 200 entries max
  - Used in: `components/ui/map.tsx`, `components/RouteMapClient.tsx`

**AI/LLM:**
- Anthropic Claude (claude-haiku-4-5-20251001) - Natural language recommendation enhancement
  - SDK: `@anthropic-ai/sdk` 0.74.x
  - Auth: `ANTHROPIC_API_KEY` env var
  - Usage: `lib/services/ai-insights.ts`
  - Daily quota: configurable via `AI_DAILY_QUOTA` env var (default: 500 calls/day)
  - Cache: 2-hour in-memory cache on responses (max 200 entries)
  - Fallback: Template strings when API unavailable or quota exceeded
  - Model params: `max_tokens: 150 * n_recommendations`, `temperature: 0.3`

**Bot Protection:**
- Google reCAPTCHA Enterprise - POST endpoint bot protection
  - Assessment endpoint: `https://recaptchaenterprise.googleapis.com/v1/projects/{projectId}/assessments`
  - Auth: `RECAPTCHA_API_KEY` (Google Cloud API key), `RECAPTCHA_PROJECT_ID`, `NEXT_PUBLIC_RECAPTCHA_SITE_KEY`
  - Used in: `lib/recaptcha.ts`, `app/api/compare-rides/route.ts`
  - Score thresholds: strict=0.7, normal=0.5, lenient=0.3
  - Skipped for precomputed routes to reduce API calls
  - Falls through to allow in development when keys are absent

**Logging/Observability:**
- Axiom - Structured log ingestion (optional)
  - Endpoint: `https://api.axiom.co/v1/datasets/{dataset}/ingest`
  - Auth: `AXIOM_TOKEN` + `AXIOM_DATASET` env vars
  - Used in: `lib/monitoring.ts` (`log()`, `logError()`, `trackPerformance()`)
  - Fires only when both env vars are present

- Sentry - Error tracking (stubbed, not yet installed)
  - Triggered by `NEXT_PUBLIC_SENTRY_DSN` env var presence
  - SDK not installed — `lib/monitoring.ts` has a TODO comment
  - Currently a no-op in production

**Analytics:**
- Vercel Analytics - Page/event tracking
  - SDK: `@vercel/analytics` 1.5.x
  - Injected via `app/layout.tsx`
  - No additional configuration required

## Data Storage

**Databases:**
- PostgreSQL 16 (primary)
  - ORM: Prisma 6.x with custom client output at `lib/generated/prisma`
  - Import client from: `lib/prisma.ts` (never import directly from generated folder)
  - Connection: `DATABASE_URL` env var (pooled connection for Prisma)
  - Direct connection: `DIRECT_URL` env var (for migrations — required by some managed providers like Neon)
  - Local dev: Docker via `docker compose up -d db` (see `docker-compose.yml`)
  - Production: Managed PostgreSQL (Neon or similar Vercel-compatible provider implied)
  - Schema: `prisma/schema.prisma`

**Models:**
- `Route` - Pickup/destination with geohash clustering (precision 8)
- `PriceSnapshot` - Historical price data with surge multipliers
- `User` / `Account` / `Session` / `VerificationToken` - NextAuth.js tables
- `SavedRoute` / `PriceAlert` - User feature data
- `SearchLog` / `RideHistory` - Analytics
- `WeatherLog` / `EventLog` / `TrafficLog` - External data inputs
- `RouteInsights` / `Recommendation` / `RecommendationAction` - AI recommendation pipeline

**File Storage:**
- None - No file upload or object storage configured

**Caching:**
- Upstash Redis (optional) - Distributed rate limiting across serverless instances
  - SDK: `@upstash/redis` + `@upstash/ratelimit`
  - Auth: `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` env vars
  - Client: `lib/redis.ts`
  - Rate limiter: `lib/rate-limiter.ts` (sliding window, 2-tier: burst + hourly)
  - Fallback: In-memory Maps (bounded to 10,000 entries, FIFO eviction) when Redis unconfigured
  - Configurable limits: `RATE_LIMIT_PER_HOUR` (default 50), `RATE_LIMIT_BURST` (default 3), `RATE_LIMIT_BURST_WINDOW` (default 10s)

- In-memory caches (process-local, resets on cold start)
  - Geocode cache: `GEOCODE_CACHE` in `lib/services/ride-comparison.ts`, TTL 5min, max 1000 entries
  - Route metrics cache: `ROUTE_CACHE` in `lib/services/ride-comparison.ts`, TTL 10min, max 1000 entries
  - AI response cache: `AI_RESPONSE_CACHE` in `lib/services/ai-insights.ts`, TTL 2h, max 200 entries

## Authentication & Identity

**Auth Provider:**
- NextAuth.js v5 (beta) with Prisma Adapter
  - Config: `auth.ts` (root)
  - Strategy: JWT (not database sessions)
  - Provider: Credentials (email + bcrypt password)
  - Custom pages: `/auth/signin`, `/auth/error`
  - Session contains: `id`, `email`, `name`, `image`
  - Required env vars: `NEXTAUTH_SECRET`, `NEXTAUTH_URL`
  - Password requirements enforced at schema level (12+ chars, mixed case, number)

## Monitoring & Observability

**Error Tracking:**
- Sentry: stubbed but not active (`lib/monitoring.ts` line 62 TODO)
- All errors logged via `logError()` which delegates to Axiom and console

**Logs:**
- Development: `console.debug` / `console.error` in `lib/monitoring.ts`
- Production: Axiom via REST API when `AXIOM_TOKEN` + `AXIOM_DATASET` set
- Log format: `{ timestamp, message, ...context }` (structured JSON)

**Health Check:**
- `lib/monitoring.ts` exports `healthCheck()` - checks DB (`DATABASE_URL` presence) and OSRM reachability

## CI/CD & Deployment

**Hosting:**
- Vercel (inferred from `@vercel/analytics`, `output: 'standalone'`, `vercel.json`)
- `vercel.json` defines one cron: `GET /api/cron/cleanup` at `0 3 * * *` (03:00 UTC daily)

**Docker:**
- `Dockerfile` + `docker-compose.yml` present for self-hosted deployments
- `docker-compose.yml` defines `web` (Next.js) + `db` (postgres:16-alpine) services
- DB health check via `pg_isready` before web starts

**CI Pipeline:**
- Not detected (no GitHub Actions, CircleCI, etc. config files found)

## Environment Configuration

**Required env vars:**
- `DATABASE_URL` - Prisma pooled connection string
- `DIRECT_URL` - Direct DB connection (for migrations)
- `NEXTAUTH_SECRET` - JWT signing secret
- `NEXTAUTH_URL` - Auth callback base URL (e.g., `http://localhost:3000`)

**Optional env vars (degrade gracefully without them):**
- `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` - Redis rate limiting (falls back to in-memory)
- `ANTHROPIC_API_KEY` - Claude AI insights (falls back to templates)
- `AI_DAILY_QUOTA` - Claude call budget (default 500)
- `NEXT_PUBLIC_RECAPTCHA_SITE_KEY` + `RECAPTCHA_API_KEY` + `RECAPTCHA_PROJECT_ID` - reCAPTCHA Enterprise
- `AXIOM_TOKEN` + `AXIOM_DATASET` - Structured log shipping
- `NEXT_PUBLIC_SENTRY_DSN` - Sentry error tracking (no-op currently)
- `RATE_LIMIT_PER_HOUR` / `RATE_LIMIT_BURST` / `RATE_LIMIT_BURST_WINDOW` - Rate limit tuning

**Secrets location:**
- `.env.local` for local development (gitignored)
- See `ENV_EXAMPLE.md` in project root for complete reference

## Webhooks & Callbacks

**Incoming:**
- None detected beyond reCAPTCHA verification callbacks (client-side)

**Outgoing:**
- None detected (no webhook dispatch code found)

---

*Integration audit: 2026-03-10*
