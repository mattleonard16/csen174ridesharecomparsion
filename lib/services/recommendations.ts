/**
 * Recommendation Engine
 *
 * Generates actionable recommendations based on RouteInsights data.
 * Pure functions that analyze patterns and produce structured outputs.
 */

import { prisma } from '@/lib/prisma'
import { type ServiceType } from '@/lib/generated/prisma'
import { getOrComputeInsights } from './insights-aggregator'
import { mapServiceToEnum, RIDE_SERVICE_NAMES } from '@/lib/service-mappings'
import { pricingEngine } from '@/lib/pricing'
import type { AIRecommendation } from '@/types'

// In-memory recommendation cache (15min TTL)
const REC_CACHE = new Map<string, { value: RecommendationOutput; expiresAt: number }>()
const REC_CACHE_TTL_MS = 15 * 60 * 1000 // 15 minutes
const MAX_REC_CACHE_SIZE = 500
const RECOMMENDATION_CACHE_VERSION = 'v2'

function cleanupExpiredEntries<T>(cache: Map<string, { value: T; expiresAt: number }>): void {
  const now = Date.now()
  for (const [key, entry] of Array.from(cache.entries())) {
    if (entry.expiresAt <= now) cache.delete(key)
  }
}

interface InsightsData {
  cheapestHour: number
  cheapestAvgPrice: number
  expensiveHour: number
  expensiveAvgPrice: number
  avgPriceByHour: Record<string, number>
  surgeProbabilityByHour: Record<string, number>
  cheapestService: string | null
  sampleSize: number
}

export interface RecommendationInput {
  routeId?: string
  userId?: string
  currentPrice?: number
  currentService?: string
  timestamp?: Date
}

export interface RecommendationOutput {
  recommendations: AIRecommendation[]
}

function formatHour(hour: number): string {
  if (hour === 0) return '12 AM'
  if (hour === 12) return '12 PM'
  if (hour < 12) return `${hour} AM`
  return `${hour - 12} PM`
}

/**
 * Generate a departure time recommendation based on hourly price patterns.
 */
function generateDepartureTimeRec(
  insights: InsightsData,
  currentHour: number
): AIRecommendation | null {
  const currentAvg = insights.avgPriceByHour[String(currentHour)]
  if (!currentAvg || insights.cheapestAvgPrice <= 0) return null

  const savings = currentAvg - insights.cheapestAvgPrice
  const pctDiff = ((savings / currentAvg) * 100).toFixed(0)

  // Only recommend if there's meaningful savings (>10%)
  if (savings < 1 || Number(pctDiff) < 10) return null

  const confidence = Math.min(0.95, 0.5 + insights.sampleSize * 0.005)

  return {
    type: 'DEPARTURE_TIME',
    title: 'Better Time to Ride',
    message: `Prices drop ~$${savings.toFixed(0)} at ${formatHour(insights.cheapestHour)} (${pctDiff}% cheaper than now)`,
    confidence: Number(confidence.toFixed(2)),
    dataPoints: {
      potentialSavings: Number(savings.toFixed(2)),
      bestHour: insights.cheapestHour,
      currentPrice: Number(currentAvg.toFixed(2)),
      bestPrice: insights.cheapestAvgPrice,
    },
  }
}

/**
 * Generate a service choice recommendation based on historical patterns.
 */
function generateServiceChoiceRec(
  allInsights: Map<string, InsightsData>,
  currentService?: string
): AIRecommendation | null {
  // Find the consistently cheapest service
  const serviceAvgs: { service: string; avg: number; sampleSize: number }[] = []

  allInsights.forEach((insights, service) => {
    const prices = Object.values(insights.avgPriceByHour) as number[]
    if (prices.length === 0) return

    const overallAvg = prices.reduce((sum: number, p: number) => sum + p, 0) / prices.length
    serviceAvgs.push({ service, avg: overallAvg, sampleSize: insights.sampleSize })
  })

  if (serviceAvgs.length < 2) return null

  serviceAvgs.sort((a, b) => a.avg - b.avg)
  const cheapest = serviceAvgs[0]
  const secondCheapest = serviceAvgs[1]

  const pctDiff = (((secondCheapest.avg - cheapest.avg) / secondCheapest.avg) * 100).toFixed(0)

  // Only suggest if >10% difference
  if (Number(pctDiff) < 10) return null

  // Don't recommend what they're already using
  if (currentService && cheapest.service.toLowerCase() === currentService.toLowerCase()) {
    return null
  }

  const serviceName = cheapest.service.charAt(0).toUpperCase() + cheapest.service.slice(1)
  const confidence = Math.min(
    0.9,
    0.5 + Math.min(cheapest.sampleSize, secondCheapest.sampleSize) * 0.005
  )

  return {
    type: 'SERVICE_CHOICE',
    title: 'Best Service for This Route',
    message: `For this route, ${serviceName} has been ${pctDiff}% cheaper on average`,
    confidence: Number(confidence.toFixed(2)),
    dataPoints: {
      bestService: cheapest.service,
      potentialSavings: Number((secondCheapest.avg - cheapest.avg).toFixed(2)),
      bestPrice: Number(cheapest.avg.toFixed(2)),
    },
  }
}

