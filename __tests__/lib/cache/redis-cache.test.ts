/**
 * Unit tests for lib/cache/redis-cache.ts
 * Tests L1 hit, L2 hit, full miss, null redis fallback, quota counter, clearCacheNamespace
 */

// Mock redis and monitoring before imports
const mockRedis = {
  get: jest.fn(),
  set: jest.fn().mockResolvedValue('OK'),
  incr: jest.fn(),
  expireat: jest.fn().mockResolvedValue(1),
}

jest.mock('@/lib/redis', () => ({
  redis: mockRedis,
  isRedisAvailable: true,
}))

jest.mock('@/lib/monitoring', () => ({
  log: jest.fn(),
}))

import { getCached, incrementQuotaCounter, clearCacheNamespace } from '@/lib/cache/redis-cache'

describe('getCached', () => {
  beforeEach(() => {
    // Clear L1 state between tests using unique namespaces or clearCacheNamespace
    clearCacheNamespace('geocode')
    clearCacheNamespace('route')
    clearCacheNamespace('comparison')
    clearCacheNamespace('testns')
    // Reset mock state
    mockRedis.get.mockReset()
    mockRedis.set.mockReset().mockResolvedValue('OK')
    mockRedis.incr.mockReset()
    mockRedis.expireat.mockReset().mockResolvedValue(1)
  })

  describe('L1 hit', () => {
    it('returns cached value from L1 on second call without calling compute or redis again', async () => {
      const compute = jest.fn().mockResolvedValue({ lat: 37.77, lng: -122.41 })
      mockRedis.get.mockResolvedValue(null)

      // First call — cache miss, populates L1
      const first = await getCached('geocode:test-l1-hit', 300, compute)
      expect(first.cacheHit).toBe(false)
      expect(compute).toHaveBeenCalledTimes(1)

      // Reset get mock so we can verify it's not called on L1 hit
      mockRedis.get.mockReset()
      compute.mockClear()

      // Second call — should hit L1
      const second = await getCached('geocode:test-l1-hit', 300, compute)
      expect(second.cacheHit).toBe(true)
      expect(second.value).toEqual({ lat: 37.77, lng: -122.41 })
      expect(compute).not.toHaveBeenCalled()
      expect(mockRedis.get).not.toHaveBeenCalled()
    })
  })

  describe('L2 hit (Redis)', () => {
    it('returns value from Redis when L1 is cold, does not call compute', async () => {
      const cachedValue = { lat: 37.33, lng: -121.88 }
      mockRedis.get.mockResolvedValue(cachedValue)

      const compute = jest.fn()

      const result = await getCached('geocode:test-l2-hit', 300, compute)
      expect(result.cacheHit).toBe(true)
      expect(result.value).toEqual(cachedValue)
      expect(compute).not.toHaveBeenCalled()
      expect(mockRedis.get).toHaveBeenCalledWith('geocode:test-l2-hit')
    })

    it('warms L1 from L2 so subsequent call does not hit Redis', async () => {
      const cachedValue = { distance: 15.2 }
      mockRedis.get.mockResolvedValue(cachedValue)

      const compute = jest.fn()

      // First call — L2 hit, warms L1
      await getCached('route:test-l2-warm', 600, compute)

      // Reset redis mock
      mockRedis.get.mockReset()
      compute.mockClear()

      // Second call — should hit L1 (warmed from L2)
      const second = await getCached('route:test-l2-warm', 600, compute)
      expect(second.cacheHit).toBe(true)
      expect(second.value).toEqual(cachedValue)
      expect(compute).not.toHaveBeenCalled()
      expect(mockRedis.get).not.toHaveBeenCalled()
    })
  })

  describe('full miss', () => {
    it('calls compute, stores in L1, fires redis.set with ex option, returns cacheHit: false', async () => {
      mockRedis.get.mockResolvedValue(null)
      const computedValue = { price: 25.50 }
      const compute = jest.fn().mockResolvedValue(computedValue)

      const result = await getCached('comparison:test-full-miss', 300, compute)

      expect(result.cacheHit).toBe(false)
      expect(result.value).toEqual(computedValue)
      expect(compute).toHaveBeenCalledTimes(1)

      // Allow fire-and-forget to settle
      await Promise.resolve()

      expect(mockRedis.set).toHaveBeenCalledWith('comparison:test-full-miss', computedValue, { ex: 300 })
    })
  })

  describe('redis null (L1-only mode)', () => {
    it('falls back to compute when redis is null without throwing errors', async () => {
      // Use isolateModules to re-mock redis as null
      let getCachedNull: typeof getCached

      jest.resetModules()

      jest.doMock('@/lib/redis', () => ({
        redis: null,
        isRedisAvailable: false,
      }))

      jest.doMock('@/lib/monitoring', () => ({
        log: jest.fn(),
      }))

      // Re-import with null redis
      const module = await import('@/lib/cache/redis-cache')
      getCachedNull = module.getCached

      const compute = jest.fn().mockResolvedValue({ fallback: true })
      const result = await getCachedNull('testns:null-redis-test', 300, compute)

      expect(result.value).toEqual({ fallback: true })
      expect(result.cacheHit).toBe(false)
      expect(compute).toHaveBeenCalledTimes(1)
      // redis.get and redis.set should NOT be called
      expect(mockRedis.get).not.toHaveBeenCalled()
      expect(mockRedis.set).not.toHaveBeenCalled()

      // Clean up dynamic mocks
      jest.resetModules()
      jest.restoreAllMocks()
    })
  })

  describe('redis.get throws', () => {
    it('swallows error and falls through to compute', async () => {
      mockRedis.get.mockRejectedValue(new Error('Redis connection failed'))
      const computedValue = { result: 'computed after error' }
      const compute = jest.fn().mockResolvedValue(computedValue)

      const result = await getCached('geocode:test-redis-throws', 300, compute)

      expect(result.cacheHit).toBe(false)
      expect(result.value).toEqual(computedValue)
      expect(compute).toHaveBeenCalledTimes(1)
    })
  })

  describe('L2 write is fire-and-forget', () => {
    it('resolves getCached before redis.set completes', async () => {
      mockRedis.get.mockResolvedValue(null)

      let resolveSet: (v: string) => void
      const setPromise = new Promise<string>(resolve => {
        resolveSet = resolve
      })
      mockRedis.set.mockReturnValue(setPromise)

      const computedValue = { data: 'test' }
      const compute = jest.fn().mockResolvedValue(computedValue)

      // getCached should resolve even though redis.set hasn't resolved yet
      const result = await getCached('route:test-fire-forget', 600, compute)

      expect(result.value).toEqual(computedValue)
      // resolve the set after the fact to avoid hanging
      resolveSet!('OK')
      await Promise.resolve()
    })
  })
})

