/** @jest-environment node */

import { NextRequest } from 'next/server'
import { OPTIONS, POST } from '@/app/api/recommendations/actions/route'
import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'

jest.mock('@/lib/prisma', () => ({
  prisma: {
    recommendation: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    recommendationAction: {
      create: jest.fn(),
    },
  },
}))

const mockAuth = auth as jest.MockedFunction<typeof auth>

function createRequest(
  body: object,
  {
    ip,
    sessionId,
    method = 'POST',
  }: {
    ip: string
    sessionId?: string
    method?: 'POST' | 'OPTIONS'
  }
) {
  return new NextRequest('http://localhost:3000/api/recommendations/actions', {
    method,
    headers: {
      'x-forwarded-for': ip,
      ...(method === 'POST' ? { 'content-type': 'application/json' } : {}),
      ...(sessionId ? { 'x-session-id': sessionId } : {}),
    },
    ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
  })
}

describe('recommendation actions route', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    process.env.DATABASE_URL = 'postgres://test'
    mockAuth.mockResolvedValue(null as never)
    ;(prisma.recommendation.findUnique as jest.Mock).mockResolvedValue({ id: 'rec-1' })
    ;(prisma.recommendationAction.create as jest.Mock).mockResolvedValue({ id: 'action-1' })
    ;(prisma.recommendation.update as jest.Mock).mockResolvedValue({})
  })

  it('requires authenticated user or session identifier', async () => {
    const response = await POST(
      createRequest(
        {
          recommendationId: 'rec-1',
          action: 'VIEWED',
        },
        { ip: '10.0.3.1' }
      )
    )

    expect(response.status).toBe(401)
  })

  it('responds to CORS preflight without auth or a request body', async () => {
    const response = await OPTIONS(
      createRequest({} as object, {
        ip: '10.0.3.0',
        method: 'OPTIONS',
      })
    )

    expect(response.status).toBe(204)
    expect(response.headers.get('Access-Control-Allow-Methods')).toContain('POST')
  })

  it('records anonymous analytics when a session identifier is present', async () => {
    const response = await POST(
      createRequest(
        {
          recommendationId: 'rec-1',
          action: 'VIEWED',
        },
        { ip: '10.0.3.2', sessionId: 'session-123' }
      )
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('x-request-id')).toBeTruthy()
    expect(prisma.recommendationAction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          recommendationId: 'rec-1',
          action: 'VIEWED',
          userId: undefined,
        }),
      })
    )
  })

  it('dedupes repeated actions for the same actor and recommendation', async () => {
    const first = await POST(
      createRequest(
        {
          recommendationId: 'rec-1',
          action: 'CLICKED',
        },
        { ip: '10.0.3.3', sessionId: 'session-dup' }
      )
    )
    const second = await POST(
      createRequest(
        {
          recommendationId: 'rec-1',
          action: 'CLICKED',
        },
        { ip: '10.0.3.3', sessionId: 'session-dup' }
      )
    )

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    await expect(second.json()).resolves.toMatchObject({ success: true, deduped: true })
    expect(prisma.recommendationAction.create).toHaveBeenCalledTimes(1)
  })

  it('allows retries after a failed write instead of poisoning the dedupe key', async () => {
    ;(prisma.recommendationAction.create as jest.Mock)
      .mockRejectedValueOnce(new Error('database unavailable'))
      .mockResolvedValueOnce({ id: 'action-2' })

    const first = await POST(
      createRequest(
        {
          recommendationId: 'rec-1',
          action: 'FOLLOWED',
          estimatedSavings: 12,
        },
        { ip: '10.0.3.5', sessionId: 'session-retry' }
      )
    )
    const second = await POST(
      createRequest(
        {
          recommendationId: 'rec-1',
          action: 'FOLLOWED',
          estimatedSavings: 12,
        },
        { ip: '10.0.3.5', sessionId: 'session-retry' }
      )
    )

    expect(first.status).toBe(500)
    expect(second.status).toBe(200)
    await expect(second.json()).resolves.toMatchObject({ success: true })
    expect(prisma.recommendationAction.create).toHaveBeenCalledTimes(2)
  })

  it('rate limits abusive writes', async () => {
    const requestBody = (recommendationId: string) =>
      createRequest(
        {
          recommendationId,
          action: 'VIEWED',
        },
        { ip: '10.0.3.4', sessionId: 'session-rate-limit' }
      )

    const first = await POST(requestBody('rec-1'))
    const second = await POST(requestBody('rec-2'))
    const third = await POST(requestBody('rec-3'))
    const fourth = await POST(requestBody('rec-4'))

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(third.status).toBe(200)
    expect(fourth.status).toBe(429)
    expect(fourth.headers.get('x-request-id')).toBeTruthy()
  })
})
