import { API_CONFIG, DEFAULT_SERVICES } from '@/lib/constants'
import { findOrCreateRoute, logPriceSnapshot, logSearch } from '@/lib/database'
import { getAirportByCode, parseAirportCode } from '@/lib/airports'
import { haversineDistanceKm } from '@/lib/geo'
import { log } from '@/lib/monitoring'
import { getBestTimeRecommendations, getTimeBasedMultiplier, pricingEngine } from '@/lib/pricing'
import { sanitizeString } from '@/lib/validation'
import { findPrecomputedRouteByAddresses } from '@/lib/popular-routes-data'
import { getCached, clearCacheNamespace } from '@/lib/cache/redis-cache'
import type {
  ComparisonResults,
  Coordinates,
  Latitude,
  Longitude,
  PriceString,
  RideResult,
  RideService,
  RouteAccuracy,
  ServiceType,
  SurgeInfo,
} from '@/types'

const COMPARISON_CACHE_VERSION = 'v2'
const PRECOMPUTED_COMPARISON_CACHE_TTL_MS = 5 * 60 * 1000
const DYNAMIC_COMPARISON_CACHE_TTL_MS = 45 * 1000

type PricingComputation = ReturnType<typeof pricingEngine.calculateFare>

interface RouteMetrics {
  distanceKm: number
  durationMin: number
  osrmDurationSec?: number
}

export type CompareServiceErrorCode =
  | 'ADDRESS_NOT_FOUND'
  | 'GEOCODE_TIMEOUT'
  | 'GEOCODE_UNAVAILABLE'
  | 'ROUTE_TIMEOUT'
  | 'ROUTE_UNAVAILABLE'

type UpstreamPhase = 'geocode' | 'route'
type UpstreamProvider = 'nominatim' | 'osrm'

type FetchPolicy = {
  provider: UpstreamProvider
  phase: UpstreamPhase
  timeoutMs: number
  maxRetries: number
  backoffMs: number
}

type RouteMetricsResolution = {
  metrics: RouteMetrics
  routeAccuracy: RouteAccuracy
  routeWarning?: string
}

export class CompareServiceError extends Error {
  code: CompareServiceErrorCode
  provider?: UpstreamProvider
  phase?: UpstreamPhase
  timedOut?: boolean

  constructor(
    code: CompareServiceErrorCode,
    message: string,
    options?: {
      provider?: UpstreamProvider
      phase?: UpstreamPhase
      timedOut?: boolean
      cause?: unknown
    }
  ) {
    super(message)
    this.name = 'CompareServiceError'
    this.code = code
    this.provider = options?.provider
    this.phase = options?.phase
    this.timedOut = options?.timedOut
    if (options?.cause !== undefined) {
      ;(this as Error & { cause?: unknown }).cause = options.cause
    }
  }
}

export function isCompareServiceError(error: unknown): error is CompareServiceError {
  return error instanceof CompareServiceError
}

export function resetRideComparisonCaches(): void {
  clearCacheNamespace('geocode')
  clearCacheNamespace('route')
  clearCacheNamespace('comparison')
}

interface ComparisonCoreComputation {
  results: ComparisonResults
  surgeInfo: SurgeInfo
  timeRecommendations: string[]
  pickup: Coordinates
  destination: Coordinates
  insights: string
  routeAccuracy: RouteAccuracy
  routeWarning?: string
}

export interface ComparisonComputation extends ComparisonCoreComputation {
  routeId: string | null
}

interface CachedPriceSnapshotData {
  service: ServiceType
  finalFare: number
  surgeMultiplier: number
  waitMinutes: number
  weather?: string
  trafficLevel?: 'light' | 'moderate' | 'heavy' | 'severe'
}

interface CachedComparisonCore extends ComparisonCoreComputation {
  metrics: RouteMetrics
  priceSnapshots: CachedPriceSnapshotData[]
}

const GEOCODE_FETCH_POLICY: FetchPolicy = {
  provider: 'nominatim',
  phase: 'geocode',
  timeoutMs: 2500,
  maxRetries: 1,
  backoffMs: 200,
}

const ROUTE_FETCH_POLICY: FetchPolicy = {
  provider: 'osrm',
  phase: 'route',
  timeoutMs: 3000,
  maxRetries: 1,
  backoffMs: 250,
}

const ESTIMATED_ROUTE_WARNING =
  'Prices are based on estimated route metrics because live routing is temporarily unavailable.'

