import { generateRecommendations } from '@/lib/services/recommendations'
import { getCached } from '@/lib/cache/redis-cache'

// Mock redis-cache — pass-through by default (cache miss: always call compute)
jest.mock('@/lib/cache/redis-cache', () => ({
  getCached: jest.fn(async (_key: string, _ttl: number, compute: () => Promise<unknown>) => ({
    value: await compute(),
    cacheHit: false,
  })),
}))

const mockGetCached = getCached as jest.MockedFunction<typeof getCached>

// Mock prisma
jest.mock('@/lib/prisma', () => ({
  prisma: {
    routeInsights: {
      findUnique: jest.fn(),
    },
    priceSnapshot: {
      findMany: jest.fn(),
      groupBy: jest.fn(),
    },
    recommendation: {
      create: jest.fn().mockResolvedValue({ id: 'rec-mock-id' }),
    },
    recommendationAction: {
      findMany: jest.fn(),
    },
  },
}))

// Mock insights aggregator
jest.mock('@/lib/services/insights-aggregator', () => ({
  getOrComputeInsights: jest.fn(),
}))

import { getOrComputeInsights } from '@/lib/services/insights-aggregator'

const mockGetOrComputeInsights = getOrComputeInsights as jest.MockedFunction<
  typeof getOrComputeInsights
>

// Sample insights fixture
function createInsights(
  overrides: Partial<Awaited<ReturnType<typeof getOrComputeInsights>> & {}> = {}
) {
  return {
    cheapestHour: 14,
    cheapestAvgPrice: 12.5,
    expensiveHour: 8,
    expensiveAvgPrice: 25.0,
    avgPriceByHour: {
      '6': 18.0,
      '7': 22.0,
      '8': 25.0,
      '9': 20.0,
      '10': 16.0,
      '14': 12.5,
      '15': 13.0,
      '17': 23.0,
      '18': 24.0,
      '22': 17.0,
    },
    surgeProbabilityByHour: {
      '7': 0.85,
      '8': 0.92,
      '9': 0.7,
      '10': 0.3,
      '14': 0.05,
      '17': 0.88,
      '18': 0.75,
      '19': 0.4,
      '20': 0.15,
    },
    cheapestService: 'LYFT',
    sampleSize: 100,
    ...overrides,
  }
}

