jest.mock('@/lib/prisma', () => ({
  prisma: {
    savedRoute: {
      findUnique: jest.fn(),
    },
  },
}))

import { verifyRouteOwnership } from '@/lib/route-ownership'
import { prisma } from '@/lib/prisma'

const mockFindUnique = prisma.savedRoute.findUnique as jest.Mock

describe('verifyRouteOwnership', () => {
  const ORIGINAL_ENV = { ...process.env }

  beforeEach(() => {
    jest.clearAllMocks()
    process.env = { ...ORIGINAL_ENV }
    process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test'
  })

  afterAll(() => {
    process.env = ORIGINAL_ENV
  })

  it('returns true when the user has a SavedRoute for the route', async () => {
    mockFindUnique.mockResolvedValue({ id: 'saved-1' })

    await expect(verifyRouteOwnership('user-1', 'route-1')).resolves.toBe(true)
    expect(mockFindUnique).toHaveBeenCalledWith({
      where: { userId_routeId: { userId: 'user-1', routeId: 'route-1' } },
      select: { id: true },
    })
  })

  it('returns false when no SavedRoute exists for the user+route pair', async () => {
    mockFindUnique.mockResolvedValue(null)

    await expect(verifyRouteOwnership('user-1', 'route-of-other-user')).resolves.toBe(false)
  })

  it('denies access on database errors', async () => {
    mockFindUnique.mockRejectedValue(new Error('connection refused'))

    await expect(verifyRouteOwnership('user-1', 'route-1')).resolves.toBe(false)
  })

  it('allows access in mock mode (no DATABASE_URL)', async () => {
    delete process.env.DATABASE_URL

    await expect(verifyRouteOwnership('user-1', 'route-1')).resolves.toBe(true)
    expect(mockFindUnique).not.toHaveBeenCalled()
  })
})
