# Project Research Summary

**Project:** Comparative Rideshares — Reliability & Observability Milestone
**Domain:** Next.js 14 serverless reliability, Redis caching, test coverage, in-app alerting
**Researched:** 2026-03-10
**Confidence:** HIGH

## Executive Summary

This milestone is a reliability pass on an existing, working Next.js 14 ride comparison app — not a greenfield build. The app has ride comparison, pricing, maps, price alerts, AI recommendations, and auth already implemented. The research reveals a consistent pattern: the app was built with correct architectural intent (caching, error tracking, AI quota limits, test infrastructure) but each of those systems was implemented in a way that works locally and fails silently in production. Module-level caches evaporate on Vercel cold starts, the Jest setup file never loads due to a typo, error tracking is a stubbed TODO, and price alerts are stored but never evaluated. The recommended approach is a focused four-phase reliability pass that fixes each of these gaps in dependency order.

The most important architectural decision this milestone must make is how caches survive serverless restarts. The existing Upstash Redis client (`lib/redis.ts`) is already provisioned and used for rate limiting — the same client must become the L2 durable cache behind all in-memory Maps. The pattern (L1 Map for same-isolate burst, Redis L2 for cross-instance and cross-restart durability) is already proven by `lib/rate-limiter.ts`. Replicating that pattern to geocode, route, comparison, recommendation, and AI response caches eliminates the primary reliability gap. A new `lib/cache/redis-cache.ts` abstraction (`getCached<T>(key, ttl, compute)`) ensures all services use a consistent cache interface rather than scattering raw Redis calls.

The key risk in this milestone is execution order. Several features are mutually dependent: the Jest typo must be fixed before test coverage can be trusted, monitoring must be wired before making infrastructure changes, the Redis cache layer must be built before AI quota tracking and alert evaluation can work correctly, and the `AlertNotification` schema must be migrated before alert evaluation can be wired into the comparison path. Deviating from the build order documented in ARCHITECTURE.md risks implementing features against a broken foundation.

## Key Findings

### Recommended Stack

No new packages are needed for core reliability work. The existing stack is fixed and fully capable. The one exception is replacing `next-axiom` (maintenance-only) with the active `@axiomhq/nextjs` package from the same vendor — this upgrades error tracking from a stub to a working integration without adding a second vendor or second billing account.

**Core technologies:**
- `@axiomhq/nextjs` (0.2.0): Replace `next-axiom` — active replacement per official Axiom docs; provides `withAxiom` wrapper for route handler exception capture
- `@axiomhq/logging` (0.2.0): Peer dependency providing `AxiomJSTransport`; required for `@axiomhq/nextjs`
- `@upstash/redis` (1.36.4, existing): Extend from rate-limiting only to full L2 cache and atomic quota counter; HTTP-based client compatible with Vercel serverless and Edge runtimes
- `jest` (29.7.0, existing): No upgrade needed; fix typo in config key; expand coverage globs
- `@playwright/test` (1.58.2, existing): Extend from nav smoke tests to full comparison flow; use `page.route()` for external API mocking

**Do not use:** Sentry (Axiom covers the need), `next-axiom` (maintenance-only), MapGrab (archived July 2025), `redis.pipeline()` for quota (not atomic — use `redis.multi()`), WebSockets or SSE for alerts (Vercel 25s timeout incompatible).

### Expected Features

This milestone is a reliability pass. The features are fixes and closures, not new product capabilities.

**Must have (table stakes — demo breaks without these):**
- Jest `setupFilesAfterEnv` typo fix — `@testing-library/jest-dom` matchers unavailable in all tests until this is corrected
- Redis-backed geocode, route, and comparison caches — in-memory Maps have near-zero hit rate in Vercel serverless
- Atomic AI quota counter via Redis INCR — module-level counter is per-instance and resets on cold starts; quota is illusory
- Working error tracking — `logError` is a stub; production errors are currently invisible
- Health check endpoint with Redis probe — DB check exists but Redis and OSRM are unchecked
- E2E test for the core comparison happy path — only nav smoke tests exist; the primary user flow has zero E2E coverage
- Coverage measured across the full codebase — current `collectCoverageFrom` covers ~30% of actual code

