/** @jest-environment node */

import { NextRequest } from 'next/server'
import { POST } from '@/app/api/price-alerts/route'
import { auth } from '@/auth'
import { createPriceAlert } from '@/lib/database'

jest.mock('@/lib/database', () => ({
  createPriceAlert: jest.fn(),
}))

const mockAuth = auth as jest.MockedFunction<typeof auth>
const mockCreatePriceAlert = createPriceAlert as jest.MockedFunction<typeof createPriceAlert>

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
})
