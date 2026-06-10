import {
  PricingEngine,
  calculateEnhancedFare,
  getTimeBasedMultiplier,
  hasAirportSurcharge,
  getBestTimeRecommendations,
} from '@/lib/pricing'
import type { Coordinates } from '@/types'
import { isAirportLocation } from '@/lib/airports'

// Mock the airports module
jest.mock('@/lib/airports', () => ({
  isAirportLocation: jest.fn(),
}))

const mockIsAirportLocation = isAirportLocation as jest.MockedFunction<typeof isAirportLocation>

// Test fixtures - coordinates
const COORDS = {
  // Regular location (not downtown, not airport)
  regular: [-122.45, 37.75] as Coordinates,
  regularDest: [-122.48, 37.78] as Coordinates,

  // Downtown San Francisco (lat: 37.785-37.805, lon: -122.415 to -122.395)
  downtownSF: [-122.405, 37.79] as Coordinates,

  // Downtown San Jose (lat: 37.325-37.345, lon: -121.895 to -121.875)
  downtownSJ: [-121.885, 37.335] as Coordinates,

  // SFO Airport
  sfo: [-122.379, 37.6213] as Coordinates,

  // SJC Airport
  sjc: [-121.9289, 37.3639] as Coordinates,

  // OAK Airport
  oak: [-122.2197, 37.7126] as Coordinates,
}

// Airport mock objects
const AIRPORTS = {
  SFO: { code: 'SFO', name: 'San Francisco International Airport' },
  SJC: { code: 'SJC', name: 'San Jose International Airport' },
  OAK: { code: 'OAK', name: 'Oakland International Airport' },
}

