import { NextRequest, NextResponse } from 'next/server'

/**
 * CORS Configuration
 *
 * Only allow requests from:
 * - localhost:3000 (development)
 * - Production domain via NEXT_PUBLIC_APP_URL env var
 *
 * No wildcard (*) - this is not a public API.
 */
const allowedOrigins = ['http://localhost:3000', process.env.NEXT_PUBLIC_APP_URL].filter(
  (origin): origin is string => Boolean(origin)
)

// Without NEXT_PUBLIC_APP_URL the allowlist is localhost-only, so all
// cross-origin production traffic gets no CORS headers — flag it loudly.
if (process.env.NODE_ENV === 'production' && !process.env.NEXT_PUBLIC_APP_URL) {
  console.warn('[cors] NEXT_PUBLIC_APP_URL not set — CORS allowlist contains only localhost')
}

type Handler = (req: NextRequest) => Promise<NextResponse> | NextResponse

/**
 * CORS wrapper for Next.js API routes.
 *
 * Usage:
 *   import { withCors } from '@/lib/cors'
 *
 *   async function handlePost(req: NextRequest) {
 *     // your logic
 *     return NextResponse.json({ ok: true })
 *   }
 *
 *   export const POST = withCors(handlePost)
 *   export const OPTIONS = handleOptions
 *
 * Key design decisions:
 * - All CORS logic in app code, no API gateway
 * - Rate limiting stays inside handlers
 * - Simple origin allowlist, no regex magic
 */
export function withCors(handler: Handler): Handler {
  return async (req: NextRequest) => {
    const origin = req.headers.get('origin') || ''
    const isAllowed = allowedOrigins.includes(origin)

    // Handle preflight OPTIONS requests
    if (req.method === 'OPTIONS') {
      const preflight = new NextResponse(null, { status: 204 })
      if (isAllowed) {
        preflight.headers.set('Access-Control-Allow-Origin', origin)
      }
      preflight.headers.set('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS')
      preflight.headers.set(
        'Access-Control-Allow-Headers',
        'Content-Type, Authorization, x-session-id, x-user-id'
      )
      preflight.headers.set('Access-Control-Max-Age', '86400') // Cache preflight for 24h
      preflight.headers.set('Vary', 'Origin')
      return preflight
    }

    // Execute the actual handler
    const res = await handler(req)

    // Add CORS headers to the response
    if (isAllowed) {
      res.headers.set('Access-Control-Allow-Origin', origin)
    }
    res.headers.set('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS')
    res.headers.set(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization, x-session-id, x-user-id'
    )
    res.headers.set('Vary', 'Origin')

    return res
  }
}

export const handleOptions = withCors(
  async (_req: NextRequest) => new NextResponse(null, { status: 204 })
)
