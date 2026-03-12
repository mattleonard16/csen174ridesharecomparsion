/**
 * Snapshot and search logging operations.
 * Handles price snapshots, search logs, weather data, and price alerts.
 */

import { prisma } from '@/lib/prisma'
import { $Enums, type ServiceType, type TrafficLevel, type AlertType } from '@/lib/generated/prisma'
import {
  mapServiceToEnum,
  mapServiceToEnumWithAny,
  type RideServiceName,
  type ServiceName,
} from '@/lib/service-mappings'
import type { ComparisonResults } from '@/types'

const TrafficLevelEnum = $Enums.TrafficLevel
const AlertTypeEnum = $Enums.AlertType

// Re-export mapServiceToEnum for backward compatibility
export { mapServiceToEnum }

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Check if database is available
 * In production, throws an error if DATABASE_URL is missing (unless ALLOW_DB_MOCK is set)
 */
export const isDatabaseAvailable = (): boolean => {
  const hasDb = !!process.env.DATABASE_URL

  if (!hasDb && process.env.NODE_ENV === 'production' && !process.env.ALLOW_DB_MOCK) {
    throw new Error(
      'DATABASE_URL is required in production. Set ALLOW_DB_MOCK=true to bypass (not recommended).'
    )
  }

  return hasDb
}

/**
 * Report a persistence error to monitoring (Axiom/Sentry if configured)
 */
export function reportPersistenceError(operation: string, error: unknown): void {
  const errorMessage = error instanceof Error ? error.message : String(error)

  // Forward to Axiom if configured
  if (process.env.AXIOM_TOKEN && process.env.AXIOM_DATASET) {
    // Fire-and-forget log to Axiom
    fetch(`https://api.axiom.co/v1/datasets/${process.env.AXIOM_DATASET}/ingest`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.AXIOM_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify([
        {
          _time: new Date().toISOString(),
          level: 'error',
          operation,
          error: errorMessage,
          service: 'rideshare-db',
        },
      ]),
    }).catch(() => {
      // Silently ignore Axiom errors to avoid cascade
    })
  }
}

// ============================================================================
// Logging Functions
// ============================================================================

/**
 * Log a price snapshot
 */
export async function logPriceSnapshot(
  routeId: string,
  service: RideServiceName,
  price: number,
  surge: number = 1.0,
  waitTime?: number,
  factors?: {
    weather?: string
    temperature?: number
    isRaining?: boolean
    trafficLevel?: 'light' | 'moderate' | 'heavy' | 'severe'
    nearbyEvents?: string[]
  }
): Promise<void> {
  if (!isDatabaseAvailable()) {
    return
  }

  try {
    const now = new Date()

    const serviceType = mapServiceToEnum(service)

    // Map traffic level string to TrafficLevel enum
    let trafficLevel: TrafficLevel | null = null
    if (factors?.trafficLevel) {
      switch (factors.trafficLevel) {
        case 'light':
          trafficLevel = TrafficLevelEnum.LIGHT
          break
        case 'moderate':
          trafficLevel = TrafficLevelEnum.MODERATE
          break
        case 'heavy':
          trafficLevel = TrafficLevelEnum.HEAVY
          break
        case 'severe':
          trafficLevel = TrafficLevelEnum.SEVERE
          break
      }
    }

    await prisma.priceSnapshot.create({
      data: {
        routeId,
        service: serviceType,
        base_price: price / surge,
        surge_multiplier: surge,
        final_price: price,
        wait_time_minutes: waitTime,
        day_of_week: now.getUTCDay(),
        hour_of_day: now.getUTCHours(),
        weather_condition: factors?.weather,
        weather_temp_f: factors?.temperature,
        is_raining: factors?.isRaining || false,
        traffic_level: trafficLevel,
        nearby_events: factors?.nearbyEvents || [],
      },
    })
  } catch (error) {
    reportPersistenceError('logPriceSnapshot', error)
  }
}

/**
 * Log a search
 */
export async function logSearch(
  routeId: string | null,
  userId: string | null,
  results: ComparisonResults,
  sessionId?: string
): Promise<void> {
  if (!isDatabaseAvailable()) {
    return
  }

  try {
    await prisma.searchLog.create({
      data: {
        routeId: routeId || undefined,
        userId: userId || undefined,
        session_id: sessionId,
        // Cast to satisfy Prisma's InputJsonValue — ComparisonResults is JSON-serializable
        results_shown: results as never,
        user_agent: typeof window !== 'undefined' ? window.navigator.userAgent : null,
      },
    })
  } catch (error) {
    reportPersistenceError('logSearch', error)
  }
}

/**
 * Log weather data
 */
