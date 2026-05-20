/** @jest-environment node */

jest.mock('@/lib/services/ride-comparison', () => ({
  // generateMetadata never calls loadComparison; mock anyway to avoid accidental network use
  compareRidesByAddresses: jest.fn(),
}))

import { generateMetadata, generateStaticParams } from '@/app/route/[slug]/page'
import { PRECOMPUTED_ROUTES } from '@/lib/popular-routes-data'

describe('app/route/[slug] page', () => {
  const ORIGINAL_SITE = process.env.NEXT_PUBLIC_SITE_URL

  beforeAll(() => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://example.test'
  })

  afterAll(() => {
    if (ORIGINAL_SITE === undefined) {
      delete process.env.NEXT_PUBLIC_SITE_URL
    } else {
      process.env.NEXT_PUBLIC_SITE_URL = ORIGINAL_SITE
    }
  })

  describe('generateStaticParams', () => {
    it('returns one entry per precomputed route slug (14 total)', () => {
      const params = generateStaticParams()
      expect(params).toHaveLength(14)
      const slugs = params.map(p => p.slug)
      for (const key of Object.keys(PRECOMPUTED_ROUTES)) {
        expect(slugs).toContain(key)
      }
    })

    it('produces objects of shape { slug: string }', () => {
      const params = generateStaticParams()
      for (const p of params) {
        expect(typeof p.slug).toBe('string')
        expect(p.slug.length).toBeGreaterThan(0)
      }
    })
  })

  describe('generateMetadata', () => {
    it('returns canonical, OG image, and descriptive title for a known slug', async () => {
      const meta = await generateMetadata({ params: { slug: 'sfo-downtown' } })

      expect(meta.title).toMatch(/Uber/)
      expect(meta.title).toMatch(/Lyft/)
      expect(meta.title).toMatch(/Waymo/)
      expect(meta.title).toMatch(/Taxi/)
      expect(meta.title).toMatch(/SFO|San Francisco International Airport/)

      expect(meta.alternates?.canonical).toBe('/route/sfo-downtown')

      const ogImages = meta.openGraph?.images
      expect(Array.isArray(ogImages)).toBe(true)
      const first = (ogImages as Array<{ url: string; width?: number; height?: number }>)[0]
      expect(first.url).toMatch(/^https:\/\/example\.test\/api\/og\?/)
      expect(first.url).toContain('pickup=')
      expect(first.url).toContain('dest=')
      expect(first.width).toBe(1200)
      expect(first.height).toBe(630)
    })

    it('returns "Route not found" for an unknown slug', async () => {
      const meta = await generateMetadata({ params: { slug: 'totally-bogus-slug' } })
      expect(meta.title).toBe('Route not found')
      expect(meta.alternates).toBeUndefined()
    })

    it('encodes pickup/dest into the OG URL', async () => {
      const meta = await generateMetadata({ params: { slug: 'stanford-apple' } })
      const ogImages = meta.openGraph?.images as Array<{ url: string }>
      // URLSearchParams encodes spaces as '+'; decode both forms before asserting.
      const decoded = decodeURIComponent(ogImages[0].url).replace(/\+/g, ' ')
      expect(decoded).toContain('Stanford University')
      expect(decoded).toContain('Apple Park')
    })
  })
})
