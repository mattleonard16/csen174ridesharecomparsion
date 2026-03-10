# Feature Research

**Domain:** Reliability & Observability — Portfolio ride comparison app
**Researched:** 2026-03-10
**Confidence:** HIGH (findings grounded in existing codebase audit + verified ecosystem sources)

---

## Context: This Is a Reliability Milestone, Not a Feature Milestone

The app already has ride comparison, pricing, maps, alerts, AI recommendations, and auth. The
question this research answers is: **what does "reliable and demo-safe" actually mean as a feature
set**, and what is table stakes vs differentiator for a portfolio app a recruiter will click through?

---

## Feature Landscape

### Table Stakes (Users Expect These)

Features that must work or the app feels broken during a live demo. These are non-negotiable.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Price alerts that visibly trigger | Alert creation exists but delivery is a no-op — creates distrust when promised functionality silently does nothing | MEDIUM | Polling is the right choice here (see Anti-Features); interval check against Redis-cached comparison data |
| Health check returns real status | `/api/health` exists but only checks DB; Redis and OSRM connectivity are unchecked; Vercel cron integrations expect 200/503 | LOW | Already ~80% done; add Redis ping and fix OSRM endpoint reference from constants |
| Error states shown in UI | When geocoding fails or OSRM is down, the form should show a user-facing message, not a spinner or silent failure | LOW | Already partially done via `CompareServiceError` — needs E2E coverage to verify it renders |
| Jest setup actually works | `setupFilesAfterSetup` typo means jest.setup.ts never loads; `@testing-library/jest-dom` matchers silently unavailable | LOW | One-character fix — `setupFilesAfterFramework` → `setupFilesAfterEach` fix is `setupFilesAfterFramework`; correct key is `setupFilesAfterFramework` — see jest.config.js line 10 |
| Coverage measured across full codebase | Currently only `app/api/`, `lib/services/`, `lib/monitoring.ts` — misses pricing engine, geo utilities, validation, rate limiter | LOW | Expand `collectCoverageFrom` glob patterns |
| E2E tests cover the comparison flow | Only nav smoke tests exist; core value (enter addresses → get results → see map route) has zero E2E coverage | MEDIUM | Happy path + geocode error + route error states |
| Caches survive serverless restarts | In-memory `Map` caches in `ride-comparison.ts` and `ai-insights.ts` reset on every cold start; each instance has its own cache | MEDIUM | Move geocode + route + AI quota to Upstash Redis with TTL-keyed `get`/`set` calls |
| AI quota tracking is atomic | Module-level `dailyCallCount` in `ai-insights.ts` is per-instance; multiple instances can each burn the full quota | LOW | Replace with `redis.incr()` + `redis.expireat()` for atomic cross-instance counting |
| Single API request format | Compare endpoint accepts both legacy string format and new coordinate format; dual-path logic adds surface area for bugs | MEDIUM | Unify to coordinate-based; add backward-compat adapter at boundary only |

### Differentiators (Competitive Advantage)

Features that make this project stand out as a portfolio piece — demonstrating production thinking
beyond basic CRUD.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| In-app price alert delivery (polling) | Closes the loop on a promised feature — alerts aren't just stored, they fire; shows full-stack feature ownership | MEDIUM | Poll `/api/price-alerts/check` on a 30s interval when user is logged in; cross-reference current comparison prices against stored target; show toast notification in UI |
| Structured error taxonomy surfaced in UI | `CompareServiceError` with typed codes (ADDRESS_NOT_FOUND, GEOCODE_TIMEOUT, etc.) already exists in the service layer — surfacing these to users with specific messages is a differentiator over generic "something went wrong" | LOW | Wire existing error codes to user-facing copy; already partially done in `compare-rides/route.ts` error map |
| Health endpoint with per-dependency latency | `/api/health` returning `{ status: "degraded", checks: { database: { healthy: true, latency: 12 }, redis: { healthy: true, latency: 8 }, osrm: { healthy: false, error: "timeout" } } }` signals production operational thinking | LOW | Already structured this way; just needs Redis check added |
| Redis-backed cache with observable hit/miss ratio | Log cache hits vs misses with `log()` calls; visible in Axiom dashboard; demonstrates caching literacy | LOW | Add hit/miss counters to Redis cache wrapper |
| Consolidated AI provider (OpenAI only) | Removes Anthropic SDK dependency; single quota tracker; cleaner secrets management; shows pragmatic tradeoff decisions | LOW | Delete `ai-insights.ts` Anthropic import, rewrite using OpenAI SDK already present |

### Anti-Features (Commonly Requested, Often Problematic)

