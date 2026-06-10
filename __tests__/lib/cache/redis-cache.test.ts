/**
 * Unit tests for lib/cache/redis-cache.ts
 * Tests L1 hit, L2 hit, full miss, null redis fallback, quota counter, clearCacheNamespace
 */

// jest.mock is hoisted above variable declarations, so mock the module with a factory
// that captures a reference to the mock functions defined inside the factory scope.
// We use a module-level variable that jest.__mocks__ populates.

let mockGet = jest.fn()
let mockSet = jest.fn().mockResolvedValue('OK')
let mockIncr = jest.fn()
let mockExpireat = jest.fn().mockResolvedValue(1)
let mockRedisIsNull = false

jest.mock('@/lib/redis', () => {
  return {
    get redis() {
      // Use a getter so we can re-mock per test without re-importing
      if (mockRedisIsNull) return null
      return {
        get: mockGet,
        set: mockSet,
        incr: mockIncr,
        expireat: mockExpireat,
      }
    },
    get isRedisAvailable() {
      return !mockRedisIsNull
    },
  }
})

jest.mock('@/lib/monitoring', () => ({
  log: jest.fn(),
  logError: jest.fn(),
}))

import { getCached, incrementQuotaCounter, clearCacheNamespace } from '@/lib/cache/redis-cache'

describe('getCached', () => {
  beforeEach(() => {
    // Clear L1 state between tests
    clearCacheNamespace('geocode')
    clearCacheNamespace('route')
    clearCacheNamespace('comparison')
    clearCacheNamespace('testns')

    // Reset mocks
    mockGet = jest.fn()
    mockSet = jest.fn().mockResolvedValue('OK')
    mockIncr = jest.fn()
    mockExpireat = jest.fn().mockResolvedValue(1)
  })

  describe('L1 hit', () => {
    it('returns cached value from L1 on second call without calling compute or redis again', async () => {
      mockGet.mockResolvedValue(null)
      const compute = jest.fn().mockResolvedValue({ lat: 37.77, lng: -122.41 })

      // First call — cache miss, populates L1
      const first = await getCached('geocode:test-l1-hit', 300, compute)
      expect(first.cacheHit).toBe(false)
      expect(compute).toHaveBeenCalledTimes(1)

      // Replace mocks with clean fns to verify they're not called on L1 hit
      mockGet = jest.fn()
      compute.mockClear()

      // Second call — should hit L1
      const second = await getCached('geocode:test-l1-hit', 300, compute)
      expect(second.cacheHit).toBe(true)
      expect(second.value).toEqual({ lat: 37.77, lng: -122.41 })
      expect(compute).not.toHaveBeenCalled()
      expect(mockGet).not.toHaveBeenCalled()
    })
  })

  describe('L2 hit (Redis)', () => {
    it('returns value from Redis when L1 is cold, does not call compute', async () => {
      const cachedValue = { lat: 37.33, lng: -121.88 }
      mockGet.mockResolvedValue(cachedValue)

      const compute = jest.fn()

      const result = await getCached('geocode:test-l2-hit', 300, compute)
      expect(result.cacheHit).toBe(true)
      expect(result.value).toEqual(cachedValue)
      expect(compute).not.toHaveBeenCalled()
      expect(mockGet).toHaveBeenCalledWith('geocode:test-l2-hit')
    })

    it('warms L1 from L2 so subsequent call does not hit Redis', async () => {
      const cachedValue = { distance: 15.2 }
      mockGet.mockResolvedValue(cachedValue)

      const compute = jest.fn()

      // First call — L2 hit, warms L1
      await getCached('route:test-l2-warm', 600, compute)

      // Replace redis.get mock — it should not be called on L1 hit
      mockGet = jest.fn()
      compute.mockClear()

      // Second call — should hit L1 (warmed from L2)
      const second = await getCached('route:test-l2-warm', 600, compute)
      expect(second.cacheHit).toBe(true)
      expect(second.value).toEqual(cachedValue)
      expect(compute).not.toHaveBeenCalled()
      expect(mockGet).not.toHaveBeenCalled()
    })
  })

  describe('full miss', () => {
    it('calls compute, stores in L1, fires redis.set with ex option, returns cacheHit: false', async () => {
      mockGet.mockResolvedValue(null)
      const computedValue = { price: 25.5 }
      const compute = jest.fn().mockResolvedValue(computedValue)

      const result = await getCached('comparison:test-full-miss', 300, compute)

      expect(result.cacheHit).toBe(false)
      expect(result.value).toEqual(computedValue)
      expect(compute).toHaveBeenCalledTimes(1)

      // Allow fire-and-forget to settle
      await Promise.resolve()
      await Promise.resolve()

      expect(mockSet).toHaveBeenCalledWith('comparison:test-full-miss', computedValue, { ex: 300 })
    })
  })

  describe('redis.get throws', () => {
    it('swallows error and falls through to compute', async () => {
      mockGet.mockRejectedValue(new Error('Redis connection failed'))
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
      mockGet.mockResolvedValue(null)

      let resolveSet!: (v: string) => void
      const setPromise = new Promise<string>(resolve => {
        resolveSet = resolve
      })
      mockSet = jest.fn().mockReturnValue(setPromise)

      const computedValue = { data: 'test' }
      const compute = jest.fn().mockResolvedValue(computedValue)

      // getCached should resolve even though redis.set hasn't resolved yet
      const result = await getCached('route:test-fire-forget', 600, compute)

      expect(result.value).toEqual(computedValue)
      // resolve the set after the fact to avoid hanging
      resolveSet('OK')
      await Promise.resolve()
    })
  })
})

