'use client'

import { useState, useEffect, useCallback } from 'react'
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
import { useRideComparison } from '@/lib/hooks/useRideComparison'
import { RECAPTCHA_CONFIG } from '@/lib/recaptcha'
import { getAirportByCode } from '@/lib/airports'
import { findPrecomputedRouteByAddresses } from '@/lib/popular-routes-data'
import type { LocationSuggestion, CommonPlaces, Coordinates } from '@/types'

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

const AUTO_SUBMIT_DELAY_PRECOMPUTED_MS = 0
const AUTO_SUBMIT_DELAY_DYNAMIC_MS = 50

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
  const { executeRecaptcha, isLoaded: isRecaptchaLoaded, error: recaptchaError } = useRecaptcha()
  const { getLocation, isGettingLocation, error: locationError } = useUserLocation()
  const {
    data,
    error: comparisonError,
    isLoading,
    isRefreshing,
    clearError: clearComparisonError,
    reset: resetComparison,
    submitComparison,
  } = useRideComparison()

  const [pickup, setPickup] = useState('')
  const [destination, setDestination] = useState('')
  const [showForm, setShowForm] = useState(true)
  const [pickupCoords, setPickupCoords] = useState<Coordinates | null>(null)
  const [destinationCoords, setDestinationCoords] = useState<Coordinates | null>(null)
  const [showAirportSelector, setShowAirportSelector] = useState(false)
  const [airportSelectorMode, setAirportSelectorMode] = useState<'pickup' | 'destination'>('pickup')
  const [localError, setLocalError] = useState('')

  const getRecaptchaToken = useCallback(async () => {
    if (!isRecaptchaLoaded) {
      return ''
    }

    return executeRecaptcha(RECAPTCHA_CONFIG.ACTIONS.RIDE_COMPARISON)
  }, [executeRecaptcha, isRecaptchaLoaded])

  useEffect(() => {
    if (selectedRoute) {
      const submitForm = async () => {
        setPickup(selectedRoute.pickup)
        setDestination(selectedRoute.destination)
        setPickupCoords(null)
        setDestinationCoords(null)
        setShowForm(true)
        setLocalError('')
        clearComparisonError()
        const wasSuccessful = await submitComparison({
          pickup: selectedRoute.pickup,
          destination: selectedRoute.destination,
          getRecaptchaToken,
        })

        if (wasSuccessful) {
          setShowForm(false)
        }
      }

      const isPrecomputed = findPrecomputedRouteByAddresses(
        selectedRoute.pickup,
        selectedRoute.destination
      )
      const delay = isPrecomputed ? AUTO_SUBMIT_DELAY_PRECOMPUTED_MS : AUTO_SUBMIT_DELAY_DYNAMIC_MS
      const timeoutId = setTimeout(submitForm, delay)

      onRouteProcessed?.()

      return () => {
        clearTimeout(timeoutId)
      }
    }
  }, [selectedRoute, onRouteProcessed, submitComparison, getRecaptchaToken, clearComparisonError])

  const handlePickupChange = useCallback(
    (value: string) => {
      setPickup(value)
      setPickupCoords(null)
      setLocalError('')
      clearComparisonError()
    },
    [clearComparisonError]
  )

  const handleDestinationChange = useCallback(
    (value: string) => {
      setDestination(value)
      setDestinationCoords(null)
      setLocalError('')
      clearComparisonError()
    },
    [clearComparisonError]
  )

  const handlePickupSelect = useCallback(
    (suggestion: LocationSuggestion) => {
      setPickup(suggestion.display_name)
      setPickupCoords([parseFloat(suggestion.lon), parseFloat(suggestion.lat)])
      setLocalError('')
      clearComparisonError()
    },
    [clearComparisonError]
  )

  const handleDestinationSelect = useCallback(
    (suggestion: LocationSuggestion) => {
      setDestination(suggestion.display_name)
      setDestinationCoords([parseFloat(suggestion.lon), parseFloat(suggestion.lat)])
      setLocalError('')
      clearComparisonError()
    },
    [clearComparisonError]
  )

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
        if (airportSelectorMode === 'pickup') {
          setPickup(airportString)
        } else {
          setDestination(airportString)
        }
      }

      setShowAirportSelector(false)
      setLocalError('')
      clearComparisonError()
    },
    [airportSelectorMode, clearComparisonError]
  )

  const openAirportSelector = useCallback((mode: 'pickup' | 'destination') => {
    setAirportSelectorMode(mode)
    setShowAirportSelector(true)
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLocalError('')
    clearComparisonError()

    const wasSuccessful = await submitComparison({
      pickup,
      destination,
      pickupCoords,
      destinationCoords,
      getRecaptchaToken,
    })

    if (wasSuccessful) {
      setShowForm(false)
    }
  }

  const handleRetry = useCallback(async () => {
    if (!pickup || !destination || isLoading) {
      return
    }

    setLocalError('')
    clearComparisonError()

    const wasSuccessful = await submitComparison({
      pickup,
      destination,
      pickupCoords,
      destinationCoords,
      getRecaptchaToken,
    })

    if (wasSuccessful) {
      setShowForm(false)
    }
  }, [
    pickup,
    destination,
    pickupCoords,
    destinationCoords,
    isLoading,
    submitComparison,
    getRecaptchaToken,
    clearComparisonError,
  ])

  const handleUseMyLocation = useCallback(async () => {
    const result = await getLocation()
    if (result) {
      setPickup(result.address)
      setPickupCoords(result.coordinates)
      setLocalError('')
      clearComparisonError()
    }
  }, [getLocation, clearComparisonError])

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
    setLocalError('')
    clearComparisonError()
  }, [clearComparisonError])

  const handleReset = useCallback(() => {
    setPickup('')
    setDestination('')
    setPickupCoords(null)
    setDestinationCoords(null)
    setLocalError('')
    clearComparisonError()
    resetComparison()
    setShowForm(true)
  }, [clearComparisonError, resetComparison])

  const errorMessage = localError || comparisonError || locationError || ''
  const results = data?.comparisons ?? null
  const routeId = data?.routeId ?? null
  const insights = data?.insights ?? ''
  const surgeInfo = data?.surgeInfo ?? null
  const timeRecommendations = data?.timeRecommendations ?? []
  const aiRecommendations = data?.aiRecommendations ?? []
  const routeAccuracy = data?.routeAccuracy ?? null
  const routeWarning = data?.routeWarning ?? ''
  const mapPickupCoords = data?.pickupCoords ?? pickupCoords
  const mapDestinationCoords = data?.destinationCoords ?? destinationCoords

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
            <LocationInput
              id="pickup"
              label="Pickup Location"
              placeholder="Enter pickup location"
              value={pickup}
              onChange={handlePickupChange}
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

            <LocationInput
              id="destination"
              label="Destination"
              placeholder="Enter destination"
              value={destination}
              onChange={handleDestinationChange}
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
                  <span>{isRefreshing ? 'Refreshing prices...' : 'Comparing prices...'}</span>
                </div>
              ) : (
                <div className="flex items-center justify-center">
                  <span>Compare Rides</span>
                  <ArrowRight className="w-5 h-5 ml-2" />
                </div>
              )}
            </button>

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

      <AirportSelector
        isOpen={showAirportSelector}
        onClose={() => setShowAirportSelector(false)}
        onSelect={handleAirportSelect}
        mode={airportSelectorMode}
      />

      {errorMessage && (
        <div className="mt-6 p-4 bg-destructive/10 text-destructive rounded-xl border border-destructive/20">
          <div className="flex items-start justify-between gap-4">
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
              <span className="text-sm">{errorMessage}</span>
            </div>
            <button
              type="button"
              onClick={handleRetry}
              disabled={isLoading || !pickup || !destination}
              className="shrink-0 rounded-lg border border-destructive/30 px-3 py-1.5 text-xs font-medium text-destructive transition-colors hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Retry
            </button>
          </div>
        </div>
      )}

      {isRefreshing && results && (
        <div className="mt-6 flex items-center gap-2 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm text-primary">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>Refreshing your latest comparison while keeping the current results visible.</span>
        </div>
      )}

      <section className="space-y-6">
        {mapPickupCoords && mapDestinationCoords && (
          <RouteMap
            key={`${mapPickupCoords[0]}-${mapPickupCoords[1]}-${mapDestinationCoords[0]}-${mapDestinationCoords[1]}`}
            pickup={mapPickupCoords}
            destination={mapDestinationCoords}
          />
        )}

        {isLoading && !results && (
          <div className="w-full max-w-6xl mx-auto space-y-8">
            <div className="flex items-center justify-between">
              <Skeleton className="h-10 w-48" />
              <div className="flex gap-2">
                <Skeleton className="h-9 w-20" />
                <Skeleton className="h-9 w-20" />
                <Skeleton className="h-9 w-20" />
              </div>
            </div>
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
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {[1, 2, 3].map(i => (
                <div key={i} className="card-elevated rounded-2xl overflow-hidden">
                  <Skeleton className="h-1 w-full" />
                  <div className="p-5">
                    <div className="flex items-center gap-3 mb-6">
                      <Skeleton className="w-12 h-12 rounded-xl" />
                      <div className="space-y-2">
                        <Skeleton className="h-6 w-20" />
                        <Skeleton className="h-3 w-24" />
                      </div>
                    </div>
                    <div className="mb-6 pb-6 border-b border-border/50">
                      <div className="flex items-baseline justify-between">
                        <Skeleton className="h-4 w-24" />
                        <Skeleton className="h-10 w-20" />
                      </div>
                    </div>
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
            pickupCoords={data?.pickupCoords ?? null}
            destinationCoords={data?.destinationCoords ?? null}
            timeRecommendations={timeRecommendations}
            aiRecommendations={aiRecommendations}
            routeAccuracy={routeAccuracy}
            routeWarning={routeWarning}
          />
        )}
      </section>
    </div>
  )
}
