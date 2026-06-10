/**
 * Pricing calibration service.
 *
 * Closes the loop between estimated and actual fares: RideHistory rows where
 * users recorded the final fare are aggregated into per-service multiplicative
 * factors, which the PricingEngine applies to its estimates. The static
 * pricing-config.json stays the model; this layer corrects its drift with
 * real observed data instead of manual config edits.
 *
 * Robustness over cleverness:
 * - median ratio (not mean) so a single bad entry can't drag the factor
 * - ratios outside sanity bounds are discarded (typos like $250 vs $25)
 * - a service needs MIN_SAMPLE_SIZE usable observations or it stays at 1.0
 * - factors are clamped so calibration can refine estimates, never rewrite them
 */

import { prisma } from '@/lib/prisma'
import { getCached, clearCacheNamespace } from '@/lib/cache/redis-cache'
import { isDatabaseAvailable, reportPersistenceError } from '@/lib/database-logging'
import { mapEnumToService, type ServiceName } from '@/lib/service-mappings'

export interface CalibrationFactor {
  /** Multiplicative adjustment applied to engine estimates (1 = no change). */
  factor: number
  /** Number of usable estimated-vs-final observations behind the factor. */
  sampleSize: number
  /** Median finalFare/estimatedFare ratio before clamping (for observability). */
  medianRatio: number
}

export type CalibrationFactors = Partial<Record<ServiceName, CalibrationFactor>>

export const CALIBRATION_LOOKBACK_DAYS = 90
export const CALIBRATION_MIN_SAMPLE_SIZE = 5
export const CALIBRATION_FACTOR_MIN = 0.85
export const CALIBRATION_FACTOR_MAX = 1.2
/** Observations beyond these bounds are data-entry noise, not market signal. */
const RATIO_SANITY_MIN = 0.25
const RATIO_SANITY_MAX = 4

const CALIBRATION_CACHE_KEY = 'calibration:service-factors'
const CALIBRATION_CACHE_TTL_SECONDS = 6 * 60 * 60

function median(sorted: number[]): number {
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

/**
 * Aggregate RideHistory into per-service calibration factors.
 * Returns {} (no calibration) when the database is unavailable or errors —
 * estimates then pass through uncorrected, which is always a safe state.
 */
export async function computeCalibrationFactors(): Promise<CalibrationFactors> {
  if (!isDatabaseAvailable()) {
    return {}
  }

  try {
    const since = new Date(Date.now() - CALIBRATION_LOOKBACK_DAYS * 24 * 60 * 60 * 1000)
    const rows = await prisma.rideHistory.findMany({
      where: {
        finalFare: { not: null, gt: 0 },
        estimatedFare: { gt: 0 },
        requestedAt: { gte: since },
      },
      select: { service: true, estimatedFare: true, finalFare: true },
    })

    const ratiosByService = new Map<ServiceName, number[]>()
    for (const row of rows) {
      const ratio = row.finalFare! / row.estimatedFare
      if (ratio < RATIO_SANITY_MIN || ratio > RATIO_SANITY_MAX) continue

      const service = mapEnumToService(row.service)
      if (!ratiosByService.has(service)) {
        ratiosByService.set(service, [])
      }
      ratiosByService.get(service)!.push(ratio)
    }

    const factors: CalibrationFactors = {}
    for (const [service, ratios] of Array.from(ratiosByService.entries())) {
      if (ratios.length < CALIBRATION_MIN_SAMPLE_SIZE) continue

      const medianRatio = median(ratios.sort((a, b) => a - b))
      factors[service] = {
        factor: Number(
          clamp(medianRatio, CALIBRATION_FACTOR_MIN, CALIBRATION_FACTOR_MAX).toFixed(3)
        ),
        sampleSize: ratios.length,
        medianRatio: Number(medianRatio.toFixed(3)),
      }
    }

    return factors
  } catch (error) {
    reportPersistenceError('computeCalibrationFactors', error)
    return {}
  }
}

/**
 * Cached accessor used on the comparison hot path. Two-tier cached (L1 + Redis)
 * so the RideHistory aggregation runs at most once per TTL per instance.
 */
export async function getCalibrationFactors(): Promise<CalibrationFactors> {
  const { value } = await getCached<CalibrationFactors>(
    CALIBRATION_CACHE_KEY,
    CALIBRATION_CACHE_TTL_SECONDS,
    computeCalibrationFactors
  )
  return value
}

/** Test hook — clears the L1 calibration cache. */
export function resetCalibrationCache(): void {
  clearCacheNamespace('calibration')
}
