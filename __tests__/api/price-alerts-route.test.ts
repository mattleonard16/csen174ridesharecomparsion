/** @jest-environment node */

import { NextRequest } from 'next/server'
import { POST, DELETE } from '@/app/api/price-alerts/route'
import { auth } from '@/auth'
import { createPriceAlert, deletePriceAlert } from '@/lib/database'

jest.mock('@/lib/database', () => ({
  createPriceAlert: jest.fn(),
  deletePriceAlert: jest.fn(),
}))

const mockAuth = auth as jest.MockedFunction<typeof auth>
const mockCreatePriceAlert = createPriceAlert as jest.MockedFunction<typeof createPriceAlert>
const mockDeletePriceAlert = deletePriceAlert as jest.MockedFunction<typeof deletePriceAlert>

function createRequest(body: object, ip: string) {
  return new NextRequest('http://localhost:3000/api/price-alerts', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': ip,
    },
    body: JSON.stringify(body),
  })
}

function deleteRequest(alertId: string | null, ip: string) {
  const url = alertId
    ? `http://localhost:3000/api/price-alerts?id=${alertId}`
    : 'http://localhost:3000/api/price-alerts'
  return new NextRequest(url, {
    method: 'DELETE',
    headers: { 'x-forwarded-for': ip },
  })
}

describe('price-alerts route', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('rejects unauthenticated alert creation', async () => {
    mockAuth.mockResolvedValue(null as never)

    const response = await POST(
      createRequest({ routeId: 'route-1', targetPrice: 25, service: 'any' }, '10.0.2.1')
    )

    expect(response.status).toBe(401)
  })

  it('validates the alert payload', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as never)

    const response = await POST(
      createRequest({ routeId: '', targetPrice: -5, service: 'bad' }, '10.0.2.2')
    )

    expect(response.status).toBe(400)
  })

  it('creates an alert for valid authenticated requests', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as never)
    mockCreatePriceAlert.mockResolvedValue({ id: 'alert-1' } as never)

    const response = await POST(
      createRequest(
        {
          routeId: 'route-1',
          targetPrice: 19,
          service: 'any',
          alertType: 'below',
        },
        '10.0.2.3'
      )
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      alertId: 'alert-1',
    })
  })

  it('creates Waymo alerts for authenticated requests', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as never)
    mockCreatePriceAlert.mockResolvedValue({ id: 'alert-waymo' } as never)

    const response = await POST(
      createRequest(
        {
          routeId: 'route-1',
          targetPrice: 19,
          service: 'waymo',
          alertType: 'below',
        },
        '10.0.2.4'
      )
    )

    expect(response.status).toBe(200)
    expect(mockCreatePriceAlert).toHaveBeenCalledWith('user-1', 'route-1', 19, 'waymo', 'below')
  })

  it('returns 404 when the route does not exist', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as never)
    mockCreatePriceAlert.mockResolvedValue('route_not_found' as never)

    const response = await POST(
      createRequest({ routeId: 'route-nonexistent', targetPrice: 19 }, '10.0.2.5')
    )

    expect(response.status).toBe(404)
  })

  it('returns 500 when alert creation fails for database reasons', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as never)
    mockCreatePriceAlert.mockResolvedValue(null as never)

    const response = await POST(createRequest({ routeId: 'route-1', targetPrice: 19 }, '10.0.2.6'))

    expect(response.status).toBe(500)
  })

  describe('DELETE', () => {
    it('rejects unauthenticated deletion', async () => {
      mockAuth.mockResolvedValue(null as never)

      const response = await DELETE(deleteRequest('alert-1', '10.0.3.1'))

      expect(response.status).toBe(401)
      expect(mockDeletePriceAlert).not.toHaveBeenCalled()
    })

    it('requires an alert id', async () => {
      mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as never)

      const response = await DELETE(deleteRequest(null, '10.0.3.2'))

      expect(response.status).toBe(400)
    })

    it('deletes an alert owned by the user', async () => {
      mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as never)
      mockDeletePriceAlert.mockResolvedValue('deleted')

      const response = await DELETE(deleteRequest('alert-1', '10.0.3.3'))

      expect(response.status).toBe(204)
      expect(mockDeletePriceAlert).toHaveBeenCalledWith('alert-1', 'user-1')
    })

    it("returns 404 for another user's alert (ownership enforced in delete)", async () => {
      mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as never)
      mockDeletePriceAlert.mockResolvedValue('not_found')

      const response = await DELETE(deleteRequest('alert-of-user-2', '10.0.3.4'))

      expect(response.status).toBe(404)
    })

    it('returns 500 on database failure', async () => {
      mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as never)
      mockDeletePriceAlert.mockResolvedValue('error')

      const response = await DELETE(deleteRequest('alert-1', '10.0.3.5'))

      expect(response.status).toBe(500)
    })
  })
})
