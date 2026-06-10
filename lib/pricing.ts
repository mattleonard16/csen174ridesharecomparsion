import type { Coordinates, ServiceType } from '@/types'
import pricingConfig from './pricing-config.json'
import { isAirportLocation } from './airports'

// Utility function (moved from deleted location.ts)
function kmToMiles(km: number): number {
  return km * 0.621371
}

// Types for pricing configuration
interface SurgeSchedule {
  weekday: Record<string, number>
  weekend: Record<string, number>
}

interface PricingConfig {
  services: Record<
    string,
    {
      base: number
      perMile: number
      perMin: number
      booking: number
      safetyFee?: number
      minFare: number
      airportPickupFee?: number
      airportDropoffFee?: number
      cbdSurcharge?: number
      longRideFee?: {
        threshold: number
        fee: number
      }
      sjcFee?: {
        pickup: number
        dropoff: number
      }
      maxSurge?: number
    }
  >
  surgeSchedule: SurgeSchedule
  waymoSurgeSchedule?: SurgeSchedule
  locationModifiers: {
    airports: Record<string, number>
    downtown: Record<string, number>
  }
  trafficModifiers?: Record<'light' | 'moderate' | 'heavy' | 'severe', number>
  specialDates?: Record<string, number>
}

interface PricingInput {
  service: ServiceType
  pickupCoords: Coordinates
  destCoords: Coordinates
  distanceKm: number
  durationMin: number
  timestamp?: Date
  osrmDurationSec?: number
  expectedDurationSec?: number
  /**
   * Data-driven correction from lib/services/pricing-calibration.ts
   * (median finalFare/estimatedFare ratio observed in RideHistory).
   */
  calibration?: { factor: number; sampleSize: number }
}

interface PricingBreakdown {
  baseFare: number
  distanceFee: number
  timeFee: number
  bookingFee: number
  safetyFee: number
  airportFees: number
  locationSurcharge: number
  longRideFee: number
  subtotal: number
  surgeMultiplier: number
  surgeFee: number
  trafficMultiplier: number
  trafficFee: number
  calibrationFactor: number
  calibrationAdjustment: number
  finalFare: number
  appliedMinFare: boolean
}

export interface PricingResult {
  price: number
  breakdown: PricingBreakdown
  surgeReason: string
  confidence: number
}

const CONFIG = pricingConfig as PricingConfig

export class PricingEngine {
  private readonly isDebug = process.env.NODE_ENV === 'development'

  calculateFare(input: PricingInput): PricingResult {
    const timestamp = input.timestamp || new Date()
    const serviceConfig = this.getServiceConfig(input.service)

    if (!serviceConfig) {
      throw new Error(`Unsupported service: ${input.service}`)
    }

    if (this.isDebug) {
      console.debug('[pricing] calculateFare', {
        service: input.service,
        distanceKm: input.distanceKm,
        durationMin: input.durationMin,
        pickupCoords: input.pickupCoords,
        destCoords: input.destCoords,
      })
    }

    const distanceMiles = kmToMiles(input.distanceKm)
    const baseFare = serviceConfig.base
    const distanceFee = distanceMiles * serviceConfig.perMile
    const timeFee = input.durationMin * serviceConfig.perMin
    const bookingFee = serviceConfig.booking
    const safetyFee = serviceConfig.safetyFee || 0

    const airportFees = this.calculateAirportFees(
      input.pickupCoords,
      input.destCoords,
      serviceConfig
    )
    const locationSurcharge = this.calculateLocationSurcharge(
      input.pickupCoords,
      input.destCoords,
      timestamp,
      serviceConfig
    )
    const longRideFee = this.calculateLongRideFee(distanceMiles, serviceConfig)

    const subtotal =
      baseFare +
      distanceFee +
      timeFee +
      bookingFee +
      safetyFee +
      airportFees +
      locationSurcharge +
      longRideFee

    const { multiplier: surgeMultiplier, surgeReason } = this.calculateSurgeMultiplier(
      input.pickupCoords,
      input.destCoords,
      timestamp,
      serviceConfig,
      input.service
    )

    const { multiplier: trafficMultiplier } = this.calculateTrafficMultiplier(
      input.osrmDurationSec,
      input.expectedDurationSec
    )

    const surgeFee = subtotal * (surgeMultiplier - 1)
    const trafficFee = subtotal * (trafficMultiplier - 1)
    let finalFare = subtotal + surgeFee + trafficFee

    // Observed-data correction, applied before the min-fare floor: providers
    // enforce their minimums regardless of how estimates trend.
    const calibrationFactor = input.calibration?.factor ?? 1
    const calibrationAdjustment = finalFare * (calibrationFactor - 1)
    finalFare += calibrationAdjustment

    const appliedMinFare = finalFare < serviceConfig.minFare
    if (appliedMinFare) {
      finalFare = serviceConfig.minFare
    }

    const confidence = this.calculateConfidence(input, surgeMultiplier, trafficMultiplier)

    return {
      price: Number(finalFare.toFixed(2)),
      breakdown: {
        baseFare,
        distanceFee,
        timeFee,
        bookingFee,
        safetyFee,
        airportFees,
        locationSurcharge,
        longRideFee,
        subtotal,
        surgeMultiplier,
        surgeFee,
        trafficMultiplier,
        trafficFee,
        calibrationFactor,
        calibrationAdjustment,
        finalFare,
        appliedMinFare,
      },
      surgeReason,
      confidence,
    }
  }