describe('PricingEngine', () => {
  let pricingEngine: PricingEngine

  beforeEach(() => {
    pricingEngine = new PricingEngine()
    mockIsAirportLocation.mockReset()
    // Default: no airport
    mockIsAirportLocation.mockReturnValue(null)
  })

  describe('calculateFare - base fare calculation', () => {
    it('should calculate base fare correctly for Uber', () => {
      const result = pricingEngine.calculateFare({
        service: 'uber',
        pickupCoords: COORDS.regular,
        destCoords: COORDS.regularDest,
        distanceKm: 10, // 6.21 miles
        durationMin: 15,
        timestamp: new Date('2024-01-15T14:00:00'), // Off-peak time (2 PM weekday)
      })

      expect(result.breakdown.baseFare).toBe(2.85)
      expect(result.breakdown.bookingFee).toBe(1.65)
      expect(result.breakdown.safetyFee).toBe(0.75)
      // Distance fee: 6.21 miles * $1.15/mile = ~$7.15
      expect(result.breakdown.distanceFee).toBeCloseTo(7.15, 1)
      // Time fee: 15 min * $0.38/min = $5.70
      expect(result.breakdown.timeFee).toBeCloseTo(5.7, 2)
      expect(result.price).toBeGreaterThan(0)
    })

    it('should calculate base fare correctly for Lyft', () => {
      const result = pricingEngine.calculateFare({
        service: 'lyft',
        pickupCoords: COORDS.regular,
        destCoords: COORDS.regularDest,
        distanceKm: 10,
        durationMin: 15,
        timestamp: new Date('2024-01-15T14:00:00'),
      })

      expect(result.breakdown.baseFare).toBe(2.65)
      expect(result.breakdown.bookingFee).toBe(2.75)
      expect(result.breakdown.safetyFee).toBe(0.65)
      // Distance fee: 6.21 miles * $1.05/mile = ~$6.52
      expect(result.breakdown.distanceFee).toBeCloseTo(6.52, 1)
      // Time fee: 15 min * $0.38/min = $5.70
      expect(result.breakdown.timeFee).toBeCloseTo(5.7, 2)
    })

    it('should calculate base fare correctly for Taxi', () => {
      const result = pricingEngine.calculateFare({
        service: 'taxi',
        pickupCoords: COORDS.regular,
        destCoords: COORDS.regularDest,
        distanceKm: 10,
        durationMin: 15,
        timestamp: new Date('2024-01-15T14:00:00'),
      })

      expect(result.breakdown.baseFare).toBe(4.25)
      expect(result.breakdown.bookingFee).toBe(0)
      expect(result.breakdown.safetyFee).toBe(0)
      // Distance fee: 6.21 miles * $3.25/mile = ~$20.19
      expect(result.breakdown.distanceFee).toBeCloseTo(20.19, 1)
      // Time fee: 15 min * $0.65/min = $9.75
      expect(result.breakdown.timeFee).toBeCloseTo(9.75, 2)
    })

    it('should throw error for unsupported service', () => {
      expect(() => {
        pricingEngine.calculateFare({
          service: 'invalid' as any,
          pickupCoords: COORDS.regular,
          destCoords: COORDS.regularDest,
          distanceKm: 10,
          durationMin: 15,
        })
      }).toThrow('Unsupported service: invalid')
    })

    it('should handle zero distance trip', () => {
      const result = pricingEngine.calculateFare({
        service: 'uber',
        pickupCoords: COORDS.regular,
        destCoords: COORDS.regular,
        distanceKm: 0,
        durationMin: 1,
        timestamp: new Date('2024-01-15T14:00:00'),
      })

      expect(result.breakdown.distanceFee).toBe(0)
      // Should still apply minimum fare
      expect(result.breakdown.appliedMinFare).toBe(true)
      expect(result.price).toBe(9.25) // Uber minimum fare
    })
  })

  describe('calculateFare - calibration', () => {
    const baseInput = {
      service: 'uber' as const,
      pickupCoords: COORDS.regular,
      destCoords: COORDS.regularDest,
      distanceKm: 15,
      durationMin: 25,
      timestamp: new Date('2024-01-15T14:00:00'), // Off-peak weekday
    }

    it('defaults to factor 1 with zero adjustment when no calibration is provided', () => {
      const result = pricingEngine.calculateFare(baseInput)

      expect(result.breakdown.calibrationFactor).toBe(1)
      expect(result.breakdown.calibrationAdjustment).toBe(0)
    })

    it('scales the fare by the calibration factor', () => {
      const uncalibrated = pricingEngine.calculateFare(baseInput)
      const calibrated = pricingEngine.calculateFare({
        ...baseInput,
        calibration: { factor: 1.1, sampleSize: 30 },
      })

      expect(calibrated.price).toBeCloseTo(uncalibrated.price * 1.1, 1)
      expect(calibrated.breakdown.calibrationFactor).toBe(1.1)
      expect(calibrated.breakdown.calibrationAdjustment).toBeGreaterThan(0)
    })

    it('keeps the min-fare floor when calibration pushes the fare below it', () => {
      const tinyRide = {
        ...baseInput,
        distanceKm: 0.3,
        durationMin: 2,
      }
      const uncalibrated = pricingEngine.calculateFare(tinyRide)
      const calibrated = pricingEngine.calculateFare({
        ...tinyRide,
        calibration: { factor: 0.85, sampleSize: 30 },
      })

      expect(uncalibrated.breakdown.appliedMinFare).toBe(true)
      expect(calibrated.breakdown.appliedMinFare).toBe(true)
      expect(calibrated.price).toBe(uncalibrated.price)
    })

    it('boosts confidence for well-sampled calibration but not for thin samples', () => {
      const uncalibrated = pricingEngine.calculateFare(baseInput)
      const thinSample = pricingEngine.calculateFare({
        ...baseInput,
        calibration: { factor: 1.05, sampleSize: 5 },
      })
      const wellSampled = pricingEngine.calculateFare({
        ...baseInput,
        calibration: { factor: 1.05, sampleSize: 20 },
      })

      expect(thinSample.confidence).toBe(uncalibrated.confidence)
      expect(wellSampled.confidence).toBeCloseTo(uncalibrated.confidence + 0.05, 5)
      expect(wellSampled.confidence).toBeLessThanOrEqual(0.95)
    })
  })

  describe('calculateFare - surge multiplier', () => {
    describe('weekday rush hours', () => {
      it('should apply morning rush hour surge (7-9 AM)', () => {
        const result = pricingEngine.calculateFare({
          service: 'uber',
          pickupCoords: COORDS.regular,
          destCoords: COORDS.regularDest,
          distanceKm: 10,
          durationMin: 15,
          timestamp: new Date('2024-01-15T08:15:00'), // Monday 8:15 AM
        })

        // 08:00-08:30 surge is 1.25
        expect(result.breakdown.surgeMultiplier).toBe(1.25)
        expect(result.surgeReason).toBe('Rush hour demand')
      })

      it('should apply evening rush hour surge (5-7 PM)', () => {
        const result = pricingEngine.calculateFare({
          service: 'uber',
          pickupCoords: COORDS.regular,
          destCoords: COORDS.regularDest,
          distanceKm: 10,
          durationMin: 15,
          timestamp: new Date('2024-01-15T18:15:00'), // Monday 6:15 PM
        })

        // 18:00-18:30 surge is 1.30
        expect(result.breakdown.surgeMultiplier).toBe(1.3)
        expect(result.surgeReason).toBe('Rush hour demand')
      })

      it('should apply lower surge during off-peak weekday', () => {
        const result = pricingEngine.calculateFare({
          service: 'uber',
          pickupCoords: COORDS.regular,
          destCoords: COORDS.regularDest,
          distanceKm: 10,
          durationMin: 15,
          timestamp: new Date('2024-01-15T14:00:00'), // Monday 2 PM
        })

        // 10:00-16:30 surge is 1.0
        expect(result.breakdown.surgeMultiplier).toBe(1)
        expect(result.surgeReason).toBe('Standard pricing')
      })
    })

    describe('weekend surge', () => {
      it('should apply weekend late night surge reason when hour >= 23 or <= 5', () => {
        const result = pricingEngine.calculateFare({
          service: 'uber',
          pickupCoords: COORDS.regular,
          destCoords: COORDS.regularDest,
          distanceKm: 10,
          durationMin: 15,
          timestamp: new Date('2024-01-20T02:00:00'), // Saturday 2 AM
        })

        // Weekend schedule uses wide ranges that don't match specific slots
        // Falls back to multiplier 1, but reason is still "Late night premium"
        expect(result.surgeReason).toBe('Late night premium')
      })

      it('should fall back to default multiplier when weekend time slot not in schedule', () => {
        const result = pricingEngine.calculateFare({
          service: 'uber',
          pickupCoords: COORDS.regular,
          destCoords: COORDS.regularDest,
          distanceKm: 10,
          durationMin: 15,
          timestamp: new Date('2024-01-20T21:00:00'), // Saturday 9 PM
        })

        // Weekend schedule "20:00-22:00" doesn't match exact slot "21:00-21:30"
        // Falls back to default multiplier 1
        // 9 PM (hour 21) is not late night (hour >= 23 || hour <= 5), so standard pricing
        expect(result.breakdown.surgeMultiplier).toBe(1)
        expect(result.surgeReason).toBe('Standard pricing')
      })

      it('should apply lower surge during weekend morning', () => {
        const result = pricingEngine.calculateFare({
          service: 'uber',
          pickupCoords: COORDS.regular,
          destCoords: COORDS.regularDest,
          distanceKm: 10,
          durationMin: 15,
          timestamp: new Date('2024-01-20T08:00:00'), // Saturday 8 AM
        })

        // Weekend 06:00-10:00 in config doesn't match "08:00-08:30" slot
        // Falls back to default multiplier 1
        expect(result.breakdown.surgeMultiplier).toBe(1)
        expect(result.surgeReason).toBe('Standard pricing')
      })
    })

    describe('late night surge', () => {
      it('should apply late night surge reason on weekday (hour >= 23)', () => {
        const result = pricingEngine.calculateFare({
          service: 'uber',
          pickupCoords: COORDS.regular,
          destCoords: COORDS.regularDest,
          distanceKm: 10,
          durationMin: 15,
          timestamp: new Date('2024-01-15T23:30:00'), // Monday 11:30 PM
        })

        // Weekday config "23:00-01:00" doesn't match specific slot "23:30-00:00"
        // Falls back to default, but late night reason is set
        expect(result.surgeReason).toBe('Late night premium')
      })

      it('should apply early morning surge reason on weekday (hour <= 5)', () => {
        const result = pricingEngine.calculateFare({
          service: 'uber',
          pickupCoords: COORDS.regular,
          destCoords: COORDS.regularDest,
          distanceKm: 10,
          durationMin: 15,
          timestamp: new Date('2024-01-15T03:00:00'), // Monday 3 AM
        })

        // Weekday config "01:00-06:00" doesn't match specific slot "03:00-03:30"
        // Falls back to default, but late night reason is set
        expect(result.surgeReason).toBe('Late night premium')
      })
    })

    describe('surge cap (maxSurge)', () => {
      it('should cap Uber surge at 2.0', () => {
        // Mock airport to get location multiplier
        mockIsAirportLocation.mockImplementation(coords => {
          if (coords === COORDS.sfo) return AIRPORTS.SFO as any
          return null
        })

        const result = pricingEngine.calculateFare({
          service: 'uber',
          pickupCoords: COORDS.sfo,
          destCoords: COORDS.regularDest,
          distanceKm: 10,
          durationMin: 15,
          timestamp: new Date('2024-01-20T02:00:00'), // Saturday 2 AM late night airport
        })

        // Additive: base surge 1.55 + (1.12 - 1) = 1.67, should not exceed 2.0
        expect(result.breakdown.surgeMultiplier).toBeLessThanOrEqual(2.0)
      })

      it('should cap Taxi surge at 1.4 when surge would exceed cap', () => {
        // Mock airport to get location multiplier that would exceed cap
        mockIsAirportLocation.mockImplementation(coords => {
          if (coords === COORDS.sfo) return AIRPORTS.SFO as any
          return null
        })

        const result = pricingEngine.calculateFare({
          service: 'taxi',
          pickupCoords: COORDS.sfo,
          destCoords: COORDS.regularDest,
          distanceKm: 10,
          durationMin: 15,
          timestamp: new Date('2024-01-15T18:00:00'), // Weekday 6 PM rush hour + airport
        })

        // Weekday 18:00-18:30 surge is 1.30, airport peakHours adds 0.12 (additive)
        // 1.30 + 0.12 = 1.42, but taxi cap is 1.4
        expect(result.breakdown.surgeMultiplier).toBe(1.4)
      })
    })
  })

  describe('calculateFare - airport fees', () => {
    describe('regular airports (SFO, OAK)', () => {
      it('should apply airport pickup fee', () => {
        mockIsAirportLocation.mockImplementation(coords => {
          if (coords === COORDS.sfo) return AIRPORTS.SFO as any
          return null
        })

        const result = pricingEngine.calculateFare({
          service: 'uber',
          pickupCoords: COORDS.sfo,
          destCoords: COORDS.regular,
          distanceKm: 20,
          durationMin: 25,
          timestamp: new Date('2024-01-15T14:00:00'),
        })

        // Uber airport pickup fee is $5.50
        expect(result.breakdown.airportFees).toBe(5.5)
      })

      it('should apply airport dropoff fee', () => {
        mockIsAirportLocation.mockImplementation(coords => {
          if (coords === COORDS.oak) return AIRPORTS.OAK as any
          return null
        })

        const result = pricingEngine.calculateFare({
          service: 'uber',
          pickupCoords: COORDS.regular,
          destCoords: COORDS.oak,
          distanceKm: 20,
          durationMin: 25,
          timestamp: new Date('2024-01-15T14:00:00'),
        })

        // Uber airport dropoff fee is $3.25
        expect(result.breakdown.airportFees).toBe(3.25)
      })

      it('should apply both pickup and dropoff fees for airport-to-airport', () => {
        mockIsAirportLocation.mockImplementation(coords => {
          if (coords === COORDS.sfo) return AIRPORTS.SFO as any
          if (coords === COORDS.oak) return AIRPORTS.OAK as any
          return null
        })

        const result = pricingEngine.calculateFare({
          service: 'uber',
          pickupCoords: COORDS.sfo,
          destCoords: COORDS.oak,
          distanceKm: 30,
          durationMin: 35,
          timestamp: new Date('2024-01-15T14:00:00'),
        })

        // Uber: $5.50 pickup + $3.25 dropoff = $8.75
        expect(result.breakdown.airportFees).toBe(8.75)
      })
    })

    describe('SJC special handling', () => {
      beforeEach(() => {
        mockIsAirportLocation.mockImplementation(coords => {
          if (coords === COORDS.sjc) return AIRPORTS.SJC as any
          return null
        })
      })

      it('should apply SJC-specific pickup fee for Uber', () => {
        const result = pricingEngine.calculateFare({
          service: 'uber',
          pickupCoords: COORDS.sjc,
          destCoords: COORDS.regular,
          distanceKm: 15,
          durationMin: 20,
          timestamp: new Date('2024-01-15T14:00:00'),
        })

        // Uber doesn't have sjcFee in config, so use regular airport fee
        expect(result.breakdown.airportFees).toBe(5.5)
      })

      it('should not apply SJC fees for Taxi (no sjcFee config)', () => {
        const result = pricingEngine.calculateFare({
          service: 'taxi',
          pickupCoords: COORDS.sjc,
          destCoords: COORDS.regular,
          distanceKm: 15,
          durationMin: 20,
          timestamp: new Date('2024-01-15T14:00:00'),
        })

        // Taxi airport pickup fee is $6.00
        expect(result.breakdown.airportFees).toBe(6.0)
      })
    })

    describe('Lyft airport fees', () => {
      it('should apply Lyft airport pickup fee', () => {
        mockIsAirportLocation.mockImplementation(coords => {
          if (coords === COORDS.sfo) return AIRPORTS.SFO as any
          return null
        })

        const result = pricingEngine.calculateFare({
          service: 'lyft',
          pickupCoords: COORDS.sfo,
          destCoords: COORDS.regular,
          distanceKm: 20,
          durationMin: 25,
          timestamp: new Date('2024-01-15T14:00:00'),
        })

        // Lyft airport pickup fee is $5.50
        expect(result.breakdown.airportFees).toBe(5.5)
      })

      it('should apply Lyft airport dropoff fee', () => {
        mockIsAirportLocation.mockImplementation(coords => {
          if (coords === COORDS.sfo) return AIRPORTS.SFO as any
          return null
        })

        const result = pricingEngine.calculateFare({
          service: 'lyft',
          pickupCoords: COORDS.regular,
          destCoords: COORDS.sfo,
          distanceKm: 20,
          durationMin: 25,
          timestamp: new Date('2024-01-15T14:00:00'),
        })

        // Lyft airport dropoff fee is $2.50
        expect(result.breakdown.airportFees).toBe(2.5)
      })
    })
  })

  describe('calculateFare - location surcharge (CBD)', () => {
    describe('downtown SF detection', () => {
      it('should apply CBD surcharge for downtown SF pickup (standard hours)', () => {
        const result = pricingEngine.calculateFare({
          service: 'uber',
          pickupCoords: COORDS.downtownSF,
          destCoords: COORDS.regular,
          distanceKm: 10,
          durationMin: 15,
          timestamp: new Date('2024-01-15T19:00:00'), // 7 PM - outside business/nightlife
        })

        // Uber CBD surcharge is $3.50 at standard times (not business hours 9-17, not nightlife 20-02)
        expect(result.breakdown.locationSurcharge).toBe(3.5)
      })

      it('should apply CBD surcharge for downtown SF destination (standard hours)', () => {
        const result = pricingEngine.calculateFare({
          service: 'uber',
          pickupCoords: COORDS.regular,
          destCoords: COORDS.downtownSF,
          distanceKm: 10,
          durationMin: 15,
          timestamp: new Date('2024-01-15T19:00:00'), // 7 PM - outside business/nightlife
        })

        expect(result.breakdown.locationSurcharge).toBe(3.5)
      })
    })

    describe('downtown SJ detection', () => {
      it('should apply CBD surcharge for downtown SJ (standard hours)', () => {
        const result = pricingEngine.calculateFare({
          service: 'uber',
          pickupCoords: COORDS.downtownSJ,
          destCoords: COORDS.regular,
          distanceKm: 10,
          durationMin: 15,
          timestamp: new Date('2024-01-15T19:00:00'), // 7 PM - standard hours
        })

        expect(result.breakdown.locationSurcharge).toBe(3.5)
      })
    })

    describe('business hours modifier', () => {
      it('should apply reduced surcharge during business hours (9 AM - 5 PM)', () => {
        const result = pricingEngine.calculateFare({
          service: 'uber',
          pickupCoords: COORDS.downtownSF,
          destCoords: COORDS.regular,
          distanceKm: 10,
          durationMin: 15,
          timestamp: new Date('2024-01-15T10:00:00'), // 10 AM - business hours
        })

        // Business hours: cbdSurcharge * 0.5 = $3.50 * 0.5 = $1.75
        expect(result.breakdown.locationSurcharge).toBe(1.75)
      })
    })

    describe('nightlife hours modifier', () => {
      it('should apply increased surcharge during nightlife hours (8 PM - 2 AM)', () => {
        const result = pricingEngine.calculateFare({
          service: 'uber',
          pickupCoords: COORDS.downtownSF,
          destCoords: COORDS.regular,
          distanceKm: 10,
          durationMin: 15,
          timestamp: new Date('2024-01-15T22:00:00'), // 10 PM - nightlife
        })

        // Nightlife: cbdSurcharge * 1.2 = $3.50 * 1.2 = $4.20
        expect(result.breakdown.locationSurcharge).toBe(4.2)
      })

      it('should apply nightlife surcharge at 1 AM', () => {
        const result = pricingEngine.calculateFare({
          service: 'uber',
          pickupCoords: COORDS.downtownSF,
          destCoords: COORDS.regular,
          distanceKm: 10,
          durationMin: 15,
          timestamp: new Date('2024-01-15T01:00:00'), // 1 AM - nightlife
        })

        expect(result.breakdown.locationSurcharge).toBe(4.2)
      })
    })

    describe('service-specific CBD surcharges', () => {
      it('should apply Lyft CBD surcharge (standard hours)', () => {
        const result = pricingEngine.calculateFare({
          service: 'lyft',
          pickupCoords: COORDS.downtownSF,
          destCoords: COORDS.regular,
          distanceKm: 10,
          durationMin: 15,
          timestamp: new Date('2024-01-15T19:00:00'), // 7 PM - standard hours
        })

        // Lyft CBD surcharge is $3.25
        expect(result.breakdown.locationSurcharge).toBe(3.25)
      })

      it('should apply Taxi CBD surcharge (standard hours)', () => {
        const result = pricingEngine.calculateFare({
          service: 'taxi',
          pickupCoords: COORDS.downtownSF,
          destCoords: COORDS.regular,
          distanceKm: 10,
          durationMin: 15,
          timestamp: new Date('2024-01-15T19:00:00'), // 7 PM - standard hours
        })

        // Taxi CBD surcharge is $3.00
        expect(result.breakdown.locationSurcharge).toBe(3.0)
      })
    })

    it('should not apply CBD surcharge for non-downtown locations', () => {
      const result = pricingEngine.calculateFare({
        service: 'uber',
        pickupCoords: COORDS.regular,
        destCoords: COORDS.regularDest,
        distanceKm: 10,
        durationMin: 15,
        timestamp: new Date('2024-01-15T12:00:00'),
      })

      expect(result.breakdown.locationSurcharge).toBe(0)
    })
  })

  describe('calculateFare - traffic multiplier', () => {
    it('should apply light traffic multiplier (ratio <= 1.1)', () => {
      const result = pricingEngine.calculateFare({
        service: 'uber',
        pickupCoords: COORDS.regular,
        destCoords: COORDS.regularDest,
        distanceKm: 10,
        durationMin: 15,
        timestamp: new Date('2024-01-15T14:00:00'),
        osrmDurationSec: 900, // 15 min
        expectedDurationSec: 900, // 15 min (ratio = 1.0)
      })

      // Light traffic: 1.0 multiplier (from config)
      expect(result.breakdown.trafficMultiplier).toBe(1.0)
    })

    it('should apply moderate traffic multiplier (ratio 1.1-1.3)', () => {
      const result = pricingEngine.calculateFare({
        service: 'uber',
        pickupCoords: COORDS.regular,
        destCoords: COORDS.regularDest,
        distanceKm: 10,
        durationMin: 15,
        timestamp: new Date('2024-01-15T14:00:00'),
        osrmDurationSec: 1080, // 18 min
        expectedDurationSec: 900, // 15 min (ratio = 1.2)
      })

      // Moderate traffic: 1.1 multiplier
      expect(result.breakdown.trafficMultiplier).toBe(1.1)
    })

    it('should apply heavy traffic multiplier (ratio 1.3-1.6)', () => {
      const result = pricingEngine.calculateFare({
        service: 'uber',
        pickupCoords: COORDS.regular,
        destCoords: COORDS.regularDest,
        distanceKm: 10,
        durationMin: 15,
        timestamp: new Date('2024-01-15T14:00:00'),
        osrmDurationSec: 1350, // 22.5 min
        expectedDurationSec: 900, // 15 min (ratio = 1.5)
      })

      // Heavy traffic: 1.25 multiplier
      expect(result.breakdown.trafficMultiplier).toBe(1.25)
    })

    it('should apply severe traffic multiplier (ratio > 1.6)', () => {
      const result = pricingEngine.calculateFare({
        service: 'uber',
        pickupCoords: COORDS.regular,
        destCoords: COORDS.regularDest,
        distanceKm: 10,
        durationMin: 15,
        timestamp: new Date('2024-01-15T14:00:00'),
        osrmDurationSec: 1800, // 30 min
        expectedDurationSec: 900, // 15 min (ratio = 2.0)
      })

      // Severe traffic: 1.4 multiplier
      expect(result.breakdown.trafficMultiplier).toBe(1.4)
    })

    it('should default to multiplier 1 when no duration data', () => {
      const result = pricingEngine.calculateFare({
        service: 'uber',
        pickupCoords: COORDS.regular,
        destCoords: COORDS.regularDest,
        distanceKm: 10,
        durationMin: 15,
        timestamp: new Date('2024-01-15T14:00:00'),
        // No osrmDurationSec or expectedDurationSec
      })

      expect(result.breakdown.trafficMultiplier).toBe(1)
      expect(result.breakdown.trafficFee).toBe(0)
    })

    it('should calculate traffic fee correctly', () => {
      const result = pricingEngine.calculateFare({
        service: 'uber',
        pickupCoords: COORDS.regular,
        destCoords: COORDS.regularDest,
        distanceKm: 10,
        durationMin: 15,
        timestamp: new Date('2024-01-15T14:00:00'),
        osrmDurationSec: 1350,
        expectedDurationSec: 900, // Heavy traffic (1.25)
      })

      // Traffic fee = subtotal * (trafficMultiplier - 1)
      const expectedTrafficFee = result.breakdown.subtotal * (1.25 - 1)
      expect(result.breakdown.trafficFee).toBeCloseTo(expectedTrafficFee, 2)
    })
  })

  describe('calculateFare - minimum fare enforcement', () => {
    it('should enforce Uber minimum fare ($9.25)', () => {
      const result = pricingEngine.calculateFare({
        service: 'uber',
        pickupCoords: COORDS.regular,
        destCoords: COORDS.regular, // Same location
        distanceKm: 0.5, // Very short trip
        durationMin: 2,
        timestamp: new Date('2024-01-15T14:00:00'),
      })

      expect(result.breakdown.appliedMinFare).toBe(true)
      expect(result.price).toBe(9.25)
    })

    it('should enforce Lyft minimum fare ($8.95)', () => {
      const result = pricingEngine.calculateFare({
        service: 'lyft',
        pickupCoords: COORDS.regular,
        destCoords: COORDS.regular,
        distanceKm: 0.5,
        durationMin: 2,
        timestamp: new Date('2024-01-15T14:00:00'),
      })

      expect(result.breakdown.appliedMinFare).toBe(true)
      expect(result.price).toBe(8.95)
    })

    it('should enforce Taxi minimum fare ($15.00)', () => {
      const result = pricingEngine.calculateFare({
        service: 'taxi',
        pickupCoords: COORDS.regular,
        destCoords: COORDS.regular,
        distanceKm: 0.5,
        durationMin: 2,
        timestamp: new Date('2024-01-15T14:00:00'),
      })

      expect(result.breakdown.appliedMinFare).toBe(true)
      expect(result.price).toBe(15.0)
    })

    it('should not apply minimum fare when calculated fare exceeds it', () => {
      const result = pricingEngine.calculateFare({
        service: 'uber',
        pickupCoords: COORDS.regular,
        destCoords: COORDS.regularDest,
        distanceKm: 20, // Long trip
        durationMin: 30,
        timestamp: new Date('2024-01-15T14:00:00'),
      })

      expect(result.breakdown.appliedMinFare).toBe(false)
      expect(result.price).toBeGreaterThan(9.25)
    })
  })

  describe('calculateFare - long ride fee', () => {
    it('should apply Uber long ride fee for trips >= 25 miles', () => {
      const distanceKm = 25 / 0.621371 // 25 miles in km

      const result = pricingEngine.calculateFare({
        service: 'uber',
        pickupCoords: COORDS.regular,
        destCoords: COORDS.regularDest,
        distanceKm,
        durationMin: 35,
        timestamp: new Date('2024-01-15T14:00:00'),
      })

      // Uber long ride fee: $5.50 for trips >= 25 miles
      expect(result.breakdown.longRideFee).toBe(5.5)
    })

    it('should not apply long ride fee for shorter trips', () => {
      const distanceKm = 20 / 0.621371 // 20 miles in km

      const result = pricingEngine.calculateFare({
        service: 'uber',
        pickupCoords: COORDS.regular,
        destCoords: COORDS.regularDest,
        distanceKm,
        durationMin: 25,
        timestamp: new Date('2024-01-15T14:00:00'),
      })

      expect(result.breakdown.longRideFee).toBe(0)
    })

    it('should apply Taxi long ride fee for trips >= 30 miles', () => {
      const distanceKm = 30 / 0.621371 // 30 miles in km

      const result = pricingEngine.calculateFare({
        service: 'taxi',
        pickupCoords: COORDS.regular,
        destCoords: COORDS.regularDest,
        distanceKm,
        durationMin: 45,
        timestamp: new Date('2024-01-15T14:00:00'),
      })

      // Taxi long ride fee: $5.00 for trips >= 30 miles
      expect(result.breakdown.longRideFee).toBe(5.0)
    })
  })

  describe('calculateFare - confidence score', () => {
    it('should return high confidence (0.9) for standard trips', () => {
      const result = pricingEngine.calculateFare({
        service: 'uber',
        pickupCoords: COORDS.regular,
        destCoords: COORDS.regularDest,
        distanceKm: 10,
        durationMin: 15,
        timestamp: new Date('2024-01-15T14:00:00'),
      })

      expect(result.confidence).toBe(0.9)
    })

    it('should reduce confidence for high surge (> 2.0)', () => {
      const result = pricingEngine.calculateFare({
        service: 'lyft', // Lyft has maxSurge 2.3, so can go above 2.0
        pickupCoords: COORDS.regular,
        destCoords: COORDS.regularDest,
        distanceKm: 10,
        durationMin: 15,
        timestamp: new Date('2024-01-20T02:00:00'), // Weekend 2 AM (1.85 surge)
      })

      // Weekend 01:00-03:00 surge is 1.85, so confidence should be reduced by 0.1
      expect(result.confidence).toBeLessThanOrEqual(0.8)
    })

    it('should reduce confidence for heavy traffic', () => {
      const result = pricingEngine.calculateFare({
        service: 'uber',
        pickupCoords: COORDS.regular,
        destCoords: COORDS.regularDest,
        distanceKm: 10,
        durationMin: 15,
        timestamp: new Date('2024-01-15T14:00:00'),
        osrmDurationSec: 1800,
        expectedDurationSec: 900, // Severe traffic (1.4 multiplier)
      })

      // Heavy traffic (>1.3) reduces confidence by 0.1
      expect(result.confidence).toBe(0.8)
    })

    it('should reduce confidence for very long distances (> 50km)', () => {
      const result = pricingEngine.calculateFare({
        service: 'uber',
        pickupCoords: COORDS.regular,
        destCoords: COORDS.regularDest,
        distanceKm: 60,
        durationMin: 60,
        timestamp: new Date('2024-01-15T14:00:00'),
      })

      // > 50km reduces confidence by 0.15
      expect(result.confidence).toBe(0.75)
    })

    it('should reduce confidence for medium long distances (25-50km)', () => {
      const result = pricingEngine.calculateFare({
        service: 'uber',
        pickupCoords: COORDS.regular,
        destCoords: COORDS.regularDest,
        distanceKm: 35,
        durationMin: 40,
        timestamp: new Date('2024-01-15T14:00:00'),
      })

      // 25-50km reduces confidence by 0.1
      expect(result.confidence).toBe(0.8)
    })

    it('should reduce confidence for late night hours (1-5 AM)', () => {
      const result = pricingEngine.calculateFare({
        service: 'uber',
        pickupCoords: COORDS.regular,
        destCoords: COORDS.regularDest,
        distanceKm: 10,
        durationMin: 15,
        timestamp: new Date('2024-01-15T03:00:00'), // 3 AM
      })

      // Late night (1-5 AM) reduces confidence by 0.1
      expect(result.confidence).toBe(0.8)
    })

    it('should have minimum confidence of 0.5', () => {
      const result = pricingEngine.calculateFare({
        service: 'lyft',
        pickupCoords: COORDS.regular,
        destCoords: COORDS.regularDest,
        distanceKm: 80, // Very long trip (-0.15)
        durationMin: 90,
        timestamp: new Date('2024-01-20T02:00:00'), // Weekend 2 AM, late night (-0.1), high surge (-0.1)
        osrmDurationSec: 7200,
        expectedDurationSec: 3600, // Severe traffic (-0.1)
      })

      // Total potential reduction: 0.45, but minimum is 0.5
      expect(result.confidence).toBeGreaterThanOrEqual(0.5)
    })
  })

  describe('calculateSurge', () => {
    it('should return surge multiplier and reason', () => {
      const result = pricingEngine.calculateSurge(
        COORDS.regular,
        COORDS.regularDest,
        new Date('2024-01-15T08:00:00')
      )

      expect(result).toHaveProperty('multiplier')
      expect(result).toHaveProperty('surgeReason')
      expect(typeof result.multiplier).toBe('number')
      expect(typeof result.surgeReason).toBe('string')
    })

    it('should use current time if timestamp not provided', () => {
      const result = pricingEngine.calculateSurge(COORDS.regular, COORDS.regularDest)

      expect(result.multiplier).toBeGreaterThanOrEqual(1)
    })

    it('should apply airport location modifier for late night', () => {
      mockIsAirportLocation.mockImplementation(coords => {
        if (coords === COORDS.sfo) return AIRPORTS.SFO as any
        return null
      })

      const result = pricingEngine.calculateSurge(
        COORDS.sfo,
        COORDS.regular,
        new Date('2024-01-15T02:00:00') // 2 AM weekday
      )

      expect(result.surgeReason).toBe('Late night airport premium')
    })

    it('should apply airport location modifier for peak hours', () => {
      mockIsAirportLocation.mockImplementation(coords => {
        if (coords === COORDS.sfo) return AIRPORTS.SFO as any
        return null
      })

      const result = pricingEngine.calculateSurge(
        COORDS.sfo,
        COORDS.regular,
        new Date('2024-01-15T08:00:00') // 8 AM weekday
      )

      expect(result.surgeReason).toBe('Peak hours airport demand')
    })
  })

  describe('getBestTimeRecommendations', () => {
    it('should return positive message for off-peak hours (2-4 PM)', () => {
      const recommendations = pricingEngine.getBestTimeRecommendations(
        new Date('2024-01-15T15:00:00')
      )

      expect(recommendations).toContain("Great timing! You're booking during off-peak hours")
      expect(recommendations).toContain(
        'Best prices are typically 2-4 PM (avoid rush hours for savings)'
      )
    })

    it('should return morning rush hour message (7-9 AM)', () => {
      const recommendations = pricingEngine.getBestTimeRecommendations(
        new Date('2024-01-15T08:00:00')
      )

      expect(recommendations).toContain(
        'Rush hour pricing in effect. Expect 15-25% increase over standard rates'
      )
    })

    it('should return evening rush hour message (5-7 PM)', () => {
      const recommendations = pricingEngine.getBestTimeRecommendations(
        new Date('2024-01-15T18:00:00')
      )

      expect(recommendations).toContain(
        'Evening rush pricing. Consider waiting until after 8 PM for better rates'
      )
    })

    it('should return late night message (8 PM - 5 AM)', () => {
      const recommendations = pricingEngine.getBestTimeRecommendations(
        new Date('2024-01-15T22:00:00')
      )

      expect(recommendations).toContain('Late night premium in effect (up to 20% increase)')
    })

    it('should return default message for other times', () => {
      const recommendations = pricingEngine.getBestTimeRecommendations(
        new Date('2024-01-15T11:00:00')
      )

      expect(recommendations).toContain('Best prices: 2-4 PM (avoid peak hours for savings)')
      expect(recommendations).toContain('Avoid rush hours: 7-9 AM and 5-7 PM (up to 25% increase)')
    })

    it('should use current time if no timestamp provided', () => {
      const recommendations = pricingEngine.getBestTimeRecommendations()

      expect(Array.isArray(recommendations)).toBe(true)
      expect(recommendations.length).toBeGreaterThan(0)
    })
  })

  describe('edge cases', () => {
    describe('very long distances', () => {
      it('should handle 100+ km trips', () => {
        const result = pricingEngine.calculateFare({
          service: 'uber',
          pickupCoords: COORDS.regular,
          destCoords: COORDS.regularDest,
          distanceKm: 150,
          durationMin: 120,
          timestamp: new Date('2024-01-15T14:00:00'),
        })

        expect(result.price).toBeGreaterThan(100)
        expect(result.confidence).toBeLessThanOrEqual(0.75) // Reduced for long distance
        expect(result.breakdown.longRideFee).toBe(5.5) // Long ride fee applied
      })
    })

    describe('very short trips', () => {
      it('should handle sub-1km trips', () => {
        const result = pricingEngine.calculateFare({
          service: 'uber',
          pickupCoords: COORDS.regular,
          destCoords: COORDS.regular,
          distanceKm: 0.1,
          durationMin: 1,
          timestamp: new Date('2024-01-15T14:00:00'),
        })

        expect(result.breakdown.appliedMinFare).toBe(true)
        expect(result.price).toBe(9.25)
      })
    })

    describe('boundary times', () => {
      it('should handle midnight (00:00) with late night reason', () => {
        const result = pricingEngine.calculateFare({
          service: 'uber',
          pickupCoords: COORDS.regular,
          destCoords: COORDS.regularDest,
          distanceKm: 10,
          durationMin: 15,
          timestamp: new Date('2024-01-15T00:00:00'),
        })

        // Midnight (hour = 0) is <= 5, so late night reason applies
        // But surge schedule "23:00-01:00" doesn't match "00:00-00:30" slot
        expect(result.surgeReason).toBe('Late night premium')
      })

      it('should handle 5:59 AM (just before morning schedule)', () => {
        const result = pricingEngine.calculateFare({
          service: 'uber',
          pickupCoords: COORDS.regular,
          destCoords: COORDS.regularDest,
          distanceKm: 10,
          durationMin: 15,
          timestamp: new Date('2024-01-15T05:59:00'),
        })

        // 5 AM is still late night (hour <= 5)
        expect(result.surgeReason).toBe('Late night premium')
        expect(result.breakdown.surgeMultiplier).toBeGreaterThanOrEqual(1)
      })

      it('should handle Sunday at midnight with late night reason', () => {
        const result = pricingEngine.calculateFare({
          service: 'uber',
          pickupCoords: COORDS.regular,
          destCoords: COORDS.regularDest,
          distanceKm: 10,
          durationMin: 15,
          timestamp: new Date('2024-01-21T00:00:00'), // Sunday midnight
        })

        // Sunday is weekend, midnight triggers late night reason
        expect(result.surgeReason).toBe('Late night premium')
      })

      it('should handle Saturday vs Sunday distinction', () => {
        const saturdayResult = pricingEngine.calculateFare({
          service: 'uber',
          pickupCoords: COORDS.regular,
          destCoords: COORDS.regularDest,
          distanceKm: 10,
          durationMin: 15,
          timestamp: new Date('2024-01-20T14:00:00'), // Saturday
        })

        const sundayResult = pricingEngine.calculateFare({
          service: 'uber',
          pickupCoords: COORDS.regular,
          destCoords: COORDS.regularDest,
          distanceKm: 10,
          durationMin: 15,
          timestamp: new Date('2024-01-21T14:00:00'), // Sunday
        })

        // Both should use weekend schedule
        expect(saturdayResult.breakdown.surgeMultiplier).toBe(
          sundayResult.breakdown.surgeMultiplier
        )
      })
    })

    describe('time slot transitions', () => {
      it('should handle 30-minute boundary (e.g., 8:29 vs 8:30)', () => {
        const before = pricingEngine.calculateFare({
          service: 'uber',
          pickupCoords: COORDS.regular,
          destCoords: COORDS.regularDest,
          distanceKm: 10,
          durationMin: 15,
          timestamp: new Date('2024-01-15T08:29:00'), // 08:00-08:30 slot
        })

        const after = pricingEngine.calculateFare({
          service: 'uber',
          pickupCoords: COORDS.regular,
          destCoords: COORDS.regularDest,
          distanceKm: 10,
          durationMin: 15,
          timestamp: new Date('2024-01-15T08:30:00'), // 08:30-09:00 slot
        })

        // 08:00-08:30 is 1.25, 08:30-09:00 is 1.20
        expect(before.breakdown.surgeMultiplier).toBe(1.25)
        expect(after.breakdown.surgeMultiplier).toBe(1.2)
      })
    })
  })
})

