import { $Enums } from '@/lib/generated/prisma'
import { prisma } from '@/lib/prisma'
import {
  createRideHistory,
  getRideHistoryForUser,
  getRideHistoryStats,
  updateRideHistoryFare,
  deleteRideHistory,
} from '@/lib/database-ride-history'
import { isDatabaseAvailable, reportPersistenceError } from '@/lib/database-logging'
import type { ComparisonResults } from '@/types'

jest.mock('@/lib/database-logging', () => ({
  isDatabaseAvailable: jest.fn(),
  reportPersistenceError: jest.fn(),
}))

jest.mock('@/lib/prisma', () => ({
  prisma: {
    rideHistory: {
      create: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
      findFirst: jest.fn(),
      delete: jest.fn(),
    },
  },
}))

const mockIsDatabaseAvailable = isDatabaseAvailable as jest.MockedFunction<
  typeof isDatabaseAvailable
>
const mockReportPersistenceError = reportPersistenceError as jest.MockedFunction<
  typeof reportPersistenceError
>

// ============================================================================
// Shared fixtures
// ============================================================================

const NOW = new Date('2024-06-15T12:00:00.000Z')

const makeRecord = (overrides: Partial<{
  id: string
  routeId: string | null
  service: string
  estimatedFare: number
  finalFare: number | null
  waitTimeMinutes: number | null
  surgeMultiplier: number | null
  comparisonSnapshot: ComparisonResults
  requestedAt: Date
  updatedAt: Date
  route: { pickup_address: string; destination_address: string } | null
}> = {}) => ({
  id: 'history-1',
  routeId: 'route-1',
  service: $Enums.ServiceType.UBER,
  estimatedFare: 22.5,
  finalFare: null,
  waitTimeMinutes: 5,
  surgeMultiplier: null,
  comparisonSnapshot: {
    uber: { price: '$22.50', waitTime: '5 min', driversNearby: 3, service: 'UberX' },
    lyft: { price: '$25.00', waitTime: '6 min', driversNearby: 2, service: 'Lyft Standard' },
  } as ComparisonResults,
  requestedAt: NOW,
  updatedAt: NOW,
  route: { pickup_address: '123 Main St', destination_address: '456 Elm St' },
  ...overrides,
})

const snapshotWithPrices: ComparisonResults = {
  uber: { price: '$18.00', waitTime: '4 min', driversNearby: 5, service: 'UberX' },
  lyft: { price: '$22.00', waitTime: '5 min', driversNearby: 3, service: 'Lyft Standard' },
}

// ============================================================================
// createRideHistory
// ============================================================================

describe('createRideHistory', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockIsDatabaseAvailable.mockReturnValue(true)
  })

  it('returns the new record id on success', async () => {
    ;(prisma.rideHistory.create as jest.Mock).mockResolvedValue({ id: 'history-1' })

    const result = await createRideHistory({
      userId: 'user-1',
      routeId: 'route-1',
      service: 'uber',
      estimatedFare: 22.5,
      comparisonSnapshot: snapshotWithPrices,
    })

    expect(result).toEqual({ id: 'history-1' })
    expect(prisma.rideHistory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'user-1',
          routeId: 'route-1',
          estimatedFare: 22.5,
        }),
        select: { id: true },
      })
    )
  })

  it('returns null when database is unavailable', async () => {
    mockIsDatabaseAvailable.mockReturnValue(false)

    const result = await createRideHistory({
      userId: 'user-1',
      service: 'uber',
      estimatedFare: 22.5,
      comparisonSnapshot: snapshotWithPrices,
    })

    expect(result).toBeNull()
    expect(prisma.rideHistory.create).not.toHaveBeenCalled()
  })

  it('returns null and reports error when prisma throws', async () => {
    const dbError = new Error('connection failed')
    ;(prisma.rideHistory.create as jest.Mock).mockRejectedValue(dbError)

    const result = await createRideHistory({
      userId: 'user-1',
      service: 'uber',
      estimatedFare: 22.5,
      comparisonSnapshot: snapshotWithPrices,
    })

    expect(result).toBeNull()
    expect(mockReportPersistenceError).toHaveBeenCalledWith('createRideHistory', dbError)
  })

  it('passes optional fields through to prisma', async () => {
    ;(prisma.rideHistory.create as jest.Mock).mockResolvedValue({ id: 'history-2' })

    await createRideHistory({
      userId: 'user-1',
      routeId: 'route-1',
      savedRouteId: 'saved-1',
      service: 'lyft',
      estimatedFare: 19.0,
      waitTimeMinutes: 4,
      surgeMultiplier: 1.2,
      comparisonSnapshot: snapshotWithPrices,
    })

    expect(prisma.rideHistory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          savedRouteId: 'saved-1',
          waitTimeMinutes: 4,
          surgeMultiplier: 1.2,
        }),
      })
    )
  })
})

