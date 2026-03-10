import geohash from 'ngeohash'

/**
 * ROUTE_GEOHASH_PRECISION: Controls the storage precision for route geohashes.
 * Higher precision = smaller geographic cells = more accurate route matching.
 *
 * Precision reference:
 *   8 = ~38m × 19m cells (default, good for exact route matching)
 *   7 = ~153m × 153m cells
 *   6 = ~1.2km × 0.6km cells (used for cluster queries via CLUSTER_GEOHASH_PRECISION)
 *   5 = ~4.9km × 4.9km cells
 *
 * Routes are stored at max precision (8) to support querying at any lower precision
 * by using prefix matching (e.g., geohash.startsWith(prefix)).
 *
 * See also: CLUSTER_GEOHASH_PRECISION in lib/database.ts for query-time precision.
 */
const DEFAULT_GEOHASH_PRECISION = Number(process.env.ROUTE_GEOHASH_PRECISION ?? 8)
const MIN_SAMPLES_THRESHOLD = 8

export { MIN_SAMPLES_THRESHOLD }

/**
 * Encode coordinates to a geohash string for route storage.
 * Note: ngeohash expects (lat, lng) order, but our API uses (lng, lat) format.
 */
export function encodeRouteGeohash(
  lng: number,
  lat: number,
  precision: number = DEFAULT_GEOHASH_PRECISION
): string {
  return geohash.encode(lat, lng, precision)
}

export function decodeGeohash(hash: string): { lat: number; lng: number } {
  const { latitude, longitude } = geohash.decode(hash)
  return { lat: latitude, lng: longitude }
}

export function getGeohashNeighbors(hash: string): string[] {
  return geohash.neighbors(hash)
}

export function getGeohashPrefix(hash: string, precision: number): string {
  return hash.slice(0, precision)
}

/**
 * Get geohash prefixes for a location and its 8 neighbors.
 * Returns 9 prefixes total (center + N, NE, E, SE, S, SW, W, NW).
 * Used for cluster queries to expand the search area.
 */
export function getNeighborPrefixes(hash: string, precision: number): string[] {
  const prefix = getGeohashPrefix(hash, precision)
  const neighbors = geohash.neighbors(prefix)
  return [prefix, ...neighbors]
}

/**
 * Get the default storage precision for route geohashes.
 * This is the precision used when storing new routes.
 */
export function getDefaultPrecision(): number {
  return DEFAULT_GEOHASH_PRECISION
}

/**
 * Calculate the great-circle distance between two [lon, lat] coordinates
 * using the Haversine formula. Returns distance in kilometers.
 */
export function haversineDistanceKm(from: [number, number], to: [number, number]): number {
  const toRadians = (value: number) => (value * Math.PI) / 180
  const [fromLon, fromLat] = from
  const [toLon, toLat] = to

  const deltaLat = toRadians(toLat - fromLat)
  const deltaLon = toRadians(toLon - fromLon)
  const originLat = toRadians(fromLat)
  const destinationLat = toRadians(toLat)

  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(originLat) * Math.cos(destinationLat) * Math.sin(deltaLon / 2) ** 2
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))

  return 6371 * c
}
