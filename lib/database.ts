/**
 * Database layer - barrel export file.
 *
 * This module re-exports all database operations from their respective modules:
 * - database-routes.ts: Route CRUD operations
 * - database-logging.ts: Snapshot and search logging
 * - database-pricing-stats.ts: Geohash clustering and pricing statistics
 */

// ============================================================================
// Route Operations
// ============================================================================
export {
  findOrCreateRoute,
  saveRouteForUser,
  getSavedRoutesForUser,
  generateRouteHash,
} from './database-routes'

// ============================================================================
// Logging Operations
// ============================================================================
export {
  logPriceSnapshot,
  logSearch,
  logWeatherData,
  getRoutePriceHistory,
  getHourlyPriceAverage,
  createPriceAlert,
  // Shared helpers (canonical source)
  isDatabaseAvailable,
  reportPersistenceError,
  // Re-exported from service-mappings for backward compatibility
  mapServiceToEnum,
} from './database-logging'

export { evaluateAndCreateNotifications } from './alert-evaluation'

// ============================================================================
// Service Mappings (canonical source)
// ============================================================================
export {
  // Functions
  mapServiceToEnum as mapServiceToEnumFromMappings,
  mapServiceToEnumWithAny,
  mapEnumToService,
  isRideServiceName,
  isServiceName,
  // Constants
  SERVICE_NAMES,
  RIDE_SERVICE_NAMES,
  ALL_SERVICE_NAMES,
  // Types
  type RideServiceName,
  type ServiceName,
  type ServiceType,
} from './service-mappings'

// ============================================================================
// Pricing Statistics
// ============================================================================
export {
  getRouteAndClusterPriceStats,
  getClusterPriceStatsByCoords,
  queryNeighborClusterPrices,
  computeStats,
  calculateConfidence,
  // Types
  type PriceStats,
  type ClusterPriceStats,
  type RouteClusterStats,
} from './database-pricing-stats'

// ============================================================================
// Legacy Exports
// ============================================================================

/**
 * Legacy export for backward compatibility.
 * Note: This is a getter evaluated at import time to avoid throwing at module load time in production.
 */
import { isDatabaseAvailable as checkDbAvailable } from './database-logging'

export const isSupabaseMockMode = (() => {
  try {
    return !checkDbAvailable()
  } catch {
    // In production without DATABASE_URL, isDatabaseAvailable() throws.
    // Return true to indicate mock mode since database is unavailable.
    return true
  }
})()
