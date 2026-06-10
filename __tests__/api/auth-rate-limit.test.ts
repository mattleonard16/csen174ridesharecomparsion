/** @jest-environment node */

/**
 * The NextAuth POST handler (credential sign-in attempts) must be rate
 * limited; GET (session reads, CSRF) must not be.
 */

jest.mock('@/lib/redis', () => ({
  redis: null,
  isRedisAvailable: false,
}))

jest.mock('@/auth', () => ({
  handlers: {
    GET: jest.fn(async () => Response.json({ session: null })),
    POST: jest.fn(async () => Response.json({ signedIn: true })),
  },
}))

import { NextRequest } from 'next/server'
import { GET, POST } from '@/app/api/auth/[...nextauth]/route'

const { handlers } = jest.requireMock('@/auth') as {
  handlers: { GET: jest.Mock; POST: jest.Mock }
}
const mockAuthGet = handlers.GET
const mockAuthPost = handlers.POST

function makeRequest(method: 'GET' | 'POST', ip: string): NextRequest {
  return new NextRequest('http://localhost:3000/api/auth/callback/credentials', {
    method,
    headers: { 'x-forwarded-for': ip },
  })
}

describe('auth route rate limiting', () => {
  beforeEach(() => {
    mockAuthPost.mockClear()
    mockAuthGet.mockClear()
  })

  it('passes sign-in POSTs through within the burst limit', async () => {
    const res = await POST(makeRequest('POST', '198.51.100.1'))

    expect(res.status).toBe(200)
    expect(mockAuthPost).toHaveBeenCalledTimes(1)
  })

  it('returns 429 with Retry-After once the burst limit is exhausted', async () => {
    const ip = '198.51.100.2'

    await POST(makeRequest('POST', ip))
    await POST(makeRequest('POST', ip))
    await POST(makeRequest('POST', ip))
    const blocked = await POST(makeRequest('POST', ip))

    expect(blocked.status).toBe(429)
    expect(blocked.headers.get('Retry-After')).toBeDefined()
    expect(mockAuthPost).toHaveBeenCalledTimes(3)
  })

  it('does not rate limit GET (session polling)', async () => {
    const ip = '198.51.100.3'

    for (let i = 0; i < 10; i++) {
      const res = await GET(makeRequest('GET', ip))
      expect(res.status).toBe(200)
    }
    expect(mockAuthGet).toHaveBeenCalledTimes(10)
  })

  it('keeps sign-in attempts from one client from blocking another', async () => {
    const ipA = '198.51.100.4'
    const ipB = '198.51.100.5'

    await POST(makeRequest('POST', ipA))
    await POST(makeRequest('POST', ipA))
    await POST(makeRequest('POST', ipA))
    const blockedA = await POST(makeRequest('POST', ipA))
    expect(blockedA.status).toBe(429)

    const okB = await POST(makeRequest('POST', ipB))
    expect(okB.status).toBe(200)
  })
})
