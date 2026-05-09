import { type NextRequest, NextResponse } from 'next/server'
import { handleOptions, withCors } from '@/lib/cors'
import { withRateLimit } from '@/lib/rate-limiter'
import { updateRideHistoryFare, deleteRideHistory } from '@/lib/database'
import { auth } from '@/auth'
import { logError } from '@/lib/monitoring'
import { getRequestId, createResponseHeaders } from '@/lib/api-helpers'
import { z } from 'zod'

const UpdateFareSchema = z.object({
  finalFare: z.number().positive().max(1000),
})

type RouteContext = { params: Promise<{ id: string }> }

async function patchHandler(request: NextRequest, id: string) {
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

    const validation = UpdateFareSchema.safeParse(body)
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

    const { finalFare } = validation.data

    const result = await updateRideHistoryFare(id, userId, finalFare)

    if ('error' in result) {
      if (result.error === 'not_found') {
        return NextResponse.json(
          { error: 'Ride history entry not found' },
          { status: 404, headers: createResponseHeaders(requestId) }
        )
      }
      return NextResponse.json(
        { error: 'Failed to update ride history fare' },
        { status: 500, headers: createResponseHeaders(requestId) }
      )
    }

    return NextResponse.json(result.entry, { headers: createResponseHeaders(requestId) })
  } catch (error) {
    logError({
      error: error instanceof Error ? error : new Error('Failed to update ride history fare'),
      route: 'api/ride-history/[id].PATCH',
      requestId,
      userId,
    })

    return NextResponse.json(
      { error: 'Failed to update ride history fare' },
      { status: 500, headers: createResponseHeaders(requestId) }
    )
  }
}

async function deleteHandler(request: NextRequest, id: string) {
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

    const result = await deleteRideHistory(id, userId)

    if (result === 'not_found') {
      return NextResponse.json(
        { error: 'Ride history entry not found' },
        { status: 404, headers: createResponseHeaders(requestId) }
      )
    }

    if (result === 'error') {
      return NextResponse.json(
        { error: 'Failed to delete ride history entry' },
        { status: 500, headers: createResponseHeaders(requestId) }
      )
    }

    return new NextResponse(null, { status: 204, headers: createResponseHeaders(requestId) })
  } catch (error) {
    logError({
      error: error instanceof Error ? error : new Error('Failed to delete ride history entry'),
      route: 'api/ride-history/[id].DELETE',
      requestId,
      userId,
    })

    return NextResponse.json(
      { error: 'Failed to delete ride history entry' },
      { status: 500, headers: createResponseHeaders(requestId) }
    )
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const { id } = await context.params
  return withCors(withRateLimit((req: NextRequest) => patchHandler(req, id)))(request)
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const { id } = await context.params
  return withCors(withRateLimit((req: NextRequest) => deleteHandler(req, id)))(request)
}

export const OPTIONS = handleOptions
