/**
 * Ride history CRUD operations for the database layer.
 * Handles creation, retrieval, update, and deletion of user ride history records.
 */

import { Prisma } from '@/lib/generated/prisma'
import { prisma } from '@/lib/prisma'
import { isDatabaseAvailable, reportPersistenceError } from './database-logging'
import { mapServiceToEnum, mapEnumToService } from './service-mappings'
import type {
  ServiceType,
  RideHistoryEntry,
  RideHistoryListResponse,
  RideHistoryStats,
  ComparisonResults,
} from '@/types'

// ============================================================================
// Input Types
// ============================================================================

interface CreateRideHistoryInput {
  userId: string
  routeId?: string
  savedRouteId?: string
  service: ServiceType
  estimatedFare: number
  waitTimeMinutes?: number
  surgeMultiplier?: number
  comparisonSnapshot: ComparisonResults
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Parse a price string like "$24.50" into a number, returning 0 on failure.
 */
function parsePriceValue(price: string): number {
  const parsed = parseFloat(price.replace('$', ''))
  return isNaN(parsed) ? 0 : parsed
}

/**
 * Map a raw Prisma rideHistory record to a RideHistoryEntry response shape.
 */
function mapToEntry(record: {
  id: string
  routeId: string | null
  service: string
  estimatedFare: number
  finalFare: number | null
  waitTimeMinutes: number | null
  surgeMultiplier: number | null
  comparisonSnapshot: unknown
  requestedAt: Date
  updatedAt: Date
  route?: { pickup_address: string; destination_address: string } | null
}): RideHistoryEntry {
  return {
    id: record.id,
    routeId: record.routeId,
    service: mapEnumToService(record.service as never) as ServiceType,
    estimatedFare: record.estimatedFare,
    finalFare: record.finalFare,
    waitTimeMinutes: record.waitTimeMinutes,
    surgeMultiplier: record.surgeMultiplier,
    comparisonSnapshot: record.comparisonSnapshot as ComparisonResults,
    requestedAt: record.requestedAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    pickupAddress: record.route?.pickup_address,
    destinationAddress: record.route?.destination_address,
  }
}

// ============================================================================
// Write Operations
// ============================================================================

/**
 * Create a ride history entry for a user.
 * Returns the new record's id, or null if the DB is unavailable or an error occurs.
 */
export async function createRideHistory(
  data: CreateRideHistoryInput
): Promise<{ id: string } | null> {
  if (!isDatabaseAvailable()) {
    return null
  }

  try {
    const serviceEnum = mapServiceToEnum(data.service)

    const record = await prisma.rideHistory.create({
      data: {
        userId: data.userId,
        routeId: data.routeId,
        savedRouteId: data.savedRouteId,
        service: serviceEnum,
        estimatedFare: data.estimatedFare,
        waitTimeMinutes: data.waitTimeMinutes,
        surgeMultiplier: data.surgeMultiplier,
        // Cast to satisfy Prisma's InputJsonValue — ComparisonResults is JSON-serializable
        comparisonSnapshot: data.comparisonSnapshot as never,
      },
      select: { id: true },
    })

    return { id: record.id }
  } catch (error) {
    reportPersistenceError('createRideHistory', error)
    return null
  }
}

// ============================================================================
// Read Operations
// ============================================================================

/**
 * Get paginated ride history for a user.
 * Uses cursor-based pagination ordered by requestedAt DESC.
 * Total count is only fetched on the first page (no cursor).
 */
export async function getRideHistoryForUser(
  userId: string,
  cursor?: string,
  limit: number = 20
): Promise<RideHistoryListResponse> {
  const emptyResponse: RideHistoryListResponse = { history: [], nextCursor: null, total: 0 }

  if (!isDatabaseAvailable()) {
    return emptyResponse
  }

  try {
    const records = await prisma.rideHistory.findMany({
      where: { userId },
      orderBy: { requestedAt: 'desc' },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: {
        route: {
          select: {
            pickup_address: true,
            destination_address: true,
          },
        },
      },
    })

    const hasNextPage = records.length > limit
    const page = hasNextPage ? records.slice(0, limit) : records
    const nextCursor = hasNextPage ? (page[page.length - 1]?.id ?? null) : null

    const total = cursor ? 0 : await prisma.rideHistory.count({ where: { userId } })

    const history = page.map(mapToEntry)

    return { history, nextCursor, total }
  } catch (error) {
    reportPersistenceError('getRideHistoryForUser', error)
    return emptyResponse
  }
}

/**
 * Compute spending analytics for a user's ride history within the last N days.
 */
export async function getRideHistoryStats(
  userId: string,
  daysBack: number = 30
): Promise<RideHistoryStats> {
  const emptyStats: RideHistoryStats = {
    totalSpent: 0,
    rideCount: 0,
    avgFare: 0,
    byService: {},
    totalSavings: 0,
  }

  if (!isDatabaseAvailable()) {
    return emptyStats
  }

  try {
    const cutoff = new Date(Date.now() - daysBack * 86_400_000)

    const where = { userId, requestedAt: { gte: cutoff } }

    // Fetch ride records with a cap to prevent memory exhaustion.
    // For users with very large histories, we cap at 1000 records for savings computation.
    const records = await prisma.rideHistory.findMany({
      where,
      select: {
        service: true,
        estimatedFare: true,
        finalFare: true,
        comparisonSnapshot: true,
      },
      orderBy: { requestedAt: 'desc' },
      take: 1000,
    })

    if (records.length === 0) {
      return emptyStats
    }

    // Aggregate totals and per-service stats using immutable reduce
    const { totalSpent, totalSavings, byServiceAccum } = records.reduce(
      (
        acc: {
          totalSpent: number
          totalSavings: number
          byServiceAccum: Record<string, { count: number; totalSpent: number }>
        },
        record
      ) => {
        const fare = record.finalFare ?? record.estimatedFare
        const serviceKey = mapEnumToService(record.service as never) as ServiceType

        // Compute savings: max price across all services in this snapshot minus what was paid
        const snapshot = record.comparisonSnapshot as ComparisonResults
        const prices = Object.values(snapshot)
          .map(r => (r?.price ? parsePriceValue(r.price) : 0))
          .filter(p => p > 0)
        const maxPrice = prices.length > 0 ? Math.max(...prices) : 0
        const savings = Math.max(0, maxPrice - record.estimatedFare)

        const existing = acc.byServiceAccum[serviceKey] ?? { count: 0, totalSpent: 0 }

        return {
          totalSpent: acc.totalSpent + fare,
          totalSavings: acc.totalSavings + savings,
          byServiceAccum: {
            ...acc.byServiceAccum,
            [serviceKey]: {
              count: existing.count + 1,
              totalSpent: existing.totalSpent + fare,
            },
          },
        }
      },
      { totalSpent: 0, totalSavings: 0, byServiceAccum: {} }
    )

    const rideCount = records.length
    const avgFare = rideCount > 0 ? totalSpent / rideCount : 0

    const byService = Object.entries(byServiceAccum).reduce(
      (acc, [service, { count, totalSpent: spent }]) => ({
        ...acc,
        [service as ServiceType]: {
          count,
          totalSpent: spent,
          avgFare: count > 0 ? spent / count : 0,
        },
      }),
      {} as RideHistoryStats['byService']
    )

    return { totalSpent, rideCount, avgFare, byService, totalSavings }
  } catch (error) {
    reportPersistenceError('getRideHistoryStats', error)
    return emptyStats
  }
}

// ============================================================================
// Mutation Operations
// ============================================================================

/**
 * Returns true when the error is a Prisma P2025 "record not found" error.
 * Handles both real PrismaClientKnownRequestError instances and duck-typed objects
 * (e.g. plain Errors with a `.code` property, as emitted by some Prisma adapters).
 */
function isPrismaNotFound(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return error.code === 'P2025'
  }
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: unknown }).code === 'P2025'
  )
}

