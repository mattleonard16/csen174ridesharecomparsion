/** @jest-environment node */

import { NextRequest } from 'next/server'
import { GET as priceTrendsGet } from '@/app/api/price-trends/route'
import { GET as summaryGet } from '@/app/api/price-trends/summary/route'
import { auth } from '@/auth'
import { getPriceTrendSnapshots, getPriceTrendsSummary } from '@/lib/database-price-trends'

const mockGetPriceTrendSnapshots = getPriceTrendSnapshots as jest.MockedFunction<
  typeof getPriceTrendSnapshots
>
const mockGetPriceTrendsSummary = getPriceTrendsSummary as jest.MockedFunction<
  typeof getPriceTrendsSummary
>

const mockAuth = auth as jest.MockedFunction<typeof auth>

// Mock prisma for IDOR checks
const mockFindUnique = jest.fn()

jest.mock('@/lib/database-price-trends', () => ({
  getPriceTrendSnapshots: jest.fn(),
  getPriceTrendsSummary: jest.fn(),
}))

jest.mock('@/lib/prisma', () => ({
  prisma: {
    savedRoute: {
      findUnique: (...args: unknown[]) => mockFindUnique(...args),
    },
  },
}))

jest.mock('@/lib/rate-limiter', () => ({
  withRateLimit: (handler: unknown) => handler,
}))

jest.mock('@/lib/cors', () => ({
  withCors: (handler: unknown) => handler,
}))

jest.mock('@/lib/monitoring', () => ({
  logError: jest.fn(),
}))

const BASE_URL = 'http://localhost:3000/api/price-trends'

let ipCounter = 1
function nextIp() {
  return `10.0.${Math.floor(ipCounter / 256)}.${ipCounter++ % 256}`
}

function createRequest(url: string, ip = nextIp()) {
  return new NextRequest(url, {
    method: 'GET',
    headers: { 'x-forwarded-for': ip },
  })
}

describe('GET /api/price-trends', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    // Default: user does NOT own the route
    mockFindUnique.mockResolvedValue(null)
  })

  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValue(null as never)

    const response = await priceTrendsGet(createRequest(`${BASE_URL}?routeId=route-1`))

    expect(response.status).toBe(401)
    const body = await response.json()
    expect(body.error).toBe('Unauthorized')
  })

  it('returns 400 when routeId is missing', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as never)

    const response = await priceTrendsGet(createRequest(BASE_URL))

    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.error).toBe('Invalid input')
  })

  it('returns 400 for invalid service parameter', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as never)

    const response = await priceTrendsGet(
      createRequest(`${BASE_URL}?routeId=route-1&service=invalid`)
    )

    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.error).toBe('Invalid input')
  })

  it('returns 403 when user does not own the route', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as never)
    // Default mock returns null = no ownership

    const response = await priceTrendsGet(createRequest(`${BASE_URL}?routeId=route-1`))

    expect(response.status).toBe(403)
    const body = await response.json()
    expect(body.error).toContain('Access denied')
  })

  it('returns 200 with snapshots for valid request', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as never)
    mockFindUnique.mockResolvedValueOnce({ id: 'sr-1' })
    mockGetPriceTrendSnapshots.mockResolvedValueOnce([
      {
        id: 'snap-1',
        timestamp: '2026-04-09T10:00:00Z',
        service: 'uber',
        basePrice: 15,
        surgeMultiplier: 1.2,
        finalPrice: 18,
        waitTimeMinutes: 5,
        dayOfWeek: 4,
        hourOfDay: 10,
        weatherCondition: 'Clear',
        weatherTempF: 72,
        isRaining: false,
        trafficLevel: 'moderate',
        nearbyEvents: [],
        isHoliday: false,
        confidence: 0.85,
      },
    ])

    const response = await priceTrendsGet(createRequest(`${BASE_URL}?routeId=route-1&daysBack=7`))

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.snapshots).toHaveLength(1)
    expect(body.snapshots[0].service).toBe('uber')
  })

  it('returns 200 with empty snapshots for route with no data', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as never)
    mockFindUnique.mockResolvedValueOnce({ id: 'sr-1' })
    mockGetPriceTrendSnapshots.mockResolvedValueOnce([])

    const response = await priceTrendsGet(createRequest(`${BASE_URL}?routeId=route-1`))

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.snapshots).toEqual([])
  })

  it('includes x-request-id header on all responses', async () => {
    mockAuth.mockResolvedValue(null as never)

    const response = await priceTrendsGet(createRequest(`${BASE_URL}?routeId=route-1`))

    expect(response.headers.get('x-request-id')).toBeDefined()
  })

  it('filters by service when provided', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as never)
    mockFindUnique.mockResolvedValueOnce({ id: 'sr-1' })
    mockGetPriceTrendSnapshots.mockResolvedValueOnce([])

    await priceTrendsGet(createRequest(`${BASE_URL}?routeId=route-1&service=uber`))

    expect(mockGetPriceTrendSnapshots).toHaveBeenCalledWith(
      'route-1',
      expect.objectContaining({ service: 'uber' })
    )
  })
})

describe('GET /api/price-trends/summary', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    // Default: user does NOT own the route
    mockFindUnique.mockResolvedValue(null)
  })

  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValue(null as never)

    const response = await summaryGet(createRequest(`${BASE_URL}/summary?routeId=route-1`))

    expect(response.status).toBe(401)
  })

  it('returns 400 when routeId is missing', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as never)

    const response = await summaryGet(createRequest(`${BASE_URL}/summary`))

    expect(response.status).toBe(400)
  })

  it('returns summary for valid request', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as never)
    mockFindUnique.mockResolvedValueOnce({ id: 'sr-1' })
    mockGetPriceTrendsSummary.mockResolvedValueOnce({
      routeId: 'route-1',
      daysBack: 7,
      services: [
        {
          service: 'uber',
          avgPrice: 18,
          minPrice: 15,
          maxPrice: 21,
          cheapestHour: 10,
          surgeProbabilityByHour: Array.from({ length: 24 }, (_, i) => ({
            hour: i,
            probability: 0,
          })),
          priceByDayOfWeek: Array.from({ length: 7 }, (_, i) => ({
            day: i,
            avgPrice: 18,
          })),
          sampleSize: 10,
        },
      ],
    })

    const response = await summaryGet(
      createRequest(`${BASE_URL}/summary?routeId=route-1&daysBack=7`)
    )

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.services).toHaveLength(1)
    expect(body.services[0].surgeProbabilityByHour).toHaveLength(24)
    expect(body.services[0].priceByDayOfWeek).toHaveLength(7)
  })

  it('returns 403 when user does not own the route', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as never)
    // Default mock returns null = no ownership

    const response = await summaryGet(createRequest(`${BASE_URL}/summary?routeId=route-1`))

    expect(response.status).toBe(403)
  })

  it('includes x-request-id header on error responses', async () => {
    mockAuth.mockResolvedValue(null as never)

    const response = await summaryGet(createRequest(`${BASE_URL}/summary?routeId=route-1`))

    expect(response.headers.get('x-request-id')).toBeDefined()
  })
})
