/** @jest-environment node */

import { NextRequest } from 'next/server'
import { GET } from '@/app/api/dashboard/route'
import { auth } from '@/auth'
import { getRoutePriceHistory, getHourlyPriceAverage, getSavedRoutesForUser } from '@/lib/database'
import { prisma } from '@/lib/prisma'

jest.mock('@/lib/database', () => ({
  getRoutePriceHistory: jest.fn(),
  getHourlyPriceAverage: jest.fn(),
  getSavedRoutesForUser: jest.fn(),
}))

jest.mock('@/lib/prisma', () => ({
  prisma: {
    savedRoute: {
      findUnique: jest.fn(),
    },
    recommendationAction: {
      findMany: jest.fn(),
    },
    searchLog: {
      count: jest.fn(),
    },
    priceAlert: {
      count: jest.fn(),
    },
    routeInsights: {
      findFirst: jest.fn(),
    },
  },
}))

const mockAuth = auth as jest.MockedFunction<typeof auth>
const mockGetSavedRoutes = getSavedRoutesForUser as jest.MockedFunction<
  typeof getSavedRoutesForUser
>
const mockGetRoutePriceHistory = getRoutePriceHistory as jest.MockedFunction<
  typeof getRoutePriceHistory
>
const mockGetHourlyAverage = getHourlyPriceAverage as jest.MockedFunction<
  typeof getHourlyPriceAverage
>

function createRequest(query: string, ip: string) {
  return new NextRequest(`http://localhost:3000/api/dashboard${query}`, {
    headers: {
      'x-forwarded-for': ip,
    },
  })
}

describe('dashboard route', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    process.env.DATABASE_URL = 'postgres://test'
  })

  it('rejects unauthenticated access', async () => {
    mockAuth.mockResolvedValue(null as never)

    const response = await GET(createRequest('', '10.0.1.1'))

    expect(response.status).toBe(401)
  })

  it('returns saved routes for an authenticated user', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as never)
    mockGetSavedRoutes.mockResolvedValue([
      { id: 'saved-1', routeId: 'route-1', fromName: 'A', toName: 'B' },
    ] as never)

    const response = await GET(createRequest('?savedRoutes=true', '10.0.1.2'))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      savedRoutes: [
        expect.objectContaining({
          routeId: 'route-1',
        }),
      ],
    })
  })

  it('rejects access to routes not owned by the user', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-2' } } as never)
    ;(prisma.savedRoute.findUnique as jest.Mock).mockResolvedValue(null)

    const response = await GET(createRequest('?routeId=route-99', '10.0.1.3'))

    expect(response.status).toBe(403)
  })

  it('returns price history for owned routes', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-3' } } as never)
    ;(prisma.savedRoute.findUnique as jest.Mock).mockResolvedValue({ id: 'saved-1' })
    mockGetRoutePriceHistory.mockResolvedValue([{ final_price: 18 }] as never)
    mockGetHourlyAverage.mockResolvedValue([{ hour: 9, avg: 20 }] as never)

    const response = await GET(
      createRequest('?routeId=route-1&service=uber&daysBack=7', '10.0.1.4')
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      priceHistory: [{ final_price: 18 }],
      hourlyAverages: [{ hour: 9, avg: 20 }],
    })
  })
})
