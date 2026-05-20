/**
 * Recommendation Actions API
 *
 * Tracks user interactions with AI recommendations.
 * POST /api/recommendations/actions - Record an action (viewed, clicked, followed, dismissed)
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { auth } from '@/auth'
import { handleOptions, withCors } from '@/lib/cors'
import { withRateLimit } from '@/lib/rate-limiter'
import { isRedisAvailable, redis } from '@/lib/redis'
import { logError } from '@/lib/monitoring'
import { getRequestId, createResponseHeaders } from '@/lib/api-helpers'
import { z } from 'zod'

const ActionSchema = z.object({
  recommendationId: z.string().min(1),
  action: z.enum(['VIEWED', 'CLICKED', 'FOLLOWED', 'DISMISSED']),
  estimatedSavings: z.number().min(0).optional(),
})

const dedupeTtls = {
  VIEWED: 15 * 60,
  CLICKED: 5 * 60,
  FOLLOWED: 24 * 60 * 60,
  DISMISSED: 24 * 60 * 60,
} as const

const MAX_DEDUPE_STORE_SIZE = 5000
const inMemoryDedupeStore = new Map<string, number>()

function getActorId(request: NextRequest, userId: string | null): string | null {
  if (userId) {
    return `user:${userId}`
  }

  const sessionId = request.headers.get('x-session-id')?.trim()
  if (sessionId) {
    return `session:${sessionId}`
  }

  return null
}

function cleanupExpiredDedupes(now: number) {
  inMemoryDedupeStore.forEach((expiresAt, key) => {
    if (expiresAt <= now) {
      inMemoryDedupeStore.delete(key)
    }
  })

  if (inMemoryDedupeStore.size > MAX_DEDUPE_STORE_SIZE) {
    const entries = Array.from(inMemoryDedupeStore.entries()).sort((a, b) => a[1] - b[1])
    const toRemove = entries.slice(0, entries.length - MAX_DEDUPE_STORE_SIZE)
    for (const entry of toRemove) {
      inMemoryDedupeStore.delete(entry[0])
    }
  }
}

async function claimActionKey(dedupeKey: string, ttlSeconds: number): Promise<boolean> {
  if (isRedisAvailable && redis) {
    try {
      const result = await redis.set(dedupeKey, '1', { nx: true, ex: ttlSeconds })
      return result === 'OK'
    } catch {
      // Fall through to in-memory dedupe.
    }
  }

  const now = Date.now()
  if (Math.random() < 0.05) {
    cleanupExpiredDedupes(now)
  }
  const existingExpiry = inMemoryDedupeStore.get(dedupeKey)
  if (existingExpiry && existingExpiry > now) {
    return false
  }

  inMemoryDedupeStore.set(dedupeKey, now + ttlSeconds * 1000)
  return true
}

async function releaseActionKey(dedupeKey: string): Promise<void> {
  if (isRedisAvailable && redis) {
    try {
      await redis.del(dedupeKey)
      return
    } catch {
      // Fall through to in-memory cleanup.
    }
  }

  inMemoryDedupeStore.delete(dedupeKey)
}

async function handlePost(request: NextRequest) {
  const requestId = getRequestId(request)

  if (!process.env.DATABASE_URL) {
    return NextResponse.json(
      { error: 'Database not configured' },
      { status: 503, headers: createResponseHeaders(requestId) }
    )
  }

  const session = await auth()
  const userId = session?.user?.id ?? null
  const actorId = getActorId(request, userId)
  let dedupeKey: string | null = null
  let actionClaimed = false

  try {
    const body = await request.json()
    const validation = ActionSchema.safeParse(body)

    if (!validation.success) {
      return NextResponse.json(
        { error: 'Invalid input', details: validation.error.flatten().fieldErrors },
        { status: 400, headers: createResponseHeaders(requestId) }
      )
    }

    if (!actorId) {
      return NextResponse.json(
        { error: 'Authenticated user or session identifier required' },
        { status: 401, headers: createResponseHeaders(requestId) }
      )
    }

    const { recommendationId, action, estimatedSavings } = validation.data

    // Verify recommendation exists
    const recommendation = await prisma.recommendation.findUnique({
      where: { id: recommendationId },
    })

    if (!recommendation) {
      return NextResponse.json(
        { error: 'Recommendation not found' },
        { status: 404, headers: createResponseHeaders(requestId) }
      )
    }

    dedupeKey = `recommendation-action:${actorId}:${recommendationId}:${action}`
    actionClaimed = await claimActionKey(dedupeKey, dedupeTtls[action])

    if (!actionClaimed) {
      return NextResponse.json(
        { success: true, deduped: true },
        { headers: createResponseHeaders(requestId) }
      )
    }

    // Create the action record
    await prisma.recommendationAction.create({
      data: {
        recommendationId,
        userId: userId ?? undefined,
        action,
        estimatedSavings: estimatedSavings ?? null,
      },
    })

    // Update impression/click counts on the recommendation (non-blocking)
    if (action === 'VIEWED') {
      prisma.recommendation
        .update({
          where: { id: recommendationId },
          data: { impressions: { increment: 1 } },
        })
        .catch(() => {})
    } else if (action === 'CLICKED') {
      prisma.recommendation
        .update({
          where: { id: recommendationId },
          data: { clicks: { increment: 1 } },
        })
        .catch(() => {})
    }

    return NextResponse.json({ success: true }, { headers: createResponseHeaders(requestId) })
  } catch (error) {
    if (actionClaimed && dedupeKey) {
      await releaseActionKey(dedupeKey).catch(() => {})
    }

    logError({
      error: error instanceof Error ? error : new Error('Failed to record recommendation action'),
      route: 'api/recommendations/actions',
      requestId,
      userId: userId ?? undefined,
      actorId: actorId ?? undefined,
    })

    return NextResponse.json(
      { error: 'Failed to record action' },
      { status: 500, headers: createResponseHeaders(requestId) }
    )
  }
}

export const POST = withCors(withRateLimit(handlePost))
export const OPTIONS = handleOptions
