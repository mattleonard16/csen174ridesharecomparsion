import { type NextRequest, NextResponse } from 'next/server'
import { handleOptions, withCors } from '@/lib/cors'
import { withRateLimit } from '@/lib/rate-limiter'
import { createPriceAlert, deletePriceAlert } from '@/lib/database'
import { auth } from '@/auth'
import { logError } from '@/lib/monitoring'
import { getRequestId, createResponseHeaders } from '@/lib/api-helpers'
import { z } from 'zod'

const PriceAlertSchema = z.object({
  routeId: z.string().min(1, 'Route ID is required'),
  targetPrice: z.number().positive('Target price must be positive'),
  service: z.enum(['uber', 'lyft', 'taxi', 'waymo', 'any']).default('any'),
  alertType: z.enum(['below', 'above']).default('below'),
})

async function handlePost(request: NextRequest) {
  const requestId = getRequestId(request)
  let userId: string | undefined

  try {
    // Auth check
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401, headers: createResponseHeaders(requestId) }
      )
    }
    userId = session.user.id

    const body = await request.json()

    // Validate input
    const validation = PriceAlertSchema.safeParse(body)
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

    const { routeId, targetPrice, service, alertType } = validation.data

    const alert = await createPriceAlert(session.user.id, routeId, targetPrice, service, alertType)

    if (alert === 'route_not_found') {
      return NextResponse.json(
        { error: 'Route not found' },
        { status: 404, headers: createResponseHeaders(requestId) }
      )
    }

    if (!alert) {
      return NextResponse.json(
        { error: 'Failed to create price alert' },
        { status: 500, headers: createResponseHeaders(requestId) }
      )
    }

    return NextResponse.json(
      {
        success: true,
        alertId: alert.id,
        message: 'Price alert created successfully',
      },
      { headers: createResponseHeaders(requestId) }
    )
  } catch (error: unknown) {
    const err = error as Error
    logError({
      error: err,
      route: 'api/price-alerts.POST',
      requestId,
      userId,
    })

    return NextResponse.json(
      { error: 'Failed to create price alert', detail: err?.message },
      { status: 500, headers: createResponseHeaders(requestId) }
    )
  }
}

async function handleDelete(request: NextRequest) {
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

    const alertId = request.nextUrl.searchParams.get('id')
    if (!alertId) {
      return NextResponse.json(
        { error: 'Alert ID is required' },
        { status: 400, headers: createResponseHeaders(requestId) }
      )
    }

    const result = await deletePriceAlert(alertId, userId)

    if (result === 'not_found') {
      return NextResponse.json(
        { error: 'Price alert not found' },
        { status: 404, headers: createResponseHeaders(requestId) }
      )
    }

    if (result === 'error') {
      return NextResponse.json(
        { error: 'Failed to delete price alert' },
        { status: 500, headers: createResponseHeaders(requestId) }
      )
    }

    return new NextResponse(null, { status: 204, headers: createResponseHeaders(requestId) })
  } catch (error) {
    logError({
      error: error instanceof Error ? error : new Error('Failed to delete price alert'),
      route: 'api/price-alerts.DELETE',
      requestId,
      userId,
    })

    return NextResponse.json(
      { error: 'Failed to delete price alert' },
      { status: 500, headers: createResponseHeaders(requestId) }
    )
  }
}

export const POST = withCors(withRateLimit(handlePost))
export const DELETE = withCors(withRateLimit(handleDelete))
export const OPTIONS = handleOptions
