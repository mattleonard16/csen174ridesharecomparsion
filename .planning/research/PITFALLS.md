# Pitfalls Research

**Domain:** Next.js App Router reliability milestone — caching, observability, testing, refactoring
**Researched:** 2026-03-10
**Confidence:** HIGH (codebase read directly; pitfalls verified against live code patterns)

---

## Critical Pitfalls

### Pitfall 1: Module-Level AI Quota Counter Resets on Every Cold Start

**What goes wrong:**
`ai-insights.ts` tracks daily API calls in module-level variables (`dailyCallCount`, `lastResetDate`). On Vercel, each serverless function invocation may spawn a fresh isolate, so the counter resets to 0 constantly. The quota protection is entirely illusory in production — every request believes it is the first call of the day.

**Why it happens:**
Developers test locally where a single Node.js process persists, so the counter works as expected in development. The serverless cold-start memory model never appears in local runs.

**How to avoid:**
Replace module-level variables with a Redis INCR + EXPIRE pattern. Use `redis.incr(key)` to get the new count; if the return value is 1 (first increment), set `redis.expire(key, 86400)` to reset at midnight. The INCR command is atomic — concurrent requests cannot double-count or race. This is the standard pattern documented by Upstash for quota-based SaaS. Keep the in-memory counter only as a short-circuit within the same isolate (if counter < quota, still call Redis; Redis is the source of truth).

**Warning signs:**
- AI calls to Anthropic/OpenAI exceed the `AI_DAILY_QUOTA` env var value when measured externally
- `dailyCallCount` logs show 0 or 1 on every request in production logs
- Anthropic/OpenAI billing shows uncapped usage despite quota logic

**Phase to address:**
Redis cache migration phase (when other in-memory caches move to Redis — do AI quota at the same time to avoid a second Redis integration pass).

---

### Pitfall 2: `setupFilesAfterSetup` Typo Silently Disables All Test Setup

**What goes wrong:**
`jest.config.js` uses `setupFilesAfterSetup` (line 10), which is not a recognized Jest configuration key. Jest ignores unknown keys without warning. The actual key is `setupFilesAfterFramework`. The `jest.setup.ts` file (which extends `@testing-library/jest-dom` matchers) is never loaded. All tests that rely on custom matchers like `toBeInTheDocument()` will fail with cryptic "not a function" errors, or tests pass only because they avoid those matchers.

**Why it happens:**
Copy-paste from documentation with a single character typo; Jest's configuration object accepts any key without schema validation, so there is no build-time or startup-time error.

**How to avoid:**
The correct key is `setupFilesAfterFramework`. Verify immediately by running `npm test -- --showConfig | grep setup` and confirming the setup file path appears in output. Add a CI step that runs tests and checks the setup file is loaded (a canary test that uses a `jest-dom` matcher will fail immediately if setup is missing).

**Warning signs:**
- Tests that use `expect(element).toBeInTheDocument()` throw "TypeError: toBeInTheDocument is not a function"
- No test failure on jest.config.js changes
- `jest --showConfig` output does not mention `jest.setup.ts`

**Phase to address:**
Jest configuration fix phase (first phase — nothing else can be trusted until this is resolved).

---

### Pitfall 3: In-Memory Caches Silently Split Across Serverless Instances

**What goes wrong:**
`ride-comparison.ts` maintains three `Map`-based caches (GEOCODE_CACHE, ROUTE_CACHE, COMPARISON_CACHE) and `recommendations.ts` maintains REC_CACHE. On Vercel, concurrent requests are handled by different isolates — each has its own copy of these Maps. A geocode result cached in isolate A is invisible to isolate B. The effective cache hit rate in production is near zero for dynamic routes (not precomputed). External Nominatim and OSRM calls are made far more frequently than the in-memory TTLs imply.

**Why it happens:**
Local development runs a single process, so the cache appears to work. The serverless execution model is not visible during development testing.