Features that seem like good ideas for this milestone but should be deliberately skipped.

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| SSE for real-time price alert delivery | "Real-time" feels more impressive than polling | Vercel serverless has a 25s function timeout; SSE requires a persistent connection; needs Redis Pub/Sub to broadcast across instances; adds infrastructure complexity (heartbeat, reconnect logic) that has nothing to do with this milestone's goals | HTTP polling every 30s is imperceptible to users for price alerts and requires zero infrastructure change |
| WebSocket for live price updates | Bidirectional real-time is the "premium" version | Vercel does not support persistent WebSocket connections natively; requires a separate WebSocket server (Ably, Pusher, Rivet) or Edge Runtime workarounds; massive scope expansion for marginal demo value | Precomputed popular routes already give instant results; polling for alerts is sufficient |
| Full Sentry APM integration | Error tracking is a stated goal | Sentry adds a Next.js wrapper to the build, source map uploads, SDK initialization in layout — significant setup for a portfolio app; Axiom is already integrated and captures structured logs | Extend `logError()` in `lib/monitoring.ts` to send to Axiom with `level: error`; add Axiom alert rule on error volume; gives 80% of Sentry value with 0% of the setup cost |
| Email/push notifications for price alerts | "Real" alert delivery | Requires external provider (Resend, SendGrid, FCM), additional secrets, unsubscribe flow, rate limit per-user per-day — all out of scope per PROJECT.md decision log | In-app badge + toast is sufficient for a demo and clearly labeled as in-app only |
| Session replay / RUM | Shows user behavior | Heavy SDK (~50KB+), privacy implications, configuration overhead; not relevant for a portfolio demo where you control the walkthrough | Core Web Vitals via Next.js built-in analytics are sufficient signal |
| CI/CD pipeline | Shows DevOps maturity | Vercel already handles this; adding a custom pipeline duplicates it without adding value; explicitly out of scope per PROJECT.md | Vercel's preview deployments + branch protection is the CI story |
| Centralized auth middleware | "Cleaner" architecture | Per PROJECT.md decision: per-handler auth works and is testable; adding middleware adds complexity for no measurable benefit at current route count | Keep per-handler `auth()` calls |

---

## Feature Dependencies

```
Price alert delivery (in-app polling)
    └──requires──> Redis-backed cache (cross-instance state)
                       └──requires──> Upstash Redis client (already exists in lib/redis.ts)

AI quota tracking (atomic)
    └──requires──> Redis client (already exists)

Health check (complete)
    └──requires──> Redis ping check (add to lib/monitoring.ts)
    └──requires──> DB check (already exists)
    └──requires──> OSRM check (already exists, uses hardcoded URL — fix to use API_CONFIG)

Jest + coverage (working)
    └──requires──> setupFilesAfterFramework typo fix (unblocks all test assertions)
    └──enhances──> E2E tests (E2E can run independently but unit test gaps are easier to see once coverage is real)

E2E comparison flow tests
    └──requires──> Dev server running (Playwright already configured against npm run dev)
    └──enhances──> MapLibre map tests (MapGrab library available for MapLibre-specific assertions)
```

### Dependency Notes

- **Redis cache requires Redis client:** The client exists (`lib/redis.ts`) with graceful degradation when not configured. Cache writes must guard with `if (redis)` same as rate limiter does.
- **Jest fix unblocks everything else:** The `setupFilesAfterSetup` typo means `expect(x).toBeInTheDocument()` always throws "not a function" — fixing this is the first task because broken test infrastructure makes all other test work unreliable.
- **E2E map tests require MapGrab:** Plain Playwright cannot await MapLibre's `load` event. MapGrab (`@mapgrab/playwright`) resolves this by providing `waitForMapLoaded()` and `queryRenderedFeatures()` helpers specifically for MapLibre/Mapbox GL.
- **In-app alert polling enhances existing alert creation:** Create alert → poll check endpoint → show toast. The polling check endpoint is the only new surface; alert creation and storage already work.

---

## MVP Definition

This is a reliability milestone, not a greenfield MVP. The following maps "must fix" vs "should add" vs "defer."

### Fix First (Blocking Demo Quality)

- [x] Fix `setupFilesAfterSetup` typo in `jest.config.js` — unblocks all unit test assertions
- [ ] Fix Jest `collectCoverageFrom` to cover `lib/pricing.ts`, `lib/geo.ts`, `lib/validation.ts`, `lib/rate-limiter.ts`
- [ ] Add E2E test: happy path comparison flow (enter addresses → get results → see map)
- [ ] Add E2E test: error state when addresses cannot be geocoded
- [ ] Add Redis ping to health check endpoint
- [ ] Move geocode cache from in-memory `Map` to Upstash Redis with TTL
- [ ] Move AI quota counter to Redis atomic `INCR` with daily `EXPIREAT`

### Add After Fixes (Closes Open Features)

