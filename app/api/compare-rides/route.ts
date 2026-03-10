import { type NextRequest, NextResponse } from 'next/server'
import { DEFAULT_SERVICES } from '@/lib/constants'
import { withCors } from '@/lib/cors'
import { withRateLimit } from '@/lib/rate-limiter'
import {
  validateInput,
  RideComparisonRequestSchema,
  detectSuspiciousCoordinates,
  detectSpamPatterns,
  sanitizeString,
} from '@/lib/validation'
import { verifyRecaptchaToken, RECAPTCHA_CONFIG } from '@/lib/recaptcha'
import {
  compareRidesByAddresses,
  compareRidesByCoordinates,
  isCompareServiceError,
  type CompareServiceErrorCode,
} from '@/lib/services/ride-comparison'
import { findPrecomputedRouteByAddresses } from '@/lib/popular-routes-data'
import { auth } from '@/auth'
import { generateRecommendations } from '@/lib/services/recommendations'
import { enhanceWithAI } from '@/lib/services/ai-insights'
import { log, logError } from '@/lib/monitoring'
import { getRequestId, createResponseHeaders } from '@/lib/api-helpers'
import type {
  ComparisonApiResponse,
  ComparisonRequestBody,
  CoordinateComparisonRequest,
  LegacyComparisonRequest,
  ServiceType,
} from '@/types'

function mapCompareError(error: CompareServiceErrorCode): {
  status: number
  message: string
} {
  switch (error) {
    case 'ADDRESS_NOT_FOUND':
      return {
        status: 400,
        message: 'We could not find one of those addresses. Please enter a more specific location.',
      }
    case 'GEOCODE_TIMEOUT':
      return {
        status: 504,
        message: 'Location lookup timed out. Please try again.',
      }
    case 'GEOCODE_UNAVAILABLE':
      return {
        status: 503,
        message: 'Location service is temporarily unavailable. Please try again.',
      }
    case 'ROUTE_TIMEOUT':
      return {
        status: 504,
        message: 'Route calculation timed out. Please try again.',
      }
    case 'ROUTE_UNAVAILABLE':
      return {
        status: 503,
        message: 'Route service is temporarily unavailable. Please try again.',
      }
    default:
      return {
        status: 500,
        message: 'Failed to compare rides',
      }
  }
}

function createCompareErrorResponse(
  error: unknown,
  request: NextRequest,
  requestId: string,
  route: string
) {
  if (!isCompareServiceError(error)) {
    return null
  }

  const mappedError = mapCompareError(error.code)
  log('Compare request failed', {
    route,
    requestId,
    sessionId: request.headers.get('x-session-id') ?? undefined,
    code: error.code,
    provider: error.provider,
    phase: error.phase,
    timedOut: error.timedOut ?? false,
  })

  return NextResponse.json(
    {
      error: mappedError.message,
      code: error.code,
      requestId,
    },
    { status: mappedError.status, headers: createResponseHeaders(requestId) }
  )
}

function normaliseServices(services?: ServiceType[]): ServiceType[] {
  return services && services.length > 0 ? Array.from(new Set(services)) : DEFAULT_SERVICES
}

function isLegacyRequest(body: unknown): body is LegacyComparisonRequest {
  return (
    typeof body === 'object' &&
    body !== null &&
    typeof (body as LegacyComparisonRequest).pickup === 'string' &&
    typeof (body as LegacyComparisonRequest).destination === 'string'
  )
}

function isCoordinateRequest(body: unknown): body is CoordinateComparisonRequest {
  return typeof body === 'object' && body !== null && 'from' in body && 'to' in body
}

function isPrecomputedRequest(body: ComparisonRequestBody): boolean {
  if (isLegacyRequest(body)) {
    return !!findPrecomputedRouteByAddresses(body.pickup, body.destination)
  }

  return !!findPrecomputedRouteByAddresses(body.from.name, body.to.name)
}

async function resolveAiRecommendations(routeId: string | null, userId?: string | null) {
  if (!routeId) {
    return []
  }

  return generateRecommendations({
    routeId,
    userId: userId ?? undefined,
    timestamp: new Date(),
  })
    .then(result => enhanceWithAI(result.recommendations))
    .catch(() => [])
}

