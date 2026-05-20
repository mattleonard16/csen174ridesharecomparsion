/** @jest-environment node */

import sitemap from '@/app/sitemap'
import { PRECOMPUTED_ROUTES } from '@/lib/popular-routes-data'

describe('sitemap()', () => {
  const ORIGINAL = process.env.NEXT_PUBLIC_SITE_URL

  beforeAll(() => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://example.test'
  })

  afterAll(() => {
    if (ORIGINAL === undefined) delete process.env.NEXT_PUBLIC_SITE_URL
    else process.env.NEXT_PUBLIC_SITE_URL = ORIGINAL
  })

  it('emits 4 static entries + one per precomputed route', () => {
    const entries = sitemap()
    expect(entries).toHaveLength(4 + Object.keys(PRECOMPUTED_ROUTES).length)
  })

  it('includes every static path', () => {
    const entries = sitemap()
    const urls = entries.map(e => e.url)
    expect(urls).toContain('https://example.test/')
    expect(urls).toContain('https://example.test/dashboard')
    expect(urls).toContain('https://example.test/history')
    expect(urls).toContain('https://example.test/trends')
  })

  it('emits a /route/<slug> entry for every precomputed route', () => {
    const entries = sitemap()
    const urls = entries.map(e => e.url)
    for (const slug of Object.keys(PRECOMPUTED_ROUTES)) {
      expect(urls).toContain(`https://example.test/route/${slug}`)
    }
  })

  it('every entry has a Date lastModified and a base-prefixed url', () => {
    const entries = sitemap()
    for (const entry of entries) {
      expect(entry.url.startsWith('https://example.test/')).toBe(true)
      expect(entry.lastModified).toBeInstanceOf(Date)
    }
  })
})
