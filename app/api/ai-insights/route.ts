import { type NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'
import { Ratelimit } from '@upstash/ratelimit'
import { handleOptions, withCors } from '@/lib/cors'
import { createResponseHeaders, getRequestId } from '@/lib/api-helpers'
import { logError } from '@/lib/monitoring'
import { redis } from '@/lib/redis'
import { z } from 'zod'

// Per-IP limit: 5 calls/hour per client
const AI_RATE_LIMIT = parseInt(process.env.OPENAI_RATE_LIMIT ?? '5', 10) || 5

// Global daily cap: 200 calls/day across all users (~$0.018/day max spend).
// Fixed-window resets at the UTC top of the day from the first request of the
// window; this is approximate, not calendar-midnight aligned.
const AI_DAILY_CAP = parseInt(process.env.OPENAI_DAILY_CAP ?? '200', 10) || 200

const aiRateLimiters = redis
  ? {
      hourly: new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(AI_RATE_LIMIT, '1h'),
        prefix: 'ratelimit:ai-insights:hourly',
      }),
      daily: new Ratelimit({
        redis,
        limiter: Ratelimit.fixedWindow(AI_DAILY_CAP, '1d'),
        prefix: 'ratelimit:ai-insights:daily',
      }),
    }
  : null

// In-memory fallback used when Upstash Redis is not configured (local dev,
// preview deploys). Per-process state — fine for single-instance dev, not
// suitable for multi-instance prod. Prod is expected to have Redis.
const memoryHourly = new Map<string, { count: number; resetTime: number }>()
const memoryDaily = { count: 0, resetDate: new Date().toISOString().split('T')[0] }

interface LimitOutcome {
  success: boolean
  reset: number
}

function memoryDailyLimit(): LimitOutcome {
  const today = new Date().toISOString().split('T')[0]
  if (today !== memoryDaily.resetDate) {
    memoryDaily.count = 0
    memoryDaily.resetDate = today
  }
  const tomorrow = new Date()
  tomorrow.setUTCHours(24, 0, 0, 0)
  if (memoryDaily.count >= AI_DAILY_CAP) {
    return { success: false, reset: tomorrow.getTime() }
  }
  memoryDaily.count++
  return { success: true, reset: tomorrow.getTime() }
}

function memoryHourlyLimit(clientId: string): LimitOutcome {
  const now = Date.now()
  const entry = memoryHourly.get(clientId)
  if (entry && now < entry.resetTime) {
    if (entry.count >= AI_RATE_LIMIT) {
      return { success: false, reset: entry.resetTime }
    }
    entry.count++
    return { success: true, reset: entry.resetTime }
  }
  const reset = now + 3_600_000
  memoryHourly.set(clientId, { count: 1, resetTime: reset })
  if (memoryHourly.size > 5000) {
    for (const [key, val] of Array.from(memoryHourly.entries())) {
      if (val.resetTime <= now) memoryHourly.delete(key)
    }
  }
  return { success: true, reset }
}

function getClientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')
  const realIp = request.headers.get('x-real-ip')
  const raw = forwarded?.split(',')[0].trim() || realIp || 'unknown'
  // Hash to avoid storing raw IPs
  let hash = 0
  for (let i = 0; i < raw.length; i++) {
    const char = raw.charCodeAt(i)
    hash = (hash << 5) - hash + char
    hash = hash & hash
  }
  return `ai_${Math.abs(hash)}`
}

const RequestSchema = z.object({
  pickup: z.string().min(1).max(200),
  destination: z.string().min(1).max(200),
  results: z.object({
    uber: z.object({ price: z.string(), waitTime: z.string() }),
    lyft: z.object({ price: z.string(), waitTime: z.string() }),
    taxi: z.object({ price: z.string(), waitTime: z.string() }),
    waymo: z.object({ price: z.string(), waitTime: z.string() }).optional().nullable(),
  }),
  surgeInfo: z
    .object({
      isActive: z.boolean(),
      multiplier: z.number(),
      reason: z.string(),
    })
    .optional()
    .nullable(),
})

