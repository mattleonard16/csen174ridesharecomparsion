'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { API_CONFIG } from '@/lib/constants'
import type { LocationSuggestion, CommonPlaces } from '@/types'

// Constants
const SEARCH_CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes
const MAX_SEARCH_CACHE_SIZE = 50

// Cache entry type
interface CacheEntry {
  data: LocationSuggestion[]
  expiresAt: number
}

// Bounded cache for API results with TTL
const searchCache = new Map<string, CacheEntry>()

/**
 * Get cached search result if it exists and hasn't expired
 */
function getCachedResult(key: string): LocationSuggestion[] | null {
  const entry = searchCache.get(key)
  if (!entry) return null

  if (entry.expiresAt <= Date.now()) {
    searchCache.delete(key)
    return null
  }

  return entry.data
}

/**
 * Set cache entry with TTL and enforce size limits
 */
function setCacheEntry(key: string, data: LocationSuggestion[]): void {
  // Enforce max cache size by removing oldest entries
  if (searchCache.size >= MAX_SEARCH_CACHE_SIZE) {
    const firstKey = searchCache.keys().next().value
    if (firstKey) {
      searchCache.delete(firstKey)
    }
  }

  searchCache.set(key, {
    data,
    expiresAt: Date.now() + SEARCH_CACHE_TTL_MS,
  })
}

/**
 * Get instant matches from common places without API call
 */
export function getInstantMatches(query: string, commonPlaces: CommonPlaces): LocationSuggestion[] {
  const normalizedQuery = query.toLowerCase().trim()
  if (normalizedQuery.length < 2) return []

  return Object.entries(commonPlaces)
    .filter(
      ([key, place]) =>
        key.includes(normalizedQuery) ||
        place.name.toLowerCase().includes(normalizedQuery) ||
        place.display_name.toLowerCase().includes(normalizedQuery)
    )
    .map(([key, place]) => ({
      place_id: key,
      display_name: place.display_name,
      name: place.name,
      lat: place.lat,
      lon: place.lon,
    }))
    .slice(0, 5)
}

/**
 * Search places using Nominatim API with caching
 */
export async function searchPlaces(
  query: string,
  commonPlaces: CommonPlaces,
  signal?: AbortSignal
): Promise<LocationSuggestion[]> {
  const normalizedQuery = query.toLowerCase().trim()

  // Check cache first (with TTL)
  const cached = getCachedResult(normalizedQuery)
  if (cached) {
    return cached
  }

  // Check common places first
  const commonMatches = Object.entries(commonPlaces)
    .filter(
      ([key, place]) =>
        key.includes(normalizedQuery) ||
        place.name.toLowerCase().includes(normalizedQuery) ||
        place.display_name.toLowerCase().includes(normalizedQuery)
    )
    .map(([key, place]) => ({
      place_id: key,
      display_name: place.display_name,
      name: place.name,
      lat: place.lat,
      lon: place.lon,
    }))

  // If we have good common matches, return them first
  if (commonMatches.length > 0 && normalizedQuery.length >= 3) {
    try {
      // Still fetch from API but combine results
      const response = await fetch(
        `${API_CONFIG.NOMINATIM_BASE_URL}?q=${encodeURIComponent(query + ' California')}&format=json&limit=3&countrycodes=us&addressdetails=1&extratags=1`,
        {
          headers: {
            'User-Agent': API_CONFIG.USER_AGENT,
          },
          signal,
        }
      )
      const apiData = await response.json()

      // Combine common places with API results, prioritizing common places
      const combinedResults = [...commonMatches, ...apiData.slice(0, 3)]
      const uniqueResults = combinedResults
        .filter(
          (item, index, self) =>
            index ===
            self.findIndex(
              t =>
                t.display_name === item.display_name ||
                (t.name && item.name && t.name === item.name) ||
                (t.lat &&
                  item.lat &&
                  Math.abs(parseFloat(t.lat) - parseFloat(item.lat)) < 0.001 &&
                  t.lon &&
                  item.lon &&
                  Math.abs(parseFloat(t.lon) - parseFloat(item.lon)) < 0.001)
            )
        )
        .slice(0, 5)

      setCacheEntry(normalizedQuery, uniqueResults)
      return uniqueResults
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        return commonMatches // Return common matches if aborted
      }
      setCacheEntry(normalizedQuery, commonMatches)
      return commonMatches
    }
  }

  // Fallback to API only
  try {
    const response = await fetch(
      `${API_CONFIG.NOMINATIM_BASE_URL}?q=${encodeURIComponent(query + ' California')}&format=json&limit=5&countrycodes=us&addressdetails=1&extratags=1`,
      {
        headers: {
          'User-Agent': API_CONFIG.USER_AGENT,
        },
        signal,
      }
    )
    const data = await response.json()
    setCacheEntry(normalizedQuery, data)
    return data
  } catch (error) {
    if ((error as Error).name === 'AbortError') {
      return [] // Silently return empty if aborted
    }
    return []
  }
}

export interface UseLocationSuggestionsOptions {
  commonPlaces: CommonPlaces
}

export interface UseLocationSuggestionsReturn {
  suggestions: LocationSuggestion[]
  isLoading: boolean
  showSuggestions: boolean
  fetchSuggestions: (query: string) => Promise<void>
  clearSuggestions: () => void
  setShowSuggestions: (show: boolean) => void
  handleInstantMatches: (query: string) => void
}

/**
 * Custom hook for managing location autocomplete suggestions
 */
export function useLocationSuggestions({
  commonPlaces,
}: UseLocationSuggestionsOptions): UseLocationSuggestionsReturn {
  const [suggestions, setSuggestions] = useState<LocationSuggestion[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [showSuggestions, setShowSuggestions] = useState(false)
  const abortControllerRef = useRef<AbortController | null>(null)

  // Abort in-flight request on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) abortControllerRef.current.abort()
    }
  }, [])

  const fetchSuggestions = useCallback(
    async (query: string) => {
      if (!query || query.length < 2) {
        setSuggestions([])
        setShowSuggestions(false)
        return
      }

      // Cancel any in-flight request
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
      }
      abortControllerRef.current = new AbortController()

      setIsLoading(true)
      try {
        const data = await searchPlaces(query, commonPlaces, abortControllerRef.current.signal)
        setSuggestions(data)
        setShowSuggestions(data.length > 0)
      } catch (error) {
        if ((error as Error).name !== 'AbortError') {
          setSuggestions([])
          setShowSuggestions(false)
        }
      } finally {
        setIsLoading(false)
      }
    },
    [commonPlaces]
  )

  const clearSuggestions = useCallback(() => {
    setSuggestions([])
    setShowSuggestions(false)
    // Cancel any in-flight request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }
  }, [])

  const handleInstantMatches = useCallback(
    (query: string) => {
      const instantMatches = getInstantMatches(query, commonPlaces)
      if (instantMatches.length > 0) {
        setSuggestions(instantMatches)
        setShowSuggestions(true)
      } else if (query.length < 2) {
        setSuggestions([])
        setShowSuggestions(false)
      }
    },
    [commonPlaces]
  )

  return {
    suggestions,
    isLoading,
    showSuggestions,
    fetchSuggestions,
    clearSuggestions,
    setShowSuggestions,
    handleInstantMatches,
  }
}
