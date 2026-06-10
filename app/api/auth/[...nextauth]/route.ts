import { handlers } from '@/auth'
import { withRateLimit } from '@/lib/rate-limiter'

export const GET = handlers.GET

// POST carries credential sign-in attempts — throttle to block brute force.
// GET stays open: SessionProvider polls it on every page load.
export const POST = withRateLimit(handlers.POST)