function buildPrompt(
  pickup: string,
  destination: string,
  results: z.infer<typeof RequestSchema>['results'],
  surgeInfo: z.infer<typeof RequestSchema>['surgeInfo'],
  currentHour: number
): string {
  const services = [
    `Uber ${results.uber.price} (${results.uber.waitTime} wait)`,
    `Lyft ${results.lyft.price} (${results.lyft.waitTime} wait)`,
    `Taxi ${results.taxi.price} (${results.taxi.waitTime} wait)`,
    results.waymo ? `Waymo ${results.waymo.price} (${results.waymo.waitTime} wait)` : null,
  ]
    .filter(Boolean)
    .join(', ')

  const surgeNote = surgeInfo?.isActive
    ? ` Surge is active at ${surgeInfo.multiplier.toFixed(1)}x (${surgeInfo.reason}).`
    : ''

  const timeOfDay =
    currentHour < 6
      ? 'late night'
      : currentHour < 12
        ? 'morning'
        : currentHour < 17
          ? 'afternoon'
          : currentHour < 21
            ? 'evening'
            : 'night'

  return `You are a helpful rideshare advisor. A user is comparing rides from ${pickup} to ${destination}.

Services: ${services}.${surgeNote} Current time: ${timeOfDay}.

Give a 2-3 sentence recommendation: which service to take and why, and any timing advice if surge is active. Be direct, friendly, and specific with prices.`
}

async function checkLimits(clientId: string): Promise<[LimitOutcome, LimitOutcome]> {
  if (!aiRateLimiters) {
    return [memoryDailyLimit(), memoryHourlyLimit(clientId)]
  }
  const [daily, hourly] = await Promise.all([
    aiRateLimiters.daily.limit('global'),
    aiRateLimiters.hourly.limit(clientId),
  ])
  return [
    { success: daily.success, reset: daily.reset },
    { success: hourly.success, reset: hourly.reset },
  ]
}

async function handlePost(request: NextRequest) {
  const requestId = getRequestId(request)
  const responseHeaders = createResponseHeaders(requestId)

  const clientId = getClientIp(request)
  let dailyLimit: LimitOutcome
  let hourlyLimit: LimitOutcome

  try {
    ;[dailyLimit, hourlyLimit] = await checkLimits(clientId)
  } catch (error) {
    logError({
      error: error instanceof Error ? error : new Error('AI rate limit check failed'),
      route: 'api/ai-insights.POST',
      requestId,
    })

    return NextResponse.json(
      { error: 'AI insights temporarily unavailable' },
      { status: 503, headers: responseHeaders }
    )
  }

  if (!dailyLimit.success) {
    return NextResponse.json(
      { error: 'AI insights daily limit reached — try again tomorrow' },
      {
        status: 429,
        headers: {
          ...responseHeaders,
          'Retry-After': Math.ceil((dailyLimit.reset - Date.now()) / 1000).toString(),
        },
      }
    )
  }

  if (!hourlyLimit.success) {
    return NextResponse.json(
      { error: 'AI insights rate limit reached — try again later' },
      {
        status: 429,
        headers: {
          ...responseHeaders,
          'Retry-After': Math.ceil((hourlyLimit.reset - Date.now()) / 1000).toString(),
        },
      }
    )
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON body' },
      { status: 400, headers: responseHeaders }
    )
  }

  const parsed = RequestSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request data' },
      { status: 400, headers: responseHeaders }
    )
  }

  const { pickup, destination, results, surgeInfo } = parsed.data

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    return NextResponse.json(
      { error: 'AI insights not configured' },
      { status: 503, headers: responseHeaders }
    )
  }

  try {
    const client = new OpenAI({ apiKey })
    const currentHour = new Date().getHours()
    const prompt = buildPrompt(pickup, destination, results, surgeInfo, currentHour)

    const completion = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 150,
      temperature: 0.4,
    })

    const insight = completion.choices[0]?.message?.content?.trim() ?? ''
    return NextResponse.json({ insight }, { headers: responseHeaders })
  } catch (error) {
    logError({
      error: error instanceof Error ? error : new Error('OpenAI API error'),
      route: 'api/ai-insights.POST',
      requestId,
    })
    return NextResponse.json(
      { error: 'AI insights temporarily unavailable' },
      { status: 503, headers: responseHeaders }
    )
  }
}

export const POST = withCors(handlePost)
export const OPTIONS = handleOptions
