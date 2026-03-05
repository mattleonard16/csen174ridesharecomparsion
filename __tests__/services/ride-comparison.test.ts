import { compareRidesByAddresses, compareRidesByCoordinates } from '@/lib/services/ride-comparison'
import type { Coordinates } from '@/types'

jest.mock('@/lib/database', () => ({
  findOrCreateRoute: jest.fn(async () => 'mock-route-id'),
  logPriceSnapshot: jest.fn(async () => undefined),
  logSearch: jest.fn(async () => undefined),
}))

const mockFetch = jest.fn()
const originalFetch = global.fetch

const MOCK_NOMINATIM_RESPONSE = [
  {
    lat: '37.7749',
    lon: '-122.4194',
  },
]

const MOCK_OSRM_RESPONSE = {
  code: 'Ok',
  routes: [
    {
      distance: 5000,
      duration: 600,
    },
  ],
}

describe('ride-comparison service', () => {
  beforeAll(() => {
    global.fetch = mockFetch
  })

  afterAll(() => {
    global.fetch = originalFetch
  })

  beforeEach(() => {
    jest.clearAllMocks()
    mockFetch.mockReset()
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.runOnlyPendingTimers()
    jest.useRealTimers()
  })

  describe('compareRidesByAddresses', () => {
    it('should geocode addresses and return comparison results', async () => {
      mockFetch.mockImplementation((url: string) => {
        if (url.includes('nominatim')) {
          return Promise.resolve({
            ok: true,
            json: async () => MOCK_NOMINATIM_RESPONSE,
          })
        }
        if (url.includes('osrm')) {
          return Promise.resolve({
            ok: true,
            json: async () => MOCK_OSRM_RESPONSE,
          })
        }
        return Promise.reject(new Error('Unexpected URL'))
      })

      const result = await compareRidesByAddresses(
        'San Francisco, CA',
        'Oakland, CA',
        ['uber', 'lyft'],
        new Date('2024-01-15T14:00:00Z')
      )

      expect(result).not.toBeNull()
      expect(result?.results).toHaveProperty('uber')
      expect(result?.results).toHaveProperty('lyft')
      expect(result?.surgeInfo).toBeDefined()
      expect(result?.timeRecommendations).toBeDefined()
      expect(result?.insights).toBeDefined()
    })

    it('should return null if pickup geocoding fails', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
      })

      const result = await compareRidesByAddresses('Invalid Address', 'Oakland, CA')

      expect(result).toBeNull()
    })

    it('should return null if destination geocoding fails', async () => {
      const uniquePickup = `Valid Address ${Math.random()}`
      const uniqueDest = `Invalid Address ${Math.random()}`

      mockFetch.mockImplementation((url: string) => {
        if (url.includes('nominatim')) {
          if (url.includes(encodeURIComponent(uniqueDest))) {
            return Promise.resolve({
              ok: true,
              json: async () => [],
            })
          }
          return Promise.resolve({
            ok: true,
            json: async () => MOCK_NOMINATIM_RESPONSE,
          })
        }
        return Promise.resolve({
          ok: true,
          json: async () => MOCK_OSRM_RESPONSE,
        })
      })

      const result = await compareRidesByAddresses(uniquePickup, uniqueDest)

      expect(result).toBeNull()
    })

    it('should sanitize input addresses', async () => {
      mockFetch.mockImplementation((url: string) => {
        if (url.includes('nominatim')) {
          return Promise.resolve({
            ok: true,
            json: async () => MOCK_NOMINATIM_RESPONSE,
          })
        }
        if (url.includes('osrm')) {
          return Promise.resolve({
            ok: true,
            json: async () => MOCK_OSRM_RESPONSE,
          })
        }
        return Promise.reject(new Error('Unexpected URL'))
      })

      await compareRidesByAddresses(
        '<script>alert("xss")</script>San Francisco',
        'Oakland<img src=x>',
        ['uber']
      )

      expect(mockFetch).toHaveBeenCalled()
      const firstCall = mockFetch.mock.calls[0][0] as string
      expect(firstCall).not.toContain('<script>')
      expect(firstCall).not.toContain('<img')
    })
  })

  describe('compareRidesByCoordinates', () => {
    const pickupCoords: Coordinates = [-122.4194, 37.7749]
    const destCoords: Coordinates = [-122.2711, 37.8044]

    beforeEach(() => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => MOCK_OSRM_RESPONSE,
      })
    })

    it('should calculate all services when not specified', async () => {
      const result = await compareRidesByCoordinates(
        { name: 'Pickup', coordinates: pickupCoords },
        { name: 'Destination', coordinates: destCoords }
      )

      expect(result.results).toHaveProperty('uber')
      expect(result.results).toHaveProperty('lyft')
      expect(result.results).toHaveProperty('taxi')
    })

    it('should only calculate specified services', async () => {
      const result = await compareRidesByCoordinates(
        { name: 'Pickup', coordinates: pickupCoords },
        { name: 'Destination', coordinates: destCoords },
        ['uber']
      )

      expect(result.results).toHaveProperty('uber')
      expect(result.results).not.toHaveProperty('lyft')
      expect(result.results).not.toHaveProperty('taxi')
    })

    it('should include surge information', async () => {
      const result = await compareRidesByCoordinates(
        { name: 'Pickup', coordinates: pickupCoords },
        { name: 'Destination', coordinates: destCoords },
        ['uber'],
        new Date('2024-01-15T18:00:00Z')
      )

      expect(result.surgeInfo).toBeDefined()
      expect(result.surgeInfo).toHaveProperty('multiplier')
      expect(result.surgeInfo).toHaveProperty('reason')
      expect(result.surgeInfo).toHaveProperty('isActive')
      expect(typeof result.surgeInfo.multiplier).toBe('number')
    })

    it('should include time recommendations', async () => {
      const result = await compareRidesByCoordinates(
        { name: 'Pickup', coordinates: pickupCoords },
        { name: 'Destination', coordinates: destCoords }
      )

      expect(result.timeRecommendations).toBeDefined()
      expect(Array.isArray(result.timeRecommendations)).toBe(true)
    })

    it('should include insights recommendation', async () => {
      const result = await compareRidesByCoordinates(
        { name: 'Pickup', coordinates: pickupCoords },
        { name: 'Destination', coordinates: destCoords }
      )

      expect(result.insights).toBeDefined()
      expect(typeof result.insights).toBe('string')
      expect(result.insights.length).toBeGreaterThan(0)
    })

    it('should return pickup and destination coordinates', async () => {
      const result = await compareRidesByCoordinates(
        { name: 'Pickup', coordinates: pickupCoords },
        { name: 'Destination', coordinates: destCoords }
      )

      expect(result.pickup).toEqual(pickupCoords)
      expect(result.destination).toEqual(destCoords)
    })

    it('should include formatted prices in results', async () => {
      const result = await compareRidesByCoordinates(
        { name: 'Pickup', coordinates: pickupCoords },
        { name: 'Destination', coordinates: destCoords },
        ['uber']
      )

      expect(result.results.uber).toBeDefined()
      expect(result.results.uber!.price).toMatch(/^\$\d+\.\d{2}$/)
    })

    it('should include wait time in results', async () => {
      const result = await compareRidesByCoordinates(
        { name: 'Pickup', coordinates: pickupCoords },
        { name: 'Destination', coordinates: destCoords },
        ['uber']
      )

      expect(result.results.uber).toBeDefined()
      expect(result.results.uber!.waitTime).toMatch(/^\d+ min$/)
    })

    it('should include drivers nearby count', async () => {
      const result = await compareRidesByCoordinates(
        { name: 'Pickup', coordinates: pickupCoords },
        { name: 'Destination', coordinates: destCoords },
        ['uber']
      )

      expect(result.results.uber).toBeDefined()
      expect(typeof result.results.uber!.driversNearby).toBe('number')
      expect(result.results.uber!.driversNearby).toBeGreaterThan(0)
    })

    it('should deduplicate service types', async () => {
      const result = await compareRidesByCoordinates(
        { name: 'Pickup', coordinates: pickupCoords },
        { name: 'Destination', coordinates: destCoords },
        ['uber', 'uber', 'Uber'] as any
      )

      expect(Object.keys(result.results)).toEqual(['uber'])
    })

    it('persists route distance in miles rather than kilometers', async () => {
      const { findOrCreateRoute } = jest.requireMock('@/lib/database') as {
        findOrCreateRoute: jest.Mock
      }

      await compareRidesByCoordinates(
        { name: 'Pickup', coordinates: pickupCoords },
        { name: 'Destination', coordinates: destCoords },
        ['uber']
      )

      expect(findOrCreateRoute).toHaveBeenCalled()
      const distanceArgument = findOrCreateRoute.mock.calls[0][4] as number
      expect(distanceArgument).toBeCloseTo(3.106855, 5)
    })
  })

  describe('caching behavior', () => {
    const pickupCoords: Coordinates = [-122.4194, 37.7749]
    const destCoords: Coordinates = [-122.2711, 37.8044]

    beforeEach(() => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => MOCK_OSRM_RESPONSE,
      })
    })

    it('should cache geocoding results', async () => {
      const uniqueAddress1 = `Test Addr ${Math.random()}`
      const uniqueAddress2 = `Test Addr ${Math.random()}`

      mockFetch.mockImplementation((url: string) => {
        if (url.includes('nominatim')) {
          return Promise.resolve({
            ok: true,
            json: async () => MOCK_NOMINATIM_RESPONSE,
          })
        }
        if (url.includes('osrm')) {
          return Promise.resolve({
            ok: true,
            json: async () => MOCK_OSRM_RESPONSE,
          })
        }
        return Promise.reject(new Error('Unexpected URL'))
      })

      await compareRidesByAddresses(uniqueAddress1, uniqueAddress2)
      const callsAfterFirst = mockFetch.mock.calls.length
      expect(callsAfterFirst).toBeGreaterThanOrEqual(2)

      mockFetch.mockClear()
      await compareRidesByAddresses(uniqueAddress1, uniqueAddress2)
      const callsAfterSecond = mockFetch.mock.calls.length
      expect(callsAfterSecond).toBe(0)
    })

    it('should cache route metrics', async () => {
      await compareRidesByCoordinates(
        { name: 'Pickup', coordinates: pickupCoords },
        { name: 'Destination', coordinates: destCoords }
      )
      const callsAfterFirst = mockFetch.mock.calls.length

      await compareRidesByCoordinates(
        { name: 'Pickup', coordinates: pickupCoords },
        { name: 'Destination', coordinates: destCoords }
      )
      const callsAfterSecond = mockFetch.mock.calls.length

      expect(callsAfterSecond).toBe(callsAfterFirst)
    })
  })

  describe('resilient fetch behavior', () => {
    const pickupCoords: Coordinates = [-122.4194, 37.7749]
    const destCoords: Coordinates = [-122.2711, 37.8044]
    const differentPickup: Coordinates = [-122.5, 37.9]

    it('should retry failed requests', async () => {
      mockFetch
        .mockRejectedValueOnce(new Error('Network error'))
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({
          ok: true,
          json: async () => MOCK_OSRM_RESPONSE,
        })

      const result = await compareRidesByCoordinates(
        { name: 'Pickup', coordinates: differentPickup },
        { name: 'Destination', coordinates: destCoords },
        ['uber']
      )

      expect(result).toBeDefined()
      expect(mockFetch).toHaveBeenCalledTimes(3)
    })

    it('should throw error after max retries', async () => {
      const uniquePickup: Coordinates = [-122.6, 37.95]
      mockFetch.mockRejectedValue(new Error('Network error'))

      await expect(
        compareRidesByCoordinates(
          { name: 'Pickup', coordinates: uniquePickup },
          { name: 'Destination', coordinates: destCoords },
          ['uber']
        )
      ).rejects.toThrow()

      expect(mockFetch).toHaveBeenCalledTimes(3)
    })

    it('should include User-Agent header', async () => {
      const uniquePickup: Coordinates = [-122.7, 37.85]
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => MOCK_OSRM_RESPONSE,
      })

      await compareRidesByCoordinates(
        { name: 'Pickup', coordinates: uniquePickup },
        { name: 'Destination', coordinates: destCoords },
        ['uber']
      )

      expect(mockFetch.mock.calls.length).toBeGreaterThan(0)
      const fetchCall = mockFetch.mock.calls[0]
      expect(fetchCall[1]?.headers['User-Agent']).toBe('RideCompareApp/1.0')
    })
  })

  describe('airport handling', () => {
    beforeEach(() => {
      mockFetch.mockImplementation((url: string) => {
        if (url.includes('nominatim')) {
          return Promise.resolve({
            ok: true,
            json: async () => MOCK_NOMINATIM_RESPONSE,
          })
        }
        if (url.includes('osrm')) {
          return Promise.resolve({
            ok: true,
            json: async () => MOCK_OSRM_RESPONSE,
          })
        }
        return Promise.reject(new Error('Unexpected URL'))
      })
    })

    it('should recognize SFO airport code', async () => {
      // Use a destination that does not match any precomputed route so OSRM is exercised.
      const result = await compareRidesByAddresses('SFO', 'Berkeley, CA', ['uber'])

      expect(result).not.toBeNull()
      const nominatimCalls = mockFetch.mock.calls.filter(call => call[0].includes('nominatim'))
      const osrmCalls = mockFetch.mock.calls.filter(call => call[0].includes('osrm'))

      // Airport code should bypass Nominatim for pickup, but destination still needs geocoding.
      expect(nominatimCalls.length).toBe(1)
      expect(osrmCalls.length).toBe(1)
    })

    it('should recognize OAK airport code', async () => {
      const result = await compareRidesByAddresses('Downtown SF', 'OAK', ['uber'])

      expect(result).not.toBeNull()
      const nominatimCalls = mockFetch.mock.calls.filter(call => call[0].includes('nominatim'))
      expect(nominatimCalls.length).toBe(1)
    })
  })

  describe('deterministic calculations', () => {
    const pickupCoords: Coordinates = [-122.4194, 37.7749]
    const destCoords: Coordinates = [-122.2711, 37.8044]
    const timestamp = new Date('2024-01-15T14:00:00Z')

    beforeEach(() => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => MOCK_OSRM_RESPONSE,
      })
    })

    it('should return consistent results for same inputs', async () => {
      const result1 = await compareRidesByCoordinates(
        { name: 'Pickup', coordinates: pickupCoords },
        { name: 'Destination', coordinates: destCoords },
        ['uber'],
        timestamp
      )

      const result2 = await compareRidesByCoordinates(
        { name: 'Pickup', coordinates: pickupCoords },
        { name: 'Destination', coordinates: destCoords },
        ['uber'],
        timestamp
      )

      expect(result1.results.uber).toBeDefined()
      expect(result2.results.uber).toBeDefined()
      expect(result1.results.uber!.price).toBe(result2.results.uber!.price)
      expect(result1.results.uber!.waitTime).toBe(result2.results.uber!.waitTime)
      expect(result1.results.uber!.driversNearby).toBe(result2.results.uber!.driversNearby)
    })

    it('should derive wait times based on service and surge', async () => {
      const result = await compareRidesByCoordinates(
        { name: 'Pickup', coordinates: pickupCoords },
        { name: 'Destination', coordinates: destCoords },
        ['uber', 'taxi'],
        timestamp
      )

      expect(result.results.uber).toBeDefined()
      expect(result.results.taxi).toBeDefined()
      const uberWait = parseInt(result.results.uber!.waitTime.replace(' min', ''))
      const taxiWait = parseInt(result.results.taxi!.waitTime.replace(' min', ''))

      expect(uberWait).toBeGreaterThanOrEqual(2)
      expect(uberWait).toBeLessThanOrEqual(18)
      expect(taxiWait).toBeGreaterThanOrEqual(2)
      expect(taxiWait).toBeLessThanOrEqual(18)
    })

    it('should derive drivers nearby based on service and conditions', async () => {
      const result = await compareRidesByCoordinates(
        { name: 'Pickup', coordinates: pickupCoords },
        { name: 'Destination', coordinates: destCoords },
        ['uber', 'lyft', 'taxi'],
        timestamp
      )

      expect(result.results.uber).toBeDefined()
      expect(result.results.lyft).toBeDefined()
      expect(result.results.taxi).toBeDefined()
      expect(result.results.uber!.driversNearby).toBeGreaterThanOrEqual(1)
      expect(result.results.lyft!.driversNearby).toBeGreaterThanOrEqual(1)
      expect(result.results.taxi!.driversNearby).toBeGreaterThanOrEqual(1)
    })
  })
})
