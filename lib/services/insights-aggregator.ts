/**
 * Insights Aggregator Service
 *
 * Aggregates PriceSnapshot data into RouteInsights for fast querying.
 * Pre-computes hourly averages, surge probabilities, and cheapest service
 * for each route+service combination.
 */

import { prisma } from '@/lib/prisma'
import { type ServiceType } from '@/lib/generated/prisma'
import { RIDE_SERVICE_NAMES, mapServiceToEnum } from '@/lib/service-mappings'
import { computeStats } from '@/lib/database-pricing-stats'

const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000 // 24 hours
const DEFAULT_DAYS_BACK = 30
const MIN_SAMPLES_FOR_INSIGHTS = 5

interface HourlyBucket {
  prices: number[]
  surgeCount: number
  totalCount: number
}

/**
 * Aggregate PriceSnapshot data into RouteInsights for a single route+service.
 * Groups snapshots by hour_of_day and computes stats.
 */
export async function aggregateRouteInsights(
  routeId: string,
  service: ServiceType,
  daysBack: number = DEFAULT_DAYS_BACK
): Promise<void> {
  const since = new Date()
  since.setDate(since.getDate() - daysBack)

  const snapshots = await prisma.priceSnapshot.findMany({
    where: {
      routeId,
      service,
      createdAt: { gte: since },
    },
    select: {
      final_price: true,
      hour_of_day: true,
      surge_multiplier: true,
    },
    orderBy: { createdAt: 'desc' },
    take: 5000,
  })

  if (snapshots.length < MIN_SAMPLES_FOR_INSIGHTS) {
    return
  }

  // Group by hour
  const hourlyBuckets: Record<number, HourlyBucket> = {}
  for (let h = 0; h < 24; h++) {
    hourlyBuckets[h] = { prices: [], surgeCount: 0, totalCount: 0 }
  }

  for (const snap of snapshots) {
    const bucket = hourlyBuckets[snap.hour_of_day]
    bucket.prices.push(snap.final_price)
    bucket.totalCount += 1
    if (snap.surge_multiplier > 1.1) {
      bucket.surgeCount += 1
    }
  }

  // Compute avg price by hour and surge probability by hour
  const avgPriceByHour: Record<string, number> = {}
  const surgeProbabilityByHour: Record<string, number> = {}
  let cheapestHour = 0
  let cheapestAvgPrice = Infinity
  let expensiveHour = 0
  let expensiveAvgPrice = 0

  for (let h = 0; h < 24; h++) {
    const bucket = hourlyBuckets[h]
    if (bucket.prices.length > 0) {
      const stats = computeStats(bucket.prices)
      avgPriceByHour[String(h)] = stats.avg

      if (stats.avg < cheapestAvgPrice) {
        cheapestAvgPrice = stats.avg
        cheapestHour = h
      }
      if (stats.avg > expensiveAvgPrice) {
        expensiveAvgPrice = stats.avg
        expensiveHour = h
      }
    }

    if (bucket.totalCount > 0) {
      surgeProbabilityByHour[String(h)] = Number((bucket.surgeCount / bucket.totalCount).toFixed(2))
    }
  }

  // Determine cheapest service across all services for this route
  const allServiceAvgs = await prisma.priceSnapshot.groupBy({
    by: ['service'],
    where: {
      routeId,
      createdAt: { gte: since },
    },
    _avg: { final_price: true },
  })

  let cheapestService: string | null = null
  let cheapestServiceAvg = Infinity
  for (const row of allServiceAvgs) {
    const avg = row._avg.final_price
    if (avg !== null && avg < cheapestServiceAvg) {
      cheapestServiceAvg = avg
      cheapestService = row.service
    }
  }

  // Upsert into RouteInsights
  await prisma.routeInsights.upsert({
    where: {
      routeId_service: { routeId, service },
    },
    create: {
      routeId,
      service,
      cheapestHour,
      cheapestAvgPrice: cheapestAvgPrice === Infinity ? 0 : cheapestAvgPrice,
      expensiveHour,
      expensiveAvgPrice,
      avgPriceByHour,
      surgeProbabilityByHour,
      cheapestService,
      sampleSize: snapshots.length,
      lastUpdated: new Date(),
    },
    update: {
      cheapestHour,
      cheapestAvgPrice: cheapestAvgPrice === Infinity ? 0 : cheapestAvgPrice,
      expensiveHour,
      expensiveAvgPrice,
      avgPriceByHour,
      surgeProbabilityByHour,
      cheapestService,
      sampleSize: snapshots.length,
      lastUpdated: new Date(),
    },
  })
}