/**
 * Generate a surge forecast recommendation based on hourly surge probability.
 */
function generateSurgeForecastRec(
  insights: InsightsData,
  currentHour: number,
  currentSurgeActive: boolean
): AIRecommendation | null {
  if (!currentSurgeActive) return null

  const surgeProbByHour = insights.surgeProbabilityByHour

  // Find the nearest future hour where surge probability drops below 30%
  let surgeEndHour: number | null = null
  for (let offset = 1; offset <= 6; offset++) {
    const checkHour = (currentHour + offset) % 24
    const prob = surgeProbByHour[String(checkHour)]
    if (prob !== undefined && prob < 0.3) {
      surgeEndHour = checkHour
      break
    }
  }

  if (surgeEndHour === null) return null

  const currentProb = surgeProbByHour[String(currentHour)] ?? 0
  const confidence = Math.min(0.85, 0.4 + insights.sampleSize * 0.005)

  return {
    type: 'SURGE_FORECAST',
    title: 'Surge Likely to End Soon',
    message: `Surge is ${(currentProb * 100).toFixed(0)}% likely now but typically ends by ${formatHour(surgeEndHour)}`,
    confidence: Number(confidence.toFixed(2)),
    dataPoints: {
      surgeEndEstimate: formatHour(surgeEndHour),
      bestHour: surgeEndHour,
    },
  }
}

/**
 * Generate a savings insight based on user's past recommendation actions.
 */
async function generateSavingsInsight(userId: string): Promise<AIRecommendation | null> {
  try {
    const thirtyDaysAgo = new Date()
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

    const actions = await prisma.recommendationAction.findMany({
      where: {
        userId,
        action: 'FOLLOWED',
        estimatedSavings: { not: null },
        createdAt: { gte: thirtyDaysAgo },
      },
      select: { estimatedSavings: true },
    })

    if (actions.length === 0) return null

    const totalSavings = actions.reduce((sum, a) => sum + (a.estimatedSavings ?? 0), 0)

    if (totalSavings <= 0) return null

    return {
      type: 'SAVINGS_INSIGHT',
      title: 'Your Savings',
      message: `You've saved $${totalSavings.toFixed(2)} this month by following ${actions.length} recommendation${actions.length === 1 ? '' : 's'}`,
      confidence: 0.95,
      dataPoints: {
        potentialSavings: Number(totalSavings.toFixed(2)),
      },
    }
  } catch {
    return null
  }
}

/**
 * Get fallback recommendations from the pricing engine's static rules.
 */
function getFallbackRecommendations(timestamp: Date): AIRecommendation[] {
  const tips = pricingEngine.getBestTimeRecommendations(timestamp)
  if (tips.length === 0) return []

  return [
    {
      type: 'DEPARTURE_TIME',
      title: 'Timing Tips',
      message: tips[0],
      confidence: 0.4,
      dataPoints: {},
    },
  ]
}

function getCacheKey(input: RecommendationInput, timestamp: Date): string {
  const hourBlock = Math.floor(timestamp.getHours() / 2)
  const dayType = timestamp.getDay() === 0 || timestamp.getDay() === 6 ? 'weekend' : 'weekday'
  const serviceKey = input.currentService?.toLowerCase() ?? 'default'
  const surgeKey = input.currentPrice !== undefined ? 'surge-context' : 'no-surge-context'
  const userKey = input.userId ?? 'anon'

  return [
    'rec',
    RECOMMENDATION_CACHE_VERSION,
    input.routeId ?? 'general',
    dayType,
    hourBlock,
    serviceKey,
    surgeKey,
    userKey,
  ].join(':')
}

