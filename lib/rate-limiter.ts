/**
 * Multi-Layer Rate Limiting System
 *
 * Implements enterprise-grade protection against API abuse with 2-tier defense:
 * 1. Burst Protection: Prevents rapid-fire spam (configurable via RATE_LIMIT_BURST)
 * 2. Per-Hour Limits: Sustained abuse prevention (configurable via RATE_LIMIT_PER_HOUR)
 *
 * Uses Upstash Redis for persistent rate limiting across serverless instances.
 * Falls back to in-memory storage when Redis is not configured or fails.
 */

import { NextRequest, NextResponse } from 'next/server'
import { Ratelimit } from '@upstash/ratelimit'
import { redis, isRedisAvailable } from './redis'

/**
 * Parse environment variable as integer with validation
 * Returns default if value is missing, non-numeric, or <= 0
 */
function parseEnvInt(value: string | undefined, defaultValue: number): number {
  if (!value) return defaultValue
  const parsed = parseInt(value, 10)
  if (isNaN(parsed) || parsed <= 0) {
    return defaultValue
  }
  return parsed
}

// Rate limiter configuration (env-driven with validated defaults)
const RATE_LIMIT_CONFIG = {
  REQUESTS_PER_HOUR: parseEnvInt(process.env.RATE_LIMIT_PER_HOUR, 50),
  BURST_REQUESTS: parseEnvInt(process.env.RATE_LIMIT_BURST, 3),
  BURST_WINDOW_SECONDS: parseEnvInt(process.env.RATE_LIMIT_BURST_WINDOW, 10),
  MAX_MEMORY_ENTRIES: 10000, // Max entries per in-memory Map to prevent unbounded growth
} as const

// In-memory fallback storage (used when Redis is not configured or fails)
const inMemoryBurstTracking = new Map<string, { count: number; resetTime: number }>()
const inMemoryHourTracking = new Map<string, { count: number; resetTime: number }>()

/**
 * Evict oldest entries from a Map if it exceeds the max size limit.
 * Uses FIFO eviction (first inserted = first evicted) since Map maintains insertion order.
 */
function evictOldestIfNeeded<T>(
  map: Map<string, T>,
  maxSize: number = RATE_LIMIT_CONFIG.MAX_MEMORY_ENTRIES
): void {
  if (map.size <= maxSize) return

  const entriesToRemove = map.size - maxSize
  const keys = Array.from(map.keys())

  for (let i = 0; i < entriesToRemove; i++) {
    map.delete(keys[i])
  }
}

// Track if we're currently using in-memory fallback (runtime state)
let usingInMemoryFallback = !isRedisAvailable

// Redis-backed rate limiters (only created if Redis is available)
const redisRateLimiters = redis
  ? {
      burst: new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(
          RATE_LIMIT_CONFIG.BURST_REQUESTS,
          `${RATE_LIMIT_CONFIG.BURST_WINDOW_SECONDS}s`
        ),
        prefix: 'ratelimit:burst',
      }),
      hour: new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(RATE_LIMIT_CONFIG.REQUESTS_PER_HOUR, '1h'),
        prefix: 'ratelimit:hour',
      }),
    }
  : null

/**
 * Get client identifier from request
 */
function getClientId(request: Request): string {
  // Try to get real IP from headers (for production with proxy)
  const forwardedFor = request.headers.get('x-forwarded-for')
  const realIp = request.headers.get('x-real-ip')

  // Fallback to a combination of headers for identification
  const userAgent = request.headers.get('user-agent') || 'unknown'
  const acceptLanguage = request.headers.get('accept-language') || 'unknown'

  // Create a simple hash of identifying characteristics
  const identifier = forwardedFor || realIp || `${userAgent}-${acceptLanguage}`

  // Simple hash function for consistent client identification
  let hash = 0
  for (let i = 0; i < identifier.length; i++) {
    const char = identifier.charCodeAt(i)
    hash = (hash << 5) - hash + char
    hash = hash & hash // Convert to 32-bit integer
  }

  return `client_${Math.abs(hash)}`
}

/**
 * Check rate limit using Redis (when available)
 * Parallelizes both rate limit checks for ~50-100ms savings
 */