/**
 * Aggregate insights for all active routes (routes with recent PriceSnapshots).
 * Intended to be called by the nightly cron job.
 */
export async function aggregateAllActiveRoutes(
  daysBack: number = DEFAULT_DAYS_BACK
): Promise<{ processed: number; errors: number }> {
  const since = new Date()
  since.setDate(since.getDate() - daysBack)

  // Find routes with recent snapshots
  const activeRoutes = await prisma.priceSnapshot.groupBy({
    by: ['routeId'],
    where: { createdAt: { gte: since } },
    _count: { routeId: true },
    having: { routeId: { _count: { gte: MIN_SAMPLES_FOR_INSIGHTS } } },
  })

  let processed = 0
  let errors = 0

  for (const { routeId } of activeRoutes) {
    for (const serviceName of RIDE_SERVICE_NAMES) {
      try {
        const serviceEnum = mapServiceToEnum(serviceName)
        await aggregateRouteInsights(routeId, serviceEnum, daysBack)
        processed++
      } catch (error) {
        console.warn(`Failed to aggregate insights for route ${routeId}/${serviceName}:`, error)
        errors++
      }
    }
  }

  return { processed, errors }
}

/**
 * Get or compute insights for a route+service.
 * Returns cached RouteInsights if fresh (<24h), otherwise recomputes.
 */
export async function getOrComputeInsights(
  routeId: string,
  service: ServiceType
): Promise<{
  cheapestHour: number
  cheapestAvgPrice: number
  expensiveHour: number
  expensiveAvgPrice: number
  avgPriceByHour: Record<string, number>
  surgeProbabilityByHour: Record<string, number>
  cheapestService: string | null
  sampleSize: number
} | null> {
  // Check for existing fresh insights
  const existing = await prisma.routeInsights.findUnique({
    where: {
      routeId_service: { routeId, service },
    },
  })

  if (existing) {
    const age = Date.now() - existing.lastUpdated.getTime()
    if (age < STALE_THRESHOLD_MS) {
      return {
        cheapestHour: existing.cheapestHour,
        cheapestAvgPrice: existing.cheapestAvgPrice,
        expensiveHour: existing.expensiveHour,
        expensiveAvgPrice: existing.expensiveAvgPrice,
        avgPriceByHour: existing.avgPriceByHour as Record<string, number>,
        surgeProbabilityByHour: existing.surgeProbabilityByHour as Record<string, number>,
        cheapestService: existing.cheapestService,
        sampleSize: existing.sampleSize,
      }
    }
  }

  // Recompute on-demand
  try {
    await aggregateRouteInsights(routeId, service)
    const fresh = await prisma.routeInsights.findUnique({
      where: {
        routeId_service: { routeId, service },
      },
    })

    if (!fresh) return null

    return {
      cheapestHour: fresh.cheapestHour,
      cheapestAvgPrice: fresh.cheapestAvgPrice,
      expensiveHour: fresh.expensiveHour,
      expensiveAvgPrice: fresh.expensiveAvgPrice,
      avgPriceByHour: fresh.avgPriceByHour as Record<string, number>,
      surgeProbabilityByHour: fresh.surgeProbabilityByHour as Record<string, number>,
      cheapestService: fresh.cheapestService,
      sampleSize: fresh.sampleSize,
    }
  } catch (error) {
    console.warn('Failed to compute insights on-demand:', error)
    return null
  }
}
