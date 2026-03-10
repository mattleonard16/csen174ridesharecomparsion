# Phase 2: Redis Cache Layer - Research

**Researched:** 2026-03-10
**Domain:** Upstash Redis caching, serverless L1+L2 cache patterns, atomic counters
**Confidence:** HIGH

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| INFR-01 | Geocode cache persists across serverless instances via Redis with TTL | `GEOCODE_CACHE` Map in `ride-comparison.ts` line 22 — direct replacement target. Key: `geocode:{normalized-address}`. TTL: 5 min (`API_CONFIG.CACHE_TTL = 300000`). |
| INFR-02 | Route cache persists across serverless instances via Redis with TTL | `ROUTE_CACHE` Map in `ride-comparison.ts` line 23 — direct replacement target. Key: `route:{accuracy}:{pickup_lon},{pickup_lat}-{dest_lon},{dest_lat}`. TTL: 10 min (`API_CONFIG.ROUTE_CACHE_TTL = 600000`). |
| INFR-03 | Comparison cache persists across serverless instances via Redis with TTL | `COMPARISON_CACHE` Map in `ride-comparison.ts` line 24 — direct replacement target. Key: `comparison:v2:{...}:{timeBucket}:{routeAccuracy}`. TTL: 5 min (precomputed) or 45 sec (dynamic). |
| INFR-04 | Recommendations cache persists across serverless instances via Redis with TTL | `REC_CACHE` Map in `recommendations.ts` line 16 — direct replacement target. Key: `rec:v2:{routeId}:{hour}`. TTL: 15 min. |
| INFR-05 | AI response cache persists across serverless instances via Redis with TTL | `AI_RESPONSE_CACHE` Map in `ai-insights.ts` line 16 — direct replacement target. Key: `ai:{sha256_of_cacheKey}`. TTL: 2 hours (AI response), 1 hour (template fallback). |
| INFR-06 | AI quota tracking uses Redis atomic counters (INCR + EXPIREAT) with daily TTL | Module-level `dailyCallCount` in `ai-insights.ts` lines 12–13 — replace with `redis.incr(quota:ai:YYYY-MM-DD)` + conditional `expireat`. |
</phase_requirements>

## Summary

Phase 2 migrates five in-memory `Map` caches and one module-level counter to Redis-backed persistent storage using the existing `@upstash/redis` client (`lib/redis.ts`). The core deliverable is a single `lib/cache/redis-cache.ts` helper that provides a typed `getCached<T>(key, ttlSeconds, compute)` function — all five cache migrations call this wrapper rather than issuing raw `redis.get`/`redis.set` calls. This enforces the success criterion that "no service makes raw `redis.get`/`redis.set` calls."

The existing codebase already has everything needed: `lib/redis.ts` exports a configured `@upstash/redis` client used for rate limiting, and all five caches follow the same pattern (check Map → miss → compute → store in Map with TTL). The migration is mechanical: replace the Map check-and-store with a `getCached` call, preserve the same key names and TTLs, and add an L1 Map inside the wrapper for same-isolate burst serving. The AI quota counter (INFR-06) uses a separate `getQuotaCounter` function that calls `redis.incr` directly and conditionally calls `expireat` on count === 1.

The only non-trivial decision is the L1 cache size. The existing Maps use `MAX_CACHE_SIZE = 1000` for comparison and `MAX_AI_CACHE_SIZE = 200` for AI responses. The wrapper should use sensible per-cache limits: geocode (500), route (500), comparison (200), recommendations (200), AI response (100). These are smaller than the originals because Redis L2 absorbs the cross-instance load.