// ============================================================================
// getRideHistoryForUser
// ============================================================================

describe('getRideHistoryForUser', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockIsDatabaseAvailable.mockReturnValue(true)
    ;(prisma.rideHistory.count as jest.Mock).mockResolvedValue(1)
  })

  it('returns empty response when database is unavailable', async () => {
    mockIsDatabaseAvailable.mockReturnValue(false)

    const result = await getRideHistoryForUser('user-1')

    expect(result).toEqual({ history: [], nextCursor: null, total: 0 })
    expect(prisma.rideHistory.findMany).not.toHaveBeenCalled()
  })

  it('returns paginated history with route addresses on first page', async () => {
    const record = makeRecord()
    ;(prisma.rideHistory.findMany as jest.Mock).mockResolvedValue([record])
    ;(prisma.rideHistory.count as jest.Mock).mockResolvedValue(1)

    const result = await getRideHistoryForUser('user-1')

    expect(result.history).toHaveLength(1)
    expect(result.nextCursor).toBeNull()
    expect(result.total).toBe(1)

    const entry = result.history[0]
    expect(entry.id).toBe('history-1')
    expect(entry.service).toBe('uber')
    expect(entry.estimatedFare).toBe(22.5)
    expect(entry.pickupAddress).toBe('123 Main St')
    expect(entry.destinationAddress).toBe('456 Elm St')
    expect(entry.requestedAt).toBe(NOW.toISOString())
  })

  it('detects next page when records exceed limit', async () => {
    const records = [
      makeRecord({ id: 'h-1' }),
      makeRecord({ id: 'h-2' }),
      makeRecord({ id: 'h-3' }), // extra record indicating next page exists
    ]
    ;(prisma.rideHistory.findMany as jest.Mock).mockResolvedValue(records)
    ;(prisma.rideHistory.count as jest.Mock).mockResolvedValue(5)

    const result = await getRideHistoryForUser('user-1', undefined, 2)

    expect(result.history).toHaveLength(2)
    expect(result.nextCursor).toBe('h-2')
    expect(result.total).toBe(5)
  })

  it('skips total count and returns 0 when cursor is provided', async () => {
    ;(prisma.rideHistory.findMany as jest.Mock).mockResolvedValue([makeRecord()])

    const result = await getRideHistoryForUser('user-1', 'cursor-abc')

    expect(result.total).toBe(0)
    expect(prisma.rideHistory.count).not.toHaveBeenCalled()
  })

  it('passes cursor to findMany query', async () => {
    ;(prisma.rideHistory.findMany as jest.Mock).mockResolvedValue([])

    await getRideHistoryForUser('user-1', 'cursor-abc', 10)

    expect(prisma.rideHistory.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        cursor: { id: 'cursor-abc' },
        skip: 1,
        take: 11,
      })
    )
  })

  it('handles null route relation gracefully', async () => {
    const record = makeRecord({ route: null })
    ;(prisma.rideHistory.findMany as jest.Mock).mockResolvedValue([record])

    const result = await getRideHistoryForUser('user-1')

    expect(result.history[0].pickupAddress).toBeUndefined()
    expect(result.history[0].destinationAddress).toBeUndefined()
  })

  it('returns empty response and reports error when prisma throws', async () => {
    const dbError = new Error('query failed')
    ;(prisma.rideHistory.findMany as jest.Mock).mockRejectedValue(dbError)

    const result = await getRideHistoryForUser('user-1')

    expect(result).toEqual({ history: [], nextCursor: null, total: 0 })
    expect(mockReportPersistenceError).toHaveBeenCalledWith('getRideHistoryForUser', dbError)
  })
})

// ============================================================================
// getRideHistoryStats
// ============================================================================

