import { type NextRequest, NextResponse } from 'next/server'
import { handleOptions, withCors } from '@/lib/cors'
import { withRateLimit } from '@/lib/rate-limiter'
import { createRideHistory, getRideHistoryForUser, getRideHistoryStats } from '@/lib/database'
import { auth } from '@/auth'
import { logError } from '@/lib/monitoring'
import { getRequestId, createResponseHeaders } from '@/lib/api-helpers'
import { z } from 'zod'

const CreateRideHistorySchema = z.object({
  routeId: z.string().min(1).optional(),
  savedRouteId: z.string().min(1).optional(),
  service: z.enum(['uber', 'lyft', 'taxi', 'waymo']),
  estimatedFare: z.number().positive().max(1000),
  waitTimeMinutes: z.number().int().min(0).max(180).optional(),
  surgeMultiplier: z.number().min(1).max(10).optional(),
  comparisonSnapshot: z
    .record(z.unknown())
    .refine(val => JSON.stringify(val).length <= 65536, 'Comparison snapshot too large'),
})

async function handlePost(request: NextRequest) {
  const requestId = getRequestId(request)
  let userId: string | undefined

  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401, headers: createResponseHeaders(requestId) }
      )
    }
    userId = session.user.id

    const contentLength = parseInt(request.headers.get('content-length') ?? '0', 10)
    if (contentLength > 100_000) {
      return NextResponse.json(
        { error: 'Request body too large' },
        { status: 413, headers: createResponseHeaders(requestId) }
      )
    }

    const body = await request.json()

    const validation = CreateRideHistorySchema.safeParse(body)
    if (!validation.success) {
      return NextResponse.json(
        {
          error: 'Invalid input',
          details: validation.error.errors.map(err => ({
            field: err.path.join('.'),
            message: err.message,
          })),
        },
        { status: 400, headers: createResponseHeaders(requestId) }
      )
    }

    const result = await createRideHistory({ userId, ...validation.data })

    if (!result) {
      return NextResponse.json(
        { error: 'Failed to create ride history entry' },
        { status: 500, headers: createResponseHeaders(requestId) }
      )
    }

    return NextResponse.json(
      { success: true, id: result.id },
      { status: 201, headers: createResponseHeaders(requestId) }
    )
  } catch (error: unknown) {
    const err = error instanceof Error ? error : new Error('Failed to create ride history')
    logError({
      error: err,
      route: 'api/ride-history.POST',
      requestId,
      userId,
    })

    return NextResponse.json(
      { error: 'Failed to create ride history entry' },
      { status: 500, headers: createResponseHeaders(requestId) }
    )
  }
}

async function handleGet(request: NextRequest) {
  const requestId = getRequestId(request)
  let userId: string | undefined

  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401, headers: createResponseHeaders(requestId) }
      )
    }
    userId = session.user.id

    const { searchParams } = new URL(request.url)
    const analytics = searchParams.get('analytics') === 'true'

    if (analytics) {
      const rawDaysBack = parseInt(searchParams.get('daysBack') ?? '30', 10)
      const daysBack = isNaN(rawDaysBack) || rawDaysBack < 1 || rawDaysBack > 90 ? 30 : rawDaysBack

      const stats = await getRideHistoryStats(userId, daysBack)

      return NextResponse.json(stats, { headers: createResponseHeaders(requestId) })
    }

    const cursor = searchParams.get('cursor') ?? undefined
    const rawLimit = parseInt(searchParams.get('limit') ?? '20', 10)
    const limit = isNaN(rawLimit) || rawLimit < 1 || rawLimit > 50 ? 20 : rawLimit

    const data = await getRideHistoryForUser(userId, cursor, limit)

    return NextResponse.json(data, { headers: createResponseHeaders(requestId) })
  } catch (error) {
    logError({
      error: error instanceof Error ? error : new Error('Failed to fetch ride history'),
      route: 'api/ride-history.GET',
      requestId,
      userId,
    })

    return NextResponse.json(
      { error: 'Failed to fetch ride history' },
      { status: 500, headers: createResponseHeaders(requestId) }
    )
  }
}

export const GET = withCors(withRateLimit(handleGet))
export const POST = withCors(withRateLimit(handlePost))
export const OPTIONS = handleOptions
