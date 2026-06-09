/**
 * Redis client initialization for Upstash
 * Provides persistent storage for rate limiting across serverless instances
 */

import { Redis } from '@upstash/redis'

// Check if Redis is configured
const isRedisConfigured = !!(
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
)

// Create Redis client (only if configured)
export const redis = isRedisConfigured
  ? new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL!,
      token: process.env.UPSTASH_REDIS_REST_TOKEN!,
    })
  : null

// Export configuration status
export const isRedisAvailable = isRedisConfigured

/**
 * Log Redis availability on startup (development only)
 */
if (process.env.NODE_ENV === 'development') {
  if (isRedisConfigured) {
    console.debug('Redis configured - using persistent rate limiting')
  } else {
    console.debug('Redis not configured - using in-memory rate limiting (resets on restart)')
  }
}

/**
 * Running production without Redis means rate limits and quotas are tracked
 * per serverless instance — effectively unenforced under multi-instance load.
 * Deploys keep working, but make the degradation loud.
 */
if (process.env.NODE_ENV === 'production' && !isRedisConfigured) {
  console.warn(
    '[redis] UPSTASH_REDIS_REST_URL/UPSTASH_REDIS_REST_TOKEN not set — ' +
      'rate limiting and AI quotas fall back to per-instance in-memory tracking'
  )
}
