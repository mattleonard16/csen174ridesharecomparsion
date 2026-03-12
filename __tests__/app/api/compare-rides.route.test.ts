/** @jest-environment node */

import { compareRidesByAddresses, compareRidesByCoordinates } from '@/lib/services/ride-comparison'
import { findPrecomputedRouteByAddresses } from '@/lib/popular-routes-data'
import { auth } from '@/auth'
import { verifyRecaptchaToken } from '@/lib/recaptcha'
import { evaluateAndCreateNotifications } from '@/lib/alert-evaluation'

class MockHeaders {
  private readonly values = new Map<string, string>()

  constructor(init?: Record<string, string>) {
    if (!init) return
    Object.entries(init).forEach(([key, value]) => {
      this.values.set(key.toLowerCase(), value)
    })
  }

  get(name: string) {
    return this.values.get(name.toLowerCase()) ?? null
  }

  set(name: string, value: string) {
    this.values.set(name.toLowerCase(), value)
  }
}

class MockRequest {
  url: string
  method: string
  headers: MockHeaders
  private readonly body?: string

  constructor(
    input: string,
    init?: { method?: string; headers?: Record<string, string>; body?: string }
  ) {
    this.url = input
    this.method = init?.method ?? 'GET'
    this.headers = new MockHeaders(init?.headers)
    this.body = init?.body
  }

  async json() {
    return this.body ? JSON.parse(this.body) : null
  }
}

class MockResponse {
  status: number
  headers: MockHeaders
  private readonly body: string | null

  constructor(body?: string | null, init?: { status?: number; headers?: Record<string, string> }) {
    this.status = init?.status ?? 200
    this.headers = new MockHeaders(init?.headers)
    this.body = body ?? null
  }

  static json(body: unknown, init?: { status?: number; headers?: Record<string, string> }) {
    const response = new MockResponse(JSON.stringify(body), init)
    response.headers.set('content-type', 'application/json')
    return response
  }

  async json() {
    return this.body ? JSON.parse(this.body) : null
  }
}

jest.mock('next/server', () => ({
  NextRequest: MockRequest,
  NextResponse: MockResponse,
}))

jest.mock('@/lib/cors', () => ({
  withCors: (handler: unknown) => handler,
}))

jest.mock('@/lib/rate-limiter', () => ({
  withRateLimit: (handler: unknown) => handler,
}))

jest.mock('@/lib/services/ride-comparison', () => ({
  compareRidesByAddresses: jest.fn(),
  compareRidesByCoordinates: jest.fn(),
}))

jest.mock('@/lib/popular-routes-data', () => ({
  findPrecomputedRouteByAddresses: jest.fn(),
}))

jest.mock('@/auth', () => ({
  auth: jest.fn(),
}))

jest.mock('@/lib/recaptcha', () => ({
  verifyRecaptchaToken: jest.fn(),
  RECAPTCHA_CONFIG: {
    ACTIONS: {
      RIDE_COMPARISON: 'ride_comparison',
    },
    NORMAL_THRESHOLD: 0.5,
    LENIENT_THRESHOLD: 0.3,
  },
}))

jest.mock('@/lib/services/recommendations', () => ({
  generateRecommendations: jest.fn(async () => ({
    recommendations: [
      {
        id: 'rec-1',
        type: 'DEPARTURE_TIME',
        title: 'Better Time to Ride',
        message: 'Leave at 2 PM to save money.',
        confidence: 0.8,
        dataPoints: { bestHour: 14, potentialSavings: 6.5 },
      },
    ],
  })),
}))

jest.mock('@/lib/services/ai-insights', () => ({
  enhanceWithAI: jest.fn(async recommendations => recommendations),
}))

jest.mock('@/lib/alert-evaluation', () => ({
  evaluateAndCreateNotifications: jest.fn(async () => undefined),
}))

const mockCompareRidesByAddresses = compareRidesByAddresses as jest.MockedFunction<
  typeof compareRidesByAddresses
>
const mockCompareRidesByCoordinates = compareRidesByCoordinates as jest.MockedFunction<
  typeof compareRidesByCoordinates