async function checkRateLimitRedis(
  clientId: string
): Promise<{ allowed: boolean; remainingRequests: number; resetTime: number; reason?: string }> {
  if (!redisRateLimiters) {
    throw new Error('Redis rate limiters not initialized')
  }

  // Check both limits in parallel for better performance
  const [burstResult, hourResult] = await Promise.all([
    redisRateLimiters.burst.limit(clientId),
    redisRateLimiters.hour.limit(clientId),
  ])

  // Check burst limit first (most restrictive short-term)
  if (!burstResult.success) {
    return {
      allowed: false,
      remainingRequests: burstResult.remaining,
      resetTime: burstResult.reset,
      reason: `Burst limit exceeded (${RATE_LIMIT_CONFIG.BURST_REQUESTS} requests per ${RATE_LIMIT_CONFIG.BURST_WINDOW_SECONDS} seconds)`,
    }
  }

  // Check per-hour limit
  if (!hourResult.success) {
    return {
      allowed: false,
      remainingRequests: hourResult.remaining,
      resetTime: hourResult.reset,
      reason: `Rate limit exceeded (${RATE_LIMIT_CONFIG.REQUESTS_PER_HOUR} requests per hour)`,
    }
  }

  // Return the most restrictive values so headers reflect the active constraint
  return {
    allowed: true,
    remainingRequests: Math.min(burstResult.remaining, hourResult.remaining),
    resetTime: Math.min(burstResult.reset, hourResult.reset),
  }
}

/**
 * Check rate limit using in-memory storage (fallback)
 * Uses immutable updates and bounded cache eviction.
 */
function checkRateLimitInMemory(clientId: string): {
  allowed: boolean
  remainingRequests: number
  resetTime: number
  reason?: string
} {
  const now = Date.now()

  // Check burst protection
  const burstData = inMemoryBurstTracking.get(clientId)
  let currentBurstCount: number
  let currentBurstResetTime: number

  if (burstData && now < burstData.resetTime) {
    // Window still active
    if (burstData.count >= RATE_LIMIT_CONFIG.BURST_REQUESTS) {
      return {
        allowed: false,
        remainingRequests: 0,
        resetTime: burstData.resetTime,
        reason: `Burst limit exceeded (${RATE_LIMIT_CONFIG.BURST_REQUESTS} requests per ${RATE_LIMIT_CONFIG.BURST_WINDOW_SECONDS} seconds)`,
      }
    }
    // Immutable update: create new object with incremented count
    currentBurstCount = burstData.count + 1
    currentBurstResetTime = burstData.resetTime
    inMemoryBurstTracking.set(clientId, {
      count: currentBurstCount,
      resetTime: currentBurstResetTime,
    })
  } else {
    // Window expired or new client - start fresh
    currentBurstCount = 1
    currentBurstResetTime = now + RATE_LIMIT_CONFIG.BURST_WINDOW_SECONDS * 1000
    inMemoryBurstTracking.set(clientId, {
      count: currentBurstCount,
      resetTime: currentBurstResetTime,
    })
    // Evict oldest entries if we exceed max size
    evictOldestIfNeeded(inMemoryBurstTracking)
  }

  // Check per-hour limit
  const hourData = inMemoryHourTracking.get(clientId)
  let currentHourCount: number
  let currentHourResetTime: number

  if (hourData && now < hourData.resetTime) {
    // Window still active
    if (hourData.count >= RATE_LIMIT_CONFIG.REQUESTS_PER_HOUR) {
      return {
        allowed: false,
        remainingRequests: 0,
        resetTime: hourData.resetTime,
        reason: `Rate limit exceeded (${RATE_LIMIT_CONFIG.REQUESTS_PER_HOUR} requests per hour)`,
      }
    }
    // Immutable update: create new object with incremented count
    currentHourCount = hourData.count + 1
    currentHourResetTime = hourData.resetTime
    inMemoryHourTracking.set(clientId, {
      count: currentHourCount,
      resetTime: currentHourResetTime,
    })
  } else {
    // Window expired or new client - start fresh
    currentHourCount = 1
    currentHourResetTime = now + 3600000
    inMemoryHourTracking.set(clientId, {
      count: currentHourCount,
      resetTime: currentHourResetTime,
    })
    // Evict oldest entries if we exceed max size
    evictOldestIfNeeded(inMemoryHourTracking)
  }

  const burstRemaining = RATE_LIMIT_CONFIG.BURST_REQUESTS - currentBurstCount
  const hourRemaining = RATE_LIMIT_CONFIG.REQUESTS_PER_HOUR - currentHourCount

  // Return the most restrictive values so headers reflect the active constraint
  return {
    allowed: true,
    remainingRequests: Math.min(burstRemaining, hourRemaining),
    resetTime: Math.min(currentBurstResetTime, currentHourResetTime),
  }
}

