/** @jest-environment node */

import { getPriceTrendSnapshots, getPriceTrendsSummary } from '@/lib/database-price-trends'
import { prisma } from '@/lib/prisma'
import { isDatabaseAvailable } from '@/lib/database-logging'
import type { ServiceType, TrafficLevel } from '@/lib/generated/prisma'

jest.mock('@/lib/prisma', () => ({
  prisma: {
    priceSnapshot: {
      findMany: jest.fn(),
    },
  },
}))

jest.mock('@/lib/database-logging', () => ({
  isDatabaseAvailable: jest.fn(() => true),
  reportPersistenceError: jest.fn(),
}))

const mockFindMany = prisma.priceSnapshot.findMany as jest.MockedFunction<
  typeof prisma.priceSnapshot.findMany
>

const mockSnapshots: {
  id: string
  routeId: string
  createdAt: Date
  service: ServiceType
  base_price: number
  surge_multiplier: number
  final_price: number
  wait_time_minutes: number | null
  drivers_nearby: number | null
  day_of_week: number
  hour_of_day: number
  weather_condition: string | null
  weather_temp_f: number | null
  is_raining: boolean
  traffic_level: TrafficLevel | null
  nearby_events: string[]
  is_holiday: boolean
  confidence: number | null
}[] = [
  {
    id: 'snap-1',
    routeId: 'route-1',
    createdAt: new Date('2026-04-09T10:00:00Z'),
    service: 'UBER' as ServiceType,
    base_price: 15,
    surge_multiplier: 1.2,
    final_price: 18,
    wait_time_minutes: 5,
    drivers_nearby: 3,
    day_of_week: 4,
    hour_of_day: 10,
    weather_condition: 'Clear',
    weather_temp_f: 72,
    is_raining: false,
    traffic_level: 'MODERATE' as TrafficLevel,
    nearby_events: [],
    is_holiday: false,
    confidence: 0.85,
  },
  {
    id: 'snap-2',
    routeId: 'route-1',
    createdAt: new Date('2026-04-09T11:00:00Z'),
    service: 'LYFT' as ServiceType,
    base_price: 14,
    surge_multiplier: 1.0,
    final_price: 14,
    wait_time_minutes: 3,
    drivers_nearby: 5,
    day_of_week: 4,
    hour_of_day: 11,
    weather_condition: null,
    weather_temp_f: null,
    is_raining: false,
    traffic_level: 'LIGHT' as TrafficLevel,
    nearby_events: ['Giants game'],
    is_holiday: false,
    confidence: 0.9,
  },
  {
    id: 'snap-3',
    routeId: 'route-1',
    createdAt: new Date('2026-04-08T08:00:00Z'),
    service: 'UBER' as ServiceType,
    base_price: 12,
    surge_multiplier: 1.5,
    final_price: 18,
    wait_time_minutes: 8,
    drivers_nearby: 1,
    day_of_week: 3,
    hour_of_day: 8,
    weather_condition: 'Rain',
    weather_temp_f: 55,
    is_raining: true,
    traffic_level: 'HEAVY' as TrafficLevel,
    nearby_events: [],
    is_holiday: false,
    confidence: 0.7,
  },
]

describe('getPriceTrendSnapshots', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns empty array when database is unavailable', async () => {
    ;(isDatabaseAvailable as jest.Mock).mockReturnValueOnce(false)

    const result = await getPriceTrendSnapshots('route-1')

    expect(result).toEqual([])
  })

  it('returns enriched snapshots with full fields', async () => {
    mockFindMany.mockResolvedValueOnce(mockSnapshots)

    const result = await getPriceTrendSnapshots('route-1', { daysBack: 7 })

    expect(result).toHaveLength(3)
    expect(result[0]).toMatchObject({
      id: 'snap-1',
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
    })
  })

  it('maps enum services to lowercase strings', async () => {
    mockFindMany.mockResolvedValueOnce(mockSnapshots)

    const result = await getPriceTrendSnapshots('route-1')

    const services = result.map(s => s.service)
    expect(services).toContain('uber')
    expect(services).toContain('lyft')
  })

  it('returns empty array on database error', async () => {
    mockFindMany.mockRejectedValueOnce(new Error('Connection refused'))

    const result = await getPriceTrendSnapshots('route-1')

    expect(result).toEqual([])
  })

  it('defaults daysBack to 7 when not specified', async () => {
    mockFindMany.mockResolvedValueOnce([])

    await getPriceTrendSnapshots('route-1')

    const where = mockFindMany.mock.calls[0][0]?.where as Record<string, unknown>
    expect(where.createdAt).toBeDefined()
  })
})