>
const mockFindPrecomputedRoute = findPrecomputedRouteByAddresses as jest.MockedFunction<
  typeof findPrecomputedRouteByAddresses
>
const mockAuth = auth as unknown as jest.Mock
const mockVerifyRecaptchaToken = verifyRecaptchaToken as jest.MockedFunction<
  typeof verifyRecaptchaToken
>
const mockEvaluateAndCreateNotifications = evaluateAndCreateNotifications as jest.MockedFunction<
  typeof evaluateAndCreateNotifications
>

let GET: (request: MockRequest) => Promise<MockResponse>
let POST: (request: MockRequest) => Promise<MockResponse>

const comparisonFixture = {
  routeId: 'route-123',
  results: {
    uber: {
      price: '$19.00',
      waitTime: '4 min',
      driversNearby: 5,
      service: 'UberX',
    },
  },
  insights: 'Uber looks like the best overall choice.',
  pickup: [-122.4194, 37.7749] as [number, number],
  destination: [-122.2711, 37.8044] as [number, number],
  surgeInfo: {
    multiplier: 1.2,
    reason: 'Rush hour',
    isActive: true,
  },
  timeRecommendations: ['Prices usually ease after 7 PM.'],
  routeAccuracy: 'exact' as const,
}

describe('/api/compare-rides route', () => {
  const originalNodeEnv = process.env.NODE_ENV

  beforeAll(async () => {
    Object.defineProperty(globalThis, 'crypto', {
      value: {
        randomUUID: () => 'test-request-id',
      },
      configurable: true,
    })
    ;({ GET, POST } = (await import('@/app/api/compare-rides/route')) as unknown as {
      GET: (request: MockRequest) => Promise<MockResponse>
      POST: (request: MockRequest) => Promise<MockResponse>
    })
  })

  beforeEach(() => {
    jest.clearAllMocks()
    ;(process.env as Record<string, string | undefined>).NODE_ENV = 'test'
    mockAuth.mockResolvedValue({ user: { id: 'user-123' } })
    mockVerifyRecaptchaToken.mockResolvedValue({
      success: true,
      score: 0.9,
      action: 'ride_comparison',
    } as Awaited<ReturnType<typeof verifyRecaptchaToken>>)
    mockFindPrecomputedRoute.mockReturnValue(undefined)
    mockCompareRidesByAddresses.mockResolvedValue(comparisonFixture)
    mockCompareRidesByCoordinates.mockResolvedValue(comparisonFixture)
    mockEvaluateAndCreateNotifications.mockResolvedValue(undefined)
  })

  afterAll(() => {
    ;(process.env as Record<string, string | undefined>).NODE_ENV = originalNodeEnv
  })

  it('returns 400 when GET is missing pickup or destination', async () => {
    const request = new MockRequest('http://localhost/api/compare-rides?pickup=Only%20Pickup')
    const response = await GET(request)

    expect(response.status).toBe(400)
    expect(response.headers.get('x-request-id')).toBeTruthy()
  })

  it('returns cached GET response metadata for precomputed routes', async () => {
    mockFindPrecomputedRoute.mockReturnValue({
      pickup: { coordinates: comparisonFixture.pickup },
      destination: { coordinates: comparisonFixture.destination },
      metrics: { distanceKm: 10, durationMin: 15 },
    } as ReturnType<typeof findPrecomputedRouteByAddresses>)

    const request = new MockRequest(
      'http://localhost/api/compare-rides?pickup=SFO&destination=Downtown%20SF'
    )
    const response = await GET(request)
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toContain('max-age=300')
    expect(payload.routeId).toBe('route-123')
    expect(payload.aiRecommendations).toHaveLength(1)
  })

  it('uses the coordinate comparison path for validated coordinate payloads', async () => {
    const request = new MockRequest('http://localhost/api/compare-rides', {
      method: 'POST',
      body: JSON.stringify({
        from: {
          name: 'San Francisco, CA',
          lat: '37.7749',
          lng: '-122.4194',
        },
        to: {
          name: 'Oakland, CA',
          lat: '37.8044',
          lng: '-122.2711',
        },
        services: ['uber', 'lyft'],
        recaptchaToken: 'token-123',
      }),
      headers: {
        'Content-Type': 'application/json',
      },
    })

    const response = await POST(request)
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(mockCompareRidesByCoordinates).toHaveBeenCalledWith(
      {
        name: 'San Francisco, CA',
        coordinates: [-122.4194, 37.7749],
      },
      {
        name: 'Oakland, CA',
        coordinates: [-122.2711, 37.8044],
      },
      ['uber', 'lyft'],
      expect.any(Date),
      expect.objectContaining({
        userId: 'user-123',
        persist: true,
        pickupAddress: 'San Francisco, CA',
        destinationAddress: 'Oakland, CA',
      })
    )
    expect(payload.pickupCoords).toEqual(comparisonFixture.pickup)
  })

  it('accepts airport-style names in coordinate payloads', async () => {
    const request = new MockRequest('http://localhost/api/compare-rides', {
      method: 'POST',
      body: JSON.stringify({
        from: {
          name: 'San Francisco International Airport (SFO)',
          lat: '37.6213',
          lng: '-122.3790',
        },
        to: {
          name: 'Union Square, San Francisco, CA',
          lat: '37.7879',
          lng: '-122.4074',
        },
        services: ['uber', 'lyft'],
        recaptchaToken: 'token-123',
      }),
      headers: {
        'Content-Type': 'application/json',
      },
    })

    const response = await POST(request)
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(mockCompareRidesByCoordinates).toHaveBeenCalledWith(
      {
        name: 'San Francisco International Airport (SFO)',
        coordinates: [-122.379, 37.6213],
      },
      {
        name: 'Union Square, San Francisco, CA',
        coordinates: [-122.4074, 37.7879],
      },
      ['uber', 'lyft'],
      expect.any(Date),
      expect.objectContaining({
        userId: 'user-123',
        persist: true,
        pickupAddress: 'San Francisco International Airport (SFO)',
        destinationAddress: 'Union Square, San Francisco, CA',
      })
    )
    expect(payload.pickupCoords).toEqual(comparisonFixture.pickup)
  })

  it('rejects legacy string format payloads with 400', async () => {
    const request = new MockRequest('http://localhost/api/compare-rides', {
      method: 'POST',
      body: JSON.stringify({
        pickup: 'San Francisco, CA',
        destination: 'Oakland, CA',
      }),
      headers: {
        'Content-Type': 'application/json',
      },
    })

    const response = await POST(request)
    const payload = await response.json()

    expect(response.status).toBe(400)
    expect(payload.error).toContain('Invalid request format')
    expect(mockCompareRidesByAddresses).not.toHaveBeenCalled()
    expect(mockCompareRidesByCoordinates).not.toHaveBeenCalled()
  })

  it('rejects suspiciously close coordinate routes', async () => {
    const request = new MockRequest('http://localhost/api/compare-rides', {
      method: 'POST',
      body: JSON.stringify({
        from: {
          name: 'Same Spot',
          lat: '37.7749',
          lng: '-122.4194',
        },
        to: {
          name: 'Same Spot Again',
          lat: '37.7749',
          lng: '-122.4194',
        },
        services: ['uber'],
        recaptchaToken: 'token-123',
      }),
      headers: {
        'Content-Type': 'application/json',
      },
    })

    const response = await POST(request)
    const payload = await response.json()

    expect(response.status).toBe(400)
    expect(payload.error).toContain('too close')
    expect(mockCompareRidesByCoordinates).not.toHaveBeenCalled()
  })

  it('requires reCAPTCHA in production for non-precomputed routes', async () => {
    ;(process.env as Record<string, string | undefined>).NODE_ENV = 'production'

    const request = new MockRequest('http://localhost/api/compare-rides', {
      method: 'POST',
      body: JSON.stringify({
        from: {
          name: 'San Francisco, CA',
          lat: '37.7749',
          lng: '-122.4194',
        },
        to: {
          name: 'Oakland, CA',
          lat: '37.8044',
          lng: '-122.2711',
        },
      }),
      headers: {
        'Content-Type': 'application/json',
      },
    })

    const response = await POST(request)
    const payload = await response.json()

    expect(response.status).toBe(400)
    expect(payload.error).toBe('Security token required')
  })
})
