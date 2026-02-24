'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import dynamic from 'next/dynamic'
import { Loader2, Locate, Shield, Plane, ArrowRight } from 'lucide-react'
import RideComparisonResults from './ride-comparison-results'
import RouteHeader from './route-header'
import { Skeleton } from './ui/skeleton'

// Lazy-load RouteMap to defer loading the 300KB MapLibre library
const RouteMap = dynamic(() => import('./RouteMap'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-64 rounded-xl bg-muted animate-pulse flex items-center justify-center">
      <span className="text-muted-foreground text-sm">Loading map...</span>
    </div>
  ),
})
import { LocationInput } from './location-input'
import { AirportSelector } from './airport-selector'
import { useRecaptcha } from '@/lib/hooks/use-recaptcha'
import { useUserLocation } from '@/lib/hooks/useUserLocation'
import { RECAPTCHA_CONFIG } from '@/lib/recaptcha'
import { getAirportByCode } from '@/lib/airports'
import { findPrecomputedRouteByAddresses } from '@/lib/popular-routes-data'
import type { LocationSuggestion, CommonPlaces, Coordinates, AIRecommendation } from '@/types'

// Common places for faster autocomplete
const COMMON_PLACES: CommonPlaces = {
  'santa clara university': {
    display_name: 'Santa Clara University, Santa Clara, CA, USA',
    name: 'Santa Clara University',
    lat: '37.3496',
    lon: '-121.9390',
  },
  'san jose airport': {
    display_name: 'San Jose International Airport (SJC), San Jose, CA, USA',
    name: 'San Jose Airport (SJC)',
    lat: '37.3639',
    lon: '-121.9289',
  },
  sjc: {
    display_name: 'San Jose International Airport (SJC), San Jose, CA, USA',
    name: 'San Jose Airport (SJC)',
    lat: '37.3639',
    lon: '-121.9289',
  },
  sfo: {
    display_name: 'San Francisco International Airport (SFO), San Francisco, CA, USA',
    name: 'San Francisco Airport (SFO)',
    lat: '37.6213',
    lon: '-122.3790',
  },
  'san francisco airport': {
    display_name: 'San Francisco International Airport (SFO), San Francisco, CA, USA',
    name: 'San Francisco Airport (SFO)',
    lat: '37.6213',
    lon: '-122.3790',
  },
  'oakland airport': {
    display_name: 'Oakland International Airport (OAK), Oakland, CA, USA',
    name: 'Oakland Airport (OAK)',
    lat: '37.7126',
    lon: '-122.2197',
  },
  oak: {
    display_name: 'Oakland International Airport (OAK), Oakland, CA, USA',
    name: 'Oakland Airport (OAK)',
    lat: '37.7126',
    lon: '-122.2197',
  },
  'stanford university': {
    display_name: 'Stanford University, Stanford, CA, USA',
    name: 'Stanford University',
    lat: '37.4275',
    lon: '-122.1697',
  },
  cupertino: {
    display_name: 'Cupertino, CA, USA',
    name: 'Cupertino',
    lat: '37.3230',
    lon: '-122.0322',
  },
  'apple park': {
    display_name: 'Apple Park, Cupertino, CA, USA',
    name: 'Apple Park',
    lat: '37.3349',
    lon: '-122.0090',
  },
  google: {
    display_name: 'Googleplex, Mountain View, CA, USA',
    name: 'Google Headquarters',
    lat: '37.4220',
    lon: '-122.0841',
  },
  'mountain view': {
    display_name: 'Mountain View, CA, USA',
    name: 'Mountain View',
    lat: '37.3861',
    lon: '-122.0839',
  },
  'palo alto': {
    display_name: 'Palo Alto, CA, USA',
    name: 'Palo Alto',
    lat: '37.4419',
    lon: '-122.1430',
  },
  'san jose': {
    display_name: 'San Jose, CA, USA',
    name: 'San Jose',
    lat: '37.3382',
    lon: '-121.8863',
  },
  'santa clara': {
    display_name: 'Santa Clara, CA, USA',
    name: 'Santa Clara',
    lat: '37.3541',
    lon: '-121.9552',
  },
  sunnyvale: {
    display_name: 'Sunnyvale, CA, USA',
    name: 'Sunnyvale',
    lat: '37.3688',
    lon: '-122.0363',
  },
  fremont: {
    display_name: 'Fremont, CA, USA',
    name: 'Fremont',
    lat: '37.5485',
    lon: '-121.9886',
  },
  'san francisco': {
    display_name: 'San Francisco, CA, USA',
    name: 'San Francisco',
    lat: '37.7749',
    lon: '-122.4194',
  },
  'downtown san jose': {
    display_name: 'Downtown San Jose, San Jose, CA, USA',
    name: 'Downtown San Jose',
    lat: '37.3382',
    lon: '-121.8863',
  },
}