describe('getPriceTrendsSummary', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns empty services when database is unavailable', async () => {
    ;(isDatabaseAvailable as jest.Mock).mockReturnValueOnce(false)

    const result = await getPriceTrendsSummary('route-1')

    expect(result).toEqual({ routeId: 'route-1', daysBack: 7, services: [] })
  })

  it('returns empty services when no snapshots exist', async () => {
    mockFindMany.mockResolvedValueOnce([])

    const result = await getPriceTrendsSummary('route-1', 30)

    expect(result.services).toEqual([])
  })

  it('computes per-service stats from snapshots', async () => {
    mockFindMany.mockResolvedValueOnce(mockSnapshots)

    const result = await getPriceTrendsSummary('route-1', 7)

    expect(result.routeId).toBe('route-1')
    expect(result.daysBack).toBe(7)

    const uberStats = result.services.find(s => s.service === 'uber')
    expect(uberStats).toBeDefined()
    expect(uberStats!.avgPrice).toBe(18) // (18 + 18) / 2
    expect(uberStats!.minPrice).toBe(18)
    expect(uberStats!.maxPrice).toBe(18)
    expect(uberStats!.sampleSize).toBe(2)

    const lyftStats = result.services.find(s => s.service === 'lyft')
    expect(lyftStats).toBeDefined()
    expect(lyftStats!.avgPrice).toBe(14)
    expect(lyftStats!.sampleSize).toBe(1)
  })

  it('includes surgeProbabilityByHour with 24 entries per service', async () => {
    mockFindMany.mockResolvedValueOnce(mockSnapshots)

    const result = await getPriceTrendsSummary('route-1')

    for (const svc of result.services) {
      expect(svc.surgeProbabilityByHour).toHaveLength(24)
    }
  })

  it('includes priceByDayOfWeek with 7 entries per service', async () => {
    mockFindMany.mockResolvedValueOnce(mockSnapshots)

    const result = await getPriceTrendsSummary('route-1')

    for (const svc of result.services) {
      expect(svc.priceByDayOfWeek).toHaveLength(7)
    }
  })

  it('computes surge probability correctly', async () => {
    mockFindMany.mockResolvedValueOnce(mockSnapshots)

    const result = await getPriceTrendsSummary('route-1')

    const uberStats = result.services.find(s => s.service === 'uber')!
    // Uber has 2 snapshots: hour 10 with surge 1.2, hour 8 with surge 1.5
    const hour8 = uberStats.surgeProbabilityByHour.find(h => h.hour === 8)!
    const hour10 = uberStats.surgeProbabilityByHour.find(h => h.hour === 10)!
    expect(hour8.probability).toBe(1) // surge > 1
    expect(hour10.probability).toBe(1) // surge > 1
  })

  it('finds cheapest hour correctly', async () => {
    mockFindMany.mockResolvedValueOnce(mockSnapshots)

    const result = await getPriceTrendsSummary('route-1')

    const uberStats = result.services.find(s => s.service === 'uber')!
    // Both uber snapshots have price 18, so cheapest hour is whichever comes first (hour 8 or 10)
    expect([8, 10]).toContain(uberStats.cheapestHour)
  })

  it('returns empty on database error', async () => {
    mockFindMany.mockRejectedValueOnce(new Error('Connection refused'))

    const result = await getPriceTrendsSummary('route-1')

    expect(result.services).toEqual([])
  })
})
