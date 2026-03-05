/**
 * Route CRUD operations for the database layer.
 * Handles route creation, saving, and retrieval operations.
 */

import { prisma } from '@/lib/prisma'
import { createHash } from 'crypto'
import { encodeRouteGeohash, getDefaultPrecision } from '@/lib/geo'
import { isDatabaseAvailable, reportPersistenceError } from './database-logging'

// Re-export shared helpers for convenience
export { isDatabaseAvailable, reportPersistenceError }

/**
 * Generate route hash for uniqueness
 */
export function generateRouteHash(
  pickupLat: number,
  pickupLng: number,
  destLat: number,
  destLng: number
): string {
  const hash = createHash('sha256')
  hash.update(`${pickupLat},${pickupLng},${destLat},${destLng}`)
  return hash.digest('hex').substring(0, 16)
}

/**
 * Find or create a route in the database
 */
export async function findOrCreateRoute(
  pickupAddress: string,
  pickupCoords: [number, number],
  destAddress: string,
  destCoords: [number, number],
  distance?: number,
  duration?: number
): Promise<string | null> {
  if (!isDatabaseAvailable()) {
    const mockRouteId =
      `mock-route-${pickupCoords[0]}-${pickupCoords[1]}-${destCoords[0]}-${destCoords[1]}`.replace(
        /\./g,
        ''
      )
    return mockRouteId
  }

  try {
    const routeHash = generateRouteHash(
      pickupCoords[1],
      pickupCoords[0],
      destCoords[1],
      destCoords[0]
    )

    const pickupGeohash = encodeRouteGeohash(pickupCoords[0], pickupCoords[1])
    const destinationGeohash = encodeRouteGeohash(destCoords[0], destCoords[1])

    const route = await prisma.route.upsert({
      where: { route_hash: routeHash },
      update: {
        pickup_address: pickupAddress,
        destination_address: destAddress,
        distance_miles: distance,
        duration_minutes: duration,
      },
      create: {
        pickup_address: pickupAddress,
        pickup_lat: pickupCoords[1],
        pickup_lng: pickupCoords[0],
        destination_address: destAddress,
        destination_lat: destCoords[1],
        destination_lng: destCoords[0],
        distance_miles: distance,
        duration_minutes: duration,
        route_hash: routeHash,
        pickup_geohash: pickupGeohash,
        destination_geohash: destinationGeohash,
        geohash_precision: getDefaultPrecision(),
      },
      select: { id: true },
    })

    return route.id
  } catch (error) {
    reportPersistenceError('findOrCreateRoute', error)
    return null
  }
}

/**
 * Save a route for a user
 */
export async function saveRouteForUser(
  userId: string,
  routeId: string,
  nickname?: string
): Promise<boolean> {
  if (!isDatabaseAvailable()) {
    return true
  }

  try {
    // First, get the route to extract coordinates
    const route = await prisma.route.findUnique({
      where: { id: routeId },
      select: {
        pickup_address: true,
        pickup_lat: true,
        pickup_lng: true,
        destination_address: true,
        destination_lat: true,
        destination_lng: true,
      },
    })

    if (!route) {
      return false
    }

    await prisma.savedRoute.upsert({
      where: {
        userId_routeId: {
          userId,
          routeId,
        },
      },
      update: {
        fromName: route.pickup_address,
        fromLat: route.pickup_lat,
        fromLng: route.pickup_lng,
        toName: route.destination_address,
        toLat: route.destination_lat,
        toLng: route.destination_lng,
      },
      create: {
        userId,
        routeId,
        fromName: route.pickup_address,
        fromLat: route.pickup_lat,
        fromLng: route.pickup_lng,
        toName: route.destination_address,
        toLat: route.destination_lat,
        toLng: route.destination_lng,
      },
    })

    return true
  } catch (error) {
    reportPersistenceError('saveRouteForUser', error)
    return false
  }
}

/**
 * Get saved routes for a user
 */
export async function getSavedRoutesForUser(userId: string) {
  if (!isDatabaseAvailable()) {
    return []
  }

  try {
    const savedRoutes = await prisma.savedRoute.findMany({
      where: { userId },
      include: {
        route: {
          select: {
            id: true,
            pickup_address: true,
            destination_address: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    })

    return savedRoutes.map(sr => ({
      id: sr.id,
      routeId: sr.routeId,
      fromName: sr.fromName,
      toName: sr.toName,
      createdAt: sr.createdAt,
      route: sr.route,
    }))
  } catch (error) {
    reportPersistenceError('getSavedRoutesForUser', error)
    return []
  }
}