  calculateSurge(
    pickupCoords: Coordinates,
    destCoords: Coordinates,
    timestamp?: Date
  ): { multiplier: number; surgeReason: string } {
    return this.calculateSurgeMultiplier(pickupCoords, destCoords, timestamp || new Date())
  }

  getBestTimeRecommendations(now: Date = new Date()): string[] {
    const hour = now.getHours()

    if (hour >= 14 && hour <= 16) {
      return [
        "Great timing! You're booking during off-peak hours",
        'Best prices are typically 2-4 PM (avoid rush hours for savings)',
      ]
    }

    if (hour >= 7 && hour <= 9) {
      return [
        'Rush hour pricing in effect. Expect 15-25% increase over standard rates',
        'Best prices: 2-4 PM (avoid peak hours for savings)',
      ]
    }

    if (hour >= 17 && hour <= 19) {
      return [
        'Evening rush pricing. Consider waiting until after 8 PM for better rates',
        'Best prices: 2-4 PM (avoid peak hours for savings)',
      ]
    }

    if (hour >= 20 || hour <= 5) {
      return [
        'Late night premium in effect (up to 20% increase)',
        'Best prices: 2-4 PM (avoid peak hours for savings)',
      ]
    }

    return [
      'Best prices: 2-4 PM (avoid peak hours for savings)',
      'Avoid rush hours: 7-9 AM and 5-7 PM (up to 25% increase)',
    ]
  }

  private getServiceConfig(service: ServiceType) {
    return CONFIG.services[service.toLowerCase() as keyof typeof CONFIG.services]
  }

  private calculateAirportFees(
    pickup: Coordinates,
    dest: Coordinates,
    config: PricingConfig['services'][string]
  ): number {
    const pickupAirport = isAirportLocation(pickup)
    const destAirport = isAirportLocation(dest)

    let total = 0

    if (pickupAirport) {
      if (pickupAirport.code === 'SJC' && config.sjcFee) {
        total += config.sjcFee.pickup
      } else {
        total += config.airportPickupFee || 0
      }
    }

    if (destAirport) {
      if (destAirport.code === 'SJC' && config.sjcFee) {
        total += config.sjcFee.dropoff
      } else {
        total += config.airportDropoffFee || 0
      }
    }

    return total
  }

  private calculateLocationSurcharge(
    pickup: Coordinates,
    dest: Coordinates,
    timestamp: Date,
    config: PricingConfig['services'][string]
  ): number {
    const isDowntown = (coords: Coordinates): boolean => {
      const [lon, lat] = coords
      if (lat >= 37.785 && lat <= 37.805 && lon >= -122.415 && lon <= -122.395) return true
      if (lat >= 37.325 && lat <= 37.345 && lon >= -121.895 && lon <= -121.875) return true
      return false
    }

    const hour = timestamp.getHours()
    const isBusinessHours = hour >= 9 && hour <= 17
    const isNightlife = hour >= 20 || hour <= 2

    if (!config.cbdSurcharge) {
      return 0
    }

    if (isDowntown(pickup) || isDowntown(dest)) {
      if (isBusinessHours) return config.cbdSurcharge * 0.5
      if (isNightlife) return config.cbdSurcharge * 1.2
      return config.cbdSurcharge
    }

    return 0
  }

  private calculateLongRideFee(
    distanceMiles: number,
    config: PricingConfig['services'][string]
  ): number {
    if (config.longRideFee && distanceMiles >= config.longRideFee.threshold) {
      return config.longRideFee.fee
    }
    return 0
  }

