# Roadmap: Comparative Rideshares — Reliability Milestone

## Overview

This milestone is a focused reliability pass on a working app. The existing codebase has correct architectural intent — caching, error tracking, AI quota limits, test infrastructure, price alerts — but each of those systems fails silently in production. Four phases fix these gaps in dependency order: first establish a trustworthy foundation (tests + observability), then build durable infrastructure (Redis cache layer), then consolidate and clean up code quality, and finally close the most visible open feature (price alert delivery) with end-to-end test coverage confirming everything works.

## Phases

- [x] **Phase 1: Foundation** - Fix Jest infrastructure and wire real observability (health checks, error tracking, cache telemetry) (completed 2026-03-10)
- [ ] **Phase 2: Redis Cache Layer** - Migrate all in-memory caches to Redis-backed L1+L2 so data survives serverless cold starts
- [ ] **Phase 3: AI Consolidation & Code Quality** - Remove Anthropic SDK, consolidate to OpenAI, replace any types, unify constants and request formats
- [ ] **Phase 4: Alert Delivery & E2E Coverage** - Evaluate price alerts after each comparison and surface in-app notifications; E2E test covers the full comparison flow

## Phase Details

### Phase 1: Foundation
**Goal**: Tests are trustworthy and production errors are visible
**Depends on**: Nothing (first phase)
**Requirements**: TEST-01, TEST-02, OBSV-01, OBSV-02, OBSV-03, OBSV-04
**Success Criteria** (what must be TRUE):
  1. Running `npm test` loads `@testing-library/jest-dom` matchers — `toBeInTheDocument()` does not throw "not a function"
  2. Jest coverage report includes components, lib, and hooks — not only app/api/ and lib/services/
  3. `GET /api/health` returns a JSON response with measured latency for database and Redis connectivity
  4. A production 500 error is captured in Axiom as a structured log entry with `level: "error"` — no Sentry stub code remains
  5. Cache hit/miss events are visible as structured entries in Axiom logs
**Plans**: 3 plans

Plans:
- [ ] 01-01-PLAN.md — Fix Jest config typo (setupFilesAfterEnv) and expand coverage globs; remove duplicate mocks
- [ ] 01-02-PLAN.md — Add Redis health check to healthCheck(); replace Sentry stub in logError() with Axiom structured log
- [ ] 01-03-PLAN.md — Instrument cache hit/miss paths with structured event fields in ride-comparison service

### Phase 2: Redis Cache Layer
**Goal**: All caches survive Vercel cold starts — the same geocode, route, comparison, recommendation, and AI response data is served from Redis across all serverless instances
**Depends on**: Phase 1
**Requirements**: INFR-01, INFR-02, INFR-03, INFR-04, INFR-05, INFR-06
**Success Criteria** (what must be TRUE):
  1. Making two identical comparison requests from different serverless invocations returns the second result from Redis cache (observable via Axiom cache-hit logs)
  2. Geocode, route, comparison, recommendation, and AI response caches each have a TTL visible in the Upstash console
  3. No service makes raw `redis.get` / `redis.set` calls — all caching goes through a single `getCached<T>` wrapper
  4. AI quota counter in Redis increments atomically — Upstash console shows a key like `quota:ai:YYYY-MM-DD` with a daily TTL
**Plans**: 3 plans

Plans:
- [ ] 02-01-PLAN.md — Create getCached<T> wrapper (lib/cache/redis-cache.ts) with L1+L2 logic, incrementQuotaCounter, clearCacheNamespace; TDD with unit tests
- [ ] 02-02-PLAN.md — Migrate GEOCODE_CACHE, ROUTE_CACHE, COMPARISON_CACHE in ride-comparison.ts to getCached; update resetRideComparisonCaches
- [ ] 02-03-PLAN.md — Migrate REC_CACHE in recommendations.ts and AI_RESPONSE_CACHE + dailyCallCount in ai-insights.ts to getCached/incrementQuotaCounter

### Phase 3: AI Consolidation & Code Quality
**Goal**: A single AI provider (OpenAI), no TypeScript `any` escapes in monitored paths, and no duplicated configuration constants or dual API request formats
**Depends on**: Phase 2
**Requirements**: INFR-07, QUAL-01, QUAL-02, QUAL-03, FEAT-02
**Success Criteria** (what must be TRUE):
  1. The Anthropic SDK is not listed in package.json — `ANTHROPIC_API_KEY` is not required to run the app
  2. `lib/monitoring.ts`, dashboard API handler, and database-logging module pass `tsc` with zero `any` types
  3. `COMMON_PLACES` / `DEFAULT_SERVICES` appears in exactly one file (`lib/constants.ts`) — no duplicates
  4. All external API base URLs (Nominatim, OSRM) are referenced through `API_CONFIG` — no hardcoded strings in service files
  5. The compare-rides API rejects the legacy string request format and accepts only the coordinate format — confirmed by an updated unit test
**Plans**: TBD

### Phase 4: Alert Delivery & E2E Coverage
**Goal**: Saved price alerts actually fire in-app when prices drop below target, and a Playwright test confirms the full comparison flow works end-to-end
**Depends on**: Phase 3
**Requirements**: FEAT-01, TEST-03
**Success Criteria** (what must be TRUE):
  1. After a price comparison, if the result price is below a user's saved alert threshold for that route, an unread notification appears in the dashboard without any manual action
  2. The dashboard GET endpoint returns an `unreadAlertCount` (or equivalent) that a UI badge can display
  3. A Playwright test navigates from the home page, enters two Bay Area addresses, submits the comparison form, and asserts that at least one ride option renders with a price — with Nominatim and OSRM calls intercepted via `page.route()`
  4. Running `npm run test:e2e` exits 0 with the comparison flow test included in the report

## Progress

**Execution Order:** 1 → 2 → 3 → 4

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation | 3/3 | Complete    | 2026-03-10 |
| 2. Redis Cache Layer | 0/3 | Not started | - |
| 3. AI Consolidation & Code Quality | 0/? | Not started | - |
| 4. Alert Delivery & E2E Coverage | 0/? | Not started | - |
