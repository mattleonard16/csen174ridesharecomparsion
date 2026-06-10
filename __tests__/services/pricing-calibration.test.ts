jest.mock('@/lib/prisma', () => ({
  prisma: {
    rideHistory: {
      findMany: jest.fn(),
    },
  },
}))

jest.mock('@/lib/database-logging', () => ({
  isDatabaseAvailable: jest.fn(),
  reportPersistenceError: jest.fn(),
}))

// Pass-through cache: always computes (cache behavior itself is covered by redis-cache tests)
jest.mock('@/lib/cache/redis-cache', () => ({
  getCached: jest.fn(async (_key: string, _ttl: number, compute: () => Promise<unknown>) => ({
    value: await compute(),
    cacheHit: false,
  })),
  clearCacheNamespace: jest.fn(),
}))

import {
  computeCalibrationFactors,
  getCalibrationFactors,
  CALIBRATION_FACTOR_MAX,
  CALIBRATION_MIN_SAMPLE_SIZE,
} from '@/lib/services/pricing-calibration'
import { prisma } from '@/lib/prisma'
import { isDatabaseAvailable, reportPersistenceError } from '@/lib/database-logging'
import { getCached } from '@/lib/cache/redis-cache'

const mockFindMany = prisma.rideHistory.findMany as jest.Mock
const mockIsDatabaseAvailable = isDatabaseAvailable as jest.MockedFunction<
  typeof isDatabaseAvailable
>
const mockReportPersistenceError = reportPersistenceError as jest.MockedFunction<
  typeof reportPersistenceError
>
const mockGetCached = getCached as jest.MockedFunction<typeof getCached>

function row(service: string, estimatedFare: number, finalFare: number) {
  return { service, estimatedFare, finalFare }
}

describe('computeCalibrationFactors', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockIsDatabaseAvailable.mockReturnValue(true)
  })

  it('returns no factors when the database is unavailable', async () => {
    mockIsDatabaseAvailable.mockReturnValue(false)

    await expect(computeCalibrationFactors()).resolves.toEqual({})
    expect(mockFindMany).not.toHaveBeenCalled()
  })

  it('computes the median finalFare/estimatedFare ratio per service', async () => {
    mockFindMany.mockResolvedValue([
      row('UBER', 20, 18), // 0.9
      row('UBER', 20, 22), // 1.1
      row('UBER', 10, 11), // 1.1
      row('UBER', 10, 12), // 1.2
      row('UBER', 25, 30), // 1.2
      row('UBER', 20, 26), // 1.3
    ])

    const factors = await computeCalibrationFactors()

    // Sorted ratios [0.9, 1.1, 1.1, 1.2, 1.2, 1.3] → median (1.1 + 1.2) / 2 = 1.15
    expect(factors.uber).toEqual({ factor: 1.15, sampleSize: 6, medianRatio: 1.15 })
  })

  it('keeps services independent', async () => {
    mockFindMany.mockResolvedValue([
      ...Array.from({ length: 5 }, () => row('UBER', 20, 22)), // ratio 1.1
      ...Array.from({ length: 5 }, () => row('LYFT', 20, 19)), // ratio 0.95
    ])

    const factors = await computeCalibrationFactors()

    expect(factors.uber?.factor).toBeCloseTo(1.1, 3)
    expect(factors.lyft?.factor).toBeCloseTo(0.95, 3)
  })

  it('clamps the factor while reporting the raw median ratio', async () => {
    mockFindMany.mockResolvedValue(Array.from({ length: 5 }, () => row('UBER', 10, 15))) // ratio 1.5

    const factors = await computeCalibrationFactors()

    expect(factors.uber?.factor).toBe(CALIBRATION_FACTOR_MAX)
    expect(factors.uber?.medianRatio).toBe(1.5)
  })

  it('emits no factor for services below the minimum sample size', async () => {
    mockFindMany.mockResolvedValue(
      Array.from({ length: CALIBRATION_MIN_SAMPLE_SIZE - 1 }, () => row('TAXI', 20, 22))
    )

    const factors = await computeCalibrationFactors()

    expect(factors.taxi).toBeUndefined()
  })

  it('discards data-entry outliers before computing the median', async () => {
    mockFindMany.mockResolvedValue([
      ...Array.from({ length: 5 }, () => row('UBER', 20, 22)), // ratio 1.1
      row('UBER', 25, 250), // ratio 10 — typo, discarded
      row('UBER', 100, 10), // ratio 0.1 — typo, discarded
    ])

    const factors = await computeCalibrationFactors()

    expect(factors.uber).toEqual({ factor: 1.1, sampleSize: 5, medianRatio: 1.1 })
  })

  it('returns no factors and reports the error on database failure', async () => {
    mockFindMany.mockRejectedValue(new Error('connection refused'))

    await expect(computeCalibrationFactors()).resolves.toEqual({})
    expect(mockReportPersistenceError).toHaveBeenCalledWith(
      'computeCalibrationFactors',
      expect.any(Error)
    )
  })
})

describe('getCalibrationFactors', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockIsDatabaseAvailable.mockReturnValue(true)
    mockFindMany.mockResolvedValue([])
  })

  it('goes through the two-tier cache with the calibration namespace and a multi-hour TTL', async () => {
    await getCalibrationFactors()

    expect(mockGetCached).toHaveBeenCalledWith(
      'calibration:service-factors',
      6 * 60 * 60,
      expect.any(Function)
    )
  })
})