**Primary recommendation:** Create `lib/cache/redis-cache.ts` first, write its unit tests, then migrate each cache one by one starting with geocode (lowest risk, clearest TTL) and ending with AI quota (most different pattern).

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@upstash/redis` | 1.35.7 (existing) | Redis client — GET, SET with EX, INCR, EXPIREAT | Already installed and configured in `lib/redis.ts`; HTTP-based, compatible with Vercel Edge and Node.js runtimes |

### Supporting

No new packages required. The entire phase uses `@upstash/redis` which is already in `package.json`.

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `@upstash/redis` direct | `ioredis` | `ioredis` requires TCP socket; incompatible with Vercel serverless. Upstash HTTP client is the only viable option on Vercel. |
| `getCached<T>` wrapper | Raw `redis.get`/`redis.set` per service | Raw calls scatter key naming, TTL management, and JSON serialization across files. Wrapper makes the pattern testable and consistent. This is the explicit success criterion. |
| L1 + L2 two-tier | L2 only (Redis directly) | Pure Redis adds 5–15ms per cache hit due to HTTP round-trip. L1 Map serves same-isolate repeat calls in microseconds — important for the comparison cache which can be hit multiple times per request. |

**Installation:**
```bash
# No new installs — @upstash/redis already present
```

## Architecture Patterns

### Recommended Project Structure

```
lib/
├── cache/
│   └── redis-cache.ts       # getCached<T> wrapper + getQuotaCounter
├── redis.ts                 # (existing) Redis client — no changes
├── services/
│   ├── ride-comparison.ts   # Migrate GEOCODE_CACHE, ROUTE_CACHE, COMPARISON_CACHE
│   ├── recommendations.ts   # Migrate REC_CACHE
│   └── ai-insights.ts       # Migrate AI_RESPONSE_CACHE + dailyCallCount
```

### Pattern 1: getCached<T> Wrapper (L1 + L2)

**What:** A generic typed function that checks an in-process Map (L1), then Redis (L2), then calls the compute function on miss. Stores the result in both layers.

**When to use:** For all five cache migrations (INFR-01 through INFR-05).

**Example:**
```typescript
// lib/cache/redis-cache.ts
// Source: Upstash Redis SDK docs (https://upstash.com/docs/redis/sdks/ts/commands/string/get)

import { redis } from '@/lib/redis'
import { log } from '@/lib/monitoring'

interface CacheEntry<T> {
  value: T
  expiresAt: number
}

// L1 store — keyed by cache namespace to allow per-cache size limits
const L1_STORES = new Map<string, Map<string, CacheEntry<unknown>>>()
const L1_MAX_SIZES: Record<string, number> = {
  geocode: 500,
  route: 500,
  comparison: 200,
  rec: 200,
  ai: 100,
}

function getL1Store(namespace: string): Map<string, CacheEntry<unknown>> {
  if (!L1_STORES.has(namespace)) {
    L1_STORES.set(namespace, new Map())
  }
  return L1_STORES.get(namespace)!
}

function extractNamespace(key: string): string {
  return key.split(':')[0]
}

function evictL1IfNeeded(store: Map<string, CacheEntry<unknown>>, namespace: string): void {
  const maxSize = L1_MAX_SIZES[namespace] ?? 200
  if (store.size < maxSize) return
  // Evict expired entries first
  const now = Date.now()
  for (const [k, entry] of store.entries()) {
    if (entry.expiresAt <= now) store.delete(k)
  }
  // If still over limit, evict oldest inserted (FIFO)
  if (store.size >= maxSize) {
    const firstKey = store.keys().next().value
    if (firstKey) store.delete(firstKey)
  }
}