// Constants
const AUTO_SUBMIT_DELAY_PRECOMPUTED_MS = 0 // Instant submit for precomputed routes
const AUTO_SUBMIT_DELAY_DYNAMIC_MS = 50 // Minimal delay for dynamic routes

// Type definitions
type RideService = {
  price: string
  waitTime: string
  driversNearby: number
  service: string
  surgeMultiplier?: string
}

type RideResults = {
  uber: RideService
  lyft: RideService
  taxi: RideService
  waymo?: RideService
}

type SurgeInfo = {
  isActive: boolean
  reason: string
  multiplier: number
}

interface RideComparisonFormProps {
  selectedRoute?: {
    pickup: string
    destination: string
  } | null
  onRouteProcessed?: () => void
}

export default function RideComparisonForm({
  selectedRoute,
  onRouteProcessed,
}: RideComparisonFormProps) {
  // reCAPTCHA integration
  const { executeRecaptcha, isLoaded: isRecaptchaLoaded, error: recaptchaError } = useRecaptcha()

  // User location hook
  const { getLocation, isGettingLocation, error: locationError } = useUserLocation()

  // Form state
  const [pickup, setPickup] = useState('')
  const [destination, setDestination] = useState('')
  const [showForm, setShowForm] = useState(true)

  // Loading states
  const [isLoading, setIsLoading] = useState(false)

  // Results state
  const [results, setResults] = useState<RideResults | null>(null)
  const [routeId, setRouteId] = useState<string | null>(null)
  const [insights, setInsights] = useState('')
  const [error, setError] = useState('')
  const [surgeInfo, setSurgeInfo] = useState<SurgeInfo | null>(null)
  const [timeRecommendations, setTimeRecommendations] = useState<string[]>([])
  const [aiRecommendations, setAiRecommendations] = useState<AIRecommendation[]>([])

  // Location state
  const [pickupCoords, setPickupCoords] = useState<Coordinates | null>(null)
  const [destinationCoords, setDestinationCoords] = useState<Coordinates | null>(null)

  // Airport selector state
  const [showAirportSelector, setShowAirportSelector] = useState(false)
  const [airportSelectorMode, setAirportSelectorMode] = useState<'pickup' | 'destination'>('pickup')

  // Request deduplication - track in-flight request to prevent duplicate submissions
  const currentRequestRef = useRef<string | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)

  // Refs for reCAPTCHA to avoid dependency changes triggering effect re-runs
  const isRecaptchaLoadedRef = useRef(isRecaptchaLoaded)
  const executeRecaptchaRef = useRef(executeRecaptcha)

  // Keep refs in sync with reCAPTCHA state
  useEffect(() => {
    isRecaptchaLoadedRef.current = isRecaptchaLoaded
    executeRecaptchaRef.current = executeRecaptcha
  }, [isRecaptchaLoaded, executeRecaptcha])

  // Handle location error from hook
  useEffect(() => {
    if (locationError) {
      setError(locationError)
    }
  }, [locationError])

  // Handle popular route selection
  // Uses refs for reCAPTCHA to prevent race conditions from dependency changes
  useEffect(() => {
    if (selectedRoute) {
      setPickup(selectedRoute.pickup)
      setDestination(selectedRoute.destination)
      setShowForm(true) // Ensure form is visible

      // Auto-submit the form after setting the values
      const submitForm = async () => {
        // Request deduplication for auto-submit
        const requestKey = `${selectedRoute.pickup}-${selectedRoute.destination}`

        // If this exact request is already in flight, ignore
        if (currentRequestRef.current === requestKey) {
          return
        }

        // Abort any previous request
        if (abortControllerRef.current) {
          abortControllerRef.current.abort()
        }

        const abortController = new AbortController()
        abortControllerRef.current = abortController
        currentRequestRef.current = requestKey

        setIsLoading(true)
        setResults(null)
        setRouteId(null)
        setInsights('')
        setError('')
        setPickupCoords(null)
        setDestinationCoords(null)

        try {
          // Get reCAPTCHA token using refs (access latest values without deps)
          let recaptchaToken = ''
          if (isRecaptchaLoadedRef.current) {
            try {
              recaptchaToken = await executeRecaptchaRef.current(
                RECAPTCHA_CONFIG.ACTIONS.RIDE_COMPARISON
              )
            } catch {
              // Continue without token if reCAPTCHA fails
            }
          }

          const response = await fetch('/api/compare-rides', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              pickup: selectedRoute.pickup,
              destination: selectedRoute.destination,
              recaptchaToken,
            }),
            signal: abortController.signal,
          }).catch(fetchError => {
            if (fetchError.name === 'AbortError') {
              return null
            }
            throw fetchError
          })

          // If request was aborted, exit early
          if (!response) return

          const data = await response.json()

          if (!response.ok) {
            setError('Failed to fetch ride comparisons for this route. Please try again.')
            return
          }

          setResults(data.comparisons)
          setRouteId(data.routeId || null)
          setInsights(data.insights)
          setPickupCoords(data.pickupCoords)
          setDestinationCoords(data.destinationCoords)
          setSurgeInfo(data.surgeInfo || null)
          setTimeRecommendations(data.timeRecommendations || [])
          setAiRecommendations(data.aiRecommendations || [])
          setShowForm(false)
        } catch {
          setError('Failed to get pricing for this route. Please try again.')
        } finally {
          setIsLoading(false)
          if (currentRequestRef.current === requestKey) {
            currentRequestRef.current = null
            abortControllerRef.current = null
          }
        }
      }

      // Check if route is precomputed - submit instantly if so, minimal delay otherwise
      const isPrecomputed = findPrecomputedRouteByAddresses(
        selectedRoute.pickup,
        selectedRoute.destination
      )
      const delay = isPrecomputed ? AUTO_SUBMIT_DELAY_PRECOMPUTED_MS : AUTO_SUBMIT_DELAY_DYNAMIC_MS
      const timeoutId = setTimeout(submitForm, delay)

      // Call the callback to clear the selected route
      onRouteProcessed?.()

      // Cleanup: cancel timeout if effect re-runs (e.g., route changes rapidly)
      return () => {
        clearTimeout(timeoutId)
      }
    }
  }, [selectedRoute, onRouteProcessed])

  // Handle pickup suggestion selection
  const handlePickupSelect = useCallback((suggestion: LocationSuggestion) => {
    setPickup(suggestion.display_name)
    // Immediately update coordinates for instant map response
    setPickupCoords([parseFloat(suggestion.lon), parseFloat(suggestion.lat)])
  }, [])

  // Handle destination suggestion selection
  const handleDestinationSelect = useCallback((suggestion: LocationSuggestion) => {
    setDestination(suggestion.display_name)
    // Immediately update coordinates for instant map response
    setDestinationCoords([parseFloat(suggestion.lon), parseFloat(suggestion.lat)])
  }, [])

  // Airport selector handlers
  const handleAirportSelect = useCallback(
    (airportCode: string, airportName: string) => {
      const airportString = `${airportName} (${airportCode})`

      const airport = getAirportByCode(airportCode)
      if (airport) {
        const coords: Coordinates = [airport.coordinates[0], airport.coordinates[1]]

        if (airportSelectorMode === 'pickup') {
          setPickup(airportString)
          setPickupCoords(coords)
        } else {
          setDestination(airportString)
          setDestinationCoords(coords)
        }
      } else {
        // Fallback if airport not found
        if (airportSelectorMode === 'pickup') {
          setPickup(airportString)
        } else {
          setDestination(airportString)
        }
      }

      setShowAirportSelector(false)
    },
    [airportSelectorMode]
  )

  const openAirportSelector = useCallback((mode: 'pickup' | 'destination') => {
    setAirportSelectorMode(mode)
    setShowAirportSelector(true)
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    // Request deduplication - create a unique key for this request
    const requestKey = `${pickup}-${destination}`

    // If this exact request is already in flight, ignore the duplicate
    if (currentRequestRef.current === requestKey && isLoading) {
      return
    }

    // Abort any previous in-flight request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }

    // Create new abort controller for this request
    const abortController = new AbortController()
    abortControllerRef.current = abortController
    currentRequestRef.current = requestKey

    setIsLoading(true)
    setResults(null)
    setRouteId(null)
    setInsights('')
    setError('')
    // Clear coordinates when starting a new search
    setPickupCoords(null)
    setDestinationCoords(null)

    try {
      // Execute reCAPTCHA v3 (invisible, no user interaction required)
      let recaptchaToken = ''
      if (isRecaptchaLoaded) {
        try {
          recaptchaToken = await executeRecaptcha(RECAPTCHA_CONFIG.ACTIONS.RIDE_COMPARISON)
        } catch {
          // Continue without reCAPTCHA token - the server will handle this gracefully
        }
      }

      const response = await fetch('/api/compare-rides', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          pickup,
          destination,
          recaptchaToken, // Include reCAPTCHA token if available
        }),
        signal: abortController.signal,
      }).catch(fetchError => {
        // Don't throw on abort
        if (fetchError.name === 'AbortError') {
          return null
        }
        throw new Error('Network error')
      })

      // If request was aborted, exit early
      if (!response) return

      const data = await response.json()

      if (!response.ok) {
        if (data.error && data.error.includes('geocode')) {
          setError('Please enter a more specific or valid address for both pickup and destination.')
        } else if (data.error && data.error.includes('required')) {
          setError('Both pickup and destination addresses are required.')
        } else {
          setError('Failed to fetch ride comparisons. Please try again.')
        }
        // Don't set coordinates on error - they should remain null
        return
      }

      setResults(data.comparisons)
      setRouteId(data.routeId || null)
      setInsights(data.insights)
      setPickupCoords(data.pickupCoords)
      setDestinationCoords(data.destinationCoords)
      setSurgeInfo(data.surgeInfo || null)
      setTimeRecommendations(data.timeRecommendations || [])
      setAiRecommendations(data.aiRecommendations || [])
      setShowForm(false)
    } catch {
      // Fallback to simulated data for demo purposes
      const basePrice = 15 + Math.random() * 10
      const baseWaitTime = 2 + Math.floor(Math.random() * 5)

      const simulatedResults = {
        uber: {
          price: `$${(basePrice * 1.05).toFixed(2)}`,
          waitTime: `${baseWaitTime} min`,
          driversNearby: Math.floor(3 + Math.random() * 5),
          service: 'UberX',
        },
        lyft: {
          price: `$${(basePrice * 0.95).toFixed(2)}`,
          waitTime: `${baseWaitTime + 1} min`,
          driversNearby: Math.floor(2 + Math.random() * 4),
          service: 'Lyft Standard',
        },
        taxi: {
          price: `$${(basePrice * 1.2).toFixed(2)}`,
          waitTime: `${baseWaitTime + 3} min`,
          driversNearby: Math.floor(1 + Math.random() * 3),
          service: 'Yellow Cab',
        },
      }

      setResults(simulatedResults)
      setRouteId(null) // Simulated data has no real route
      setAiRecommendations([])
      setInsights(
        'Based on price and wait time, Lyft appears to be your best option for this trip.'
      )
      setError('Note: Using simulated data due to API connection issues.')
      setShowForm(false)
    } finally {
      setIsLoading(false)
      // Clear request tracking
      if (currentRequestRef.current === requestKey) {
        currentRequestRef.current = null
        abortControllerRef.current = null
      }
    }
  }

  // Get user's current location
  const handleUseMyLocation = useCallback(async () => {
    const result = await getLocation()
    if (result) {
      setPickup(result.address)
      setPickupCoords(result.coordinates)
    }
  }, [getLocation])

  // Swap pickup and destination
  const handleSwap = useCallback(() => {
    const tempPickup = pickup
    const tempPickupCoords = pickupCoords
    setPickup(destination)
    setDestination(tempPickup)
    setPickupCoords(destinationCoords)
    setDestinationCoords(tempPickupCoords)
    if (navigator.vibrate) {
      navigator.vibrate(30)
    }
  }, [pickup, destination, pickupCoords, destinationCoords])

  const handleEdit = useCallback(() => {
    setShowForm(true)
  }, [])

  const handleReset = useCallback(() => {
    setPickup('')
    setDestination('')
    setResults(null)
    setRouteId(null)
    setInsights('')
    setError('')
    setPickupCoords(null)
    setDestinationCoords(null)
    setAiRecommendations([])
    setShowForm(true)
  }, [])

  return (
    <div className="w-full max-w-3xl mx-auto">
      {!showForm && results && (
        <RouteHeader
          origin={pickup}
          destination={destination}
          onEdit={handleEdit}
          onReset={handleReset}
        />
      )}

      {showForm && (
        <div className="transition-all duration-300">
          <form onSubmit={handleSubmit} className="space-y-8">
            {/* Pickup Location Input */}
            <LocationInput
              id="pickup"
              label="Pickup Location"
              placeholder="Enter pickup location"
              value={pickup}
              onChange={setPickup}
              onSelect={handlePickupSelect}
              commonPlaces={COMMON_PLACES}
              labelIcon={
                <span className="w-1.5 h-1.5 bg-primary rounded-full mr-2 animate-pulse-dot"></span>
              }
              headerAction={
                <button
                  type="button"
                  onClick={handleUseMyLocation}
                  disabled={isGettingLocation}
                  className="flex items-center text-xs text-primary hover:text-primary/80 disabled:opacity-50 touch-none select-none transition-colors"
                  title="Use my current location"
                >
                  {isGettingLocation ? (
                    <Loader2 className="h-3 w-3 animate-spin mr-1.5" />
                  ) : (
                    <Locate className="h-3 w-3 mr-1.5" />
                  )}
                  <span className="hidden sm:inline">Use my location</span>
                  <span className="sm:hidden">
                    <Locate className="h-4 w-4" />
                  </span>
                </button>
              }
            />

            {/* Airport Quick Select for Pickup */}
            <div className="flex items-center justify-start ml-1">
              <button
                type="button"
                onClick={() => openAirportSelector('pickup')}
                className="flex items-center text-xs text-muted-foreground hover:text-primary transition-colors px-3 py-1.5 rounded-lg hover:bg-muted/50"
              >
                <Plane className="h-3.5 w-3.5 mr-2" />
                <span>Select airport</span>
              </button>
            </div>

            {/* Destination Input */}
            <LocationInput
              id="destination"
              label="Destination"
              placeholder="Enter destination"
              value={destination}
              onChange={setDestination}
              onSelect={handleDestinationSelect}
              commonPlaces={COMMON_PLACES}
              labelIcon={
                <span className="w-1.5 h-1.5 bg-secondary rounded-full mr-2 animate-pulse-dot"></span>
              }
              headerAction={
                <button
                  type="button"
                  onClick={handleSwap}
                  className="flex items-center text-xs text-muted-foreground hover:text-foreground touch-none select-none transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  title="Swap pickup and destination"
                  disabled={!pickup || !destination}
                >
                  <span className="text-sm mr-1.5">&#x21C5;</span>
                  <span className="hidden sm:inline">Swap</span>
                </button>
              }
            />

            {/* Airport Quick Select for Destination */}
            <div className="flex items-center justify-start ml-1">
              <button
                type="button"
                onClick={() => openAirportSelector('destination')}
                className="flex items-center text-xs text-muted-foreground hover:text-primary transition-colors px-3 py-1.5 rounded-lg hover:bg-muted/50"
              >
                <Plane className="h-3.5 w-3.5 mr-2" />
                <span>Select airport</span>
              </button>
            </div>

            <button
              type="submit"
              className="w-full bg-primary hover:bg-primary/90 text-primary-foreground py-4 px-6 rounded-xl font-semibold text-base shadow-sm hover:shadow-lg hover:shadow-primary/25 hover:scale-[1.02] transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed btn-glow"
              disabled={isLoading}
              onTouchStart={() => {
                if (navigator.vibrate) {
                  navigator.vibrate(20)
                }
              }}
            >
              {isLoading ? (
                <div className="flex items-center justify-center">
                  <Loader2 className="h-5 w-5 animate-spin mr-2" />
                  <span>Comparing prices...</span>
                </div>
              ) : (
                <div className="flex items-center justify-center">
                  <span>Compare Rides</span>
                  <ArrowRight className="w-5 h-5 ml-2" />
                </div>
              )}
            </button>

            {/* reCAPTCHA Protection Indicator */}
            <div className="flex items-center justify-center text-xs text-muted-foreground/70 mt-3">
              <Shield className="h-3 w-3 mr-1.5" />
              {isRecaptchaLoaded ? (
                <span>Protected by reCAPTCHA</span>
              ) : recaptchaError ? (
                <span className="text-muted-foreground">Security loading...</span>
              ) : (
                <span>Loading security...</span>
              )}
            </div>
          </form>
        </div>
      )}

      {/* Airport Selector Modal */}
      <AirportSelector
        isOpen={showAirportSelector}
        onClose={() => setShowAirportSelector(false)}
        onSelect={handleAirportSelect}
        mode={airportSelectorMode}
      />

      {error && (
        <div className="mt-6 p-4 bg-destructive/10 text-destructive rounded-xl border border-destructive/20">
          <div className="flex items-center">
            <svg
              className="h-5 w-5 mr-3 flex-shrink-0"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <span className="text-sm">{error}</span>
          </div>
        </div>
      )}

      <section className="space-y-6">
        {pickupCoords && destinationCoords && (
          <RouteMap
            key={`${pickupCoords[0]}-${pickupCoords[1]}-${destinationCoords[0]}-${destinationCoords[1]}`}
            pickup={pickupCoords}
            destination={destinationCoords}
          />
        )}

        {/* Skeleton loading cards */}
        {isLoading && !results && (
          <div className="w-full max-w-6xl mx-auto space-y-8">
            {/* Skeleton header */}
            <div className="flex items-center justify-between">
              <Skeleton className="h-10 w-48" />
              <div className="flex gap-2">
                <Skeleton className="h-9 w-20" />
                <Skeleton className="h-9 w-20" />
                <Skeleton className="h-9 w-20" />
              </div>
            </div>

            {/* Skeleton quick summary */}
            <div className="card-elevated rounded-2xl p-6 sm:p-8">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-center">
                {[1, 2, 3].map(i => (
                  <div key={i} className="space-y-2 flex flex-col items-center">
                    <Skeleton className="h-10 w-24" />
                    <Skeleton className="h-4 w-32" />
                  </div>
                ))}
              </div>
            </div>

            {/* Skeleton ride cards */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {[1, 2, 3].map(i => (
                <div key={i} className="card-elevated rounded-2xl overflow-hidden">
                  <Skeleton className="h-1 w-full" />
                  <div className="p-5">
                    {/* Header */}
                    <div className="flex items-center gap-3 mb-6">
                      <Skeleton className="w-12 h-12 rounded-xl" />
                      <div className="space-y-2">
                        <Skeleton className="h-6 w-20" />
                        <Skeleton className="h-3 w-24" />
                      </div>
                    </div>

                    {/* Price */}
                    <div className="mb-6 pb-6 border-b border-border/50">
                      <div className="flex items-baseline justify-between">
                        <Skeleton className="h-4 w-24" />
                        <Skeleton className="h-10 w-20" />
                      </div>
                    </div>

                    {/* Metrics */}
                    <div className="grid grid-cols-2 gap-3 mb-6">
                      <div className="bg-muted/30 p-3 rounded-xl space-y-2">
                        <Skeleton className="h-3 w-16" />
                        <Skeleton className="h-6 w-12" />
                      </div>
                      <div className="bg-muted/30 p-3 rounded-xl space-y-2">
                        <Skeleton className="h-3 w-20" />
                        <Skeleton className="h-6 w-8" />
                      </div>
                    </div>

                    {/* Buttons */}
                    <div className="space-y-3">
                      <Skeleton className="h-12 w-full rounded-xl" />
                      <Skeleton className="h-8 w-full rounded-lg" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {results && (
          <RideComparisonResults
            routeId={routeId}
            results={results}
            insights={insights}
            surgeInfo={surgeInfo}
            pickup={pickup}
            destination={destination}
            pickupCoords={pickupCoords}
            destinationCoords={destinationCoords}
          />
        )}
      </section>
    </div>
  )
}
