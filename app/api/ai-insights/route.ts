import { type NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'
import { withCors } from '@/lib/cors'
import { z } from 'zod'

// Per-IP limit: 5 calls/hour per client
const AI_RATE_LIMIT = parseInt(process.env.OPENAI_RATE_LIMIT ?? '5', 10) || 5

// Global daily cap: 200 calls/day across all users (~$0.018/day max spend)
const AI_DAILY_CAP = parseInt(process.env.OPENAI_DAILY_CAP ?? '200', 10) || 200

const aiRateTracker = new Map<string, { count: number; resetTime: number }>()

// Global daily counter — resets at midnight UTC
let globalDailyCount = 0
let globalDailyResetDate = new Date().toISOString().split('T')[0]

function checkGlobalDailyCap(): { allowed: boolean } {
  const today = new Date().toISOString().split('T')[0]
  if (today !== globalDailyResetDate) {
    globalDailyCount = 0
    globalDailyResetDate = today
  }
  if (globalDailyCount >= AI_DAILY_CAP) {
    return { allowed: false }
  }
  globalDailyCount++
  return { allowed: true }
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

function checkAiRateLimit(clientId: string): { allowed: boolean; retryAfter: number } {
  const now = Date.now()
  const entry = aiRateTracker.get(clientId)

  if (entry && now < entry.resetTime) {
    if (entry.count >= AI_RATE_LIMIT) {
      return { allowed: false, retryAfter: Math.ceil((entry.resetTime - now) / 1000) }
    }
    aiRateTracker.set(clientId, { count: entry.count + 1, resetTime: entry.resetTime })
  } else {
    aiRateTracker.set(clientId, { count: 1, resetTime: now + 3_600_000 })
    // Evict old entries periodically
    if (aiRateTracker.size > 5000) {
      for (const [key, val] of Array.from(aiRateTracker.entries())) {
        if (val.resetTime <= now) aiRateTracker.delete(key)
      }
    }
  }

  return { allowed: true, retryAfter: 0 }
}

const RequestSchema = z.object({
  pickup: z.string().min(1).max(200),
  destination: z.string().min(1).max(200),
  results: z.object({
    uber: z.object({ price: z.string(), waitTime: z.string() }),
    lyft: z.object({ price: z.string(), waitTime: z.string() }),
    taxi: z.object({ price: z.string(), waitTime: z.string() }),
    waymo: z
      .object({ price: z.string(), waitTime: z.string() })
      .optional()
      .nullable(),
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
    results.waymo
      ? `Waymo ${results.waymo.price} (${results.waymo.waitTime} wait)`
      : null,
  ]
    .filter(Boolean)
    .join(', ')

  const surgeNote =
    surgeInfo?.isActive
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

async function handlePost(request: NextRequest) {
  // Check global daily cap first (cheapest check, bounds total spend)
  if (!checkGlobalDailyCap().allowed) {
    return NextResponse.json(
      { error: 'AI insights daily limit reached — try again tomorrow' },
      { status: 429 }
    )
  }

  const clientId = getClientIp(request)
  const { allowed, retryAfter } = checkAiRateLimit(clientId)

  if (!allowed) {
    return NextResponse.json(
      { error: 'AI insights rate limit reached — try again later' },
      {
        status: 429,
        headers: { 'Retry-After': retryAfter.toString() },
      }
    )
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = RequestSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request data' }, { status: 400 })
  }

  const { pickup, destination, results, surgeInfo } = parsed.data

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    return NextResponse.json(
      { error: 'AI insights not configured' },
      { status: 503 }
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
    return NextResponse.json({ insight })
  } catch (error) {
    console.error('OpenAI API error:', error)
    return NextResponse.json(
      { error: 'AI insights temporarily unavailable' },
      { status: 503 }
    )
  }
}

export const POST = withCors(handlePost)