- [ ] Implement price alert polling check endpoint (`GET /api/price-alerts/check`)
- [ ] Add toast notification in UI when a user's alert price threshold is crossed
- [ ] Consolidate AI provider to OpenAI; remove Anthropic SDK
- [ ] Unify compare-rides API to coordinate-based format only

### Defer (Out of Scope for This Milestone)

- [ ] SSE / WebSocket real-time delivery — architectural complexity, no demo value over polling
- [ ] Email/push notifications — external provider dependency, out of scope per decision log
- [ ] Sentry APM — Axiom covers the logging need; alerting via Axiom rules is sufficient
- [ ] Price trend charts — new feature, not reliability work

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Jest setup fix (typo) | HIGH (unblocks coverage) | LOW (1 line) | P1 |
| Redis-backed geocode cache | HIGH (cross-instance correctness) | MEDIUM (wrapper + TTL logic) | P1 |
| AI quota atomic counter | HIGH (prevents quota overrun in prod) | LOW (redis.incr swap) | P1 |
| Health check Redis probe | MEDIUM (completeness) | LOW (10 lines) | P1 |
| E2E comparison happy path | HIGH (proves core feature works) | MEDIUM (Playwright + MapGrab) | P1 |
| E2E error states | MEDIUM (proves resilience) | LOW (extend happy path test) | P1 |
| Coverage glob expansion | MEDIUM (visibility) | LOW (config change) | P1 |
| In-app alert delivery (polling) | HIGH (closes promised feature) | MEDIUM (check endpoint + toast) | P2 |
| Consolidate to OpenAI | MEDIUM (reduces secrets/complexity) | LOW (rewrite ai-insights.ts) | P2 |
| Unified request format | MEDIUM (reduces bug surface) | MEDIUM (adapter + type cleanup) | P2 |
| TypeScript `any` elimination | LOW (code quality) | MEDIUM (type archaeology) | P3 |
| Large file refactoring | LOW (maintainability) | HIGH (careful extraction) | P3 |

**Priority key:**
- P1: Must fix for milestone — demo is broken or misleading without this
- P2: Should complete — closes known gaps, visible to reviewers
- P3: Nice to have — worth doing but does not affect demo quality

---

## Competitor Feature Analysis

Framed as: what do production-grade Next.js reliability milestones typically include vs what's overkill for a portfolio demo.

| Feature | Production Standard | Portfolio Demo Need | Our Approach |
|---------|---------------------|---------------------|--------------|
| Error tracking | Sentry with source maps + session replay | Structured logs with error-level alerting | Axiom `logError()` + Axiom alert rule on error volume; no SDK overhead |
| Health checks | `/health` + `/ready` + `/live` (Kubernetes pattern) | Single `/health` with dependency checks and latency | Single endpoint returning `{ status, checks: { db, redis, osrm } }` |
| Caching | Redis cluster with read replicas, cache warming | Single Upstash instance with TTL | Upstash with `get`/`set` + TTL; graceful degradation to in-memory |
| Test coverage | 80%+ with mandatory coverage gates in CI | 80%+ measured correctly, visibly passing | Fix jest config + expand globs; coverage visible in `npm run quality` |
| Notification delivery | Push/email with SLA | In-app polling, visible in dashboard | 30s polling against check endpoint; toast on match |
| Real-time data | WebSocket / SSE for sub-second updates | Deterministic pricing shows same result repeatably | Precomputed routes + 45s cache covers demo use case |

---

## Sources

- Upstash blog: [Building Real-Time Notifications with Upstash Redis, Next.js Server Actions and Vercel](https://upstash.com/blog/realtime-notifications) — confirms Redis Pub/Sub pattern for SSE multi-instance; also confirms polling is sufficient for low-frequency notifications
- GitHub Discussion: [Server-Sent Events don't work in Next API routes](https://github.com/vercel/next.js/discussions/48427) — confirms Vercel 25s timeout constraint for SSE
- MapGrab: [Testing MapLibre GL JS applications with MapGrab and Playwright](https://falseinput.com/testing-maplibre-gl-js-applications-with-mapgrab-and-playwright) — confirms `@mapgrab/playwright` is the correct tool for MapLibre E2E assertions
- next-axiom: [GitHub — axiomhq/next-axiom](https://github.com/axiomhq/next-axiom) — confirms Axiom as viable structured log + alerting path without Sentry
- Codebase audit: `lib/monitoring.ts`, `lib/services/ai-insights.ts`, `lib/services/ride-comparison.ts`, `jest.config.js`, `e2e/nav-smoke.spec.ts` — direct inspection of existing stubs and gaps

---

*Feature research for: Reliability & Observability milestone — Comparative Rideshares portfolio app*
*Researched: 2026-03-10*
