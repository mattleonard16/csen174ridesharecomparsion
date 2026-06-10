/**
 * Route ownership verification (IDOR protection) — canonical source.
 *
 * Ownership means the user has a SavedRoute for the route (composite
 * userId+routeId key). Mock mode (no DATABASE_URL) allows access so the
 * app works without a database; database errors deny access.
 */

import { prisma } from '@/lib/prisma'

export async function verifyRouteOwnership(userId: string, routeId: string): Promise<boolean> {
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
