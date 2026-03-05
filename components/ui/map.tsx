'use client'

import MapLibreGL from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { useTheme } from 'next-themes'
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'

// Re-export from extracted modules for backward compatibility
export {
  MapMarker,
  MarkerContent,
  MarkerPopup,
  MarkerTooltip,
  MarkerLabel,
  MapPopup,
} from './map-markers'

export { MapRoute, ROUTE_LAYER_PREFIX, ROUTE_SOURCE_PREFIX } from './map-route'

export { MapControls } from './map-controls'

type MapContextValue = {
  map: MapLibreGL.Map | null
  isLoaded: boolean
}

const MapContext = createContext<MapContextValue | null>(null)

function useMap() {
  const context = useContext(MapContext)
  if (!context) {
    throw new Error('useMap must be used within a Map component')
  }
  return context
}

const defaultStyles = {
  dark: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
  light: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
}

type MapStyleOption = string | MapLibreGL.StyleSpecification

type MapProps = {
  children?: ReactNode
  /** Custom map styles for light and dark themes. Overrides the default Carto styles. */
  styles?: {
    light?: MapStyleOption
    dark?: MapStyleOption
  }
} & Omit<MapLibreGL.MapOptions, 'container' | 'style'>

const DefaultLoader = () => (
  <div className="absolute inset-0 flex items-center justify-center">
    <div className="flex gap-1">
      <span className="size-1.5 rounded-full bg-muted-foreground/60 animate-pulse" />
      <span className="size-1.5 rounded-full bg-muted-foreground/60 animate-pulse [animation-delay:150ms]" />
      <span className="size-1.5 rounded-full bg-muted-foreground/60 animate-pulse [animation-delay:300ms]" />
    </div>
  </div>
)

function Map({ children, styles, ...props }: MapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreGL.Map | null>(null)
  const [isLoaded, setIsLoaded] = useState(false)
  const [isStyleLoaded, setIsStyleLoaded] = useState(false)
  const [mapInitError, setMapInitError] = useState(false)
  const { resolvedTheme } = useTheme()

  const mapStyles = useMemo(
    () => ({
      dark: styles?.dark ?? defaultStyles.dark,
      light: styles?.light ?? defaultStyles.light,
    }),
    [styles]
  )

  useEffect(() => {
    if (!containerRef.current) return

    const mapStyle = resolvedTheme === 'dark' ? mapStyles.dark : mapStyles.light

    let mapInstance: MapLibreGL.Map | null = null

    try {
      mapInstance = new MapLibreGL.Map({
        container: containerRef.current,
        style: mapStyle,
        renderWorldCopies: false,
        attributionControl: {
          compact: true,
        },
        ...props,
      })
    } catch {
      setMapInitError(true)
      return
    }

    const styleDataHandler = () => setIsStyleLoaded(true)
    const loadHandler = () => {
      mapInstance!.resize()
      setIsLoaded(true)
    }
    const errorHandler = () => setMapInitError(true)

    mapInstance.on('load', loadHandler)
    mapInstance.on('styledata', styleDataHandler)
    mapInstance.on('error', errorHandler)
    mapRef.current = mapInstance

    return () => {
      mapInstance!.off('load', loadHandler)
      mapInstance!.off('styledata', styleDataHandler)
      mapInstance!.off('error', errorHandler)
      mapInstance!.remove()
      mapRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (mapRef.current) {
      setIsStyleLoaded(false)
      mapRef.current.setStyle(resolvedTheme === 'dark' ? mapStyles.dark : mapStyles.light, {
        diff: true,
      })
    }
  }, [resolvedTheme, mapStyles])

  const isLoading = !isLoaded || !isStyleLoaded

  const contextValue = useMemo(
    () => ({
      map: mapRef.current,
      isLoaded: isLoaded && isStyleLoaded,
    }),
    [isLoaded, isStyleLoaded]
  )

  if (mapInitError) {
    return (
      <div className="relative w-full h-full flex items-center justify-center bg-muted/30 rounded-lg border border-dashed border-border">
        <div className="text-center text-muted-foreground p-4">
          <div className="text-sm font-medium mb-1">Map unavailable</div>
          <div className="text-xs">Route displayed above</div>
        </div>
      </div>
    )
  }

  return (
    <MapContext.Provider value={contextValue}>
      <div ref={containerRef} className="relative w-full h-full">
        {isLoading && <DefaultLoader />}
        {/* SSR-safe: children render only when map exists on client */}
        {mapRef.current && children}
      </div>
    </MapContext.Provider>
  )
}

export { Map, useMap }