const SERVICE_LABELS: Record<ServiceType, string> = {
  uber: 'UberX',
  lyft: 'Lyft Standard',
  taxi: 'Yellow Cab',
  waymo: 'Waymo One',
}

const WAYMO_SERVICE_AREAS = {
  sanFrancisco: {
    minLat: 37.7,
    maxLat: 37.82,
    minLon: -122.52,
    maxLon: -122.35,
  },
  peninsula: {
    minLat: 37.4,
    maxLat: 37.7,
    minLon: -122.5,
    maxLon: -122.1,
  },
}

function kmToMiles(km: number): number {
  return km * 0.621371
}

function formatCoordinateValue(value: number): string {
  return value.toFixed(5)
}

function getTimeBucket(timestamp: Date): string {
  const quarterHour = Math.floor(timestamp.getMinutes() / 15)
  const day = timestamp.toISOString().slice(0, 10)
  return `${day}:${timestamp.getHours()}:${quarterHour}`
}

function normaliseServices(services: ServiceType[]): ServiceType[] {
  const requestedServices = services.length ? services : DEFAULT_SERVICES
  return Array.from(
    new Set<ServiceType>(requestedServices.map(service => service.toLowerCase() as ServiceType))
  )
}

function createComparisonCacheKey(
  pickup: Coordinates,
  destination: Coordinates,
  services: ServiceType[],
  timestamp: Date,
  routeAccuracy: RouteAccuracy
): string {
  const pickupKey = `${formatCoordinateValue(pickup[0])},${formatCoordinateValue(pickup[1])}`
  const destinationKey = `${formatCoordinateValue(destination[0])},${formatCoordinateValue(destination[1])}`

  return [
    'comparison',
    COMPARISON_CACHE_VERSION,
    pickupKey,
    destinationKey,
    services.join(','),
    getTimeBucket(timestamp),
    routeAccuracy,
  ].join(':')
}

function isInWaymoServiceArea(coords: Coordinates): boolean {
  const [lon, lat] = coords

  for (const area of Object.values(WAYMO_SERVICE_AREAS)) {
    if (lat >= area.minLat && lat <= area.maxLat && lon >= area.minLon && lon <= area.maxLon) {
      return true
    }
  }

  return false
}

function filterServicesForRoute(
  services: ServiceType[],
  pickup: Coordinates,
  destination: Coordinates
): ServiceType[] {
  return services.filter(service => {
    if (service === 'waymo') {
      return isInWaymoServiceArea(pickup) && isInWaymoServiceArea(destination)
    }

    return true
  })
}

async function getComparisonCore(
  pickup: Coordinates,
  destination: Coordinates,
  services: ServiceType[],
  metrics: RouteMetrics,
  timestamp: Date,
  isPrecomputedRoute: boolean,
  routeAccuracy: RouteAccuracy,
  routeWarning?: string
): Promise<CachedComparisonCore> {
  const cacheKey = createComparisonCacheKey(pickup, destination, services, timestamp, routeAccuracy)
  const ttlSeconds = isPrecomputedRoute
    ? PRECOMPUTED_COMPARISON_CACHE_TTL_MS / 1000
    : DYNAMIC_COMPARISON_CACHE_TTL_MS / 1000

  const { value } = await getCached<CachedComparisonCore>(cacheKey, ttlSeconds, async () => {
    const resultsEntries = services.map(service => {
      const computation = pricingEngine.calculateFare({
        service,
        pickupCoords: pickup,
        destCoords: destination,
        distanceKm: metrics.distanceKm,
        durationMin: metrics.durationMin,
        timestamp,
        osrmDurationSec: metrics.osrmDurationSec,
        expectedDurationSec: metrics.durationMin * 60,
      })

      return [service, buildRideResult(service, computation, metrics), computation] as const
    })

    const comparisonResults = Object.fromEntries(
      resultsEntries.map(([service, result]) => [service, result])
    ) as ComparisonResults

    const { multiplier, surgeReason } = getTimeBasedMultiplier(pickup, destination, timestamp)

    const core: CachedComparisonCore = {
      metrics,
      results: comparisonResults,
      surgeInfo: {
        multiplier,
        reason: surgeReason,
        isActive: multiplier > 1.05,
      },
      timeRecommendations: getBestTimeRecommendations(),
      pickup,
      destination,
      insights: generateRecommendation(comparisonResults),
      routeAccuracy,
      routeWarning,
      priceSnapshots: resultsEntries.map(([service, _, computation]) => ({
        service,
        finalFare: computation.breakdown.finalFare,
        surgeMultiplier: computation.breakdown.surgeMultiplier,
        waitMinutes: deriveWaitMinutes(
          service,
          computation.breakdown.surgeMultiplier,
          metrics.durationMin
        ),
        weather: computation.surgeReason,
        trafficLevel: classifyTraffic(computation.breakdown.trafficMultiplier),
      })),
    }

    return core
  })

  return value
}