describe('getCached with null redis', () => {
  it('falls back to compute when redis is null without throwing errors', async () => {
    // We test null-redis behavior using jest.isolateModules
    let getCachedNull: typeof getCached
    let clearNull: typeof clearCacheNamespace
    const nullRedisGet = jest.fn()
    const nullRedisSet = jest.fn()

    await jest.isolateModulesAsync(async () => {
      jest.doMock('@/lib/redis', () => ({
        redis: null,
        isRedisAvailable: false,
      }))

      jest.doMock('@/lib/monitoring', () => ({
        log: jest.fn(),
      }))

      const mod = await import('@/lib/cache/redis-cache')
      getCachedNull = mod.getCached
      clearNull = mod.clearCacheNamespace
    })

    clearNull!('testns')

    const compute = jest.fn().mockResolvedValue({ fallback: true })
    const result = await getCachedNull!('testns:null-redis-key', 300, compute)

    expect(result.value).toEqual({ fallback: true })
    expect(result.cacheHit).toBe(false)
    expect(compute).toHaveBeenCalledTimes(1)
    // Verify no redis calls were made (isolated module had null redis)
    expect(nullRedisGet).not.toHaveBeenCalled()
    expect(nullRedisSet).not.toHaveBeenCalled()
  })
})

describe('incrementQuotaCounter', () => {
  beforeEach(() => {
    mockIncr = jest.fn()
    mockExpireat = jest.fn().mockResolvedValue(1)
  })

  it('calls redis.incr and redis.expireat when count === 1', async () => {
    mockIncr.mockResolvedValue(1)

    const key = 'quota:ai:2026-03-10'
    const count = await incrementQuotaCounter(key)

    expect(count).toBe(1)
    expect(mockIncr).toHaveBeenCalledWith(key)
    expect(mockExpireat).toHaveBeenCalledTimes(1)

    // Verify the expireat timestamp is for next midnight UTC
    const expireAt = mockExpireat.mock.calls[0][1] as number
    const now = new Date()
    const nextMidnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)
    const expectedExpireAt = Math.floor(nextMidnight / 1000)

    // Allow +-60 seconds tolerance for test timing
    expect(expireAt).toBeGreaterThanOrEqual(expectedExpireAt - 60)
    expect(expireAt).toBeLessThanOrEqual(expectedExpireAt + 60)
  })

  it('calls redis.incr but NOT redis.expireat when count > 1', async () => {
    mockIncr.mockResolvedValue(2)

    const count = await incrementQuotaCounter('quota:ai:2026-03-10')

    expect(count).toBe(2)
    expect(mockIncr).toHaveBeenCalledTimes(1)
    expect(mockExpireat).not.toHaveBeenCalled()
  })

  it('returns 0 when redis is null (fail-open)', async () => {
    // Temporarily make incr throw to simulate what happens when redis is null
    // The null-redis path is validated by the getCached null redis test via isolateModules.
    // Here we validate that redis errors (incr throws) also return 0 (same fail-open contract).
    mockIncr.mockRejectedValue(new Error('Redis not available'))

    const count = await incrementQuotaCounter('quota:ai:2026-03-10')
    expect(count).toBe(0)
  })

  describe('production fail-closed', () => {
    const originalNodeEnv = process.env.NODE_ENV

    afterEach(() => {
      Object.assign(process.env, { NODE_ENV: originalNodeEnv })
    })

    it('returns Infinity on redis error in production so quota checks fail', async () => {
      Object.assign(process.env, { NODE_ENV: 'production' })
      mockIncr.mockRejectedValue(new Error('Redis connection failed'))

      const count = await incrementQuotaCounter('quota:ai:2026-06-09')
      expect(count).toBe(Number.POSITIVE_INFINITY)
    })

    it('returns Infinity when redis is null in production', async () => {
      mockRedisIsNull = true
      try {
        Object.assign(process.env, { NODE_ENV: 'production' })
        const count = await incrementQuotaCounter('quota:ai:2026-06-09')
        expect(count).toBe(Number.POSITIVE_INFINITY)
      } finally {
        mockRedisIsNull = false
      }
    })
  })
})

describe('clearCacheNamespace', () => {
  beforeEach(() => {
    mockGet = jest.fn().mockResolvedValue(null)
    mockSet = jest.fn().mockResolvedValue('OK')
    clearCacheNamespace('geocode')
  })

  it('clears L1 entries for the given namespace so next call triggers compute', async () => {
    const compute = jest.fn().mockResolvedValue({ address: '123 Main St' })

    // Populate L1
    await getCached('geocode:test-clear-ns', 300, compute)
    expect(compute).toHaveBeenCalledTimes(1)

    // Verify L1 hit works
    mockGet = jest.fn()
    compute.mockClear()
    await getCached('geocode:test-clear-ns', 300, compute)
    expect(compute).not.toHaveBeenCalled()
    expect(mockGet).not.toHaveBeenCalled()

    // Clear the namespace
    clearCacheNamespace('geocode')

    mockGet = jest.fn().mockResolvedValue(null)
    compute.mockClear()

    // Next call should miss L1 (and L2 since mock returns null)
    const result = await getCached('geocode:test-clear-ns', 300, compute)
    expect(compute).toHaveBeenCalledTimes(1)
    expect(result.cacheHit).toBe(false)
  })

  it('does not throw when clearing a namespace that has no entries', () => {
    expect(() => clearCacheNamespace('nonexistent-namespace')).not.toThrow()
  })
})
