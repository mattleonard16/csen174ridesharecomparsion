/**
 * Price trends query functions for the database layer.
 * Provides enriched price snapshot data and aggregated summary stats
 * for the /api/price-trends and /api/price-trends/summary endpoints.
 */

import { prisma } from '@/lib/prisma'
import { isDatabaseAvailable, reportPersistenceError } from './database-logging'
import { mapEnumToService, type RideServiceName, RIDE_SERVICE_NAMES } from './service-mappings'

// ============================================================================
// Types
// ============================================================================

export interface PriceTrendSnapshot {
  id: string
  timestamp: string
  service: RideServiceName
  basePrice: number
  surgeMultiplier: number
  finalPrice: number
  waitTimeMinutes: number | null
  dayOfWeek: number
  hourOfDay: number
  weatherCondition: string | null
  weatherTempF: number | null
  isRaining: boolean
  trafficLevel: string | null
  nearbyEvents: string[]
  isHoliday: boolean
  confidence: number | null
}

export interface ServiceSummary {
  service: RideServiceName
  avgPrice: number
  minPrice: number
  maxPrice: number
  cheapestHour: number
  surgeProbabilityByHour: { hour: number; probability: number }[]
  priceByDayOfWeek: { day: number; avgPrice: number }[]
  sampleSize: number
}

export interface PriceTrendsSummary {
  routeId: string
  daysBack: number
  services: ServiceSummary[]
}

// ============================================================================
// Query Functions
// ============================================================================

/**
 * Get enriched price trend snapshots for a route.
 * Returns full PriceSnapshot fields (not just the 5 fields from getRoutePriceHistory).
 * Optionally filter by service and control the lookback window.
 */
export async function getPriceTrendSnapshots(
  routeId: string,
  options?: {
    service?: RideServiceName
    daysBack?: number
  }
): Promise<PriceTrendSnapshot[]> {
  if (!isDatabaseAvailable()) {
    return []
  }

  try {
    const daysBack = options?.daysBack ?? 7
    const cutoff = new Date(Date.now() - daysBack * 86_400_000)

    const where: Record<string, unknown> = {
      routeId,
      createdAt: { gte: cutoff },
    }

    if (options?.service) {
      const { mapServiceToEnum } = await import('./service-mappings')
      where.service = mapServiceToEnum(options.service)
    }

    const snapshots = await prisma.priceSnapshot.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 2000,
    })

    return snapshots.map(s => ({
      id: s.id,
      timestamp: s.createdAt.toISOString(),
      service: mapEnumToService(s.service) as RideServiceName,
      basePrice: s.base_price,
      surgeMultiplier: s.surge_multiplier,
      finalPrice: s.final_price,
      waitTimeMinutes: s.wait_time_minutes,
      dayOfWeek: s.day_of_week,
      hourOfDay: s.hour_of_day,
      weatherCondition: s.weather_condition,
      weatherTempF: s.weather_temp_f,
      isRaining: s.is_raining,
      trafficLevel: s.traffic_level?.toLowerCase() ?? null,
      nearbyEvents: s.nearby_events,
      isHoliday: s.is_holiday,
      confidence: s.confidence,
    }))
  } catch (error) {
    reportPersistenceError('getPriceTrendSnapshots', error)
    return []
  }
}

/**
 * Get aggregated price trend summary for a route, broken down by service.
 * Returns per-service stats including avgPrice, minPrice, maxPrice,
 * cheapestHour, surgeProbabilityByHour, and priceByDayOfWeek.
 */
export async function getPriceTrendsSummary(
  routeId: string,
  daysBack: number = 7
): Promise<PriceTrendsSummary> {
  const empty: PriceTrendsSummary = { routeId, daysBack, services: [] }

  if (!isDatabaseAvailable()) {
    return empty
  }

  try {
    const cutoff = new Date(Date.now() - daysBack * 86_400_000)

    const snapshots = await prisma.priceSnapshot.findMany({
      where: {
        routeId,
        createdAt: { gte: cutoff },
      },
      orderBy: { createdAt: 'desc' },
      take: 5000,
    })

    if (snapshots.length === 0) {
      return empty
    }

    // Group by service
    const grouped = new Map<string, (typeof snapshots)[number][]>()

    for (const s of snapshots) {
      const serviceKey = mapEnumToService(s.service) as RideServiceName
      const existing = grouped.get(serviceKey) ?? []
      existing.push(s)
      grouped.set(serviceKey, existing)
    }

    const services: ServiceSummary[] = []

    for (const [serviceName, records] of Array.from(grouped.entries())) {
      const prices = records.map((r: (typeof records)[number]) => r.final_price)
      const avgPrice = prices.reduce((a: number, b: number) => a + b, 0) / prices.length
      const minPrice = Math.min(...prices)
      const maxPrice = Math.max(...prices)

      // Find cheapest hour (lowest average price by hour)
      const byHour = new Map<number, { sum: number; count: number }>()
      for (const r of records) {
        const existing = byHour.get(r.hour_of_day) ?? { sum: 0, count: 0 }
        byHour.set(r.hour_of_day, {
          sum: existing.sum + r.final_price,
          count: existing.count + 1,
        })
      }

      let cheapestHour = 0
      let cheapestAvg = Infinity
      for (const [hour, { sum, count }] of Array.from(byHour.entries())) {
        const avg = sum / count
        if (avg < cheapestAvg) {
          cheapestAvg = avg
          cheapestHour = hour
        }
      }

      // Surge probability by hour (fraction of snapshots with surge > 1)
      const surgeByHour = new Map<number, { total: number; surge: number }>()
      for (const r of records) {
        const existing = surgeByHour.get(r.hour_of_day) ?? { total: 0, surge: 0 }
        surgeByHour.set(r.hour_of_day, {
          total: existing.total + 1,
          surge: existing.surge + (r.surge_multiplier > 1 ? 1 : 0),
        })
      }

      const surgeProbabilityByHour: ServiceSummary['surgeProbabilityByHour'] = []
      for (let hour = 0; hour < 24; hour++) {
        const data = surgeByHour.get(hour)
        surgeProbabilityByHour.push({
          hour,
          probability: data ? data.surge / data.total : 0,
        })
      }

      // Price by day of week
      const byDay = new Map<number, { sum: number; count: number }>()
      for (const r of records) {
        const existing = byDay.get(r.day_of_week) ?? { sum: 0, count: 0 }
        byDay.set(r.day_of_week, {
          sum: existing.sum + r.final_price,
          count: existing.count + 1,
        })
      }

      const priceByDayOfWeek: ServiceSummary['priceByDayOfWeek'] = []
      for (let day = 0; day < 7; day++) {
        const data = byDay.get(day)
        priceByDayOfWeek.push({
          day,
          avgPrice: data ? data.sum / data.count : 0,
        })
      }

      services.push({
        service: serviceName as RideServiceName,
        avgPrice: Math.round(avgPrice * 100) / 100,
        minPrice,
        maxPrice,
        cheapestHour,
        surgeProbabilityByHour,
        priceByDayOfWeek,
        sampleSize: records.length,
      })
    }

    // Sort services in a consistent order
    const serviceOrder = [...RIDE_SERVICE_NAMES]
    services.sort((a, b) => serviceOrder.indexOf(a.service) - serviceOrder.indexOf(b.service))

    return { routeId, daysBack, services }
  } catch (error) {
    reportPersistenceError('getPriceTrendsSummary', error)
    return empty
  }
}