async function persistComparison(
  core: CachedComparisonCore,
  pickupAddress: string,
  destinationAddress: string,
  pickupCoords: Coordinates,
  destinationCoords: Coordinates,
  options?: {
    userId?: string | null
    sessionId?: string | null
    persist?: boolean
  }
): Promise<string | null> {
  if (options?.persist === false) {
    return null
  }

  // Only persist exact route metrics to maintain database quality
  const persistedDistance =
    core.routeAccuracy === 'exact' ? kmToMiles(core.metrics.distanceKm) : undefined
  const persistedDuration = core.routeAccuracy === 'exact' ? core.metrics.durationMin : undefined

  const routeId = await findOrCreateRoute(
    pickupAddress,
    [pickupCoords[0], pickupCoords[1]],
    destinationAddress,
    [destinationCoords[0], destinationCoords[1]],
    persistedDistance,
    persistedDuration
  )

  if (!routeId) {
    return null
  }

  core.priceSnapshots.forEach(snapshot => {
    logPriceSnapshot(
      routeId,
      snapshot.service,
      snapshot.finalFare,
      snapshot.surgeMultiplier,
      snapshot.waitMinutes,
      {
        weather: snapshot.weather,
        trafficLevel: snapshot.trafficLevel,
      }
    ).catch(() => {
      // Snapshot logging is non-critical and should never block user results.
    })
  })

  logSearch(routeId, options?.userId ?? null, core.results, options?.sessionId ?? undefined).catch(
    () => {
      // Search logging is non-critical and should never block user results.
    }
  )

  return routeId
}

export async function compareRidesByAddresses(
  pickupAddress: string,
  destinationAddress: string,
  services: ServiceType[] = DEFAULT_SERVICES,
  timestamp: Date = new Date(),
  options?: {
    userId?: string | null
    sessionId?: string | null
    persist?: boolean
  }
): Promise<ComparisonComputation> {
  const sanitizedPickup = sanitizeString(pickupAddress)
  const sanitizedDestination = sanitizeString(destinationAddress)

  const precomputedRoute = findPrecomputedRouteByAddresses(sanitizedPickup, sanitizedDestination)

  let pickupCoords: Coordinates
  let destinationCoords: Coordinates

  if (precomputedRoute) {
    pickupCoords = precomputedRoute.pickup.coordinates
    destinationCoords = precomputedRoute.destination.coordinates
  } else {
    const [pickup, destination] = await Promise.all([
      geocodeWithCache(sanitizedPickup),
      geocodeWithCache(sanitizedDestination),
    ])
    pickupCoords = pickup
    destinationCoords = destination
  }

  return compareRidesByCoordinates(
    { name: sanitizedPickup, coordinates: pickupCoords },
    { name: sanitizedDestination, coordinates: destinationCoords },
    services,
    timestamp,
    {
      userId: options?.userId ?? null,
      sessionId: options?.sessionId ?? null,
      persist: options?.persist ?? true,
      pickupAddress: sanitizedPickup,
      destinationAddress: sanitizedDestination,
      precomputedMetrics: precomputedRoute?.metrics,
    }
  )
}

