import { type NextRequest, NextResponse } from 'next/server'
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
import { compareRidesByAddresses, compareRidesByCoordinates } from '@/lib/services/ride-comparison'
import { findPrecomputedRouteByAddresses } from '@/lib/popular-routes-data'
import { auth } from '@/auth'
import { generateRecommendations } from '@/lib/services/recommendations'
import { enhanceWithAI } from '@/lib/services/ai-insights'
import type {
  ComparisonApiResponse,
  ComparisonRequestBody,
  CoordinateComparisonRequest,
  LegacyComparisonRequest,
  ServiceType,
} from '@/types'

const DEFAULT_SERVICES: ServiceType[] = ['uber', 'lyft', 'taxi', 'waymo']

function getRequestId(request: NextRequest): string {
  return request.headers.get('x-request-id') ?? crypto.randomUUID()
}

function createResponseHeaders(
  requestId: string,
  additionalHeaders?: Record<string, string>
): Record<string, string> {
  return {
    'x-request-id': requestId,
    ...additionalHeaders,
  }
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

    if (!comparisons) {
      return NextResponse.json(
        { error: 'Could not compute comparisons' },
        { status: 500, headers: createResponseHeaders(requestId) }
      )
    }

    const cacheControl = isPrecomputedRoute
      ? 'private, max-age=300, stale-while-revalidate=1800'
      : 'private, max-age=30, stale-while-revalidate=120'
    const aiRecommendations = await resolveAiRecommendations(comparisons.routeId)

    return NextResponse.json(buildComparisonResponse(comparisons, aiRecommendations), {
      headers: createResponseHeaders(requestId, { 'Cache-Control': cacheControl }),
    })
  } catch {
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

    if (!comparisons) {
      return NextResponse.json(
        { error: 'Could not compute comparisons' },
        { status: 500, headers: createResponseHeaders(requestId) }
      )
    }

    const aiRecommendations = await resolveAiRecommendations(
      comparisons.routeId,
      authenticatedUserId
    )

    return NextResponse.json(buildComparisonResponse(comparisons, aiRecommendations), {
      headers: createResponseHeaders(requestId),
    })
  } catch {
    return NextResponse.json(
      { error: 'Failed to compare rides' },
      { status: 500, headers: createResponseHeaders(requestId) }
    )
  }
}

export const GET = withCors(withRateLimit(handleGet))
export const POST = withCors(withRateLimit(handlePost))
export const OPTIONS = withCors(handleGet)