**Should have (closes open features, visible to reviewers):**
- In-app price alert delivery via polling — alerts are created and stored but never evaluated; the schema is complete, the evaluation loop is missing
- Consolidated AI provider (OpenAI only) — Anthropic SDK can be removed; simpler secrets management
- Unified compare-rides request format — dual legacy/coordinate format doubles test surface area

**Defer (explicitly out of scope):**
- SSE / WebSocket real-time delivery — Vercel 25s timeout incompatible with persistent connections
- Email/push notifications — external provider dependency, explicitly excluded per PROJECT.md
- Sentry APM — Axiom covers the need at zero additional cost
- Price trend charts — new feature, not reliability work

### Architecture Approach

The target architecture adds a Redis L2 cache layer between existing in-memory Maps and external API calls, triggers alert evaluation as a non-blocking fire-and-forget after each comparison completes, and extracts the 938-line `ride-comparison.ts` into focused modules. The key structural addition is `lib/cache/redis-cache.ts` (a typed `getCached<T>` wrapper) and `lib/alerts/evaluate-alerts.ts` (a pure function that takes route ID and price snapshots, returns notifications created). All other changes are wiring — no architecture invention required.

**Major components:**
1. `lib/cache/redis-cache.ts` — typed L1+L2 cache wrapper; all services use this, never raw `redis` calls; eliminates scattered key naming and TTL management
2. `lib/alerts/evaluate-alerts.ts` — pure function; queries active PriceAlert rows for route, compares against fresh snapshots, writes AlertNotification rows; called fire-and-forget from compare-rides route
3. `AlertNotification` Prisma model — new schema addition; stores triggered notifications with `isRead` flag; read by dashboard route to surface unread count
4. `lib/monitoring.ts` (repaired) — remove Sentry stub, replace `any` types with `LogContext`/`ErrorContext` interfaces, ensure `logError` calls Axiom with `level: "error"`
5. `lib/services/geocoding.ts` + `lib/services/routing.ts` (extracted) — pure refactor from 938-line `ride-comparison.ts`; no behavior change; enables isolated testing of each concern

### Critical Pitfalls

1. **`setupFilesAfterEnv` typo (`setupFilesAfterSetup` in jest.config.js line 10)** — Jest silently ignores unknown config keys; `jest.setup.ts` never loads; all `toBeInTheDocument()` assertions throw "not a function". Fix this first. Verify with `npx jest --showConfig | grep setupFilesAfterEnv`. This is a one-line fix that unblocks all other test work.

2. **In-memory Map caches evaporate on every Vercel cold start** — Local development runs a single process so caches appear to work; production cold starts (frequent on serverless) reset all Maps to empty. External Nominatim and OSRM calls happen at full rate in production. Fix: `getCached<T>` wrapper using Redis L2 with the same key scheme already defined (e.g. `geocode:{normalized-address}`, `route:exact:{coords}`, TTLs matching current Map values).

3. **Module-level AI quota counter is per-isolate** — `dailyCallCount` in `ai-insights.ts` resets on every cold start. Each isolate believes it is the first call of the day. The quota provides zero protection in production. Fix: `redis.incr(key)` + `redis.expire(key, 86400)` on count === 1. This is the Upstash-canonical atomic quota pattern.

4. **`logError` is a stub — production errors are invisible** — The Sentry SDK check passes but the SDK was never imported; errors fall through to Axiom `log()` only if env vars are set. Production 500 errors currently leave no trace. Fix: Replace Sentry conditional with direct Axiom structured log at `level: "error"`. Remove `NEXT_PUBLIC_SENTRY_DSN` check entirely. No new SDK needed.

5. **Price alert polling storm from duplicate `useEffect` intervals** — If the dashboard polling hook is implemented naively, navigating away and back accumulates intervals (2x, 4x, 8x rate). At the current rate-limit burst (3 per 10s), authenticated users get throttled on their own dashboard. Fix: Use a single `useRef` to track interval ID; always clear on unmount; use 60s+ poll interval; pause polling when `document.visibilityState === 'hidden'`.

