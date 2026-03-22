/** @jest-environment node */

import { NextRequest } from 'next/server'
import { PATCH, DELETE } from '@/app/api/ride-history/[id]/route'
import { auth } from '@/auth'
import { updateRideHistoryFare, deleteRideHistory } from '@/lib/database'

jest.mock('@/lib/database', () => ({
  updateRideHistoryFare: jest.fn(),
  deleteRideHistory: jest.fn(),
}))

const mockAuth = auth as jest.MockedFunction<typeof auth>
const mockUpdateRideHistoryFare = updateRideHistoryFare as jest.MockedFunction<
  typeof updateRideHistoryFare
>
const mockDeleteRideHistory = deleteRideHistory as jest.MockedFunction<typeof deleteRideHistory>

const TEST_ENTRY_ID = 'entry-abc-123'
const BASE_URL = `http://localhost:3000/api/ride-history/${TEST_ENTRY_ID}`

let ipCounter = 1
function nextIp() {
  return `10.0.${Math.floor(ipCounter / 256)}.${ipCounter++ % 256}`
}

function createPatchRequest(body: object, ip = nextIp()) {
  return new NextRequest(BASE_URL, {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': ip,
    },
    body: JSON.stringify(body),
  })
}

function createDeleteRequest(ip = nextIp()) {
  return new NextRequest(BASE_URL, {
    method: 'DELETE',
    headers: { 'x-forwarded-for': ip },
  })
}

const routeParams = { params: { id: TEST_ENTRY_ID } }

const mockEntry = {
  id: TEST_ENTRY_ID,
  routeId: 'route-1',
  service: 'uber' as const,
  estimatedFare: 20,
  finalFare: 22.5,
  waitTimeMinutes: 5,
  surgeMultiplier: 1.1,
  comparisonSnapshot: {},
  requestedAt: '2026-03-22T00:00:00.000Z',
  updatedAt: '2026-03-22T01:00:00.000Z',
}

describe('PATCH /api/ride-history/[id]', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValue(null as never)

    const response = await PATCH(createPatchRequest({ finalFare: 22.5 }), routeParams)

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toMatchObject({ error: 'Unauthorized' })
  })

  it('returns 400 when finalFare is missing', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as never)

    const response = await PATCH(createPatchRequest({}), routeParams)

    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.error).toBe('Invalid input')
    expect(body.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'finalFare' })])
    )
  })

  it('returns 400 when finalFare is negative', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as never)

    const response = await PATCH(createPatchRequest({ finalFare: -5 }), routeParams)

    expect(response.status).toBe(400)
  })

  it('returns 400 when finalFare exceeds 1000', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as never)

    const response = await PATCH(createPatchRequest({ finalFare: 1001 }), routeParams)

    expect(response.status).toBe(400)
  })

  it('returns 404 when entry not found (IDOR protection)', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as never)
    mockUpdateRideHistoryFare.mockResolvedValue(null)

    const response = await PATCH(createPatchRequest({ finalFare: 22.5 }), routeParams)

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toMatchObject({ error: 'Ride history entry not found' })
    expect(mockUpdateRideHistoryFare).toHaveBeenCalledWith(TEST_ENTRY_ID, 'user-1', 22.5)
  })

  it('returns 200 with updated entry on success', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as never)
    mockUpdateRideHistoryFare.mockResolvedValue(mockEntry as never)

    const response = await PATCH(createPatchRequest({ finalFare: 22.5 }), routeParams)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      id: TEST_ENTRY_ID,
      finalFare: 22.5,
    })
    expect(mockUpdateRideHistoryFare).toHaveBeenCalledWith(TEST_ENTRY_ID, 'user-1', 22.5)
  })
})

describe('DELETE /api/ride-history/[id]', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValue(null as never)

    const response = await DELETE(createDeleteRequest(), routeParams)

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toMatchObject({ error: 'Unauthorized' })
  })

  it('returns 404 when entry not found (IDOR protection)', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as never)
    mockDeleteRideHistory.mockResolvedValue(false)

    const response = await DELETE(createDeleteRequest(), routeParams)

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toMatchObject({ error: 'Ride history entry not found' })
    expect(mockDeleteRideHistory).toHaveBeenCalledWith(TEST_ENTRY_ID, 'user-1')
  })

  it('returns 204 with no body on success', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as never)
    mockDeleteRideHistory.mockResolvedValue(true)

    const response = await DELETE(createDeleteRequest(), routeParams)

    expect(response.status).toBe(204)
    expect(mockDeleteRideHistory).toHaveBeenCalledWith(TEST_ENTRY_ID, 'user-1')
  })
})
