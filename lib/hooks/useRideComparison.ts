'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { getClientSessionId } from '@/lib/client-session'
import { DEFAULT_SERVICES } from '@/lib/constants'
import type {
  ComparisonApiResponse,
  ComparisonRequestBody,
  Coordinates,
  ServiceType,
} from '@/types'

type ComparisonStatus = 'idle' | 'loading' | 'refreshing' | 'success' | 'error'

interface SubmitComparisonInput {
  pickup: string
  destination: string
  pickupCoords?: Coordinates | null
  destinationCoords?: Coordinates | null
  getRecaptchaToken?: () => Promise<string>
}

function buildRequestBody(
  input: SubmitComparisonInput,
  recaptchaToken: string
): ComparisonRequestBody {
  if (input.pickupCoords && input.destinationCoords) {
    return {
      from: {
        name: input.pickup,
        lat: String(input.pickupCoords[1]),
        lng: String(input.pickupCoords[0]),
      },
      to: {
        name: input.destination,
        lat: String(input.destinationCoords[1]),
        lng: String(input.destinationCoords[0]),
      },
      services: DEFAULT_SERVICES,
      recaptchaToken,
    }
  }

  return {
    pickup: input.pickup,
    destination: input.destination,
    services: DEFAULT_SERVICES,
    recaptchaToken,
  }
}

function getRequestKey(input: SubmitComparisonInput): string {
  const pickupCoords = input.pickupCoords?.join(',') ?? 'none'
  const destinationCoords = input.destinationCoords?.join(',') ?? 'none'
  return [input.pickup, input.destination, pickupCoords, destinationCoords].join('|')
}

function getErrorMessage(payload: unknown): string {
  const error =
    typeof payload === 'object' && payload !== null && 'error' in payload
      ? (payload.error as string | undefined)
      : undefined

  if (error?.includes('geocode')) {
    return 'Please enter a more specific or valid address for both pickup and destination.'
  }

  if (error?.includes('required')) {
    return 'Both pickup and destination addresses are required.'
  }

  if (error?.includes('too close')) {
    return 'Pickup and destination need to be at least a short distance apart.'
  }

  return error ?? 'Failed to fetch ride comparisons. Please try again.'
}

export function useRideComparison() {
  const [status, setStatus] = useState<ComparisonStatus>('idle')
  const [data, setData] = useState<ComparisonApiResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  const currentRequestRef = useRef<string | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)

  const clearError = useCallback(() => {
    setError(null)
  }, [])

  const reset = useCallback(() => {
    abortControllerRef.current?.abort()
    abortControllerRef.current = null
    currentRequestRef.current = null
    setStatus('idle')
    setData(null)
    setError(null)
  }, [])

  const submitComparison = useCallback(
    async (input: SubmitComparisonInput): Promise<boolean> => {
      const requestKey = getRequestKey(input)
      if (currentRequestRef.current === requestKey) {
        return false
      }

      abortControllerRef.current?.abort()

      const controller = new AbortController()
      abortControllerRef.current = controller
      currentRequestRef.current = requestKey

      const hadExistingData = data !== null
      setStatus(hadExistingData ? 'refreshing' : 'loading')
      setError(null)

      try {
        let recaptchaToken = ''
        if (input.getRecaptchaToken) {
          try {
            recaptchaToken = await input.getRecaptchaToken()
          } catch {
            recaptchaToken = ''
          }
        }

        const sessionId = getClientSessionId()
        const response = await fetch('/api/compare-rides', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(sessionId ? { 'x-session-id': sessionId } : {}),
          },
          body: JSON.stringify(buildRequestBody(input, recaptchaToken)),
          signal: controller.signal,
        })

        const payload = (await response.json().catch(() => null)) as ComparisonApiResponse | null

        if (!response.ok || !payload) {
          const message = getErrorMessage(payload)
          setError(message)
          setStatus(hadExistingData ? 'success' : 'error')
          return false
        }

        setData(payload)
        setStatus('success')
        setError(null)
        return true
      } catch (fetchError) {
        if (fetchError instanceof Error && fetchError.name === 'AbortError') {
          return false
        }

        setError('Failed to fetch ride comparisons. Please try again.')
        setStatus(hadExistingData ? 'success' : 'error')
        return false
      } finally {
        if (currentRequestRef.current === requestKey) {
          currentRequestRef.current = null
          abortControllerRef.current = null
        }
      }
    },
    [data]
  )

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort()
    }
  }, [])

  return {
    status,
    data,
    error,
    isLoading: status === 'loading' || status === 'refreshing',
    isRefreshing: status === 'refreshing',
    clearError,
    reset,
    submitComparison,
  }
}
