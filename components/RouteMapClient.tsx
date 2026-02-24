'use client'

import { useEffect, useState, memo, useCallback, useRef } from 'react'
import MapLibreGL from 'maplibre-gl'
import { Map, MapMarker, MarkerContent, MapRoute, MapControls, useMap } from '@/components/ui/map'

// Map view controller for fitting bounds
function MapViewController({
  pickup,
  destination,
  routeCoordinates,
  isRouteLoading,
}: {
  pickup: [number, number] // [lon, lat]
  destination: [number, number] // [lon, lat]
  routeCoordinates: [number, number][] // [[lon, lat], ...]
  isRouteLoading: boolean
}) {
  const { map, isLoaded } = useMap()
  const hasInitialized = useRef(false)

  // Fit bounds when coordinates change
  useEffect(() => {
    if (!map || !isLoaded) return

    // Create bounds from pickup and destination
    const bounds = new MapLibreGL.LngLatBounds()
      .extend([pickup[0], pickup[1]])
      .extend([destination[0], destination[1]])

    if (!hasInitialized.current) {
      // First load - instant fit
      map.fitBounds(bounds, {
        padding: 40,
        duration: 0,
      })
      hasInitialized.current = true
    } else {
      // Subsequent updates - smooth animation
      map.fitBounds(bounds, {
        padding: 40,
        duration: 1000,
      })
    }
  }, [map, isLoaded, pickup, destination])

  // Refine bounds when route loads
  useEffect(() => {
    if (!map || !isLoaded || !routeCoordinates.length || isRouteLoading) return

    // Create bounds including all route coordinates
    const bounds = new MapLibreGL.LngLatBounds()
    routeCoordinates.forEach(coord => bounds.extend(coord))

    map.fitBounds(bounds, {
      padding: 40,
      duration: 800,
    })
  }, [map, isLoaded, routeCoordinates, isRouteLoading])

  return null
}

// Loading indicator component
function RouteLoadingIndicator({ isLoading }: { isLoading: boolean }) {
  if (!isLoading) return null

  return (
    <div className="absolute top-2 right-2 z-[1000] bg-card/90 backdrop-blur-sm rounded-lg px-3 py-2 shadow-lg border border-border">
      <div className="flex items-center space-x-2">
        <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin"></div>
        <span className="text-sm font-medium text-foreground">Loading route...</span>
      </div>
    </div>
  )
}

// Custom pickup marker (green pin)
function PickupMarkerIcon() {
  return (
    <div className="flex flex-col items-center">
      <div className="w-6 h-6 bg-green-500 border-2 border-white rounded-full shadow-lg flex items-center justify-center">
        <div className="w-2 h-2 bg-white rounded-full" />
      </div>
      <div className="w-0 h-0 border-l-[6px] border-r-[6px] border-t-[8px] border-l-transparent border-r-transparent border-t-green-500 -mt-1" />
    </div>
  )
}

// Custom destination marker (red pin)
function DestinationMarkerIcon() {
  return (
    <div className="flex flex-col items-center">
      <div className="w-6 h-6 bg-red-500 border-2 border-white rounded-full shadow-lg flex items-center justify-center">
        <div className="w-2 h-2 bg-white rounded-full" />
      </div>
      <div className="w-0 h-0 border-l-[6px] border-r-[6px] border-t-[8px] border-l-transparent border-r-transparent border-t-red-500 -mt-1" />
    </div>
  )
}

type RouteMapClientProps = {
  pickup: [number, number] // [lon, lat]
  destination: [number, number] // [lon, lat]
}

