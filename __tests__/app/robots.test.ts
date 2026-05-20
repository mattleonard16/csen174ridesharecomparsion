/** @jest-environment node */

import robots from '@/app/robots'

describe('robots()', () => {
  const ORIGINAL = process.env.NEXT_PUBLIC_SITE_URL

  beforeAll(() => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://example.test'
  })

  afterAll(() => {
    if (ORIGINAL === undefined) delete process.env.NEXT_PUBLIC_SITE_URL
    else process.env.NEXT_PUBLIC_SITE_URL = ORIGINAL
  })

  it('allows / and disallows the expected private paths for "*"', () => {
    const out = robots()
    const rules = Array.isArray(out.rules) ? out.rules : [out.rules]
    const star = rules.find(r => r.userAgent === '*')
    expect(star).toBeDefined()
    expect(star?.allow).toBe('/')
    expect(star?.disallow).toEqual(['/api/', '/dashboard/', '/test/'])
  })

  it('points sitemap at NEXT_PUBLIC_SITE_URL/sitemap.xml', () => {
    expect(robots().sitemap).toBe('https://example.test/sitemap.xml')
  })
})