export async function compareRidesByCoordinates(
  pickup: { name: string; coordinates: Coordinates },
  destination: { name: string; coordinates: Coordinates },
  services: ServiceType[] = DEFAULT_SERVICES,
  timestamp: Date = new Date(),
  options?: {
    userId?: string | null
    sessionId?: string | null
    persist?: boolean
    pickupAddress?: string
    destinationAddress?: string
    precomputedMetrics?: Pick<RouteMetrics, 'distanceKm' | 'durationMin'>
  }
): Promise<ComparisonComputation> {
  const uniqueServices = normaliseServices(services)

  let eligibleServices = filterServicesForRoute(
    uniqueServices,
    pickup.coordinates,
    destination.coordinates
  )

  if (eligibleServices.length === 0) {
    eligibleServices = filterServicesForRoute(
      DEFAULT_SERVICES.filter(service => service !== 'waymo'),
      pickup.coordinates,
      destination.coordinates
    )
  }

  const routeMetrics = await resolveRouteMetrics(
    pickup.coordinates,
    destination.coordinates,
    options?.precomputedMetrics
  )
  const metrics = routeMetrics.metrics

  const core = await getComparisonCore(
    pickup.coordinates,
    destination.coordinates,
    eligibleServices,
    metrics,
    timestamp,
    !!options?.precomputedMetrics,
    routeMetrics.routeAccuracy,
    routeMetrics.routeWarning
  )

  const pickupAddress = options?.pickupAddress ?? pickup.name
  const destinationAddress = options?.destinationAddress ?? destination.name
  const routeId = await persistComparison(
    core,
    pickupAddress,
    destinationAddress,
    pickup.coordinates,
    destination.coordinates,
    options
  )

  return {
    routeId,
    results: core.results,
    surgeInfo: core.surgeInfo,
    timeRecommendations: core.timeRecommendations,
    pickup: core.pickup,
    destination: core.destination,
    insights: core.insights,
    routeAccuracy: core.routeAccuracy,
    routeWarning: core.routeWarning,
  }
}

function classifyTraffic(
  multiplier: number
): 'light' | 'moderate' | 'heavy' | 'severe' | undefined {
  if (multiplier <= 1.1) return 'light'
  if (multiplier <= 1.25) return 'moderate'
  if (multiplier <= 1.4) return 'heavy'
  return 'severe'
}

async function geocodeWithCache(address: string): Promise<Coordinates> {
  const normalizedKey = address.toLowerCase()
  const GEOCODE_TTL_SECONDS = API_CONFIG.CACHE_TTL / 1000

  const airportCode = parseAirportCode(address)
  if (airportCode) {
    const airport = getAirportByCode(airportCode)
    if (airport) {
      const { value } = await getCached<Coordinates>(
        `geocode:${normalizedKey}`,
        GEOCODE_TTL_SECONDS,
        async () => airport.coordinates
      )
      return value
    }
  }

  const { value: coordinates } = await getCached<Coordinates>(
    `geocode:${normalizedKey}`,
    GEOCODE_TTL_SECONDS,
    async () => {
      const url = `${API_CONFIG.NOMINATIM_BASE_URL}?q=${encodeURIComponent(address)}&format=json&limit=1`
      const response = await fetchWithPolicy(url, GEOCODE_FETCH_POLICY)

      if (!response.ok) {
        throw new CompareServiceError(
          'GEOCODE_UNAVAILABLE',
          `Geocoding provider returned ${response.status}`,
          {
            provider: 'nominatim',
            phase: 'geocode',
          }
        )
      }

      const data = (await response.json()) as Array<{ lon: string; lat: string }>
      if (!data.length) {
        throw new CompareServiceError(
          'ADDRESS_NOT_FOUND',
          `Address could not be resolved: ${address}`,
          {
            provider: 'nominatim',
            phase: 'geocode',
          }
        )
      }

      return [
        parseFloat(data[0].lon) as Longitude,
        parseFloat(data[0].lat) as Latitude,
      ] as Coordinates
    }
  )

  return coordinates
}

async function getRouteMetrics(
  pickup: Coordinates,
  destination: Coordinates
): Promise<RouteMetrics> {
  const cacheKey = `route:${getRouteCacheKey('exact', pickup, destination)}`
  const ROUTE_TTL_SECONDS = API_CONFIG.ROUTE_CACHE_TTL / 1000

  const { value } = await getCached<RouteMetrics>(cacheKey, ROUTE_TTL_SECONDS, async () => {
    const url = `${API_CONFIG.OSRM_BASE_URL}/${pickup[0]},${pickup[1]};${destination[0]},${destination[1]}?overview=false`
    const response = await fetchWithPolicy(url, ROUTE_FETCH_POLICY)

    if (!response.ok) {
      throw new CompareServiceError(
        'ROUTE_UNAVAILABLE',
        `Routing provider returned ${response.status}`,
        {
          provider: 'osrm',
          phase: 'route',
        }
      )
    }

    const data: OSRMResponse = await response.json()

    if (data.code !== 'Ok' || !data.routes?.length) {
      throw new CompareServiceError('ROUTE_UNAVAILABLE', `Routing response invalid: ${data.code}`, {
        provider: 'osrm',
        phase: 'route',
      })
    }

    const route = data.routes[0]
    return {
      distanceKm: route.distance / 1000,
      durationMin: route.duration / 60,
      osrmDurationSec: route.duration,
    }
  })

  return value
}