/**
 * Update the final fare for a ride history entry.
 * Enforces ownership via { id, userId } to prevent IDOR.
 * Returns { entry } on success, or { error: 'not_found' | 'db_error' } on failure.
 */
export async function updateRideHistoryFare(
  id: string,
  userId: string,
  finalFare: number
): Promise<{ entry: RideHistoryEntry } | { error: 'not_found' | 'db_error' }> {
  if (!isDatabaseAvailable()) {
    return { error: 'db_error' }
  }

  try {
    const updated = await prisma.rideHistory.update({
      where: { id, userId },
      data: { finalFare },
      include: {
        route: {
          select: {
            pickup_address: true,
            destination_address: true,
          },
        },
      },
    })

    return { entry: mapToEntry(updated) }
  } catch (error) {
    if (isPrismaNotFound(error)) return { error: 'not_found' }
    reportPersistenceError('updateRideHistoryFare', error)
    return { error: 'db_error' }
  }
}

/**
 * Delete a ride history entry.
 * Enforces ownership by checking userId before deleting to prevent IDOR.
 * Returns 'deleted' if deleted, 'not_found' if the record doesn't exist or isn't owned,
 * or 'error' if an unexpected database failure occurred.
 */
export async function deleteRideHistory(
  id: string,
  userId: string
): Promise<'deleted' | 'not_found' | 'error'> {
  if (!isDatabaseAvailable()) {
    return 'error'
  }

  try {
    await prisma.rideHistory.delete({ where: { id, userId } })

    return 'deleted'
  } catch (error) {
    if (isPrismaNotFound(error)) return 'not_found'
    reportPersistenceError('deleteRideHistory', error)
    return 'error'
  }
}