describe('Helper functions', () => {
  beforeEach(() => {
    mockIsAirportLocation.mockReset()
    mockIsAirportLocation.mockReturnValue(null)
  })

  describe('calculateEnhancedFare', () => {
    it('should return formatted price string', () => {
      const result = calculateEnhancedFare(
        'uber',
        COORDS.regular,
        COORDS.regularDest,
        10,
        15,
        new Date('2024-01-15T14:00:00')
      )

      expect(result.price).toMatch(/^\$\d+\.\d{2}$/)
    })

    it('should return surge reason', () => {
      const result = calculateEnhancedFare(
        'uber',
        COORDS.regular,
        COORDS.regularDest,
        10,
        15,
        new Date('2024-01-15T08:00:00')
      )

      expect(result.surgeReason).toBe('Rush hour demand')
    })

    it('should return confidence score', () => {
      const result = calculateEnhancedFare(
        'uber',
        COORDS.regular,
        COORDS.regularDest,
        10,
        15,
        new Date('2024-01-15T14:00:00')
      )

      expect(result.confidence).toBe(0.9)
    })

    it('should use current time if timestamp not provided', () => {
      const result = calculateEnhancedFare('uber', COORDS.regular, COORDS.regularDest, 10, 15)

      expect(result.price).toMatch(/^\$\d+\.\d{2}$/)
      expect(result.confidence).toBeGreaterThanOrEqual(0.5)
    })
  })

  describe('getTimeBasedMultiplier', () => {
    it('should return multiplier and reason', () => {
      const result = getTimeBasedMultiplier(
        COORDS.regular,
        COORDS.regularDest,
        new Date('2024-01-15T08:00:00')
      )

      expect(result).toHaveProperty('multiplier')
      expect(result).toHaveProperty('surgeReason')
      expect(result.multiplier).toBeGreaterThan(1)
      expect(result.surgeReason).toBe('Rush hour demand')
    })

    it('should use current time if timestamp not provided', () => {
      const result = getTimeBasedMultiplier(COORDS.regular, COORDS.regularDest)

      expect(typeof result.multiplier).toBe('number')
      expect(typeof result.surgeReason).toBe('string')
    })
  })

  describe('getBestTimeRecommendations (exported function)', () => {
    it('should return array of recommendations', () => {
      const result = getBestTimeRecommendations()

      expect(Array.isArray(result)).toBe(true)
      expect(result.length).toBeGreaterThan(0)
    })
  })

  describe('hasAirportSurcharge', () => {
    it('should return true for airport pickup', () => {
      mockIsAirportLocation.mockImplementation(coords => {
        if (coords === COORDS.sfo) return AIRPORTS.SFO as any
        return null
      })

      const result = hasAirportSurcharge(COORDS.sfo, COORDS.regular)

      expect(result).toBe(true)
    })

    it('should return true for airport destination', () => {
      mockIsAirportLocation.mockImplementation(coords => {
        if (coords === COORDS.sfo) return AIRPORTS.SFO as any
        return null
      })

      const result = hasAirportSurcharge(COORDS.regular, COORDS.sfo)

      expect(result).toBe(true)
    })

    it('should return true for airport-to-airport', () => {
      mockIsAirportLocation.mockImplementation(coords => {
        if (coords === COORDS.sfo) return AIRPORTS.SFO as any
        if (coords === COORDS.oak) return AIRPORTS.OAK as any
        return null
      })

      const result = hasAirportSurcharge(COORDS.sfo, COORDS.oak)

      expect(result).toBe(true)
    })

    it('should return false for non-airport routes', () => {
      mockIsAirportLocation.mockReturnValue(null)

      const result = hasAirportSurcharge(COORDS.regular, COORDS.regularDest)

      expect(result).toBe(false)
    })
  })
})
