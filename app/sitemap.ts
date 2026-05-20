import type { MetadataRoute } from 'next'
import { PRECOMPUTED_ROUTES } from '@/lib/popular-routes-data'

const STATIC_PATHS = ['/', '/dashboard', '/history', '/trends'] as const

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://comparativerideshares.com'
  const now = new Date()

  const staticEntries: MetadataRoute.Sitemap = STATIC_PATHS.map(path => ({
    url: `${baseUrl}${path}`,
    lastModified: now,
    changeFrequency: path === '/' ? 'daily' : 'weekly',
    priority: path === '/' ? 1.0 : 0.6,
  }))

  const routeEntries: MetadataRoute.Sitemap = Object.keys(PRECOMPUTED_ROUTES).map(slug => ({
    url: `${baseUrl}/route/${slug}`,
    lastModified: now,
    changeFrequency: 'daily',
    priority: 0.8,
  }))

  return [...staticEntries, ...routeEntries]
}