export async function getCached<T>(
  key: string,
  ttlSeconds: number,
  compute: () => Promise<T>
): Promise<{ value: T; cacheHit: boolean }> {
  const namespace = extractNamespace(key)
  const store = getL1Store(namespace)
  const now = Date.now()

  // L1 check
  const l1Entry = store.get(key)
  if (l1Entry && l1Entry.expiresAt > now) {
    log('Cache hit', { event: 'cache_hit', cacheKey: key, cacheLayer: 'memory' })
    return { value: l1Entry.value as T, cacheHit: true }
  }

  // L2 check (Redis)
  if (redis) {
    try {
      const redisValue = await redis.get<T>(key)
      if (redisValue !== null) {
        // Warm L1 from L2
        evictL1IfNeeded(store, namespace)
        store.set(key, { value: redisValue, expiresAt: now + ttlSeconds * 1000 })
        log('Cache hit', { event: 'cache_hit', cacheKey: key, cacheLayer: 'redis' })
        return { value: redisValue, cacheHit: true }
      }
    } catch {
      // Redis unavailable — fall through to compute
    }
  }

  // Cache miss — compute and store
  const computed = await compute()

  // Write to L1
  evictL1IfNeeded(store, namespace)
  store.set(key, { value: computed, expiresAt: now + ttlSeconds * 1000 })

  // Write to L2 (non-blocking — do not await)
  if (redis) {
    redis.set(key, computed, { ex: ttlSeconds }).catch(() => {
      // Redis write failure is non-critical
    })
  }

  log('Cache miss', { event: 'cache_miss', cacheKey: key, cacheLayer: 'memory' })
  return { value: computed, cacheHit: false }
}
```

### Pattern 2: Atomic Quota Counter (INFR-06)

**What:** Replace the module-level `dailyCallCount` / `lastResetDate` variables in `ai-insights.ts` with a Redis INCR counter keyed by date. On the first increment of the day (count === 1), set EXPIREAT to the next midnight UTC. This ensures the counter always has a daily TTL visible in the Upstash console.

**When to use:** Only for INFR-06 (AI quota tracking). Do NOT use this for cache TTLs — use `getCached<T>` with `ex` option instead.

**Why INCR + EXPIREAT (not SET with EX):** SET with EX resets the counter on every call. INCR is atomic and increments without overwriting, which is essential for counting across multiple concurrent instances.

**Why EXPIREAT (not EXPIRE):** The daily TTL must expire at the next midnight UTC regardless of when today's first call happened. EXPIREAT takes an absolute Unix timestamp (seconds), allowing precise midnight-based resets. EXPIRE takes relative seconds, which would expire 86400s after the first call — not necessarily at midnight.

**Example:**
```typescript
// lib/cache/redis-cache.ts (additional export)
// Source: Upstash INCR docs + EXPIREAT docs