## Implications for Roadmap

Based on research, suggested phase structure:

### Phase 1: Foundation — Test Infrastructure & Observability

**Rationale:** Everything else is built on top of these two systems. Tests cannot be trusted until the Jest typo is fixed. Infrastructure changes cannot be made safely without error tracking. These are zero-dependency fixes that unblock all subsequent work. Do both in the same phase because they have the same priority and no interdependency.

**Delivers:** Working test suite with correct coverage measurement; working error logging that captures production exceptions; TypeScript-clean monitoring module

**Addresses:**
- Jest `setupFilesAfterEnv` typo fix
- `collectCoverageFrom` glob expansion to full `lib/**` and `components/**`
- `lib/monitoring.ts` `any` type removal and Sentry stub replacement with Axiom `logError`
- `@axiomhq/nextjs` package swap from `next-axiom`
- Health check endpoint with DB + Redis + OSRM probes

**Avoids:** Building Redis cache layer against a broken test infrastructure; making infrastructure changes without error observability

**Research flag:** Standard patterns — no additional research needed. All changes are single-file edits with documented solutions.

---

### Phase 2: Redis Cache Layer Migration

**Rationale:** The `lib/cache/redis-cache.ts` abstraction is a prerequisite for Phase 3 (AI quota) and Phase 4 (alert evaluation uses cached comparison data). Building the cache wrapper in isolation — before wiring it to anything — keeps the change reviewable and testable on its own.

**Delivers:** `getCached<T>` wrapper with L1 Map + L2 Redis; all service caches migrated; geocode, route, comparison, recommendation, and AI response caches survive cold starts; cache hit/miss logging visible in Axiom

**Addresses:**
- `lib/cache/redis-cache.ts` new helper
- Geocode cache migration in `lib/services/ride-comparison.ts` (or extracted `geocoding.ts`)
- Route cache migration
- Comparison cache migration
- Recommendation cache migration in `lib/services/recommendations.ts`
- AI response cache migration in `lib/services/ai-insights.ts`

**Uses:** `@upstash/redis` (existing); key naming convention from ARCHITECTURE.md

**Avoids:** Per-service raw Redis calls (anti-pattern 2 from ARCHITECTURE.md); `redis.pipeline()` for quota (non-atomic)

**Research flag:** Standard patterns — Upstash docs and ARCHITECTURE.md provide exact key scheme, TTLs, and L1+L2 pattern. No additional research needed.

---

### Phase 3: AI Quota Tracking & Provider Consolidation

**Rationale:** Depends on Phase 2 (Redis client wrapper established). Atomic quota is a simple `INCR` key using the same `getCached` infrastructure. Consolidating AI to OpenAI-only reduces secrets and removes the Anthropic SDK — do it in the same phase while touching `ai-insights.ts` for quota.

**Delivers:** Atomic cross-instance daily quota counter; Anthropic SDK removed; single AI provider (OpenAI); quota key visible in Upstash console

**Addresses:**
- Replace `dailyCallCount` module variable with `redis.incr(quota:ai:YYYY-MM-DD)` + conditional `expire`
- Remove Anthropic SDK import; rewrite `enhanceWithAI` using OpenAI SDK (already present)
- Unified provider means single `ANTHROPIC_API_KEY` secret can be removed from Vercel

**Avoids:** Quota bypassed in serverless (pitfall 1); two-vendor AI complexity

**Research flag:** Standard patterns — Upstash quota blog documents exact INCR + EXPIRE-on-count-1 pattern. No additional research needed.

---

### Phase 4: Price Alert Delivery

**Rationale:** Requires Phase 2 Redis cache (evaluation reads cached prices) and a new `AlertNotification` schema migration. The `PriceAlert` model is complete; only the evaluation loop and notification model are missing. This closes the most visible open feature — alerts are currently a UI dead-end.

**Delivers:** `AlertNotification` Prisma model and migration; `evaluateAlertsForRoute()` pure function; alert evaluation wired into compare-rides route (fire-and-forget); unread notifications surfaced in dashboard GET; in-app polling hook with correct cleanup

