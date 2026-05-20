/** @jest-environment node */

import { NextRequest } from 'next/server'
import { GET, POST } from '@/app/api/ride-history/route'
import { auth } from '@/auth'
import { createRideHistory, getRideHistoryForUser, getRideHistoryStats } from '@/lib/database'

jest.mock('@/lib/rate-limiter', () => ({
  withRateLimit: (handler: unknown) => handler,
}))

jest.mock('@/lib/cors', () => ({
  withCors: (handler: unknown) => handler,
}))

jest.mock('@/lib/database', () => ({
  createRideHistory: jest.fn(),
  getRideHistoryForUser: jest.fn(),
  getRideHistoryStats: jest.fn(),
}))

const mockAuth = auth as jest.MockedFunction<typeof auth>
const mockCreateRideHistory = createRideHistory as jest.MockedFunction<typeof createRideHistory>
const mockGetRideHistoryForUser = getRideHistoryForUser as jest.MockedFunction<
  typeof getRideHistoryForUser
>
const mockGetRideHistoryStats = getRideHistoryStats as jest.MockedFunction<
  typeof getRideHistoryStats
>

const VALID_SNAPSHOT = { uber: { price: '$25.00' }, lyft: { price: '$22.00' } }

function createPostRequest(body: object, ip = '10.0.0.1') {
  return new NextRequest('http://localhost:3000/api/ride-history', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': ip,
    },
    body: JSON.stringify(body),
  })
}

function createGetRequest(query = '', ip = '10.0.0.1') {
  return new NextRequest(`http://localhost:3000/api/ride-history${query}`, {
    headers: {
      'x-forwarded-for': ip,
    },
  })
}

describe('POST /api/ride-history', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns 401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null as never)

    const response = await POST(
      createPostRequest({
        service: 'uber',
        estimatedFare: 22.5,
        comparisonSnapshot: VALID_SNAPSHOT,
      })
    )

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toMatchObject({ error: 'Unauthorized' })
  })

  it('returns 400 for missing required fields', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as never)

    const response = await POST(createPostRequest({}))

    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.error).toBe('Invalid input')
    expect(Array.isArray(body.details)).toBe(true)
    expect(body.details.length).toBeGreaterThan(0)
  })

  it('returns 400 for invalid service enum', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as never)

    const response = await POST(
      createPostRequest({
        service: 'doordash',
        estimatedFare: 22.5,
        comparisonSnapshot: VALID_SNAPSHOT,
      })
    )

    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.error).toBe('Invalid input')
  })

  it('returns 400 for out-of-range estimatedFare', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as never)

    const response = await POST(
      createPostRequest({
        service: 'uber',
        estimatedFare: 9999,
        comparisonSnapshot: VALID_SNAPSHOT,
      })
    )

    expect(response.status).toBe(400)
  })

  it('returns 201 with id on success', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as never)
    mockCreateRideHistory.mockResolvedValue({ id: 'history-abc' })

    const response = await POST(
      createPostRequest({
        service: 'lyft',
        estimatedFare: 18.75,
        waitTimeMinutes: 4,
        surgeMultiplier: 1.2,
        comparisonSnapshot: VALID_SNAPSHOT,
      })
    )

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toMatchObject({ success: true, id: 'history-abc' })
    expect(mockCreateRideHistory).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        service: 'lyft',
        estimatedFare: 18.75,
      })
    )
  })

  it('returns 500 when createRideHistory returns null (DB failure)', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as never)
    mockCreateRideHistory.mockResolvedValue(null)

    const response = await POST(
      createPostRequest({
        service: 'taxi',
        estimatedFare: 30.0,
        comparisonSnapshot: VALID_SNAPSHOT,
      })
    )

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toMatchObject({ error: expect.any(String) })
  })
})

describe('GET /api/ride-history — list', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns 401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null as never)

    const response = await GET(createGetRequest())

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toMatchObject({ error: 'Unauthorized' })
  })

  it('returns paginated history for authenticated user', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-2' } } as never)
    mockGetRideHistoryForUser.mockResolvedValue({
      history: [
        {
          id: 'h-1',
          routeId: 'r-1',
          service: 'uber',
          estimatedFare: 20,
          finalFare: null,
          waitTimeMinutes: 5,
          surgeMultiplier: null,
          comparisonSnapshot: VALID_SNAPSHOT as never,
          requestedAt: '2026-03-01T10:00:00.000Z',
          updatedAt: '2026-03-01T10:00:00.000Z',
        },
      ],
      nextCursor: null,
      total: 1,
    })

    const response = await GET(createGetRequest('?limit=10'))

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(Array.isArray(body.history)).toBe(true)
    expect(body.nextCursor).toBeNull()
    expect(body.total).toBe(1)
    expect(mockGetRideHistoryForUser).toHaveBeenCalledWith('user-2', undefined, 10)
  })

  it('passes cursor param to getRideHistoryForUser', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-3' } } as never)
    mockGetRideHistoryForUser.mockResolvedValue({ history: [], nextCursor: null, total: 0 })

    await GET(createGetRequest('?cursor=h-5&limit=5'))

    expect(mockGetRideHistoryForUser).toHaveBeenCalledWith('user-3', 'h-5', 5)
  })

  it('clamps limit to 20 when limit is out of range', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-4' } } as never)
    mockGetRideHistoryForUser.mockResolvedValue({ history: [], nextCursor: null, total: 0 })

    await GET(createGetRequest('?limit=999'))

    expect(mockGetRideHistoryForUser).toHaveBeenCalledWith('user-4', undefined, 20)
  })
})

describe('GET /api/ride-history — analytics', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns stats when analytics=true', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-5' } } as never)
    mockGetRideHistoryStats.mockResolvedValue({
      totalSpent: 120.5,
      rideCount: 6,
      avgFare: 20.08,
      byService: { uber: { count: 4, totalSpent: 90, avgFare: 22.5 } },
      totalSavings: 15.0,
    })

    const response = await GET(createGetRequest('?analytics=true&daysBack=30'))

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toMatchObject({
      totalSpent: 120.5,
      rideCount: 6,
      avgFare: 20.08,
    })
    expect(mockGetRideHistoryStats).toHaveBeenCalledWith('user-5', 30)
  })

  it('defaults daysBack to 30 when out of range', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-6' } } as never)
    mockGetRideHistoryStats.mockResolvedValue({
      totalSpent: 0,
      rideCount: 0,
      avgFare: 0,
      byService: {},
      totalSavings: 0,
    })

    await GET(createGetRequest('?analytics=true&daysBack=999'))

    expect(mockGetRideHistoryStats).toHaveBeenCalledWith('user-6', 30)
  })

  it('does not call getRideHistoryStats without analytics=true', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-7' } } as never)
    mockGetRideHistoryForUser.mockResolvedValue({ history: [], nextCursor: null, total: 0 })

    await GET(createGetRequest())

    expect(mockGetRideHistoryStats).not.toHaveBeenCalled()
    expect(mockGetRideHistoryForUser).toHaveBeenCalled()
  })
})