export async function incrementQuotaCounter(
  key: string,
  dailyLimitSeconds: number
): Promise<number> {
  if (!redis) {
    // Fallback: no Redis — quota is uncountable; return 0 to allow calls
    return 0
  }

  try {
    const count = await redis.incr(key)

    // On first increment, set expiration to next midnight UTC
    if (count === 1) {
      const now = new Date()
      const nextMidnightUTC = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)
      )
      const expiresAtUnixSeconds = Math.floor(nextMidnightUTC.getTime() / 1000)
      await redis.expireat(key, expiresAtUnixSeconds)
    }

    return count
  } catch {
    // Redis failure — return 0 to allow calls (fail open)
    return 0
  }
}
```

### Anti-Patterns to Avoid

- **Raw `redis.get` / `redis.set` in service files:** Scatters key naming and TTL management. All cache reads/writes go through `getCached<T>`.
- **`await`-ing the Redis L2 write on the hot path:** L2 writes are fire-and-forget (`.catch(() => {})`). Awaiting them adds 5–15ms to every cache miss.
- **`redis.pipeline()` for quota:** Pipeline does not guarantee atomicity. Use `redis.incr()` (atomic) + conditional `redis.expireat()`.
- **Storing `Date` objects in Redis:** Upstash serializes via JSON. Store epoch ms numbers (`Date.now()`) instead of `Date` instances, and reconstruct on read if needed.
- **Single large L1 store:** Mixing all caches in one Map makes size limits ambiguous. Use namespace-keyed stores (`L1_STORES`) as shown above.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Redis client | Custom HTTP Redis client | `@upstash/redis` (existing) | Handles auth, serialization, connection pooling, HTTP/2 keep-alive |
| JSON serialization | Manual `JSON.stringify`/`JSON.parse` | Upstash SDK does this automatically for `get<T>` | SDK serializes on `set` and deserializes on `get<T>` with the generic type |
| TTL calculation | Custom expiry logic | `redis.set(key, val, { ex: ttlSeconds })` | EX option is atomic with the SET; no separate EXPIRE call needed for non-quota caches |
| Atomic counter | Module-level variable + reset check | `redis.incr(key)` + conditional `redis.expireat()` | INCR is atomic at the Redis level; module variable is per-isolate and resets on cold start |

**Key insight:** The Upstash SDK's `get<T>` generic eliminates the need for custom deserialization. Complex objects stored with `set(key, complexObject, { ex })` are automatically serialized to JSON; `get<ComplexType>(key)` returns them typed.

## Common Pitfalls

### Pitfall 1: Redis Unavailable in Dev / Test — Silently Breaking Tests

**What goes wrong:** `lib/redis.ts` exports `redis = null` when `UPSTASH_REDIS_REST_URL` is not set. Tests that don't mock `redis` will skip the L2 layer entirely. If test assertions depend on Redis behavior (e.g., testing that a second call returns cached data cross-instance), the test will always pass even if the Redis path is broken.

**Why it happens:** The `redis = null` pattern is correct for production degradation, but tests need to explicitly mock the Redis client to exercise the L2 path.

**How to avoid:** In tests for `lib/cache/redis-cache.ts`, mock `@/lib/redis` with a `redis` object that has `get` and `set` jest functions. Test the L2 path explicitly by returning a value from the mock `get` and asserting `compute` was not called.

**Warning signs:** A test that calls `getCached` twice passes even when you never mock `redis`.

### Pitfall 2: Key Collision Between Cache Types

**What goes wrong:** If two different caches use overlapping key patterns (e.g., both geocode and route caches use `{address}` as the key), a route cache value could be returned for a geocode lookup.

**Why it happens:** Forgetting to namespace keys when migrating from per-Map isolation to a shared Redis keyspace.

**How to avoid:** Keys MUST be prefixed with the cache type:
- Geocode: `geocode:{normalized_address}`
- Route: `route:{accuracy}:{pickup_coords}-{dest_coords}` (already uses this pattern in existing `getRouteCacheKey`)
- Comparison: `comparison:v2:{...}` (already uses COMPARISON_CACHE_VERSION prefix)
- Recommendations: `rec:v2:{routeId}:{hour}` (uses RECOMMENDATION_CACHE_VERSION)
- AI responses: `ai:{hash_of_content}`
- AI quota: `quota:ai:YYYY-MM-DD`

The existing key construction functions (`createComparisonCacheKey`, `getRouteCacheKey`, `buildCacheKey`) already produce prefixed keys — preserve them exactly.

**Warning signs:** A cache miss where you expect a hit; wrong type returned (TypeScript would catch this with `get<T>`).

### Pitfall 3: `resetRideComparisonCaches()` Test Helper Breaks After Migration

**What goes wrong:** `lib/services/ride-comparison.ts` exports `resetRideComparisonCaches()` (line 96) which clears the three Maps. Tests call this in `beforeEach`. After migration to `getCached`, the Maps are inside `lib/cache/redis-cache.ts`'s `L1_STORES`, not exported from `ride-comparison.ts`.

**Why it happens:** The reset function is coupled to the old Map location.

**How to avoid:** Export a `clearCacheNamespace(namespace: string)` function from `lib/cache/redis-cache.ts`. Update `resetRideComparisonCaches()` to call `clearCacheNamespace('geocode')`, `clearCacheNamespace('route')`, and `clearCacheNamespace('comparison')`. Existing test call sites are unchanged.

**Warning signs:** Tests that rely on `resetRideComparisonCaches()` start seeing cross-test cache contamination.

### Pitfall 4: AI Quota Key Format — Wrong Date Timezone

**What goes wrong:** Using `new Date().toISOString().split('T')[0]` (as the existing code does at line 13) gives today's date in UTC, which is correct for a "daily UTC reset" quota. But if the quota key is constructed from local time (e.g., `new Date().toLocaleDateString()`), the key changes at local midnight rather than UTC midnight, causing inconsistent cross-instance quota sharing.

**Why it happens:** Mixing UTC and local time in key construction.

**How to avoid:** Always use `new Date().toISOString().split('T')[0]` (UTC date) for the quota key. The existing `lastResetDate` logic already uses this — preserve the same format: `quota:ai:YYYY-MM-DD`.

**Warning signs:** Quota key in Upstash console shows `quota:ai:2026-03-09` at 5pm UTC-7 when it should show `quota:ai:2026-03-10`.

### Pitfall 5: Upstash Free Tier Request Budget

**What goes wrong:** The free tier allows 10,000 requests/day. Each comparison request now adds ~6 Redis calls (geocode get/set, route get/set, comparison get/set) on a cache miss. On a cache hit, it's 2 calls (geocode get, comparison get). With the current rate limit of 50 requests/hour = 1,200/day, the budget math is:
- Worst case (all misses): 1,200 × 6 = 7,200 Redis calls/day — within budget
- Adding recommendations + AI: +2 calls → 1,200 × 8 = 9,600 — near limit

**Why it happens:** Cache adds 6–8x Redis calls vs current rate-limit-only usage (~2,400/day for rate limiting).

**How to avoid:** The L1 layer absorbs same-isolate repeat calls. The TTLs are set to prevent hammering Redis on burst traffic (45 seconds minimum for dynamic comparisons). If the Upstash console shows >8,000 requests/day, consider extending the comparison cache TTL from 45s to 2 minutes.

**Warning signs:** Upstash console shows request count near 10,000/day; rate limit errors returned to callers.

### Pitfall 6: L2 Write Not Fire-and-Forget — Blocking Cache Miss Path

**What goes wrong:** If `await redis.set(...)` is called on the hot path, a Redis write failure (network timeout, ~100ms) blocks the response. For a 45-second comparison cache TTL, the set is not critical.

**Why it happens:** Accidentally using `await` on the Redis L2 write.

**How to avoid:** L2 writes use `.catch(() => {})` (fire-and-forget). Only L2 reads are awaited. The existing `persistComparison` pattern in `ride-comparison.ts` demonstrates this correctly with `logPriceSnapshot().catch(() => {})`.

## Code Examples

### getCached<T> Usage in ride-comparison.ts

```typescript
// Source: pattern derived from existing geocodeWithCache + lib/redis.ts structure
// Replacing the GEOCODE_CACHE Map pattern with getCached<T>

