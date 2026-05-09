import { type NextRequest, NextResponse } from 'next/server'
import { handleOptions, withCors } from '@/lib/cors'
import { getPriceTrendsSummary } from '@/lib/database-price-trends'
import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'
import { logError } from '@/lib/monitoring'
import { getRequestId, createResponseHeaders } from '@/lib/api-helpers'
import { z } from 'zod'

const SummaryQuerySchema = z.object({
  routeId: z.string().min(1, 'Route ID is required'),
  daysBack: z.coerce.number().int().min(1).max(90).optional().default(7),
})

/**
 * Verify that the user owns the specified route (IDOR protection).
 */
async function verifyRouteOwnership(userId: string, routeId: string): Promise<boolean> {
  if (!process.env.DATABASE_URL) {
    return true
  }

  try {
    const savedRoute = await prisma.savedRoute.findUnique({
      where: { userId_routeId: { userId, routeId } },
      select: { id: true },
    })
    return savedRoute != null
  } catch {
    return false
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
    const validation = SummaryQuerySchema.safeParse({
      routeId: searchParams.get('routeId'),
      daysBack: searchParams.get('daysBack') ?? undefined,
    })

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

    const { routeId, daysBack } = validation.data

    // IDOR protection
    const ownsRoute = await verifyRouteOwnership(session.user.id, routeId)
    if (!ownsRoute) {
      return NextResponse.json(
        { error: 'Access denied: You do not have permission to view this route' },
        { status: 403, headers: createResponseHeaders(requestId) }
      )
    }

    const summary = await getPriceTrendsSummary(routeId, daysBack)

    return NextResponse.json(summary, { headers: createResponseHeaders(requestId) })
  } catch (error) {
    logError({
      error: error instanceof Error ? error : new Error('Failed to fetch price trends summary'),
      route: 'api/price-trends/summary.GET',
      requestId,
      userId,
    })

    return NextResponse.json(
      { error: 'Failed to fetch price trends summary' },
      { status: 500, headers: createResponseHeaders(requestId) }
    )
  }
}

export const GET = withCors(handleGet)
export const OPTIONS = handleOptions