**How to avoid:**
Serialize cache values to Redis with a key scheme that mirrors the existing Map keys. Use `redis.get` / `redis.setex` with JSON serialization. Keep the in-memory Map as an L1 cache (short TTL, e.g. 5 seconds) to handle burst traffic within the same isolate; Redis is L2. Always check L1 first, then L2, then compute. Upstash's HTTP-based Redis client (`@upstash/redis`) works in Edge and serverless runtimes without connection pool issues — the existing `lib/redis.ts` already creates this client.

**Warning signs:**
- Nominatim or OSRM calls appear in production logs for addresses that were recently looked up
- Cache hit metrics (if logged) show consistently low rates in production vs. local
- Response times for popular routes are similar to unknown routes

**Phase to address:**
Redis cache migration phase.

---

### Pitfall 4: `collectCoverageFrom` Only Measures 3 Paths — True Coverage Is Unknown

**What goes wrong:**
`jest.config.js` limits `collectCoverageFrom` to `app/api/**`, `lib/services/**`, and `lib/monitoring.ts`. Large, critical files like `lib/pricing.ts`, `lib/pricing-config.json` consumers, `lib/validation.ts`, `lib/geo.ts`, `lib/rate-limiter.ts`, and all UI components have zero coverage measurement. The coverage percentage reported by Jest is not the project's actual test coverage — it is the coverage of an arbitrarily small slice. A 95% reported coverage could coexist with 0% coverage of the pricing engine.

**Why it happens:**
The `collectCoverageFrom` glob was written to match what tests existed at the time, not what should be covered. Expanding it to match true scope would immediately reveal the real (lower) coverage number, which feels like a regression.

**How to avoid:**
Expand `collectCoverageFrom` to at minimum: `lib/**/*.{ts,tsx}`, `app/api/**/*.{ts,tsx}`, then exclude `lib/generated/**` and `**/*.d.ts`. Accept that the reported number will drop when the scope is corrected — this is honest progress, not regression. Set coverage thresholds (`coverageThreshold`) after expansion, not before.

**Warning signs:**
- High coverage percentage but pricing bugs appear in production
- `npm test -- --coverage` output does not include `lib/pricing.ts` in the file list
- Adding new files to `lib/` does not affect the coverage percentage

**Phase to address:**
Jest configuration fix phase (same pass as the typo fix).

---

### Pitfall 5: `logError` Is a Stub — Production Errors Are Invisible

**What goes wrong:**
`lib/monitoring.ts` `logError` checks `process.env.NEXT_PUBLIC_SENTRY_DSN` and then does nothing — the Sentry SDK is commented out with a TODO. In production, API errors call `logError` expecting error tracking, but the call silently falls through to `log()` which only writes to Axiom if both `AXIOM_TOKEN` and `AXIOM_DATASET` are set. If Axiom is not configured, errors vanish entirely. There is no alerting, no stack trace capture, and no way to know production errors are occurring.

**Why it happens:**
Sentry was scaffolded but never wired. The function signature looks correct to callers, masking the missing implementation.

**How to avoid:**
Replace the Sentry stub with an actually-wired solution. Since Axiom is already integrated for logging, the minimal path is to use Axiom as the error sink (structured log with `level: "error"` and full stack trace). If Sentry is preferred, the `@sentry/nextjs` package requires: (1) `sentry.client.config.ts`, `sentry.server.config.ts`, and `sentry.edge.config.ts` files, (2) `withSentryConfig` wrapping `next.config.mjs`, (3) `instrumentation.ts` for App Router server-side initialization. For Next.js App Router, server component errors require the `onRequestError` hook — they do not propagate to `global-error.tsx`.

**Warning signs:**
- Production 500 errors visible in Vercel function logs but no corresponding Sentry event
- `logError` calls in API routes execute but the Sentry dashboard shows 0 events
- No `NEXT_PUBLIC_SENTRY_DSN` or `SENTRY_DSN` env var set in Vercel project settings

**Phase to address:**
Error tracking phase (before Redis migration — you need observability before making infrastructure changes).

---

### Pitfall 6: Price Alert Polling Will Storm the API Under Concurrent Users

