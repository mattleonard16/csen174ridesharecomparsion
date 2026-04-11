import { type NextRequest, NextResponse } from 'next/server'
import { withCors } from '@/lib/cors'
import { getRoutePriceHistory, getHourlyPriceAverage, getSavedRoutesForUser } from '@/lib/database'
import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'
import { logError } from '@/lib/monitoring'
import { getRequestId, createResponseHeaders } from '@/lib/api-helpers'

/**
 * Verify that the user owns the specified route (IDOR protection)
 */
async function verifyRouteOwnership(userId: string, routeId: string): Promise<boolean> {
  if (!process.env.DATABASE_URL) {
    // In mock mode, allow access
    return true
  }

  try {
    const savedRoute = await prisma.savedRoute.findUnique({
      where: {
        userId_routeId: {
          userId,
          routeId,
        },
      },
      select: { id: true },
    })
    return savedRoute !== null
  } catch {
    return false
  }
}

async function handleGet(request: NextRequest) {
  const requestId = getRequestId(request)
  let userId: string | undefined

  try {
    // Verify authentication
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401, headers: createResponseHeaders(requestId) }
      )
    }
    userId = session.user.id

    const { searchParams } = new URL(request.url)
    const routeId = searchParams.get('routeId')
    const service = searchParams.get('service') as 'uber' | 'lyft' | 'taxi' | 'waymo' | null
    const daysBack = parseInt(searchParams.get('daysBack') || '7', 10)
    const getSavedRoutes = searchParams.get('savedRoutes') === 'true'
    const getSavings = searchParams.get('savings') === 'true'

    // If requesting savings data, return aggregated savings + surge insights
    if (getSavings) {
      const userId = session.user.id
      const thirtyDaysAgo = new Date()
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

      const [savingsActions, comparisonCount, alertsSet, unreadAlertCount, surgeInsightsRaw] =
        await Promise.all([
          // Savings from followed recommendations
          process.env.DATABASE_URL
            ? prisma.recommendationAction
                .findMany({
                  where: {
                    userId,
                    action: 'FOLLOWED',
                    estimatedSavings: { not: null },
                    createdAt: { gte: thirtyDaysAgo },
                  },
                  select: { estimatedSavings: true },
                })
                .catch(() => [])
            : Promise.resolve([]),
          // Count of search logs (comparisons)
          process.env.DATABASE_URL
            ? prisma.searchLog
                .count({
                  where: {
                    userId,
                    createdAt: { gte: thirtyDaysAgo },
                  },
                })
                .catch(() => 0)
            : Promise.resolve(0),
          // Count of active alerts
          process.env.DATABASE_URL
            ? prisma.priceAlert
                .count({
                  where: {
                    userId,
                    isActive: true,
                  },
                })
                .catch(() => 0)
            : Promise.resolve(0),
          process.env.DATABASE_URL
            ? prisma.alertNotification
                .count({
                  where: {
                    userId,
                    isRead: false,
                  },
                })
                .catch(() => 0)
            : Promise.resolve(0),
          // Surge insights from first saved route's RouteInsights
          (async () => {
            if (!process.env.DATABASE_URL) return []
            const firstSavedRoute = await prisma.savedRoute
              .findFirst({
                where: { userId, routeId: { not: null } },
                select: { routeId: true },
              })
              .catch(() => null)
            if (!firstSavedRoute?.routeId) return []
            const insights = await prisma.routeInsights
              .findFirst({
                where: { routeId: firstSavedRoute.routeId },
                select: { surgeProbabilityByHour: true },
              })
              .catch(() => null)
            if (!insights?.surgeProbabilityByHour) return []
            const surgeData = insights.surgeProbabilityByHour as Record<string, number>
            return Object.entries(surgeData)
              .map(([hour, probability]) => ({
                hour: parseInt(hour, 10),
                probability,
              }))
              .filter(s => s.probability > 0.1)
              .sort((a, b) => b.probability - a.probability)
              .slice(0, 8)
          })(),
        ])

      const totalSavings = savingsActions.reduce((sum, a) => sum + (a.estimatedSavings ?? 0), 0)

      return NextResponse.json(
        {
          savings: {
            totalSavings,
            comparisonCount,
            recsFollowed: savingsActions.length,
            alertsSet,
            unreadAlertCount,
          },
          surgeInsights: surgeInsightsRaw,
        },
        { headers: createResponseHeaders(requestId) }
      )
    }

    // If requesting saved routes, return them
    if (getSavedRoutes) {
      const savedRoutes = await getSavedRoutesForUser(session.user.id)
      return NextResponse.json({ savedRoutes }, { headers: createResponseHeaders(requestId) })
    }

    // If no routeId, return saved routes so the user can select one
    if (!routeId) {
      const savedRoutes = await getSavedRoutesForUser(session.user.id)
      return NextResponse.json(
        {
          savedRoutes,
          priceHistory: [],
          hourlyAverages: [],
        },
        { headers: createResponseHeaders(requestId) }
      )
    }

    // SECURITY: Verify user owns this route before accessing price data (IDOR protection)
    const ownsRoute = await verifyRouteOwnership(session.user.id, routeId)
    if (!ownsRoute) {
      return NextResponse.json(
        { error: 'Access denied: You do not have permission to view this route' },
        { status: 403, headers: createResponseHeaders(requestId) }
      )
    }

    // Validate service parameter
    if (service && !['uber', 'lyft', 'taxi', 'waymo'].includes(service)) {
      return NextResponse.json(
        { error: 'Invalid service type' },
        { status: 400, headers: createResponseHeaders(requestId) }
      )
    }

    // Validate daysBack
    if (isNaN(daysBack) || daysBack < 1 || daysBack > 90) {
      return NextResponse.json(
        { error: 'daysBack must be between 1 and 90' },
        { status: 400, headers: createResponseHeaders(requestId) }
      )
    }

    const [priceHistory, hourlyAverages] = await Promise.all([
      getRoutePriceHistory(routeId, daysBack),
      service ? getHourlyPriceAverage(routeId, service) : Promise.resolve([]),
    ])

    return NextResponse.json(
      {
        priceHistory,
        hourlyAverages,
      },
      { headers: createResponseHeaders(requestId) }
    )
  } catch (error) {
    logError({
      error: error instanceof Error ? error : new Error('Failed to fetch dashboard data'),
      route: 'api/dashboard.GET',
      requestId,
      userId,
    })

    return NextResponse.json(
      { error: 'Failed to fetch dashboard data' },
      { status: 500, headers: createResponseHeaders(requestId) }
    )
  }
}

export const GET = withCors(handleGet)
export const OPTIONS = withCors(handleGet)