export async function logWeatherData(
  coords: [number, number],
  weatherData: {
    temperature: number
    condition: string
    precipitation?: number
    windSpeed?: number
    visibility?: number
    rawData?: unknown
  }
): Promise<void> {
  if (!isDatabaseAvailable()) {
    return
  }

  try {
    await prisma.weatherLog.create({
      data: {
        coords_lat: coords[1],
        coords_lng: coords[0],
        temperature_f: weatherData.temperature,
        condition: weatherData.condition,
        precipitation_inch: weatherData.precipitation,
        wind_speed_mph: weatherData.windSpeed,
        visibility_miles: weatherData.visibility,
        is_severe:
          weatherData.condition.toLowerCase().includes('storm') ||
          weatherData.condition.toLowerCase().includes('severe'),
        // Cast to satisfy Prisma's InputJsonValue — rawData is an opaque blob passed directly to DB
        raw_data: weatherData.rawData as never,
      },
    })
  } catch (error) {
    reportPersistenceError('logWeatherData', error)
  }
}

// ============================================================================
// Query Functions
// ============================================================================

/**
 * Get route price history
 */
export async function getRoutePriceHistory(routeId: string, daysBack: number = 7) {
  if (!isDatabaseAvailable()) {
    return []
  }

  try {
    const cutoffDate = new Date()
    cutoffDate.setDate(cutoffDate.getDate() - daysBack)

    const snapshots = await prisma.priceSnapshot.findMany({
      where: {
        routeId,
        createdAt: {
          gte: cutoffDate,
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
      select: {
        createdAt: true,
        service: true,
        final_price: true,
        surge_multiplier: true,
        weather_condition: true,
      },
    })

    return snapshots.map(
      (snapshot: {
        createdAt: Date
        service: string
        final_price: number
        surge_multiplier: number
        weather_condition: string | null
      }) => ({
        timestamp: snapshot.createdAt.toISOString(),
        service_type: snapshot.service.toLowerCase(),
        final_price: snapshot.final_price,
        surge_multiplier: snapshot.surge_multiplier,
        weather_condition: snapshot.weather_condition,
      })
    )
  } catch (error) {
    reportPersistenceError('getRoutePriceHistory', error)
    return []
  }
}

/**
 * Get average prices by hour for a route
 */
export async function getHourlyPriceAverage(routeId: string, service: RideServiceName) {
  if (!isDatabaseAvailable()) {
    return []
  }

  try {
    const serviceType = mapServiceToEnum(service)

    // Get snapshots for this route and service
    const snapshots = await prisma.priceSnapshot.findMany({
      where: {
        routeId,
        service: serviceType,
      },
      select: {
        hour_of_day: true,
        final_price: true,
      },
    })

    // Group by hour and calculate average using reduce for immutability
    const hourlyData = snapshots.reduce(
      (acc: Record<number, { sum: number; count: number }>, snapshot) => {
        const hour = snapshot.hour_of_day
        const existing = acc[hour] || { sum: 0, count: 0 }
        return {
          ...acc,
          [hour]: {
            sum: existing.sum + snapshot.final_price,
            count: existing.count + 1,
          },
        }
      },
      {}
    )

    // Convert to array format
    return Object.entries(hourlyData)
      .map(([hour, data]) => ({
        hour: parseInt(hour, 10),
        avg_price: data.sum / data.count,
      }))
      .sort((a, b) => a.hour - b.hour)
  } catch (error) {
    reportPersistenceError('getHourlyPriceAverage', error)
    return []
  }
}

// ============================================================================
// Price Alert Functions
// ============================================================================

/**
 * Create a price alert
 */
export async function createPriceAlert(
  userId: string,
  routeId: string,
  targetPrice: number,
  service: ServiceName = 'any',
  alertType: 'below' | 'above' = 'below'
) {
  if (!isDatabaseAvailable()) {
    return null
  }

  try {
    // First, get or create a saved route
    const route = await prisma.route.findUnique({
      where: { id: routeId },
    })

    if (!route) {
      return null
    }

    // Find or create saved route using composite key
    let savedRoute = routeId
      ? await prisma.savedRoute.findUnique({
          where: { userId_routeId: { userId, routeId } },
        })
      : null

    if (!savedRoute && routeId) {
      savedRoute = await prisma.savedRoute.create({
        data: {
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
    }

    const serviceType: ServiceType = mapServiceToEnumWithAny(service)

    const alertTypeValue: AlertType =
      alertType === 'above' ? AlertTypeEnum.ABOVE : AlertTypeEnum.BELOW

    if (!savedRoute) {
      return null
    }

    const alert = await prisma.priceAlert.create({
      data: {
        userId,
        savedRouteId: savedRoute.id,
        service: serviceType,
        alertType: alertTypeValue,
        targetPrice,
      },
    })

    return alert
  } catch (error) {
    reportPersistenceError('createPriceAlert', error)
    return null
  }
}
