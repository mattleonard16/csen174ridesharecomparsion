// Branded types for better type safety
export type Brand<K, T extends string> = K & { __brand: T }

// Location and coordinate types
export type Latitude = number
export type Longitude = number
export type Coordinates = [Longitude, Latitude]

// Price and currency types
export type PriceAmount = number
export type PriceString = string

// Service and ride types
export type ServiceType = 'uber' | 'lyft' | 'taxi' | 'waymo'
export type RideService = string

// Location suggestion interface
export interface LocationSuggestion {
  display_name: string
  lat: string
  lon: string
  name?: string
  place_id?: string
}

// Ride comparison result interface
export interface RideResult {
  price: PriceString
  waitTime: string
  driversNearby: number
  service: RideService
  surgeMultiplier?: string
}

// Complete comparison results
export type ComparisonResults = Partial<Record<ServiceType, RideResult>>

export interface ComparisonPersistenceContext {
  routeId: string | null
  pickupAddress: string
  destinationAddress: string
  userId?: string | null
  sessionId?: string | null
}

export interface ComparisonLocationInput {
  name: string
  lat: string
  lng: string
}

export interface CoordinateComparisonRequest {
  from: ComparisonLocationInput
  to: ComparisonLocationInput
  services: ServiceType[]
  recaptchaToken?: string
}

export type ComparisonRequestBody = CoordinateComparisonRequest

// Surge information
export interface SurgeInfo {
  isActive: boolean
  reason: string
  multiplier: number
}

// AI Recommendation types
export interface AIRecommendation {
  id?: string
  type: 'DEPARTURE_TIME' | 'SERVICE_CHOICE' | 'SURGE_FORECAST' | 'SAVINGS_INSIGHT'
  title: string
  message: string
  confidence: number
  dataPoints: {
    potentialSavings?: number
    bestHour?: number
    currentPrice?: number
    bestPrice?: number
    bestService?: string
    surgeEndEstimate?: string
  }
}

export type RouteAccuracy = 'exact' | 'estimated'

// API response types
export interface ComparisonApiResponse {
  routeId?: string | null
  comparisons: ComparisonResults
  insights: string
  pickupCoords: Coordinates
  destinationCoords: Coordinates
  surgeInfo: SurgeInfo
  timeRecommendations: string[]
  aiRecommendations?: AIRecommendation[]
  routeAccuracy?: RouteAccuracy
  routeWarning?: string
}

// Common places type
export interface CommonPlace {
  display_name: string
  name: string
  lat: string
  lon: string
}

export type CommonPlaces = Record<string, CommonPlace>

export interface RideHistoryEntry {
  id: string
  routeId: string | null
  service: ServiceType
  estimatedFare: number
  finalFare: number | null
  waitTimeMinutes: number | null
  surgeMultiplier: number | null
  comparisonSnapshot: ComparisonResults
  requestedAt: string
  updatedAt: string
  pickupAddress?: string
  destinationAddress?: string
}

export interface RideHistoryListResponse {
  history: RideHistoryEntry[]
  nextCursor: string | null
  total: number
}

export interface RideHistoryStats {
  totalSpent: number
  rideCount: number
  avgFare: number
  byService: Partial<Record<ServiceType, { count: number; totalSpent: number; avgFare: number }>>
  totalSavings: number
}

export interface DashboardSavedRoute {
  id: string
  routeId: string | null
  fromName: string
  toName: string
  createdAt?: string | Date
}

export interface DashboardPriceSnapshot {
  timestamp: string
  service_type: ServiceType | string
  final_price: number
  surge_multiplier: number
  weather_condition?: string | null
}

export interface DashboardHourlyAverage {
  hour: number
  avg_price: number
}

export interface DashboardSavingsSummary {
  totalSavings: number
  comparisonCount: number
  recsFollowed: number
  alertsSet: number
  unreadAlertCount?: number
}

export interface DashboardSurgeInsight {
  hour: number
  probability: number
}

export interface DashboardResponse {
  savedRoutes?: DashboardSavedRoute[]
  priceHistory?: DashboardPriceSnapshot[]
  hourlyAverages?: DashboardHourlyAverage[]
  savings?: DashboardSavingsSummary
  surgeInsights?: DashboardSurgeInsight[]
}