describe('incrementQuotaCounter', () => {
  beforeEach(() => {
    mockRedis.incr.mockReset()
    mockRedis.expireat.mockReset().mockResolvedValue(1)
  })

  it('calls redis.incr and redis.expireat when count === 1', async () => {
    mockRedis.incr.mockResolvedValue(1)

    const key = 'quota:ai:2026-03-10'
    const count = await incrementQuotaCounter(key)

    expect(count).toBe(1)
    expect(mockRedis.incr).toHaveBeenCalledWith(key)
    expect(mockRedis.expireat).toHaveBeenCalledTimes(1)

    // Verify the expireat timestamp is for next midnight UTC
    const expireAt = mockRedis.expireat.mock.calls[0][1] as number
    const now = new Date()
    const nextMidnight = Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() + 1
    )
    const expectedExpireAt = Math.floor(nextMidnight / 1000)

    // Allow +-60 seconds tolerance for test timing
    expect(expireAt).toBeGreaterThanOrEqual(expectedExpireAt - 60)
    expect(expireAt).toBeLessThanOrEqual(expectedExpireAt + 60)
  })

  it('calls redis.incr but NOT redis.expireat when count > 1', async () => {
    mockRedis.incr.mockResolvedValue(2)

    const count = await incrementQuotaCounter('quota:ai:2026-03-10')

    expect(count).toBe(2)
    expect(mockRedis.incr).toHaveBeenCalledTimes(1)
    expect(mockRedis.expireat).not.toHaveBeenCalled()
  })

  it('returns 0 when redis is null (fail-open)', async () => {
    let incrementQuotaCounterNull: typeof incrementQuotaCounter

    jest.resetModules()

    jest.doMock('@/lib/redis', () => ({
      redis: null,
      isRedisAvailable: false,
    }))

    jest.doMock('@/lib/monitoring', () => ({
      log: jest.fn(),
    }))

    const module = await import('@/lib/cache/redis-cache')
    incrementQuotaCounterNull = module.incrementQuotaCounter

    const count = await incrementQuotaCounterNull('quota:ai:2026-03-10')
    expect(count).toBe(0)
    expect(mockRedis.incr).not.toHaveBeenCalled()

    jest.resetModules()
    jest.restoreAllMocks()
  })
})

describe('clearCacheNamespace', () => {
  beforeEach(() => {
    mockRedis.get.mockReset().mockResolvedValue(null)
    mockRedis.set.mockReset().mockResolvedValue('OK')
  })

  it('clears L1 entries for the given namespace so next call triggers compute', async () => {
    const compute = jest.fn().mockResolvedValue({ address: '123 Main St' })
    mockRedis.get.mockResolvedValue(null)

    // Populate L1
    await getCached('geocode:test-clear-ns', 300, compute)
    expect(compute).toHaveBeenCalledTimes(1)
    compute.mockClear()
    mockRedis.get.mockClear()

    // Verify L1 hit works
    await getCached('geocode:test-clear-ns', 300, compute)
    expect(compute).not.toHaveBeenCalled()
    expect(mockRedis.get).not.toHaveBeenCalled()

    // Clear the namespace
    clearCacheNamespace('geocode')

    compute.mockClear()
    mockRedis.get.mockReset().mockResolvedValue(null)

    // Next call should miss L1 (and L2 since mock returns null)
    const result = await getCached('geocode:test-clear-ns', 300, compute)
    expect(compute).toHaveBeenCalledTimes(1)
    expect(result.cacheHit).toBe(false)
  })

  it('does not throw when clearing a namespace that has no entries', () => {
    expect(() => clearCacheNamespace('nonexistent-namespace')).not.toThrow()
  })
})