**Addresses:**
- `AlertNotification` model: `id`, `alertId`, `userId`, `routeId`, `service`, `triggeredPrice`, `targetPrice`, `isRead`, `createdAt`
- `lib/alerts/evaluate-alerts.ts` pure function (takes routeId + snapshots, returns created notifications)
- Wire evaluation into `app/api/compare-rides/route.ts` after `persistComparison()`
- Add unread notification count to `GET /api/dashboard`
- Dashboard polling hook with `useRef` interval ID and `visibilitychange` pause

**Avoids:** Alert polling storm (pitfall 6 from PITFALLS.md); cron-based evaluation (anti-pattern 1 from ARCHITECTURE.md)

**Research flag:** AlertNotification schema design is straightforward from ARCHITECTURE.md. Polling hook pattern is documented in PITFALLS.md. No additional research needed.

---

### Phase 5: Refactoring & Test Coverage Expansion

**Rationale:** Refactoring after tests are green (Phase 1) and features are stable (Phases 2–4) is safe. Extracting `geocoding.ts` and `routing.ts` from the 938-line `ride-comparison.ts` makes each concern independently testable. E2E comparison flow tests should be added last — they are the integration validation that everything works end-to-end.

**Delivers:** `lib/services/geocoding.ts` and `routing.ts` extracted; `ride-comparison.ts` reduced to orchestrator (<300 lines); E2E comparison happy path test; E2E OSRM error state test; unit tests for extracted modules; consolidated `DEFAULT_SERVICES` constants; unified compare-rides request format (coordinate-only)

**Addresses:**
- Extract `geocodeWithCache` → `lib/services/geocoding.ts`
- Extract `getRouteMetrics` + `resolveRouteMetrics` + `fetchWithPolicy` → `lib/services/routing.ts`
- `e2e/comparison-flow.spec.ts` with Nominatim + OSRM mocking via `page.route()`
- `e2e/comparison-flow.spec.ts` error state test (OSRM abort → estimated route warning)
- Unify legacy string and coordinate request formats in compare-rides route
- Remove `DEFAULT_SERVICES` constant duplication

**Avoids:** Growing `ride-comparison.ts` further (anti-pattern 4 from ARCHITECTURE.md); barrel file circular dependencies (use `npx madge --circular lib/` before and after)

**Research flag:** Well-documented refactoring patterns. MapLibre E2E testing approach (test DOM surrounding the map, not canvas pixels) is documented in ARCHITECTURE.md. No additional research needed.

---

### Phase Ordering Rationale

- **Phase 1 must be first.** The Jest typo means no test can be trusted. Error tracking must exist before making infrastructure changes — otherwise a broken Redis migration is invisible. These two fixes have no dependencies on anything else.
- **Phase 2 must precede Phases 3 and 4.** The `getCached<T>` abstraction is the prerequisite for both atomic quota tracking (Phase 3) and alert evaluation (Phase 4, which reads cached comparison data to avoid re-fetching prices).
- **Phase 3 can overlap with Phase 4** if parallelizing work. The only shared file is `lib/services/ai-insights.ts`. Keep them sequential to avoid merge conflicts.
- **Phase 4 requires a Prisma migration** (AlertNotification model). This is the only schema change in the milestone. It must be applied before the evaluation function can be wired in.
- **Phase 5 is last** because it refactors code that Phases 2–4 modify. Refactoring first, then adding features to refactored code, creates unnecessary rebase risk.

### Research Flags

Phases with standard patterns (research-phase not needed):
- **Phase 1:** Single-character Jest fix + Axiom docs are authoritative. All solutions are documented in STACK.md.
- **Phase 2:** Upstash L1+L2 pattern is documented in ARCHITECTURE.md. Key naming convention is fully defined.
- **Phase 3:** Upstash INCR + EXPIRE-on-count-1 is the canonical quota pattern per official Upstash blog.
- **Phase 4:** Schema and data flow fully specified in ARCHITECTURE.md. Polling anti-patterns documented in PITFALLS.md.
- **Phase 5:** Refactoring strategy (extract-leaf-utilities-first) documented in ARCHITECTURE.md.