async function resolveRouteMetrics(
  pickup: Coordinates,
  destination: Coordinates,
  precomputedMetrics?: Pick<RouteMetrics, 'distanceKm' | 'durationMin'>
): Promise<RouteMetricsResolution> {
  if (precomputedMetrics) {
    return {
      metrics: {
        distanceKm: precomputedMetrics.distanceKm,
        durationMin: precomputedMetrics.durationMin,
      },
      routeAccuracy: 'exact',
    }
  }

  try {
    return {
      metrics: await getRouteMetrics(pickup, destination),
      routeAccuracy: 'exact',
    }
  } catch (error) {
    if (!isRouteFallbackError(error)) {
      throw error
    }

    const metrics = getEstimatedRouteMetrics(pickup, destination)
    log('Route metrics fallback enabled', {
      provider: 'osrm',
      phase: 'route',
      fallbackUsed: true,
      code: error.code,
      timedOut: error.timedOut ?? false,
    })

    return {
      metrics,
      routeAccuracy: 'estimated',
      routeWarning: ESTIMATED_ROUTE_WARNING,
    }
  }
}

async function fetchWithPolicy(url: string, policy: FetchPolicy): Promise<Response> {
  let lastError: unknown

  for (let attempt = 0; attempt <= policy.maxRetries; attempt++) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), policy.timeoutMs)
    const startedAt = Date.now()

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': API_CONFIG.USER_AGENT,
        },
      })

      clearTimeout(timeout)

      if (shouldRetryResponse(response)) {
        const elapsedMs = Date.now() - startedAt
        log('Upstream request retry scheduled', {
          provider: policy.provider,
          phase: policy.phase,
          attempt: attempt + 1,
          elapsedMs,
          timedOut: false,
          status: response.status,
          fallbackUsed: false,
        })

        if (attempt < policy.maxRetries) {
          await sleep(getBackoffDelay(policy.backoffMs, attempt))
          continue
        }
      }

      return response
    } catch (error) {
      clearTimeout(timeout)
      lastError = error

      const timedOut = isAbortError(error)
      const elapsedMs = Date.now() - startedAt
      log('Upstream request failed', {
        provider: policy.provider,
        phase: policy.phase,
        attempt: attempt + 1,
        elapsedMs,
        timedOut,
        fallbackUsed: false,
      })

      if (attempt < policy.maxRetries && isRetryableError(error)) {
        await sleep(getBackoffDelay(policy.backoffMs, attempt))
        continue
      }

      throw buildUpstreamError(policy, error, timedOut)
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Request failed after retries')
}

function shouldRetryResponse(response: Response): boolean {
  return response.status >= 500
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

function isRetryableError(error: unknown): boolean {
  return isAbortError(error) || error instanceof TypeError
}

function buildUpstreamError(
  policy: FetchPolicy,
  error: unknown,
  timedOut: boolean
): CompareServiceError {
  if (policy.phase === 'geocode') {
    return new CompareServiceError(
      timedOut ? 'GEOCODE_TIMEOUT' : 'GEOCODE_UNAVAILABLE',
      timedOut ? 'Geocoding provider timed out' : 'Geocoding provider is temporarily unavailable',
      {
        provider: policy.provider,
        phase: policy.phase,
        timedOut,
        cause: error,
      }
    )
  }

  return new CompareServiceError(
    timedOut ? 'ROUTE_TIMEOUT' : 'ROUTE_UNAVAILABLE',
    timedOut ? 'Routing provider timed out' : 'Routing provider is temporarily unavailable',
    {
      provider: policy.provider,
      phase: policy.phase,
      timedOut,
      cause: error,
    }
  )
}

function isRouteFallbackError(error: unknown): error is CompareServiceError {
  return (
    isCompareServiceError(error) &&
    (error.code === 'ROUTE_TIMEOUT' || error.code === 'ROUTE_UNAVAILABLE')
  )
}

function getRouteCacheKey(
  accuracy: RouteAccuracy,
  pickup: Coordinates,
  destination: Coordinates
): string {
  return `${accuracy}:${pickup[0]},${pickup[1]}-${destination[0]},${destination[1]}`
}

function getEstimatedRouteMetrics(pickup: Coordinates, destination: Coordinates): RouteMetrics {
  // Estimated metrics are computed synchronously via haversine — no network call required.
  // These are cheap to compute, so no caching is needed.
  const straightLineKm = haversineDistanceKm(pickup, destination)
  const roadFactor =
    straightLineKm < 3 ? 1.45 : straightLineKm < 10 ? 1.35 : straightLineKm < 30 ? 1.25 : 1.18
  const distanceKm = Math.max(0.8, Number((straightLineKm * roadFactor).toFixed(2)))
  const averageSpeedKmh = distanceKm < 5 ? 22 : distanceKm < 15 ? 28 : distanceKm < 40 ? 36 : 48
  const durationMin = Math.max(4, Number(((distanceKm / averageSpeedKmh) * 60 + 3).toFixed(1)))

  return {
    distanceKm,
    durationMin,
  }
}

async function sleep(ms: number): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, ms))
}