/**
 * Main entry point: generate recommendations for a given context.
 */
export async function generateRecommendations(
  input: RecommendationInput
): Promise<RecommendationOutput> {
  const timestamp = input.timestamp ?? new Date()
  const currentHour = timestamp.getHours()

  // Check cache
  const cacheKey = getCacheKey(input, timestamp)
  const cached = REC_CACHE.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value
  }

  const recommendations: AIRecommendation[] = []

  // If we have a routeId, generate data-driven recommendations
  if (input.routeId) {
    try {
      // Fetch insights for all services in parallel
      const insightsMap = new Map<string, InsightsData>()
      const insightResults = await Promise.allSettled(
        RIDE_SERVICE_NAMES.map(async serviceName => {
          const serviceEnum = mapServiceToEnum(serviceName)
          const insights = await getOrComputeInsights(input.routeId!, serviceEnum)
          return { serviceName, insights }
        })
      )

      for (const result of insightResults) {
        if (result.status === 'fulfilled' && result.value.insights) {
          insightsMap.set(result.value.serviceName, result.value.insights)
        }
      }

      // Use current service's insights for time/surge recs, or first available
      const currentServiceKey = input.currentService?.toLowerCase() ?? 'uber'
      const primaryInsights =
        insightsMap.get(currentServiceKey) ?? insightsMap.values().next().value

      if (primaryInsights) {
        // Departure time recommendation
        const departureRec = generateDepartureTimeRec(primaryInsights, currentHour)
        if (departureRec) recommendations.push(departureRec)

        // Surge forecast recommendation
        const surgeActive = input.currentPrice
          ? primaryInsights.surgeProbabilityByHour[String(currentHour)] > 0.5
          : false
        const surgeRec = generateSurgeForecastRec(primaryInsights, currentHour, surgeActive)
        if (surgeRec) recommendations.push(surgeRec)
      }

      // Service choice recommendation (uses all services)
      if (insightsMap.size >= 2) {
        const serviceRec = generateServiceChoiceRec(insightsMap, input.currentService)
        if (serviceRec) recommendations.push(serviceRec)
      }
    } catch (error) {
      console.warn('Failed to generate data-driven recommendations:', error)
    }
  }

  // Savings insight for authenticated users
  if (input.userId) {
    const savingsRec = await generateSavingsInsight(input.userId)
    if (savingsRec) recommendations.push(savingsRec)
  }

  // Fallback if no data-driven recs generated
  if (recommendations.length === 0) {
    recommendations.push(...getFallbackRecommendations(timestamp))
  }

  // Limit to 3 recommendations, sorted by confidence
  const sortedRecs = [...recommendations].sort((a, b) => b.confidence - a.confidence).slice(0, 3)

  const output: RecommendationOutput = { recommendations: sortedRecs }

  // Persist to DB if we have a routeId (non-blocking for feature)
  if (input.routeId && sortedRecs.length > 0) {
    try {
      const validUntil = new Date(Date.now() + 24 * 60 * 60 * 1000)
      const persisted = await Promise.all(
        sortedRecs.map(rec =>
          prisma.recommendation.create({
            data: {
              routeId: input.routeId!,
              userId: input.userId ?? null,
              type: rec.type,
              title: rec.title,
              message: rec.message,
              dataPoints: rec.dataPoints,
              confidence: rec.confidence,
              validUntil,
            },
          })
        )
      )
      output.recommendations = sortedRecs.map((rec, i) => ({
        ...rec,
        id: persisted[i].id,
      }))
    } catch (error) {
      console.warn('Failed to persist recommendations:', error)
    }
  }

  // Cache result
  cleanupExpiredEntries(REC_CACHE)
  if (REC_CACHE.size >= MAX_REC_CACHE_SIZE) {
    const firstKey = REC_CACHE.keys().next().value
    if (firstKey) REC_CACHE.delete(firstKey)
  }
  REC_CACHE.set(cacheKey, { value: output, expiresAt: Date.now() + REC_CACHE_TTL_MS })

  return output
}