describe('getRideHistoryStats', () => {
  const emptyStats = { totalSpent: 0, rideCount: 0, avgFare: 0, byService: {}, totalSavings: 0 }

  beforeEach(() => {
    jest.clearAllMocks()
    mockIsDatabaseAvailable.mockReturnValue(true)
  })

  it('returns zero stats when database is unavailable', async () => {
    mockIsDatabaseAvailable.mockReturnValue(false)

    const result = await getRideHistoryStats('user-1')

    expect(result).toEqual(emptyStats)
    expect(prisma.rideHistory.findMany).not.toHaveBeenCalled()
  })

  it('returns zero stats when no records found', async () => {
    ;(prisma.rideHistory.findMany as jest.Mock).mockResolvedValue([])

    const result = await getRideHistoryStats('user-1')

    expect(result).toEqual(emptyStats)
  })

  it('aggregates totals and per-service stats correctly', async () => {
    ;(prisma.rideHistory.findMany as jest.Mock).mockResolvedValue([
      {
        service: $Enums.ServiceType.UBER,
        estimatedFare: 18.0,
        finalFare: null,
        comparisonSnapshot: {
          uber: { price: '$18.00', waitTime: '4 min', driversNearby: 5, service: 'UberX' },
          lyft: { price: '$22.00', waitTime: '5 min', driversNearby: 3, service: 'Lyft Standard' },
        },
      },
      {
        service: $Enums.ServiceType.UBER,
        estimatedFare: 20.0,
        finalFare: null,
        comparisonSnapshot: {
          uber: { price: '$20.00', waitTime: '4 min', driversNearby: 4, service: 'UberX' },
          lyft: { price: '$24.00', waitTime: '6 min', driversNearby: 2, service: 'Lyft Standard' },
        },
      },
    ])

    const result = await getRideHistoryStats('user-1')

    expect(result.rideCount).toBe(2)
    expect(result.totalSpent).toBeCloseTo(38.0)
    expect(result.avgFare).toBeCloseTo(19.0)
    expect(result.byService.uber?.count).toBe(2)
    expect(result.byService.uber?.totalSpent).toBeCloseTo(38.0)
    expect(result.byService.uber?.avgFare).toBeCloseTo(19.0)
    // savings: ride1 maxPrice=$22 - $18 = $4, ride2 maxPrice=$24 - $20 = $4 → total=$8
    expect(result.totalSavings).toBeCloseTo(8.0)
  })

  it('uses finalFare when present instead of estimatedFare', async () => {
    ;(prisma.rideHistory.findMany as jest.Mock).mockResolvedValue([
      {
        service: $Enums.ServiceType.LYFT,
        estimatedFare: 20.0,
        finalFare: 18.5,
        comparisonSnapshot: {
          lyft: { price: '$20.00', waitTime: '5 min', driversNearby: 3, service: 'Lyft Standard' },
        },
      },
    ])

    const result = await getRideHistoryStats('user-1')

    expect(result.totalSpent).toBeCloseTo(18.5)
    expect(result.byService.lyft?.totalSpent).toBeCloseTo(18.5)
  })

  it('computes zero savings when chosen service has the highest price', async () => {
    ;(prisma.rideHistory.findMany as jest.Mock).mockResolvedValue([
      {
        service: $Enums.ServiceType.LYFT,
        estimatedFare: 25.0,
        finalFare: null,
        comparisonSnapshot: {
          uber: { price: '$20.00', waitTime: '4 min', driversNearby: 5, service: 'UberX' },
          lyft: { price: '$25.00', waitTime: '5 min', driversNearby: 3, service: 'Lyft Standard' },
        },
      },
    ])

    const result = await getRideHistoryStats('user-1')

    // lyft was chosen at max price — no savings possible
    expect(result.totalSavings).toBe(0)
  })

  it('handles snapshot with unparseable prices without throwing', async () => {
    ;(prisma.rideHistory.findMany as jest.Mock).mockResolvedValue([
      {
        service: $Enums.ServiceType.UBER,
        estimatedFare: 15.0,
        finalFare: null,
        comparisonSnapshot: {
          uber: { price: 'unavailable', waitTime: '4 min', driversNearby: 0, service: 'UberX' },
        },
      },
    ])

    const result = await getRideHistoryStats('user-1')

    expect(result.rideCount).toBe(1)
    expect(result.totalSpent).toBeCloseTo(15.0)
    expect(result.totalSavings).toBe(0)
  })

  it('returns zero stats and reports error when prisma throws', async () => {
    const dbError = new Error('stats query failed')
    ;(prisma.rideHistory.findMany as jest.Mock).mockRejectedValue(dbError)

    const result = await getRideHistoryStats('user-1')

    expect(result).toEqual(emptyStats)
    expect(mockReportPersistenceError).toHaveBeenCalledWith('getRideHistoryStats', dbError)
  })
})