// Before (line 532–593 in ride-comparison.ts):
const cached = GEOCODE_CACHE.get(cacheKey)
if (cached && cached.expiresAt > now) { ... }
GEOCODE_CACHE.set(cacheKey, { value: coordinates, expiresAt: now + API_CONFIG.CACHE_TTL })

// After:
const GEOCODE_TTL_SECONDS = API_CONFIG.CACHE_TTL / 1000  // 300 seconds = 5 min

const { value: coordinates } = await getCached<Coordinates>(
  `geocode:${cacheKey}`,
  GEOCODE_TTL_SECONDS,
  async () => {
    // ... existing Nominatim fetch logic unchanged ...
    return coordinates
  }
)
```

### Quota Counter Usage in ai-insights.ts

```typescript
// Source: Upstash INCR + EXPIREAT pattern for daily quota
// Replacing dailyCallCount module variable (lines 12–44)

// Before:
let dailyCallCount = 0
let lastResetDate = new Date().toISOString().split('T')[0]

function isWithinQuota(): boolean {
  resetDailyQuotaIfNeeded()
  return dailyCallCount < AI_DAILY_QUOTA
}

// After — in enhanceWithAI():
const quotaKey = `quota:ai:${new Date().toISOString().split('T')[0]}`
const currentCount = await incrementQuotaCounter(quotaKey, 86400)
const withinQuota = currentCount <= AI_DAILY_QUOTA