  private calculateSurgeMultiplier(
    pickup: Coordinates,
    dest: Coordinates,
    timestamp: Date,
    configOverride?: PricingConfig['services'][string],
    service?: ServiceType
  ): { multiplier: number; surgeReason: string } {
    const hour = timestamp.getHours()
    const minute = timestamp.getMinutes()
    const day = timestamp.getDay()
    const isWeekend = day === 0 || day === 6
    const timeSlot = this.getTimeSlot(hour, minute)
    const scheduleType = isWeekend ? 'weekend' : 'weekday'

    // Use Waymo-specific surge schedule if available and service is waymo
    const surgeConfig =
      service === 'waymo' && CONFIG.waymoSurgeSchedule
        ? CONFIG.waymoSurgeSchedule
        : CONFIG.surgeSchedule
    const schedule = surgeConfig[scheduleType]

    let baseSurge = schedule[timeSlot] ?? schedule[hour.toString()] ?? 1

    const isAirportRoute = isAirportLocation(pickup) !== null || isAirportLocation(dest) !== null
    const isLateNight = hour >= 23 || hour <= 5
    const isPeakHours = !isWeekend && ((hour >= 7 && hour <= 9) || (hour >= 17 && hour <= 19))
    const locationModifiers = CONFIG.locationModifiers || { airports: {}, downtown: {} }

    let locationMultiplier = 1
    let reason = 'Standard pricing'

    if (isAirportRoute) {
      if (isLateNight && locationModifiers.airports?.lateNight) {
        locationMultiplier = locationModifiers.airports.lateNight
        reason = 'Late night airport premium'
      } else if (isPeakHours && locationModifiers.airports?.peakHours) {
        locationMultiplier = locationModifiers.airports.peakHours
        reason = 'Peak hours airport demand'
      } else {
        reason = 'Airport route'
      }
    } else if (isLateNight) {
      reason = 'Late night premium'
    } else if (isPeakHours) {
      reason = 'Rush hour demand'
    }

    const surgeCap = configOverride?.maxSurge ?? 3
    const finalMultiplier = Math.min(baseSurge + (locationMultiplier - 1), surgeCap)

    if (this.isDebug) {
      console.debug('[pricing] surge', {
        baseSurge,
        locationMultiplier,
        finalMultiplier,
        reason,
        timeSlot,
        hour,
        minute,
        day,
      })
    }

    return { multiplier: finalMultiplier, surgeReason: reason }
  }

  private calculateTrafficMultiplier(
    osrmDurationSec?: number,
    expectedDurationSec?: number
  ): { multiplier: number } {
    if (!osrmDurationSec || !expectedDurationSec) {
      return { multiplier: 1 }
    }

    const ratio = osrmDurationSec / expectedDurationSec
    const modifiers = CONFIG.trafficModifiers || {
      light: 1.05,
      moderate: 1.1,
      heavy: 1.25,
      severe: 1.4,
    }

    if (ratio <= 1.1) return { multiplier: modifiers.light }
    if (ratio <= 1.3) return { multiplier: modifiers.moderate }
    if (ratio <= 1.6) return { multiplier: modifiers.heavy }
    return { multiplier: modifiers.severe }
  }

  private calculateConfidence(
    input: PricingInput,
    surgeMultiplier: number,
    trafficMultiplier: number
  ): number {
    let confidence = 0.9

    if (surgeMultiplier > 2) confidence -= 0.15
    else if (surgeMultiplier > 1.5) confidence -= 0.1

    if (trafficMultiplier > 1.3) confidence -= 0.1

    if (input.distanceKm > 50) confidence -= 0.15
    else if (input.distanceKm > 25) confidence -= 0.1

    const hour = (input.timestamp || new Date()).getHours()
    if (hour >= 1 && hour <= 5) confidence -= 0.1

    // Estimates corrected by a well-sampled calibration factor are backed by
    // real observed fares — worth a modest confidence bump.
    if ((input.calibration?.sampleSize ?? 0) >= 20) confidence += 0.05

    return Math.min(Math.max(confidence, 0.5), 0.95)
  }

  private getTimeSlot(hour: number, minute: number): string {
    const slotMinute = minute < 30 ? '00' : '30'
    const nextHour = minute < 30 ? hour : (hour + 1) % 24
    const nextSlotMinute = minute < 30 ? '30' : '00'

    return `${hour.toString().padStart(2, '0')}:${slotMinute}-${nextHour
      .toString()
      .padStart(2, '0')}:${nextSlotMinute}`
  }
}

export const pricingEngine = new PricingEngine()

export function calculateEnhancedFare(
  service: ServiceType,
  pickupCoords: Coordinates,
  destCoords: Coordinates,
  distanceKm: number,
  durationMin: number,
  timestamp?: Date
): { price: string; surgeReason: string; confidence: number } {
  const result = pricingEngine.calculateFare({
    service,
    pickupCoords,
    destCoords,
    distanceKm,
    durationMin,
    timestamp,
    expectedDurationSec: durationMin * 60,
  })

  return {
    price: `$${result.price.toFixed(2)}`,
    surgeReason: result.surgeReason,
    confidence: result.confidence,
  }
}

export function getTimeBasedMultiplier(
  pickupCoords: Coordinates,
  destCoords: Coordinates,
  timestamp?: Date
): { multiplier: number; surgeReason: string } {
  return pricingEngine.calculateSurge(pickupCoords, destCoords, timestamp)
}

export function getBestTimeRecommendations(): string[] {
  return pricingEngine.getBestTimeRecommendations()
}

export function hasAirportSurcharge(pickup: Coordinates, dest: Coordinates): boolean {
  return isAirportLocation(pickup) !== null || isAirportLocation(dest) !== null
}
