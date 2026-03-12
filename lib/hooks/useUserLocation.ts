'use client'

import { useState, useCallback } from 'react'
import { API_CONFIG } from '@/lib/constants'
import type { Coordinates } from '@/types'

export interface UserLocationResult {
  address: string
  coordinates: Coordinates
}

export interface UseUserLocationReturn {
  getLocation: () => Promise<UserLocationResult | null>
  isGettingLocation: boolean
  error: string | null
  clearError: () => void
}

/**
 * Custom hook for getting user's current location and reverse geocoding it
 */
export function useUserLocation(): UseUserLocationReturn {
  const [isGettingLocation, setIsGettingLocation] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const clearError = useCallback(() => {
    setError(null)
  }, [])

  const getLocation = useCallback(async (): Promise<UserLocationResult | null> => {
    if (!navigator.geolocation) {
      setError('Geolocation is not supported by this browser.')
      return null
    }

    setIsGettingLocation(true)
    setError(null)

    return new Promise(resolve => {
      navigator.geolocation.getCurrentPosition(
        async position => {
          try {
            const { latitude, longitude } = position.coords

            // Reverse geocode the coordinates
            const response = await fetch(
              `${API_CONFIG.NOMINATIM_REVERSE_URL}?lat=${latitude}&lon=${longitude}&format=json`,
              {
                headers: {
                  'User-Agent': API_CONFIG.USER_AGENT,
                },
              }
            )
            const data = await response.json()

            if (data.display_name) {
              // Add haptic feedback if supported
              if (navigator.vibrate) {
                navigator.vibrate(50)
              }

              setIsGettingLocation(false)
              resolve({
                address: data.display_name,
                coordinates: [longitude, latitude],
              })
            } else {
              setError('Could not determine your location address.')
              setIsGettingLocation(false)
              resolve(null)
            }
          } catch {
            setError('Failed to get your current address.')
            setIsGettingLocation(false)
            resolve(null)
          }
        },
        () => {
          setError('Could not access your location. Please check permissions.')
          setIsGettingLocation(false)
          resolve(null)
        },
        {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 300000, // 5 minutes
        }
      )
    })
  }, [])

  return {
    getLocation,
    isGettingLocation,
    error,
    clearError,
  }
}
