/** @jest-environment node */

import { NextRequest } from 'next/server'

type CapturedCall = {
  node: unknown
  opts?: { width?: number; height?: number }
}

const calls: CapturedCall[] = []

jest.mock('next/og', () => ({
  ImageResponse: jest.fn(function MockImageResponse(
    this: { node: unknown; opts: unknown; status: number; headers: Headers },
    node: unknown,
    opts?: unknown
  ) {
    calls.push({ node, opts: opts as CapturedCall['opts'] })
    this.node = node
    this.opts = opts
    this.status = 200
    this.headers = new Headers({ 'content-type': 'image/png' })
  }),
}))

// Dynamic import after mock
import { GET } from '@/app/api/og/route'

describe('GET /api/og', () => {
  beforeEach(() => {
    calls.length = 0
  })

  function req(query: string): NextRequest {
    return new NextRequest(`http://localhost:3000/api/og${query}`)
  }

  it('returns an ImageResponse-shaped object with 1200x630 dimensions', async () => {
    const res = await GET(req('?pickup=SFO&dest=Downtown%20SF&price=%2423&service=Uber'))

    expect(res).toBeDefined()
    expect(calls).toHaveLength(1)
    expect(calls[0].opts).toEqual({ width: 1200, height: 630 })
  })

  it('falls back to defaults when query params are missing', async () => {
    await GET(req(''))
    const serialized = JSON.stringify(calls[0].node)
    expect(serialized).toContain('Pickup')
    expect(serialized).toContain('Destination')
    expect(serialized).toContain('Best ride')
    expect(serialized).toContain('—')
  })

  it('clamps oversize pickup strings (>60 chars) with a trailing ellipsis', async () => {
    const longPickup = 'A'.repeat(120)
    await GET(req(`?pickup=${encodeURIComponent(longPickup)}&dest=B`))
    const serialized = JSON.stringify(calls[0].node)
    expect(serialized).toContain('…')
    // Original full string must NOT appear verbatim
    expect(serialized).not.toContain('A'.repeat(120))
  })

  it('clamps the price field with the tighter 12-char limit', async () => {
    const longPrice = '$' + '9'.repeat(40)
    await GET(req(`?pickup=X&dest=Y&price=${encodeURIComponent(longPrice)}`))
    const serialized = JSON.stringify(calls[0].node)
    expect(serialized).toContain('…')
    expect(serialized).not.toContain('9'.repeat(40))
  })

  it('renders supplied pickup/destination values in the element tree', async () => {
    await GET(req('?pickup=Stanford&dest=Apple%20Park&service=Lyft&price=%2417'))
    const serialized = JSON.stringify(calls[0].node)
    expect(serialized).toContain('Stanford')
    expect(serialized).toContain('Apple Park')
    expect(serialized).toContain('Lyft')
    expect(serialized).toContain('$17')
  })
})