const RouteMapClient = ({ pickup, destination }: RouteMapClientProps) => {
  const [routeCoordinates, setRouteCoordinates] = useState<[number, number][]>([])
  const [isRouteLoading, setIsRouteLoading] = useState(false)
  const [routeError, setRouteError] = useState(false)
  const abortControllerRef = useRef<AbortController | null>(null)
  const debounceTimeoutRef = useRef<NodeJS.Timeout>()

  // Calculate center for initial map view
  const center: [number, number] = [
    (pickup[0] + destination[0]) / 2,
    (pickup[1] + destination[1]) / 2,
  ]

  // Fetch route from OSRM
  const fetchRoute = useCallback(
    async (pickupCoords: [number, number], destCoords: [number, number], signal: AbortSignal) => {
      try {
        const [pickupLon, pickupLat] = pickupCoords
        const [destLon, destLat] = destCoords

        // Use HTTPS endpoint
        const url = `https://router.project-osrm.org/route/v1/driving/${pickupLon},${pickupLat};${destLon},${destLat}?overview=full&geometries=geojson&alternatives=false`

        const response = await fetch(url, {
          signal,
          method: 'GET',
          headers: {
            Accept: 'application/json',
          },
          mode: 'cors',
        })

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`)
        }

        const data = await response.json()

        if (data.code === 'Ok' && data.routes?.length > 0) {
          const route = data.routes[0]

          if (!route.geometry?.coordinates) {
            throw new Error('Route geometry missing')
          }

          // OSRM returns coordinates as [lon, lat] which is what MapLibre expects
          const coordinates = route.geometry.coordinates as [number, number][]

          setRouteCoordinates(coordinates)
          setRouteError(false)
        } else {
          throw new Error(`OSRM error: ${data.code} - ${data.message || 'No route found'}`)
        }
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.name : 'Unknown error'
        if (errorMessage === 'AbortError') return // Ignore aborted requests

        // Fallback to straight line on error
        setRouteCoordinates([pickupCoords, destCoords])
        setRouteError(true)
      }
    },
    []
  )

  // Effect with debouncing and cancellation
  useEffect(() => {
    // Cancel any pending requests
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }

    // Clear any pending debounce
    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current)
    }

    // Start loading immediately for UI feedback
    setIsRouteLoading(true)

    // Debounce route fetching to avoid spam
    debounceTimeoutRef.current = setTimeout(async () => {
      const abortController = new AbortController()
      abortControllerRef.current = abortController

      await fetchRoute(pickup, destination, abortController.signal)

      // Only set loading false if this request wasn't aborted
      if (!abortController.signal.aborted) {
        setIsRouteLoading(false)
      }
    }, 100) // 100ms debounce (reduced from 300ms for faster response)

    // Cleanup
    return () => {
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current)
      }
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
      }
    }
  }, [pickup, destination, fetchRoute])

  return (
    <div className="mt-4 relative h-[300px] rounded-lg overflow-hidden border border-border shadow-md">
      <Map center={center} zoom={10}>
        <MapControls position="bottom-right" showZoom={true} />

        {/* Pickup marker (green) */}
        <MapMarker longitude={pickup[0]} latitude={pickup[1]}>
          <MarkerContent>
            <PickupMarkerIcon />
          </MarkerContent>
        </MapMarker>

        {/* Destination marker (red) */}
        <MapMarker longitude={destination[0]} latitude={destination[1]}>
          <MarkerContent>
            <DestinationMarkerIcon />
          </MarkerContent>
        </MapMarker>

        {/* Route polyline - uses theme-aware colors by default */}
        {routeCoordinates.length > 0 && (
          <MapRoute
            coordinates={routeCoordinates}
            // Only override color for error state (red), otherwise use theme-aware defaults
            color={routeError ? '#ef4444' : undefined}
            hoverColor={routeError ? '#dc2626' : undefined}
            width={4}
            hoverWidth={6}
            opacity={isRouteLoading ? 0.5 : 0.85}
            dashArray={routeError ? [10, 10] : undefined}
            interactive={!routeError}
          />
        )}

        {/* Map view controller */}
        <MapViewController
          pickup={pickup}
          destination={destination}
          routeCoordinates={routeCoordinates}
          isRouteLoading={isRouteLoading}
        />
      </Map>

      {/* Loading indicator overlay */}
      <RouteLoadingIndicator isLoading={isRouteLoading} />

      {/* Error indicator */}
      {routeError && !isRouteLoading && (
        <div className="absolute bottom-2 left-2 z-[1000] bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2">
          <div className="flex items-center space-x-2">
            <div className="w-2 h-2 bg-destructive rounded-full"></div>
            <span className="text-xs text-foreground">Using direct route</span>
          </div>
        </div>
      )}
    </div>
  )
}

export default memo(RouteMapClient)