**What goes wrong:**
When implementing in-app price alert delivery, the natural approach is to poll `/api/price-alerts` from the dashboard on an interval. If 10 users have the dashboard open, each polling every 30 seconds, that is 20 rate-limited requests per minute against the same Upstash Redis rate-limit bucket. At the current burst limit (3 requests per 10 seconds per client), individual users can be throttled. More critically, if the polling interval is naively set per-component mount (e.g. `setInterval` in a `useEffect` without cleanup), navigation away and back creates duplicate intervals — 2x, 4x, 8x the intended rate.

**Why it happens:**
`useEffect` polling is easy to write and hard to clean up correctly. Developers test with a single tab, missing the interval accumulation.

**How to avoid:**
Use a single polling hook with `useRef` to track the interval ID and clear it on unmount. Use `useCallback` to stabilize the fetch function reference. Never start a new interval if one is already running (check the ref). Consider exponential backoff when the tab is hidden (`document.visibilityState === 'hidden'`). For the notification use case specifically, polling interval of 60+ seconds is adequate — price alerts are not millisecond-sensitive.

**Warning signs:**
- Network tab shows duplicate alert API calls after navigating away and back to dashboard
- Rate-limiting headers show `X-RateLimit-Remaining: 0` for authenticated users on the dashboard
- Console shows multiple "fetching alerts" logs per poll cycle

**Phase to address:**
Price alert delivery phase.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Module-level quota counters | Zero Redis calls, simple code | Quota bypassed in serverless; AI costs uncapped | Never in serverless deployment |
| `any` type on LogContext fields | Fast authoring, no cast needed | Error tracking loses structured context; search by field breaks | Never — use `Record<string, unknown>` |
| Silent `.catch(() => {})` on DB writes | User never sees DB errors | DB failures invisible; data loss undetectable | Only for truly non-critical analytics |
| Dual request format (legacy + coordinate) in same handler | Backward compatibility | Handler grows unbounded; new fields must be added twice; test coverage gaps | Acceptable short-term; must unify before adding more fields |
| `collectCoverageFrom` targeting small path set | High reported coverage number | Actual coverage unknown; false confidence | Never — always target the full `lib/` and `app/api/` |
| In-memory cache with `Map` | Zero infrastructure needed | Cache misses on every cold start; external APIs hit at full rate | Only for local dev; never in Vercel production |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Upstash Redis for caching | Using TCP Redis client (`ioredis`) which requires persistent connections | Use `@upstash/redis` HTTP client — already in the project; works in serverless without connection pooling |
| Upstash Redis for atomic counters | `GET` → `check` → `SET` pattern (non-atomic, race condition) | Use `INCR` (atomic) and set TTL only when value is 1 (first write) |
| Next.js App Router + Sentry | Initializing Sentry only in `layout.tsx` (client-only) | Require `sentry.server.config.ts` + `instrumentation.ts` + `withSentryConfig` in `next.config.mjs` to catch server component errors |
| Jest + Next.js `next/jest` wrapper | `transformIgnorePatterns` missing packages that use ESM (`next-auth`, `@auth/prisma-adapter`) | List all ESM-only packages in `transformIgnorePatterns` negative lookahead: `/node_modules/(?!(next-auth|@auth|@panva)/)`  — already partially done but must be verified after adding new auth deps |
| MapLibre GL in Playwright | Testing map renders with live CARTO tile requests — network errors cause flaky tests | Mock tile requests in Playwright with `page.route('**/carto**', route => route.fulfill({...}))` or use an offline style JSON; alternatively, test only at the interaction layer (form inputs, results) and treat the map as a black box |
| Axiom logging | Calling `sendToAxiom` without awaiting the result — fire-and-forget swallows errors | Already wrapped in `.catch(console.error)`; acceptable; do not await inside request handler — latency matters more than log delivery guarantee |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Rate limiting both `GET` and `POST` on compare-rides | Prefetch GET (triggered on form input change) consumes rate limit budget before user submits POST | Consider a higher burst limit for GET (prefetch) vs POST (actual submission), or exempt authenticated users from strict burst limits | Noticeable with 3+ rapid address changes (current burst: 3 per 10s) |
| Parallelizing Upstash Redis reads for every cached key | Upstash REST API has per-request latency (~50ms); 5 parallel reads = 5 round trips | Use `redis.mget` for multiple keys or batch with Redis pipeline | At >5 cache lookups per request |
| `AI_RESPONSE_CACHE` Map shared across requests | Same cold-start isolation issue as geocode/route caches; AI cache hits in local dev never replicate in production | Use Redis for AI response cache (same key scheme: hash of recommendation fingerprint) | Every cold start |
| Comparison result freshness vs. 15-minute recommendation cache | User compares at 8 AM and 9 AM; prices change but cached recommendation says "cheapest at 8 AM" | Cache key must include time bucket (already done in `createComparisonCacheKey` for comparison; verify for recommendations) | Any time-sensitive surge window |