describe('Recommendation Engine', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    // Restore default pass-through (cache miss) behavior for getCached
    mockGetCached.mockImplementation(
      async (_key: string, _ttl: number, compute: () => Promise<unknown>) => ({
        value: await compute(),
        cacheHit: false,
      })
    )
  })

  describe('generateRecommendations', () => {
    it('returns fallback recommendations when no routeId is provided', async () => {
      const result = await generateRecommendations({
        timestamp: new Date('2025-06-15T10:00:00'),
      })

      expect(result.recommendations.length).toBeGreaterThan(0)
      expect(result.recommendations[0].type).toBe('DEPARTURE_TIME')
      // Low confidence for generic recs
      expect(result.recommendations[0].confidence).toBeLessThanOrEqual(0.5)
    })

    it('generates departure time rec when current hour is expensive', async () => {
      const uberInsights = createInsights()
      const lyftInsights = createInsights({
        cheapestAvgPrice: 11.0,
        avgPriceByHour: { ...createInsights().avgPriceByHour, '14': 11.0 },
      })

      mockGetOrComputeInsights
        .mockResolvedValueOnce(uberInsights) // uber
        .mockResolvedValueOnce(lyftInsights) // lyft
        .mockResolvedValueOnce(null) // taxi
        .mockResolvedValueOnce(null) // waymo

      const result = await generateRecommendations({
        routeId: 'route-departure-test',
        currentService: 'uber',
        timestamp: new Date('2025-06-15T08:00:00'), // 8 AM (expensive hour)
      })

      const departureRec = result.recommendations.find(r => r.type === 'DEPARTURE_TIME')
      expect(departureRec).toBeDefined()
      expect(departureRec!.dataPoints.bestHour).toBe(14)
      expect(departureRec!.dataPoints.potentialSavings).toBeGreaterThan(0)
      expect(departureRec!.message).toContain('2 PM')
    })

    it('does not generate data-driven departure time rec when prices are flat', async () => {
      // All hours have the same average price = no savings possible
      const insights = createInsights({
        cheapestHour: 14,
        cheapestAvgPrice: 15.0,
        avgPriceByHour: {
          '8': 15.0,
          '14': 15.0,
          '17': 15.0,
        },
      })

      mockGetOrComputeInsights
        .mockResolvedValueOnce(insights)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)

      const result = await generateRecommendations({
        routeId: 'route-no-savings',
        currentService: 'uber',
        timestamp: new Date('2025-06-15T14:00:00'),
      })

      // No data-driven departure rec (with potentialSavings) should exist
      const dataDrivenDepartureRec = result.recommendations.find(
        r =>
          r.type === 'DEPARTURE_TIME' &&
          r.dataPoints.potentialSavings !== undefined &&
          r.dataPoints.potentialSavings > 0
      )
      expect(dataDrivenDepartureRec).toBeUndefined()
    })

    it('generates service choice rec when one service is much cheaper', async () => {
      const uberInsights = createInsights({
        avgPriceByHour: { '8': 25.0, '14': 18.0, '17': 23.0 },
      })
      const lyftInsights = createInsights({
        avgPriceByHour: { '8': 18.0, '14': 12.0, '17': 16.0 },
      })

      mockGetOrComputeInsights
        .mockResolvedValueOnce(uberInsights) // uber
        .mockResolvedValueOnce(lyftInsights) // lyft
        .mockResolvedValueOnce(null) // taxi
        .mockResolvedValueOnce(null) // waymo

      const result = await generateRecommendations({
        routeId: 'route-service-choice',
        currentService: 'uber',
        timestamp: new Date('2025-06-15T14:00:00'),
      })

      const serviceRec = result.recommendations.find(r => r.type === 'SERVICE_CHOICE')
      expect(serviceRec).toBeDefined()
      expect(serviceRec!.dataPoints.bestService).toBe('lyft')
      expect(serviceRec!.message).toContain('Lyft')
    })

    it('limits to max 3 recommendations sorted by confidence', async () => {
      const uberInsights = createInsights({ sampleSize: 200 })
      const lyftInsights = createInsights({
        cheapestAvgPrice: 10.0,
        avgPriceByHour: { '8': 18.0, '14': 10.0, '17': 16.0 },
        sampleSize: 200,
      })

      mockGetOrComputeInsights
        .mockResolvedValueOnce(uberInsights)
        .mockResolvedValueOnce(lyftInsights)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)

      const result = await generateRecommendations({
        routeId: 'route-max-3-test',
        currentService: 'uber',
        currentPrice: 25.0,
        timestamp: new Date('2025-06-15T08:00:00'),
      })

      expect(result.recommendations.length).toBeLessThanOrEqual(3)
      // Should be sorted by confidence (highest first)
      for (let i = 1; i < result.recommendations.length; i++) {
        expect(result.recommendations[i].confidence).toBeLessThanOrEqual(
          result.recommendations[i - 1].confidence
        )
      }
    })

    it('handles insights aggregator failure gracefully', async () => {
      mockGetOrComputeInsights.mockRejectedValue(new Error('DB connection failed'))

      const result = await generateRecommendations({
        routeId: 'route-failure-test',
        timestamp: new Date('2025-06-15T10:00:00'),
      })

      // Should fall back to generic recommendations
      expect(result.recommendations.length).toBeGreaterThan(0)
      // Fallback recs have low confidence (0.4)
      expect(result.recommendations[0].confidence).toBeLessThanOrEqual(0.5)
    })

    it('persists recommendations to DB and attaches id when routeId is provided', async () => {
      const { prisma } = jest.requireMock('@/lib/prisma') as {
        prisma: { recommendation: { create: jest.Mock } }
      }
      prisma.recommendation.create
        .mockResolvedValueOnce({ id: 'db-rec-1' })
        .mockResolvedValueOnce({ id: 'db-rec-2' })

      const uberInsights = createInsights()
      const lyftInsights = createInsights({
        cheapestAvgPrice: 10.0,
        avgPriceByHour: { '8': 18.0, '14': 10.0, '17': 16.0 },
      })

      mockGetOrComputeInsights
        .mockResolvedValueOnce(uberInsights)
        .mockResolvedValueOnce(lyftInsights)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)

      const result = await generateRecommendations({
        routeId: 'route-persist-test',
        currentService: 'uber',
        timestamp: new Date('2025-06-15T08:00:00'),
      })

      expect(prisma.recommendation.create).toHaveBeenCalled()
      // Recommendations should have DB ids attached
      const withIds = result.recommendations.filter(r => r.id)
      expect(withIds.length).toBeGreaterThan(0)
      expect(withIds[0].id).toBe('db-rec-1')
    })

    it('uses cache for repeated requests — getCached hit path skips compute', async () => {
      const cachedOutput = {
        recommendations: [
          {
            type: 'DEPARTURE_TIME' as const,
            title: 'Better Time',
            message: 'Ride at 2 PM',
            confidence: 0.85,
            dataPoints: { bestHour: 14, potentialSavings: 5 },
          },
        ],
      }

      // Simulate getCached returning a cached value without calling compute
      mockGetCached.mockResolvedValueOnce({ value: cachedOutput, cacheHit: true })

      const result = await generateRecommendations({
        routeId: 'cache-test-route',
        timestamp: new Date('2025-06-15T08:00:00'),
      })

      expect(result).toEqual(cachedOutput)
      // compute was not called — so getOrComputeInsights was never called
      expect(mockGetOrComputeInsights).not.toHaveBeenCalled()
    })

    it('does not share cached user-specific recommendations across users', async () => {
      const { prisma } = jest.requireMock('@/lib/prisma') as {
        prisma: { recommendationAction: { findMany: jest.Mock } }
      }

      prisma.recommendationAction.findMany
        .mockResolvedValueOnce([{ estimatedSavings: 12 }])
        .mockResolvedValueOnce([{ estimatedSavings: 28 }])

      const userOne = await generateRecommendations({
        userId: 'user-one',
        timestamp: new Date('2025-06-15T10:00:00'),
      })

      const userTwo = await generateRecommendations({
        userId: 'user-two',
        timestamp: new Date('2025-06-15T10:00:00'),
      })

      expect(userOne.recommendations[0].message).toContain('$12.00')
      expect(userTwo.recommendations[0].message).toContain('$28.00')
      expect(prisma.recommendationAction.findMany).toHaveBeenCalledTimes(2)
    })

    it('does not reuse cached recommendations across different current services', async () => {
      const uberInsights = createInsights({
        avgPriceByHour: { '8': 22.0, '14': 18.0, '17': 20.0 },
      })
      const lyftInsights = createInsights({
        avgPriceByHour: { '8': 14.0, '14': 10.0, '17': 12.0 },
      })

      mockGetOrComputeInsights
        .mockResolvedValueOnce(uberInsights)
        .mockResolvedValueOnce(lyftInsights)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(uberInsights)
        .mockResolvedValueOnce(lyftInsights)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)

      const timestamp = new Date('2025-06-15T08:00:00')

      const forUber = await generateRecommendations({
        routeId: 'service-cache-route',
        currentService: 'uber',
        timestamp,
      })

      const forLyft = await generateRecommendations({
        routeId: 'service-cache-route',
        currentService: 'lyft',
        timestamp,
      })

      expect(forUber.recommendations.find(r => r.type === 'SERVICE_CHOICE')).toBeDefined()
      expect(forLyft.recommendations.find(r => r.type === 'SERVICE_CHOICE')).toBeUndefined()
      expect(mockGetOrComputeInsights).toHaveBeenCalledTimes(8)
    })
  })
})
