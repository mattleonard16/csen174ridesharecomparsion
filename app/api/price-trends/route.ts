import { type NextRequest, NextResponse } from 'next/server'
import { withCors } from '@/lib/cors'
import { getPriceTrendSnapshots } from '@/lib/database-price-trends'
import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'
import { logError } from '@/lib/monitoring'
import { getRequestId, createResponseHeaders } from '@/lib/api-helpers'
import { z } from 'zod'
import { isRideServiceName } from '@/lib/service-mappings'

const PriceTrendsQuerySchema = z.object({
  routeId: z.string().min(1, 'Route ID is required'),
  service: z
    .string()
    .optional()
    .refine(val => val === undefined || isRideServiceName(val), {
      message: 'Invalid service. Must be one of: uber, lyft, taxi, waymo',
    }),
  daysBack: z.coerce.number().int().min(1).max(90).optional().default(7),
})

/**
 * Verify that the user owns the specified route (IDOR protection).
 * Users can only access trends for routes they have saved.
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
    const validation = PriceTrendsQuerySchema.safeParse({
      routeId: searchParams.get('routeId'),
      service: searchParams.get('service') ?? undefined,
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

    const { routeId, service, daysBack } = validation.data

    // IDOR protection
    const ownsRoute = await verifyRouteOwnership(session.user.id, routeId)
    if (!ownsRoute) {
      return NextResponse.json(
        { error: 'Access denied: You do not have permission to view this route' },
        { status: 403, headers: createResponseHeaders(requestId) }
      )
    }

    const snapshots = await getPriceTrendSnapshots(routeId, {
      service: service as 'uber' | 'lyft' | 'taxi' | 'waymo' | undefined,
      daysBack,
    })

    return NextResponse.json({ snapshots }, { headers: createResponseHeaders(requestId) })
  } catch (error) {
    logError({
      error: error instanceof Error ? error : new Error('Failed to fetch price trends'),
      route: 'api/price-trends.GET',
      requestId,
      userId,
    })

    return NextResponse.json(
      { error: 'Failed to fetch price trends' },
      { status: 500, headers: createResponseHeaders(requestId) }
    )
  }
}

export const GET = withCors(handleGet)
export const OPTIONS = withCors(
  async (_req: NextRequest) => new NextResponse(null, { status: 204 })
)