---

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| `logError` leaking `err.message` verbatim in API 500 responses (price-alerts route line 78: `detail: err?.message`) | Internal error messages may expose Prisma query structure, table names, or connection strings to clients | Map internal errors to generic messages; log full detail server-side only; never return raw `Error.message` to clients |
| Health check endpoint exposing database latency and OSRM URL | Reconnaissance for attackers; reveals infrastructure topology | Add authentication or rate limiting to `/api/health`; return only `status: "healthy"|"degraded"` without latency numbers or endpoint URLs in public-facing response |
| Client ID hashing with non-cryptographic hash in rate limiter | Two different IPs could collide on the same hash bucket; sophisticated clients could find collisions to bypass rate limiting | For a portfolio demo this is acceptable; in production use the raw IP string as the key (Upstash handles key length) |
| `NEXT_PUBLIC_` prefix on Sentry DSN | Public DSN is technically public (by design in Sentry) but exposes project ID and organization slug | Use `SENTRY_DSN` (server-only) for server-side error reporting; `NEXT_PUBLIC_SENTRY_DSN` only if client-side reporting is needed |

---

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Price alerts have no delivery mechanism — "alert created" gives false confidence | User expects a notification when price drops; nothing happens; they check back and discover they were never notified | Show explicit copy: "We'll notify you here when prices drop. Check back on your dashboard." until delivery is implemented |
| Showing `routeWarning` string when OSRM is unavailable but not distinguishing from error states | User sees technical warning ("live routing temporarily unavailable") without understanding impact on price accuracy | Map warning to a friendlier string with an explicit accuracy indicator: "Prices estimated (±15%)" |
| Health check at `/api/health` not linked from dashboard | Operations team cannot verify system status without knowing the URL | Add a visible (but subtle) status indicator on the dashboard that polls health on mount |

---

## "Looks Done But Isn't" Checklist

- [ ] **Jest setup:** `setupFilesAfterFramework` (not `setupFilesAfterSetup`) — verify with `npx jest --showConfig | grep setupFilesAfterEnv`
- [ ] **Error tracking:** `logError` actually captures to an external system — verify by throwing a test error in production and checking Sentry/Axiom for the event
- [ ] **Redis caches:** Geocode, route, comparison, recommendation, and AI response caches all use Redis, not only in-memory Maps — verify by deploying and checking Redis key count in Upstash console after a comparison request
- [ ] **AI quota counter:** Daily call count survives a cold start — verify by checking Upstash Redis for a `ai:quota:YYYY-MM-DD` key after running a comparison in production
- [ ] **Price alerts:** Creating an alert produces an in-app notification when price drops — verify end-to-end by creating an alert and triggering the check mechanism
- [ ] **Coverage scope:** `collectCoverageFrom` includes `lib/pricing.ts` — verify by running `npm test -- --coverage` and confirming pricing.ts appears in the file table
- [ ] **Anthropic SDK removed:** No `import Anthropic from '@anthropic-ai/sdk'` in any file — verify with `grep -r 'anthropic-ai/sdk' src/ lib/`
- [ ] **Health check probes DB:** Health endpoint actually queries the database, not just checks `DATABASE_URL` is set — verify by running health check with DB disconnected and confirming `healthy: false`

