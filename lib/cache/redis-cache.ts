/**
 * Two-tier cache wrapper: L1 (in-process Map) + L2 (Redis via Upstash)
 *
 * All five in-memory Map caches (GEOCODE, ROUTE, COMPARISON, REC, AI_RESPONSE)
 * and the AI quota counter migrate to call these functions. This enforces
 * consistent key naming, TTL management, L1 eviction, and fire-and-forget
 * L2 writes — eliminating scattered raw redis.get/redis.set calls.
 */

import { redis } from '@/lib/redis'
import { log, logError } from '@/lib/monitoring'

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
  for (const [k, entry] of Array.from(store.entries())) {
    if (entry.expiresAt <= now) store.delete(k)
  }

  // If still over limit, evict oldest inserted (FIFO)
  if (store.size >= maxSize) {
    const firstKey = store.keys().next().value
    if (firstKey !== undefined) store.delete(firstKey)
  }
}

/**
 * Two-tier cache lookup: L1 Map → L2 Redis → compute on full miss.
 *
 * L1 hit: returns cached value without calling compute or Redis.
 * L2 hit: warms L1, returns cached value without calling compute.
 * Full miss: calls compute, writes to L1, fire-and-forgets L2 write.
 * Redis null: skips all L2 ops; still uses L1 and compute on miss.
 * Redis error: swallows error, falls through to compute.
 */
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

  // L2 check (Redis) — only when redis is available
  if (redis) {
    try {
      const redisValue = await redis.get<T>(key)
      if (redisValue !== null && redisValue !== undefined) {
        // Warm L1 from L2
        evictL1IfNeeded(store, namespace)
        store.set(key, { value: redisValue, expiresAt: now + ttlSeconds * 1000 })
        log('Cache hit', { event: 'cache_hit', cacheKey: key, cacheLayer: 'redis' })
        return { value: redisValue, cacheHit: true }
      }
    } catch {
      // Redis unavailable or error — fall through to compute
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

/**
 * Atomic daily quota counter using Redis INCR + EXPIREAT.
 *
 * On count === 1 (first increment of the day), sets EXPIREAT to next midnight UTC.
 *
 * Degraded-Redis policy:
 * - Development: returns 0 (fail-open) so local work without Upstash keeps AI paths usable.
 * - Production: returns Infinity (fail-closed) so every `count <= quota` check fails and
 *   callers take their template fallback — the quota cannot be bypassed by knocking Redis over.
 */
export async function incrementQuotaCounter(key: string): Promise<number> {
  const failClosed = process.env.NODE_ENV === 'production'

  if (!redis) {
    return failClosed ? Number.POSITIVE_INFINITY : 0
  }

  try {
    const count = await redis.incr(key)

    // On first increment, set expiration to next midnight UTC
    if (count === 1) {
      const now = new Date()
      const nextMidnightUTC = Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate() + 1
      )
      const expiresAtUnixSeconds = Math.floor(nextMidnightUTC / 1000)
      await redis.expireat(key, expiresAtUnixSeconds)
    }

    return count
  } catch (error) {
    if (failClosed) {
      logError({
        error: error instanceof Error ? error : new Error('Quota counter Redis failure'),
        context: 'incrementQuotaCounter fail-closed',
        quotaKey: key,
      })
      return Number.POSITIVE_INFINITY
    }
    return 0
  }
}

/**
 * Clears all L1 cache entries for a given namespace prefix.
 * Used by resetRideComparisonCaches() in ride-comparison.ts so existing
 * test call sites remain unchanged after migration.
 */
export function clearCacheNamespace(namespace: string): void {
  L1_STORES.get(namespace)?.clear()
}