No phases require `/gsd:research-phase` — the existing research is comprehensive and grounded in direct source code audit.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All recommendations verified against official docs and npm registry; no speculative choices |
| Features | HIGH | Grounded in direct codebase audit of existing stubs, gaps, and working systems |
| Architecture | HIGH | Derived from reading all source files directly; build order validated against actual dependency graph |
| Pitfalls | HIGH | Every critical pitfall verified against live code (specific file and line references); not inferred |

**Overall confidence:** HIGH

### Gaps to Address

- **`setupFilesAfterEnv` exact correction:** PITFALLS.md and STACK.md contain a minor inconsistency — the typo fix is variously called `setupFilesAfterEnv`, `setupFilesAfterFramework`, and `setupFilesAfterEach` across the research files. The correct Jest key is `setupFilesAfterEnv`. Verify by checking official Next.js Jest docs before implementing.
- **Upstash free tier limits:** Research notes the free tier allows 10k requests/day. With Redis now handling caching AND rate limiting, request count per comparison will increase (geocode get/set + route get/set + comparison get/set = ~6 additional Redis calls per request). Validate that free tier is sufficient for expected demo traffic, or note the risk.
- **AlertNotification PATCH endpoint:** ARCHITECTURE.md specifies `PATCH /api/price-alerts/notifications/:id` to mark notifications as read, but the polling and delivery sections focus on creation. The read-marking flow needs implementation design during Phase 4 planning.
- **E2E test stability for MapLibre:** STACK.md explicitly deprecates MapGrab (archived July 2025) and recommends `page.route()` tile blocking + `page.locator('canvas')`. FEATURES.md references MapGrab as still available. Use STACK.md guidance — MapGrab is archived and should not be added.

## Sources

### Primary (HIGH confidence)
- [Axiom Next.js docs](https://axiom.co/docs/send-data/nextjs) — `@axiomhq/nextjs` as active `next-axiom` replacement
- [Axiom new JS logging announcement](https://axiom.co/blog/new-js-logging) — `withAxiom` wrapper setup
- [Next.js Jest docs](https://nextjs.org/docs/app/guides/testing/jest) — `setupFilesAfterEnv` correct key, `coverageProvider: 'v8'`
- [Upstash quota pattern](https://upstash.com/blog/quota-based-saas) — INCR + EXPIRE-on-count-1 atomic quota
- [Upstash pipeline/transaction docs](https://upstash.com/docs/redis/sdks/ts/pipelining/pipeline-transaction) — `redis.multi()` for atomicity
- [Playwright network docs](https://playwright.dev/docs/network) — `page.route()` mocking, `networkidle` discouraged
- [MapGrab GitHub](https://github.com/MapGrab/map-grab-packages) — archived July 2025, confirmed read-only
- Direct source code audit — `lib/services/ride-comparison.ts`, `lib/services/ai-insights.ts`, `lib/monitoring.ts`, `jest.config.js`, `prisma/schema.prisma`, `app/api/price-alerts/route.ts`, `e2e/nav-smoke.spec.ts`

### Secondary (MEDIUM confidence)
- [Redis caching strategies for Next.js production](https://www.digitalapplied.com/blog/redis-caching-strategies-nextjs-production) — serverless cache isolation pitfalls
- [Testing MapLibre with Playwright](https://falseinput.com/testing-maplibre-gl-js-applications-with-mapgrab-and-playwright) — MapLibre E2E approach
- [Circular dependency / barrel file pitfalls](https://medium.com/@idrussalam95/fixing-circular-dependencies-in-node-js-a-battle-against-barrel-files-and-god-classes-e7d13df995f0) — refactor risks

### Tertiary (LOW confidence)
- [nextcov — coverage for Next.js server components](https://dev.to/stevez/nextcov-collecting-test-coverage-for-nextjs-server-components-6gc) — server component coverage gaps (not directly applicable since this milestone targets API routes and utilities, not server components)

---
*Research completed: 2026-03-10*
*Ready for roadmap: yes*