---

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Module-level quota counter in production | LOW | Add Redis INCR; re-deploy; no data migration needed; counter starts fresh (acceptable) |
| `setupFilesAfterSetup` typo | LOW | Fix key name; re-run tests; setup file loads; matcher errors surface (expected and fixable) |
| In-memory caches discovered to be ineffective | MEDIUM | Add Redis cache layer alongside existing Maps; deploy; Maps become the L1 hot path; no user-facing change |
| `logError` stub discovered after production incident | HIGH | Retroactive errors not capturable; only new errors after fix are tracked; may miss root cause of existing bugs |
| Polling storm on price alerts | LOW | Add cleanup to `useEffect`; add `visibilitychange` listener; deploy; duplicate intervals stop immediately |
| Barrel file circular dependency introduced during refactor | MEDIUM | Run `npx madge --circular lib/` to identify the cycle; break the cycle by extracting the shared piece to a third file; no user impact |

---

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Jest typo (`setupFilesAfterSetup`) | Phase 1: Jest configuration fix | `npx jest --showConfig | grep setupFilesAfterEnv` shows `jest.setup.ts` path |
| Coverage scope too narrow | Phase 1: Jest configuration fix | `npm test -- --coverage` output includes `lib/pricing.ts` and all `lib/` files |
| `logError` is a stub | Phase 2: Error tracking integration | Intentional test error appears in Axiom/Sentry within 60 seconds of triggering |
| In-memory caches miss in serverless | Phase 3: Redis cache migration | Upstash console shows new keys after first comparison in production |
| Module-level AI quota counter | Phase 3: Redis cache migration | Redis key `ai:quota:YYYY-MM-DD` exists in Upstash after AI-enhanced request |
| AI cache misses in serverless | Phase 3: Redis cache migration | Repeat comparison returns same AI insights without new Anthropic/OpenAI API call |
| Price alert polling storm | Phase 4: Price alert delivery | Network tab shows single poll interval (no duplicates after navigation) |
| `logError` leaking `err.message` to clients | Phase 2: Error tracking integration | API error responses contain no Prisma or internal strings |
| Health check exposing internals | Phase 2: Error tracking integration | Health response body contains only `status` field; no URLs or latency in public response |
| Dual request format in compare-rides | Phase 5: Refactoring / consolidation | Single validation path in handler; legacy format removed or unified |
| Barrel file circular dependencies | Phase 5: Refactoring / consolidation | `npx madge --circular lib/` returns no cycles |
| Missing `transformIgnorePatterns` for new ESM deps | Phase 1: Jest configuration fix | All new test files run without `SyntaxError: Cannot use import statement` |

---

## Sources

- Live codebase audit: `/lib/services/ai-insights.ts` (module-level quota counter), `/jest.config.js` (typo), `/lib/monitoring.ts` (Sentry stub), `/lib/services/ride-comparison.ts` (in-memory Maps), `/app/api/price-alerts/route.ts` (logError leaking message)
- [Next.js Jest configuration — Official docs](https://nextjs.org/docs/pages/guides/testing/jest) — confirms `setupFilesAfterFramework` is the correct key
- [Upstash: Manage quota-based SaaS with Next.js](https://upstash.com/blog/quota-based-saas) — INCR + EXPIRE atomic counter pattern (HIGH confidence)
- [Redis Caching Strategies: Next.js Production Guide](https://www.digitalapplied.com/blog/redis-caching-strategies-nextjs-production) — serverless cache isolation pitfalls (MEDIUM confidence)
- [Sentry for Next.js — Manual Setup](https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/) — server vs. client error capture requirements (HIGH confidence)
- [Testing MapLibre with MapGrab and Playwright](https://falseinput.com/testing-maplibre-gl-js-applications-with-mapgrab-and-playwright) — MapLibre E2E pitfalls (MEDIUM confidence)
- [Circular dependencies: barrel file pitfalls](https://medium.com/@idrussalam95/fixing-circular-dependencies-in-node-js-a-battle-against-barrel-files-and-god-classes-e7d13df995f0) — refactor risks (MEDIUM confidence)
- [nextcov — coverage for Next.js server components](https://dev.to/stevez/nextcov-collecting-test-coverage-for-nextjs-server-components-6gc) — coverage gap for server components (MEDIUM confidence)

---
*Pitfalls research for: Next.js App Router reliability milestone — ride comparison app*
*Researched: 2026-03-10*
