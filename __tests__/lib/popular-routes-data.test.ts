import {
  PRECOMPUTED_ROUTES,
  findPrecomputedRouteByAddresses,
  getPrecomputedRoute,
} from '@/lib/popular-routes-data'

describe('popular-routes-data', () => {
  it('exposes exactly 14 precomputed routes', () => {
    expect(Object.keys(PRECOMPUTED_ROUTES)).toHaveLength(14)
  })

  it('every route has non-empty pickup/destination names and positive metrics', () => {
    for (const [slug, route] of Object.entries(PRECOMPUTED_ROUTES)) {
      expect(route.pickup.name.length).toBeGreaterThan(0)
      expect(route.destination.name.length).toBeGreaterThan(0)
      expect(route.pickup.coordinates).toHaveLength(2)
      expect(route.destination.coordinates).toHaveLength(2)
      expect(route.metrics.distanceKm).toBeGreaterThan(0)
      expect(route.metrics.durationMin).toBeGreaterThan(0)
      // Surface slug in failure if any assertion above fails
      expect(slug).toBeTruthy()
    }
  })

  describe('getPrecomputedRoute', () => {
    it('returns the route for a known slug', () => {
      const route = getPrecomputedRoute('sfo-downtown')
      expect(route).toBeDefined()
      expect(route?.pickup.name).toMatch(/SFO|San Francisco International Airport/i)
      expect(route?.destination.name).toMatch(/Downtown San Francisco/i)
    })

    it('returns undefined for an unknown slug', () => {
      expect(getPrecomputedRoute('nonexistent-slug')).toBeUndefined()
    })

    it('returns a record for every slug enumerated in PRECOMPUTED_ROUTES', () => {
      for (const slug of Object.keys(PRECOMPUTED_ROUTES)) {
        expect(getPrecomputedRoute(slug)).toBeDefined()
      }
    })
  })

  describe('findPrecomputedRouteByAddresses', () => {
    it('finds a route from exact full address strings', () => {
      const route = findPrecomputedRouteByAddresses(
        'San Francisco International Airport (SFO), San Francisco, CA, USA',
        'Downtown San Francisco, San Francisco, CA, USA'
      )
      expect(route).toBeDefined()
      expect(route?.pickup.name).toMatch(/SFO/)
    })

    it('is case-insensitive', () => {
      const route = findPrecomputedRouteByAddresses(
        'san francisco international airport (sfo), san francisco, ca, usa',
        'downtown san francisco, san francisco, ca, usa'
      )
      expect(route).toBeDefined()
    })

    it('matches when only the first-segment key is supplied', () => {
      // The function splits on comma and checks the leading segment as a key.
      const route = findPrecomputedRouteByAddresses(
        'San Francisco International Airport (SFO)',
        'Downtown San Francisco'
      )
      expect(route).toBeDefined()
    })

    it('returns undefined when addresses do not match any precomputed route', () => {
      expect(
        findPrecomputedRouteByAddresses('1234 Bogus St, Nowhere', '5678 Imaginary Ave, Nowhere')
      ).toBeUndefined()
    })
  })
})
