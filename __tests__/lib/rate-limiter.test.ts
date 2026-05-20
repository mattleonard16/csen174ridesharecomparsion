/** @jest-environment node */

jest.mock('@/lib/redis', () => ({
  redis: null,
  isRedisAvailable: false,
}))

import { NextRequest, NextResponse } from 'next/server'
import { withRateLimit } from '@/lib/rate-limiter'

const ORIGINAL_ENV = { ...process.env }

function makeRequest(ip?: string): NextRequest {
  const headers: Record<string, string> = {}
  if (ip) headers['x-forwarded-for'] = ip
  return new NextRequest('http://localhost:3000/test', {
    method: 'GET',
    headers,
  })
}

function okHandler() {
  return jest.fn(async () => NextResponse.json({ ok: true }))
}

describe('withRateLimit (in-mem fallback)', () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV }
    process.env.RATE_LIMIT_BURST = '3'
    process.env.RATE_LIMIT_BURST_WINDOW = '10'
    process.env.RATE_LIMIT_PER_HOUR = '50'
    jest.resetModules()
  })

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV }
  })

  it('invokes handler and returns its response on first request', async () => {
    const handler = okHandler()
    const wrapped = withRateLimit(handler)

    const res = await wrapped(makeRequest('10.0.0.1'))

    expect(handler).toHaveBeenCalledTimes(1)
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ ok: true })
  })

  it('adds rate-limit headers to successful responses', async () => {
    const wrapped = withRateLimit(okHandler())
    const res = await wrapped(makeRequest('10.0.0.2'))

    expect(res.headers.get('X-RateLimit-Remaining')).toBeDefined()
    expect(res.headers.get('X-RateLimit-Reset')).toBeDefined()
    expect(res.headers.get('x-request-id')).toBeDefined()
  })

  it('returns 429 after burst limit is exhausted', async () => {
    const handler = okHandler()
    const wrapped = withRateLimit(handler)
    const ip = '10.0.0.3'

    const r1 = await wrapped(makeRequest(ip))
    const r2 = await wrapped(makeRequest(ip))
    const r3 = await wrapped(makeRequest(ip))
    const r4 = await wrapped(makeRequest(ip))

    expect(r1.status).toBe(200)
    expect(r2.status).toBe(200)
    expect(r3.status).toBe(200)
    expect(r4.status).toBe(429)
    expect(handler).toHaveBeenCalledTimes(3)

    expect(r4.headers.get('Retry-After')).toBeDefined()
    expect(Number(r4.headers.get('Retry-After'))).toBeGreaterThanOrEqual(0)

    const body = await r4.json()
    expect(body.error).toBe('Rate limit exceeded')
    expect(body.details).toMatch(/Burst limit exceeded/)
    expect(typeof body.retryAfter).toBe('number')
  })

  it('isolates buckets per client IP', async () => {
    const handler = okHandler()
    const wrapped = withRateLimit(handler)

    // Exhaust client A
    await wrapped(makeRequest('10.0.0.10'))
    await wrapped(makeRequest('10.0.0.10'))
    await wrapped(makeRequest('10.0.0.10'))
    const blockedA = await wrapped(makeRequest('10.0.0.10'))
    expect(blockedA.status).toBe(429)

    // Client B still has its own quota
    const okB = await wrapped(makeRequest('10.0.0.11'))
    expect(okB.status).toBe(200)
  })

  it('propagates handler throws (does not swallow)', async () => {
    const boom = new Error('handler exploded')
    const wrapped = withRateLimit(async () => {
      throw boom
    })

    await expect(wrapped(makeRequest('10.0.0.20'))).rejects.toBe(boom)
  })

  it('does not crash when x-forwarded-for is missing', async () => {
    const wrapped = withRateLimit(okHandler())
    const res = await wrapped(makeRequest())
    expect(res.status).toBe(200)
  })
})
