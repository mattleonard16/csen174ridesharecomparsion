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
  const currentStyleRef = useRef<MapStyleOption | null>(null)
  const [isLoaded, setIsLoaded] = useState(false)
  const [isStyleLoaded, setIsStyleLoaded] = useState(false)
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
    currentStyleRef.current = mapStyle

    const mapInstance = new MapLibreGL.Map({
      container: containerRef.current,
      style: mapStyle,
      renderWorldCopies: false,
      attributionControl: {
        compact: true,
      },
      ...props,
    })

    const loadHandler = () => {
      mapInstance.resize()
      setIsLoaded(true)
      setIsStyleLoaded(Boolean(mapInstance.isStyleLoaded()))
    }
    const styleLoadHandler = () => setIsStyleLoaded(true)

    mapInstance.on('load', loadHandler)
    mapInstance.on('style.load', styleLoadHandler)
    mapRef.current = mapInstance

    return () => {
      mapInstance.off('load', loadHandler)
      mapInstance.off('style.load', styleLoadHandler)
      mapInstance.remove()
      mapRef.current = null
      currentStyleRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const mapInstance = mapRef.current
    if (!mapInstance || !isLoaded) return

    const nextStyle = resolvedTheme === 'dark' ? mapStyles.dark : mapStyles.light
    if (currentStyleRef.current === nextStyle) {
      return
    }

    currentStyleRef.current = nextStyle
    setIsStyleLoaded(false)
    mapInstance.setStyle(nextStyle, { diff: false })
  }, [isLoaded, resolvedTheme, mapStyles])

  const isLoading = !isLoaded || !isStyleLoaded

  const contextValue = useMemo(
    () => ({
      map: mapRef.current,
      isLoaded: isLoaded && isStyleLoaded,
    }),
    [isLoaded, isStyleLoaded]
  )

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