/**
 * Check if request should be rate limited
 * Uses Redis when available, falls back to in-memory storage
 */
export async function checkRateLimit(request: Request): Promise<{
  allowed: boolean
  remainingRequests: number
  resetTime: number
  reason?: string
}> {
  const clientId = getClientId(request)

  if (isRedisAvailable && redisRateLimiters) {
    try {
      const result = await checkRateLimitRedis(clientId)
      usingInMemoryFallback = false // Redis is working
      return result
    } catch {
      usingInMemoryFallback = true // Mark that we fell back to in-memory
    }
  }

  return checkRateLimitInMemory(clientId)
}

/**
 * Clean up old in-memory rate limiters (call periodically)
 * Only runs when in-memory storage is actually being used
 */
export function cleanupRateLimiters(): void {
  // Only cleanup if we're actually using in-memory storage
  // (either Redis not configured, or Redis failed and we fell back)
  if (!usingInMemoryFallback) {
    return
  }

  const now = Date.now()

  // Clean up burst tracking older than window + 1 hour buffer
  Array.from(inMemoryBurstTracking.entries()).forEach(([key, data]) => {
    if (now > data.resetTime + 3600000) {
      inMemoryBurstTracking.delete(key)
    }
  })

  // Clean up hour tracking older than 2 hours
  Array.from(inMemoryHourTracking.entries()).forEach(([key, data]) => {
    if (now > data.resetTime + 3600000) {
      inMemoryHourTracking.delete(key)
    }
  })
}

// Handler type for middleware
type Handler = (req: NextRequest) => Promise<NextResponse> | NextResponse

/**
 * Rate limiting middleware wrapper
 *
 * Usage:
 *   import { withRateLimit } from '@/lib/rate-limiter'
 *
 *   async function handlePost(req: NextRequest) {
 *     // your logic (rate limiting already applied)
 *     return NextResponse.json({ ok: true })
 *   }
 *
 *   export const POST = withCors(withRateLimit(handlePost))
 */
export function withRateLimit(handler: Handler): Handler {
  return async (req: NextRequest) => {
    const requestId = req.headers.get('x-request-id') ?? crypto.randomUUID()

    // Periodic cleanup (1% chance per request, runs for ALL traffic including 429s)
    if (Math.random() < 0.01) {
      cleanupRateLimiters()
    }

    const result = await checkRateLimit(req)

    if (!result.allowed) {
      const retryAfter = Math.ceil((result.resetTime - Date.now()) / 1000)
      return NextResponse.json(
        {
          error: 'Rate limit exceeded',
          details: result.reason,
          retryAfter,
        },
        {
          status: 429,
          headers: {
            'x-request-id': requestId,
            'Retry-After': retryAfter.toString(),
            'X-RateLimit-Remaining': result.remainingRequests.toString(),
            'X-RateLimit-Reset': result.resetTime.toString(),
          },
        }
      )
    }

    // Execute the actual handler
    const response = await handler(req)

    // Add rate limit headers to successful responses
    if (!response.headers.has('x-request-id')) {
      response.headers.set('x-request-id', requestId)
    }
    response.headers.set('X-RateLimit-Remaining', result.remainingRequests.toString())
    response.headers.set('X-RateLimit-Reset', result.resetTime.toString())

    return response
  }
}

// Export for testing
export { isRedisAvailable }