function buildComparisonResponse(
  comparisons: Awaited<ReturnType<typeof compareRidesByCoordinates>>,
  aiRecommendations: Awaited<ReturnType<typeof resolveAiRecommendations>>
): ComparisonApiResponse {
  return {
    routeId: comparisons.routeId,
    comparisons: comparisons.results,
    insights: comparisons.insights,
    pickupCoords: comparisons.pickup,
    destinationCoords: comparisons.destination,
    surgeInfo: comparisons.surgeInfo,
    timeRecommendations: comparisons.timeRecommendations,
    aiRecommendations,
    routeAccuracy: comparisons.routeAccuracy,
    routeWarning: comparisons.routeWarning,
  }
}

async function handleGet(request: NextRequest) {
  const requestId = getRequestId(request)

  try {
    const { searchParams } = new URL(request.url)
    const pickup = searchParams.get('pickup')
    const destination = searchParams.get('destination')

    if (!pickup || !destination) {
      return NextResponse.json(
        { error: 'Pickup and destination are required' },
        { status: 400, headers: createResponseHeaders(requestId) }
      )
    }

    const isPrecomputedRoute = !!findPrecomputedRouteByAddresses(pickup, destination)
    const comparisons = await compareRidesByAddresses(
      pickup,
      destination,
      DEFAULT_SERVICES,
      new Date(),
      {
        userId: null,
        sessionId: request.headers.get('x-session-id') ?? undefined,
        persist: true,
      }
    )

    const cacheControl = isPrecomputedRoute
      ? 'private, max-age=300, stale-while-revalidate=1800'
      : 'private, max-age=30, stale-while-revalidate=120'
    const aiRecommendations = await resolveAiRecommendations(comparisons.routeId)

    return NextResponse.json(buildComparisonResponse(comparisons, aiRecommendations), {
      headers: createResponseHeaders(requestId, { 'Cache-Control': cacheControl }),
    })
  } catch (error) {
    const compareErrorResponse = createCompareErrorResponse(
      error,
      request,
      requestId,
      'api/compare-rides.GET'
    )
    if (compareErrorResponse) {
      return compareErrorResponse
    }

    logError({
      error: error instanceof Error ? error : new Error('Failed to prefetch ride comparisons'),
      route: 'api/compare-rides.GET',
      requestId,
      sessionId: request.headers.get('x-session-id') ?? undefined,
    })

    return NextResponse.json(
      { error: 'Failed to prefetch ride comparisons' },
      { status: 500, headers: createResponseHeaders(requestId) }
    )
  }
}