// ============================================================================
// updateRideHistoryFare
// ============================================================================

describe('updateRideHistoryFare', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockIsDatabaseAvailable.mockReturnValue(true)
  })

  it('returns the updated entry on success', async () => {
    const record = makeRecord({ finalFare: 21.0 })
    ;(prisma.rideHistory.update as jest.Mock).mockResolvedValue(record)

    const result = await updateRideHistoryFare('history-1', 'user-1', 21.0)

    expect(result).not.toBeNull()
    expect(result?.finalFare).toBe(21.0)
    expect(result?.id).toBe('history-1')
    expect(prisma.rideHistory.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'history-1', userId: 'user-1' },
        data: { finalFare: 21.0 },
      })
    )
  })

  it('returns null when database is unavailable', async () => {
    mockIsDatabaseAvailable.mockReturnValue(false)

    const result = await updateRideHistoryFare('history-1', 'user-1', 21.0)

    expect(result).toBeNull()
    expect(prisma.rideHistory.update).not.toHaveBeenCalled()
  })

  it('returns null and reports error when prisma throws (IDOR — wrong userId)', async () => {
    const p2025 = Object.assign(new Error('Record not found'), { code: 'P2025' })
    ;(prisma.rideHistory.update as jest.Mock).mockRejectedValue(p2025)

    const result = await updateRideHistoryFare('history-1', 'wrong-user', 21.0)

    expect(result).toBeNull()
    expect(mockReportPersistenceError).toHaveBeenCalledWith('updateRideHistoryFare', p2025)
  })

  it('includes route addresses in the returned entry', async () => {
    const record = makeRecord({
      route: { pickup_address: 'Airport', destination_address: 'Downtown' },
    })
    ;(prisma.rideHistory.update as jest.Mock).mockResolvedValue(record)

    const result = await updateRideHistoryFare('history-1', 'user-1', 20.0)

    expect(result?.pickupAddress).toBe('Airport')
    expect(result?.destinationAddress).toBe('Downtown')
  })
})

// ============================================================================
// deleteRideHistory
// ============================================================================

describe('deleteRideHistory', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockIsDatabaseAvailable.mockReturnValue(true)
  })

  it('returns true when record is found and deleted', async () => {
    ;(prisma.rideHistory.findFirst as jest.Mock).mockResolvedValue({ id: 'history-1' })
    ;(prisma.rideHistory.delete as jest.Mock).mockResolvedValue({ id: 'history-1' })

    const result = await deleteRideHistory('history-1', 'user-1')

    expect(result).toBe(true)
    expect(prisma.rideHistory.findFirst).toHaveBeenCalledWith({
      where: { id: 'history-1', userId: 'user-1' },
      select: { id: true },
    })
    expect(prisma.rideHistory.delete).toHaveBeenCalledWith({ where: { id: 'history-1' } })
  })

  it('returns false when database is unavailable', async () => {
    mockIsDatabaseAvailable.mockReturnValue(false)

    const result = await deleteRideHistory('history-1', 'user-1')

    expect(result).toBe(false)
    expect(prisma.rideHistory.findFirst).not.toHaveBeenCalled()
  })

  it('returns false when record is not found (IDOR — wrong userId)', async () => {
    ;(prisma.rideHistory.findFirst as jest.Mock).mockResolvedValue(null)

    const result = await deleteRideHistory('history-1', 'wrong-user')

    expect(result).toBe(false)
    expect(prisma.rideHistory.delete).not.toHaveBeenCalled()
  })

  it('returns false and reports error when prisma throws', async () => {
    const dbError = new Error('delete failed')
    ;(prisma.rideHistory.findFirst as jest.Mock).mockRejectedValue(dbError)

    const result = await deleteRideHistory('history-1', 'user-1')

    expect(result).toBe(false)
    expect(mockReportPersistenceError).toHaveBeenCalledWith('deleteRideHistory', dbError)
  })
})
