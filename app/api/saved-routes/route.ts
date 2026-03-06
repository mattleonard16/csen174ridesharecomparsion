import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/auth'
import { withCors } from '@/lib/cors'
import { withRateLimit } from '@/lib/rate-limiter'
import { saveRouteForUser } from '@/lib/database'

const SaveRouteSchema = z.object({
  routeId: z.string().min(1, 'routeId is required'),
  nickname: z.string().max(120).optional(),
})

function getRequestId(request: NextRequest): string {
  return request.headers.get('x-request-id') ?? crypto.randomUUID()
}

function createResponseHeaders(requestId: string): Record<string, string> {
  return {
    'x-request-id': requestId,
  }
}

async function handlePost(request: NextRequest) {
  const requestId = getRequestId(request)

  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401, headers: createResponseHeaders(requestId) }
      )
    }

    const body = await request.json()
    const validation = SaveRouteSchema.safeParse(body)

    if (!validation.success) {
      return NextResponse.json(
        {
          error: 'Invalid input',
          details: validation.error.flatten().fieldErrors,
        },
        { status: 400, headers: createResponseHeaders(requestId) }
      )
    }

    const success = await saveRouteForUser(
      session.user.id,
      validation.data.routeId,
      validation.data.nickname
    )

    if (!success) {
      return NextResponse.json(
        { error: 'Failed to save route' },
        { status: 500, headers: createResponseHeaders(requestId) }
      )
    }

    return NextResponse.json({ success: true }, { headers: createResponseHeaders(requestId) })
  } catch {
    return NextResponse.json(
      { error: 'Failed to save route' },
      { status: 500, headers: createResponseHeaders(requestId) }
    )
  }
}

export const POST = withCors(withRateLimit(handlePost))
export const OPTIONS = withCors(handlePost)