if (withinQuota) {
  // increment happens before AI call; no separate dailyCallCount++
  // ...
}
```

### Comparison Cache Key — Preserve Existing Format

```typescript
// Source: existing createComparisonCacheKey in ride-comparison.ts (lines 218–237)
// Key already contains 'comparison' prefix + version — use verbatim as Redis key

function createComparisonCacheKey(...): string {
  return [
    'comparison',
    COMPARISON_CACHE_VERSION,  // 'v2'
    pickupKey,
    destinationKey,
    services.join(','),
    getTimeBucket(timestamp),
    routeAccuracy,
  ].join(':')
}
// Result: 'comparison:v2:37.77490,-122.41940:37.33820,-121.88630:uber,lyft,taxi,waymo:2026-03-10:14:2:exact'
// This string is used directly as the Redis key — no additional prefixing needed
```

### Recommendation Cache Key

```typescript
// Source: existing REC_CACHE usage in recommendations.ts (line 16)
// REC_CACHE keys are constructed per the function arguments

// Key format: 'rec:{RECOMMENDATION_CACHE_VERSION}:{routeId}:{currentHour}'
// e.g., 'rec:v2:route-abc123:14'
// TTL: REC_CACHE_TTL_MS / 1000 = 900 seconds (15 min)
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Per-file Map caches | L1 Map + L2 Redis via `getCached<T>` | This phase | Cross-instance cache sharing; zero config for local dev (Redis null → L1 only) |
| Module-level quota counter | Redis INCR + EXPIREAT daily key | This phase | Atomic, cross-instance, survives cold starts |
| `resetRideComparisonCaches()` clears Maps | `clearCacheNamespace()` clears L1 stores | This phase | Test helper stays functional; behavior identical |

**Deprecated after this phase:**
- `GEOCODE_CACHE`, `ROUTE_CACHE`, `COMPARISON_CACHE` Maps in `ride-comparison.ts` — replaced by `getCached<T>` calls
- `REC_CACHE` Map in `recommendations.ts` — replaced by `getCached<T>`
- `AI_RESPONSE_CACHE` Map in `ai-insights.ts` — replaced by `getCached<T>`
- `dailyCallCount`, `lastResetDate`, `resetDailyQuotaIfNeeded()`, `isWithinQuota()` in `ai-insights.ts` — replaced by `incrementQuotaCounter`
- Local `cleanupCache`, `maintainCache`, `cleanupExpiredEntries` functions in each service — their logic moves into `getCached<T>` wrapper

## Open Questions

1. **AI response cache key length**
   - What we know: `buildCacheKey` in `ai-insights.ts` (line 49) generates `${r.type}:${JSON.stringify(r.dataPoints)}` per recommendation, joined by `|`. For 3–4 recommendations this could be 200–400 characters.
   - What's unclear: Redis supports keys up to 512MB; 400 characters is fine. But Upstash URL-encodes keys in HTTP requests — very long keys may hit URL length limits (8KB typically). Recommendation data is bounded (4 recommendation types, fixed data point keys), so in practice keys stay under 500 chars.
   - Recommendation: Use the key as-is; add a comment noting the 512MB Redis key limit is not a concern here. If keys grow unexpectedly, hash with `crypto.createHash('sha256')`.