async function handlePost(request: NextRequest) {
  const requestId = getRequestId(request)

  try {
    const body = (await request.json()) as ComparisonRequestBody

    if (!isLegacyRequest(body) && !isCoordinateRequest(body)) {
      return NextResponse.json(
        { error: 'Invalid input' },
        { status: 400, headers: createResponseHeaders(requestId) }
      )
    }

    const isPrecomputedRoute = isPrecomputedRequest(body)
    const isProduction = process.env.NODE_ENV === 'production'

    if (body.recaptchaToken && !isPrecomputedRoute) {
      const recaptchaResult = await verifyRecaptchaToken(
        body.recaptchaToken,
        RECAPTCHA_CONFIG.ACTIONS.RIDE_COMPARISON,
        RECAPTCHA_CONFIG.NORMAL_THRESHOLD
      )

      if (!recaptchaResult.success) {
        if (recaptchaResult.error?.includes('Action mismatch')) {
          return NextResponse.json(
            { error: 'Security verification failed. Please refresh and try again.' },
            { status: 403, headers: createResponseHeaders(requestId) }
          )
        }

        if (
          recaptchaResult.score !== undefined &&
          recaptchaResult.score < RECAPTCHA_CONFIG.LENIENT_THRESHOLD
        ) {
          return NextResponse.json(
            {
              error: 'Security verification failed. Please try again.',
              details: 'Your request appears to be automated. Please try again in a few moments.',
            },
            { status: 403, headers: createResponseHeaders(requestId) }
          )
        }

        if (isProduction) {
          return NextResponse.json(
            { error: 'Security verification unavailable. Please try again later.' },
            { status: 503, headers: createResponseHeaders(requestId) }
          )
        }
      }
    } else if (!isPrecomputedRoute && !body.recaptchaToken && isProduction) {
      return NextResponse.json(
        { error: 'Security token required' },
        { status: 400, headers: createResponseHeaders(requestId) }
      )
    }

    const session = await auth()
    const authenticatedUserId = session?.user?.id ?? null
    const sessionId = request.headers.get('x-session-id') ?? undefined
    const timestamp = new Date()

    if (isCoordinateRequest(body) && !isLegacyRequest(body)) {
      const validation = validateInput(
        RideComparisonRequestSchema,
        {
          from: body.from,
          to: body.to,
          services: normaliseServices(body.services),
        },
        'ride comparison request'
      )

      if (!validation.success) {
        return NextResponse.json(
          {
            error: 'Invalid input',
            details: validation.errors.map(err => ({
              field: err.field,
              message: err.message,
            })),
          },
          { status: 400, headers: createResponseHeaders(requestId) }
        )
      }

      const requestData = validation.data
      const fromName = requestData.from.name
      const toName = requestData.to.name

      if (detectSpamPatterns(fromName) || detectSpamPatterns(toName)) {
        return NextResponse.json(
          { error: 'Invalid location names detected' },
          { status: 400, headers: createResponseHeaders(requestId) }
        )
      }

      if (
        detectSuspiciousCoordinates(
          { lat: requestData.from.lat, lng: requestData.from.lng },
          { lat: requestData.to.lat, lng: requestData.to.lng }
        )
      ) {
        return NextResponse.json(
          { error: 'Invalid route: pickup and destination are too close' },
          { status: 400, headers: createResponseHeaders(requestId) }
        )
      }

      const comparisons = await compareRidesByCoordinates(
        {
          name: requestData.from.name,
          coordinates: [parseFloat(requestData.from.lng), parseFloat(requestData.from.lat)],
        },
        {
          name: requestData.to.name,
          coordinates: [parseFloat(requestData.to.lng), parseFloat(requestData.to.lat)],
        },
        requestData.services,
        timestamp,
        {
          userId: authenticatedUserId,
          sessionId,
          persist: true,
          pickupAddress: requestData.from.name,
          destinationAddress: requestData.to.name,
        }
      )

      const aiRecommendations = await resolveAiRecommendations(
        comparisons.routeId,
        authenticatedUserId
      )

      return NextResponse.json(buildComparisonResponse(comparisons, aiRecommendations), {
        headers: createResponseHeaders(requestId),
      })
    }

    const sanitizedPickup = sanitizeString(body.pickup)
    const sanitizedDestination = sanitizeString(body.destination)

    if (!sanitizedPickup || !sanitizedDestination) {
      return NextResponse.json(
        { error: 'Pickup and destination are required' },
        { status: 400, headers: createResponseHeaders(requestId) }
      )
    }

    if (detectSpamPatterns(sanitizedPickup) || detectSpamPatterns(sanitizedDestination)) {
      return NextResponse.json(
        { error: 'Invalid location names detected' },
        { status: 400, headers: createResponseHeaders(requestId) }
      )
    }

    const comparisons = await compareRidesByAddresses(
      sanitizedPickup,
      sanitizedDestination,
      normaliseServices(body.services),
      timestamp,
      {
        userId: authenticatedUserId,
        sessionId,
        persist: true,
      }
    )

    const aiRecommendations = await resolveAiRecommendations(
      comparisons.routeId,
      authenticatedUserId
    )

    return NextResponse.json(buildComparisonResponse(comparisons, aiRecommendations), {
      headers: createResponseHeaders(requestId),
    })
  } catch (error) {
    const compareErrorResponse = createCompareErrorResponse(
      error,
      request,
      requestId,
      'api/compare-rides.POST'
    )
    if (compareErrorResponse) {
      return compareErrorResponse
    }

    logError({
      error: error instanceof Error ? error : new Error('Failed to compare rides'),
      route: 'api/compare-rides.POST',
      requestId,
      sessionId: request.headers.get('x-session-id') ?? undefined,
    })

    return NextResponse.json(
      { error: 'Failed to compare rides' },
      { status: 500, headers: createResponseHeaders(requestId) }
    )
  }
}

export const GET = withCors(withRateLimit(handleGet))
export const POST = withCors(withRateLimit(handlePost))
export const OPTIONS = withCors(handleGet)
