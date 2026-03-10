/** @jest-environment node */

import { NextRequest } from 'next/server'
import { POST } from '@/app/api/compare-rides/route'
import { auth } from '@/auth'
import { compareRidesByCoordinates, CompareServiceError } from '@/lib/services/ride-comparison'
import { findPrecomputedRouteByAddresses } from '@/lib/popular-routes-data'
import { generateRecommendations } from '@/lib/services/recommendations'
import { enhanceWithAI } from '@/lib/services/ai-insights'

jest.mock('@/lib/services/ride-comparison', () => ({
  ...jest.requireActual('@/lib/services/ride-comparison'),
  compareRidesByCoordinates: jest.fn(),
}))

jest.mock('@/lib/popular-routes-data', () => ({
  findPrecomputedRouteByAddresses: jest.fn(),
}))

jest.mock('@/lib/services/recommendations', () => ({
  generateRecommendations: jest.fn(),
}))

jest.mock('@/lib/services/ai-insights', () => ({
  enhanceWithAI: jest.fn(),
}))

const mockAuth = auth as jest.MockedFunction<typeof auth>
const mockCompareRides = compareRidesByCoordinates as jest.MockedFunction<
  typeof compareRidesByCoordinates
>
const mockFindPrecomputedRoute = findPrecomputedRouteByAddresses as jest.MockedFunction<
  typeof findPrecomputedRouteByAddresses
>
const mockGenerateRecommendations = generateRecommendations as jest.MockedFunction<
  typeof generateRecommendations
>
const mockEnhanceWithAI = enhanceWithAI as jest.MockedFunction<typeof enhanceWithAI>

const coordinateBody = {
  from: { name: '123 Main St', lat: '37.7749', lng: '-122.4194' },
  to: { name: '456 Market St', lat: '37.7879', lng: '-122.4074' },
}

function createRequest(body: object, ip: string) {
  return new NextRequest('http://localhost:3000/api/compare-rides', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': ip,
    },
    body: JSON.stringify(body),
  })
}

describe('compare-rides route', () => {
  const originalNodeEnv = process.env.NODE_ENV
  const env = process.env as Record<string, string | undefined>

  beforeEach(() => {
    jest.clearAllMocks()
    env.NODE_ENV = 'test'
    mockAuth.mockResolvedValue(null as never)
    mockFindPrecomputedRoute.mockReturnValue(undefined)
    mockGenerateRecommendations.mockResolvedValue({ recommendations: [] } as never)
    mockEnhanceWithAI.mockResolvedValue([])
  })

  afterAll(() => {
    env.NODE_ENV = originalNodeEnv
  })

  it('requires a security token in production for non-precomputed routes', async () => {
    env.NODE_ENV = 'production'

    const response = await POST(createRequest(coordinateBody, '10.0.0.1'))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: 'Security token required',
    })
  })

  it('returns ride comparisons and request metadata on success', async () => {
    env.NODE_ENV = 'test'
    mockCompareRides.mockResolvedValue({
      routeId: 'route-123',
      results: {
        uber: {
          price: '$18.50',
          waitTime: '4 min',
          driversNearby: 5,
          service: 'UberX',
        },
      },
      insights: 'Take Uber.',
      pickup: [-122.4, 37.7],
      destination: [-122.3, 37.8],
      surgeInfo: null,
      timeRecommendations: [],
      routeAccuracy: 'exact',
      routeWarning: undefined,
    } as never)

    const response = await POST(createRequest(coordinateBody, '10.0.0.2'))

    expect(response.status).toBe(200)
    expect(response.headers.get('x-request-id')).toBeTruthy()
    await expect(response.json()).resolves.toMatchObject({
      routeId: 'route-123',
      insights: 'Take Uber.',
      comparisons: {
        uber: expect.objectContaining({
          price: '$18.50',
        }),
      },
      routeAccuracy: 'exact',
    })
  })

  it('returns degraded success metadata when routing falls back to estimated metrics', async () => {
    mockCompareRides.mockResolvedValue({
      routeId: 'route-456',
      results: {
        uber: {
          price: '$20.00',
          waitTime: '5 min',
          driversNearby: 4,
          service: 'UberX',
        },
      },
      insights: 'Estimated route is available.',
      pickup: [-122.4, 37.7],
      destination: [-122.3, 37.8],
      surgeInfo: null,
      timeRecommendations: [],
      routeAccuracy: 'estimated',
      routeWarning:
        'Prices are based on estimated route metrics because live routing is temporarily unavailable.',
    } as never)

    const response = await POST(createRequest(coordinateBody, '10.0.0.3'))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      routeAccuracy: 'estimated',
      routeWarning: expect.stringMatching(/estimated route metrics/i),
    })
  })

  it('returns a stable 400 error for address resolution failures', async () => {
    mockCompareRides.mockRejectedValue(
      new CompareServiceError('ADDRESS_NOT_FOUND', 'Address could not be resolved')
    )

    const response = await POST(
      createRequest(
        {
          from: { name: 'bad address', lat: '37.7749', lng: '-122.4194' },
          to: { name: '456 Market St', lat: '37.7879', lng: '-122.4074' },
        },
        '10.0.0.4'
      )
    )

    expect(response.status).toBe(400)
    expect(response.headers.get('x-request-id')).toBeTruthy()
    await expect(response.json()).resolves.toMatchObject({
      code: 'ADDRESS_NOT_FOUND',
      requestId: expect.any(String),
    })
  })

  it('returns a stable 504 error for geocode timeouts', async () => {
    mockCompareRides.mockRejectedValue(
      new CompareServiceError('GEOCODE_TIMEOUT', 'Geocoding provider timed out', {
        provider: 'nominatim',
        phase: 'geocode',
        timedOut: true,
      })
    )

    const response = await POST(createRequest(coordinateBody, '10.0.0.5'))

    expect(response.status).toBe(504)
    await expect(response.json()).resolves.toMatchObject({
      code: 'GEOCODE_TIMEOUT',
    })
  })

  it('returns a stable 503 error when geocoding is unavailable', async () => {
    mockCompareRides.mockRejectedValue(
      new CompareServiceError('GEOCODE_UNAVAILABLE', 'Geocoding provider unavailable', {
        provider: 'nominatim',
        phase: 'geocode',
      })
    )

    const response = await POST(createRequest(coordinateBody, '10.0.0.6'))

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({
      code: 'GEOCODE_UNAVAILABLE',
    })
  })
})