2. **Graceful degradation when Redis is unconfigured (local dev)**
   - What we know: `lib/redis.ts` exports `redis = null` when env vars are absent. `getCached<T>` checks `if (redis)` before L2 operations.
   - What's unclear: Tests must not fail if `UPSTASH_REDIS_REST_URL` is not set in CI. The wrapper's null check handles this — L1 only mode works identically.
   - Recommendation: Add a test that sets `redis = null` (mock `@/lib/redis` with `{ redis: null, isRedisAvailable: false }`) and asserts that `getCached` still calls `compute` and returns the value. This ensures local dev and CI work without Redis credentials.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Jest 29.7.0 with jest-environment-jsdom |
| Config file | `jest.config.js` |
| Quick run command | `npm test -- --testPathPattern=lib/cache` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| INFR-01 | Geocode result returned from Redis on second call (different "instance") | unit | `npm test -- --testPathPattern=lib/cache/redis-cache` | Wave 0 |
| INFR-02 | Route result returned from Redis on second call | unit | `npm test -- --testPathPattern=lib/cache/redis-cache` | Wave 0 |
| INFR-03 | Comparison result returned from Redis on second call | unit | `npm test -- --testPathPattern=services/ride-comparison` | ✅ (extend) |
| INFR-04 | Recommendations result returned from Redis on second call | unit | `npm test -- --testPathPattern=services/recommendations` | ✅ (extend) |
| INFR-05 | AI response returned from Redis on second call | unit | `npm test -- --testPathPattern=services/ai-insights` | ✅ (extend) |
| INFR-06 | `redis.incr` called; `redis.expireat` called on count===1; count > quota blocks AI call | unit | `npm test -- --testPathPattern=services/ai-insights` | ✅ (extend) |

### Sampling Rate

- **Per task commit:** `npm test -- --testPathPattern=lib/cache`
- **Per wave merge:** `npm test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `__tests__/lib/cache/redis-cache.test.ts` — covers `getCached<T>` L1 hit, L2 hit, miss, Redis null fallback, `incrementQuotaCounter` INCR + EXPIREAT logic

*(Existing test files `__tests__/services/ride-comparison.test.ts`, `__tests__/services/recommendations.test.ts`, `__tests__/services/ai-insights.test.ts` need test cases extended, not new files created.)*

## Sources

### Primary (HIGH confidence)

- Upstash Redis TypeScript SDK — `redis.get<T>(key)` returns generic typed value or null; `redis.set(key, val, { ex, nx })` with NX and EX options; `redis.incr(key)` returns incremented integer; `redis.expireat(key, unixSeconds)` sets absolute expiration
  - https://upstash.com/docs/redis/sdks/ts/commands/string/get
  - https://upstash.com/docs/redis/sdks/ts/commands/string/set
  - https://upstash.com/docs/redis/sdks/ts/commands/string/incr
  - https://upstash.com/docs/redis/sdks/ts/commands/generic/expireat
- Direct source audit — `lib/redis.ts`, `lib/services/ride-comparison.ts`, `lib/services/ai-insights.ts`, `lib/services/recommendations.ts`, `lib/rate-limiter.ts`, `lib/constants.ts`
- `.planning/research/SUMMARY.md` — L1+L2 pattern recommendation, key naming convention, TTL values, Upstash free tier limits

### Secondary (MEDIUM confidence)

- `.planning/codebase/CONCERNS.md` — "All In-Memory Caches Reset on Cold Start / Across Instances" performance bottleneck analysis (lines 93–97); "AI `dailyCallCount` Is Module-Level State" analysis (lines 87–91)
- `.planning/codebase/STACK.md` — `@upstash/redis` 1.35.x confirmed present; `@upstash/ratelimit` 2.x pattern shows existing Redis usage

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — `@upstash/redis` already installed; GET/SET/INCR/EXPIREAT verified against official docs
- Architecture: HIGH — `getCached<T>` pattern derived directly from existing cache code; no invention required
- Pitfalls: HIGH — Every pitfall grounded in a specific line of existing code or confirmed Upstash behavior

**Research date:** 2026-03-10
**Valid until:** 2026-06-10 (Upstash Redis SDK API is stable; 90-day window is conservative)
