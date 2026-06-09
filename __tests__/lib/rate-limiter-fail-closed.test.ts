/** @jest-environment node */

/**
 * Fail-closed behavior of checkRateLimit when Redis is configured but errors
 * at runtime. Separate file from rate-limiter.test.ts because that suite mocks
 * redis as null at module scope; here the limiter must initialize with a
 * (failing) Redis client.
 */

import type { NextRequest } from 'next/server'

const ORIGINAL_ENV = { ...process.env }

function makeRequest(ip: string): NextRequest {
  // Imported lazily so each isolated module registry gets its own next/server
  const { NextRequest } = jest.requireActual('next/server')
  return new NextRequest('http://localhost:3000/test', {
    method: 'GET',
    headers: { 'x-forwarded-for': ip },
  })
}

async function loadRateLimiterWithFailingRedis(): Promise<{
  checkRateLimit: (req: Request) => Promise<{ allowed: boolean; reason?: string }>
  logError: jest.Mock
}> {
  let checkRateLimit!: (req: Request) => Promise<{ allowed: boolean; reason?: string }>
  const logError = jest.fn()

  await jest.isolateModulesAsync(async () => {
    jest.doMock('@/lib/redis', () => ({
      redis: {}, // truthy so Redis-backed limiters are constructed
      isRedisAvailable: true,
    }))
    jest.doMock('@upstash/ratelimit', () => ({
      Ratelimit: Object.assign(
        jest.fn().mockImplementation(() => ({
          limit: jest.fn().mockRejectedValue(new Error('Redis connection refused')),
        })),
        { slidingWindow: jest.fn().mockReturnValue('sliding-window-config') }
      ),
    }))
    jest.doMock('@/lib/monitoring', () => ({
      log: jest.fn(),
      logError,
    }))

    const mod = await import('@/lib/rate-limiter')
    checkRateLimit = mod.checkRateLimit
  })

  return { checkRateLimit, logError }
}

describe('checkRateLimit with Redis runtime failures', () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV }
  })

  it('fails closed in production: denies the request and logs the error', async () => {
    const { checkRateLimit, logError } = await loadRateLimiterWithFailingRedis()
    Object.assign(process.env, { NODE_ENV: 'production' })

    const result = await checkRateLimit(makeRequest('203.0.113.5'))

    expect(result.allowed).toBe(false)
    expect(result.reason).toMatch(/temporarily unavailable/i)
    expect(logError).toHaveBeenCalledTimes(1)
  })

  it('falls back to in-memory limits outside production', async () => {
    const { checkRateLimit } = await loadRateLimiterWithFailingRedis()
    Object.assign(process.env, { NODE_ENV: 'test' })

    const result = await checkRateLimit(makeRequest('203.0.113.6'))

    expect(result.allowed).toBe(true)
  })
})