function getBackoffDelay(baseMs: number, attempt: number): number {
  return baseMs * (attempt + 1)
}

function buildRideResult(
  service: ServiceType,
  computation: PricingComputation,
  metrics: RouteMetrics
): RideResult {
  const surgeMultiplier = computation.breakdown.surgeMultiplier
  const waitMinutes = deriveWaitMinutes(service, surgeMultiplier, metrics.durationMin)
  const driversNearby = deriveDriversNearby(service, surgeMultiplier, metrics.distanceKm)

  return {
    price: formatCurrency(computation.price),
    waitTime: `${waitMinutes} min`,
    driversNearby,
    service: SERVICE_LABELS[service] as RideService,
    surgeMultiplier: surgeMultiplier > 1.05 ? `${surgeMultiplier.toFixed(2)}x` : undefined,
  }
}

function deriveWaitMinutes(
  service: ServiceType,
  surgeMultiplier: number,
  durationMin: number
): number {
  // Base wait times: Waymo has longer waits (7 min), Taxi moderate (6 min), rideshare fastest (4 min)
  const base = service === 'waymo' ? 7 : service === 'taxi' ? 6 : 4
  const demandPenalty =
    surgeMultiplier > 1.4 ? 3 : surgeMultiplier > 1.2 ? 2 : surgeMultiplier > 1.05 ? 1 : 0
  const tripComplexity = Math.min(4, Math.round(durationMin / 15))

  // Waymo has a higher max wait time (22 min) due to smaller fleet
  const maxWait = service === 'waymo' ? 22 : 18
  return Math.max(2, Math.min(maxWait, base + demandPenalty + tripComplexity))
}

function deriveDriversNearby(
  service: ServiceType,
  surgeMultiplier: number,
  distanceKm: number
): number {
  // Waymo has the smallest fleet (2 base), followed by taxi (3), lyft (4), uber (5)
  const baseDrivers = service === 'waymo' ? 2 : service === 'taxi' ? 3 : service === 'lyft' ? 4 : 5
  const surgePenalty = surgeMultiplier > 1.4 ? 2 : surgeMultiplier > 1.2 ? 1 : 0
  const distanceFactor = distanceKm > 30 ? 1 : 0

  return Math.max(1, baseDrivers - surgePenalty - distanceFactor)
}

function formatCurrency(amount: number): PriceString {
  return `$${amount.toFixed(2)}`
}

function generateRecommendation(results: ComparisonResults): string {
  const parsed = Object.entries(results).map(([service, result]) => ({
    service,
    price: parseFloat(result.price.replace('$', '')),
    wait: parseInt(result.waitTime.replace(' min', ''), 10),
  }))

  // Guard against empty results
  if (parsed.length === 0) {
    return 'No ride services available for this route.'
  }

  const scores = parsed.map(entry => ({
    service: entry.service,
    score: entry.price * 0.7 + entry.wait * 0.3,
    price: entry.price,
    wait: entry.wait,
  }))

  const best = scores.reduce((prev, curr) => (curr.score < prev.score ? curr : prev))
  const cheapest = scores.reduce((prev, curr) => (curr.price < prev.price ? curr : prev))
  const fastest = scores.reduce((prev, curr) => (curr.wait < prev.wait ? curr : prev))

  let recommendation = `Based on price and wait time, ${capitalise(best.service)} looks like the best overall choice.`

  if (best.service !== cheapest.service) {
    recommendation += ` ${capitalise(cheapest.service)} is the most budget-friendly ride today.`
  }

  if (best.service !== fastest.service) {
    recommendation += ` ${capitalise(fastest.service)} should arrive the quickest.`
  }

  return recommendation.trim()
}

function capitalise(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

interface OSRMResponse {
  code: string
  routes: Array<{
    distance: number
    duration: number
  }>
}
