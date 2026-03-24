import { NextRequest, NextResponse } from 'next/server'

/**
 * CORS Configuration
 *
 * Only allow requests from:
 * - localhost:3000 (development)
 * - Production domain via NEXT_PUBLIC_APP_URL env var
 * - Project-scoped Vercel preview/production deployments
 */
const allowedOrigins = ['http://localhost:3000', process.env.NEXT_PUBLIC_APP_URL].filter(
  (origin): origin is string => Boolean(origin)
)

const VERCEL_PROJECT_NAME = process.env.VERCEL_PROJECT_NAME || 'ridesharecomparsion'

/**
 * Returns true if the given origin is permitted to access the API.
 * Explicit allowlist takes priority; project-scoped Vercel deployments also allowed.
 */
function isAllowedOrigin(origin: string): boolean {
  if (allowedOrigins.includes(origin)) return true
  // Allow this project's Vercel preview/production deployments only
  try {
    const hostname = new URL(origin).hostname
    if (hostname.endsWith('.vercel.app') && hostname.includes(VERCEL_PROJECT_NAME)) {
      return true
    }
  } catch {
    // Invalid URL — not allowed
  }
  return false
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
 *   export const OPTIONS = withCors(handlePost)
 *
 * Key design decisions:
 * - All CORS logic in app code, no API gateway
 * - Rate limiting stays inside handlers
 * - Explicit allowlist + Vercel deployment pattern matching
 */
export function withCors(handler: Handler): Handler {
  return async (req: NextRequest) => {
    const origin = req.headers.get('origin') || ''
    const isAllowed = isAllowedOrigin(origin)

    // Handle preflight OPTIONS requests
    if (req.method === 'OPTIONS') {
      const preflight = new NextResponse(null, { status: 204 })
      if (isAllowed) {
        preflight.headers.set('Access-Control-Allow-Origin', origin)
      }
      preflight.headers.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
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
    res.headers.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
    res.headers.set(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization, x-session-id, x-user-id'
    )
    res.headers.set('Vary', 'Origin')

    return res
  }
}
