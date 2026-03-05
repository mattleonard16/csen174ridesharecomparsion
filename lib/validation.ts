import { z } from 'zod'
import { getAirportByCode } from '@/lib/airports'

// Common validation patterns
const COORDINATE_REGEX = /^-?\d+\.?\d*$/
const LOCATION_NAME_REGEX = /^[a-zA-Z0-9\s,().-]+$/

/**
 * Coordinate validation schema
 */
export const CoordinateSchema = z
  .string()
  .regex(COORDINATE_REGEX, 'Invalid coordinate format')
  .refine(val => {
    const num = parseFloat(val)
    return !isNaN(num) && isFinite(num)
  }, 'Coordinate must be a valid number')

/**
 * Latitude validation schema (Bay Area bounds: 37.0 to 38.0)
 */
export const LatitudeSchema = CoordinateSchema.refine(val => {
  const lat = parseFloat(val)
  return lat >= 36.5 && lat <= 38.5
}, 'Latitude must be within Bay Area bounds (36.5 to 38.5)')

/**
 * Longitude validation schema (Bay Area bounds: -123.0 to -121.0)
 */
export const LongitudeSchema = CoordinateSchema.refine(val => {
  const lng = parseFloat(val)
  return lng >= -123.5 && lng <= -121.0
}, 'Longitude must be within Bay Area bounds (-123.5 to -121.0)')

/**
 * Location name validation schema
 */
export const LocationNameSchema = z
  .string()
  .min(2, 'Location name must be at least 2 characters')
  .max(100, 'Location name must be less than 100 characters')
  .regex(LOCATION_NAME_REGEX, 'Location name contains invalid characters')
  .refine(val => val.trim().length > 0, 'Location name cannot be empty')

/**
 * Service type validation schema
 */
export const ServiceTypeSchema = z.enum(['uber', 'lyft', 'taxi', 'waymo'], {
  errorMap: () => ({ message: 'Service type must be uber, lyft, taxi, or waymo' }),
})

/**
 * Ride comparison request validation schema
 */
export const RideComparisonRequestSchema = z.object({
  from: z.object({
    name: LocationNameSchema,
    lat: LatitudeSchema,
    lng: LongitudeSchema,
  }),
  to: z.object({
    name: LocationNameSchema,
    lat: LatitudeSchema,
    lng: LongitudeSchema,
  }),
  services: z
    .array(ServiceTypeSchema)
    .min(1, 'At least one service must be selected')
    .max(4, 'Maximum 4 services can be selected')
    .refine(services => {
      const uniqueServices = new Set(services)
      return uniqueServices.size === services.length
    }, 'Duplicate services are not allowed'),
})

/**
 * Geocoding request validation schema
 */
export const GeocodingRequestSchema = z.object({
  query: z
    .string()
    .min(2, 'Search query must be at least 2 characters')
    .max(200, 'Search query must be less than 200 characters')
    .regex(LOCATION_NAME_REGEX, 'Search query contains invalid characters')
    .refine(val => val.trim().length > 0, 'Search query cannot be empty'),
})

/**
 * Common validation utilities
 */
export class ValidationError extends Error {
  constructor(
    message: string,
    public field: string,
    public code: string = 'VALIDATION_ERROR'
  ) {
    super(message)
    this.name = 'ValidationError'
  }
}

/**
 * Validate and sanitize input with detailed error reporting
 */
export function validateInput<T>(
  schema: z.ZodSchema<T>,
  data: unknown,
  context: string = 'input'
): { success: true; data: T } | { success: false; errors: ValidationError[] } {
  try {
    const result = schema.parse(data)
    return { success: true, data: result }
  } catch (error) {
    if (error instanceof z.ZodError) {
      const validationErrors = error.errors.map(err => {
        const field = err.path.join('.')
        const message = err.message
        return new ValidationError(`${context}: ${message}`, field, err.code)
      })
      return { success: false, errors: validationErrors }
    }

    // Unexpected error
    return {
      success: false,
      errors: [new ValidationError(`${context}: Unexpected validation error`, 'unknown')],
    }
  }
}

/**
 * Sanitize string input to prevent injection attacks
 */
export function sanitizeString(input: string): string {
  return input
    .trim()
    .replace(/[<>]/g, '') // Remove potential HTML tags
    .replace(/['"]/g, '') // Remove quotes
    .replace(/[;&|`$]/g, '') // Remove shell injection characters
    .substring(0, 200) // Limit length
}

/**
 * Check if coordinates are suspiciously similar (potential spam)
 */
export function detectSuspiciousCoordinates(
  from: { lat: string; lng: string },
  to: { lat: string; lng: string }
): boolean {
  const fromLat = parseFloat(from.lat)
  const fromLng = parseFloat(from.lng)
  const toLat = parseFloat(to.lat)
  const toLng = parseFloat(to.lng)

  // Check if coordinates are identical
  if (fromLat === toLat && fromLng === toLng) {
    return true
  }

  // Check if coordinates are suspiciously close (< 100 meters)
  const distance = Math.sqrt(
    Math.pow((toLat - fromLat) * 111000, 2) +
    Math.pow((toLng - fromLng) * 111000 * Math.cos((fromLat * Math.PI) / 180), 2)
  )

  return distance < 100 // Less than 100 meters
}

/**
 * Detect common spam patterns in location names
 */
export function detectSpamPatterns(locationName: string): boolean {
  const normalizedLocation = locationName.trim()

  // Allow known airport codes like SFO while rejecting generic one-word spam.
  if (/^[a-z]+$/i.test(normalizedLocation)) {
    return !getAirportByCode(normalizedLocation)
  }

  const spamPatterns = [
    /test/i,
    /spam/i,
    /bot/i,
    /script/i,
    /hack/i,
    /\d{10,}/, // Long numbers
    /(.)\1{5,}/, // Repeated characters (aaaaaa)
    /^[^a-zA-Z]*$/, // No letters at all
  ]

  return spamPatterns.some(pattern => pattern.test(normalizedLocation))
}
