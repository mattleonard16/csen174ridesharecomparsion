import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { PRECOMPUTED_ROUTES } from '@/lib/popular-routes-data'
import { compareRidesByAddresses } from '@/lib/services/ride-comparison'
import type { ComparisonResults, ServiceType } from '@/types'

export const revalidate = 1800

export function generateStaticParams() {
  return Object.keys(PRECOMPUTED_ROUTES).map(slug => ({ slug }))
}

function shortName(fullName: string): string {
  return fullName.split(',')[0].trim()
}

function buildOgUrl(params: {
  baseUrl: string
  pickup: string
  destination: string
  price: string
  service: string
}): string {
  const url = new URL('/api/og', params.baseUrl)
  url.searchParams.set('pickup', shortName(params.pickup))
  url.searchParams.set('dest', shortName(params.destination))
  url.searchParams.set('price', params.price)
  url.searchParams.set('service', params.service)
  return url.toString()
}

function pickBestService(
  results: ComparisonResults
): { service: ServiceType; label: string; price: string } | null {
  let best: { service: ServiceType; label: string; price: string; value: number } | null = null
  for (const [service, data] of Object.entries(results)) {
    if (!data) continue
    const value = Number.parseFloat(data.price.replace('$', ''))
    if (!Number.isFinite(value)) continue
    if (!best || value < best.value) {
      best = {
        service: service as ServiceType,
        label: data.service,
        price: data.price,
        value,
      }
    }
  }
  if (!best) return null
  return { service: best.service, label: best.label, price: best.price }
}

async function loadComparison(slug: string) {
  const route = PRECOMPUTED_ROUTES[slug]
  if (!route) return null
  try {
    const computation = await compareRidesByAddresses(
      route.pickup.name,
      route.destination.name,
      ['uber', 'lyft', 'taxi', 'waymo'],
      new Date(),
      { persist: false }
    )
    return { route, computation }
  } catch {
    return { route, computation: null }
  }
}

export async function generateMetadata({
  params,
}: {
  params: { slug: string }
}): Promise<Metadata> {
  const route = PRECOMPUTED_ROUTES[params.slug]
  if (!route) return { title: 'Route not found' }

  const pickup = shortName(route.pickup.name)
  const destination = shortName(route.destination.name)
  const title = `${pickup} to ${destination} — Uber, Lyft, Waymo & Taxi Fare Estimates`
  const description = `Compare estimated fares and wait times for Uber, Lyft, Waymo, and Taxi from ${pickup} to ${destination}. Built from 30 days of Bay Area pricing data.`

  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://comparativerideshares.com'
  const ogImage = buildOgUrl({
    baseUrl,
    pickup: route.pickup.name,
    destination: route.destination.name,
    price: '—',
    service: 'Compare 4 services',
  })

  return {
    title,
    description,
    alternates: {
      canonical: `/route/${params.slug}`,
    },
    openGraph: {
      title,
      description,
      url: `/route/${params.slug}`,
      type: 'website',
      images: [{ url: ogImage, width: 1200, height: 630 }],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [ogImage],
    },
  }
}

export default async function RoutePage({ params }: { params: { slug: string } }) {
  const data = await loadComparison(params.slug)
  if (!data) notFound()

  const { route, computation } = data
  const pickup = shortName(route.pickup.name)
  const destination = shortName(route.destination.name)
  const best = computation ? pickBestService(computation.results) : null

  const services = computation
    ? (['uber', 'lyft', 'waymo', 'taxi'] as ServiceType[])
        .map(key => ({ key, data: computation.results[key] }))
        .filter(s => s.data)
    : []

  return (
    <main className="min-h-screen bg-background px-4 py-24">
      <article className="mx-auto max-w-3xl space-y-10">
        <header className="space-y-4">
          <p className="text-sm uppercase tracking-wider text-muted-foreground">
            Bay Area route comparison
          </p>
          <h1 className="font-display text-4xl sm:text-5xl md:text-6xl font-normal leading-tight text-foreground">
            {pickup} to {destination}
          </h1>
          <p className="text-base sm:text-lg text-muted-foreground leading-relaxed">
            Estimated fares and wait times across Uber, Lyft, Waymo, and Taxi for this{' '}
            {route.metrics.distanceKm.toFixed(1)} km route (≈
            {Math.round(route.metrics.durationMin)} min). Estimates are built from historical
            pricing and current traffic — confirm in each provider&apos;s app before booking.
          </p>
        </header>

        {best && (
          <section className="rounded-2xl border border-secondary/40 bg-secondary/5 p-6">
            <div className="text-xs uppercase tracking-wider text-secondary mb-2">
              Cheapest right now
            </div>
            <div className="flex items-baseline justify-between gap-4">
              <div className="font-display text-3xl text-foreground">{best.label}</div>
              <div className="font-display text-4xl text-secondary tabular-nums">{best.price}</div>
            </div>
          </section>
        )}

        {services.length > 0 ? (
          <section className="space-y-3">
            <h2 className="text-2xl font-display text-foreground">All services</h2>
            <ul className="divide-y divide-border/40 rounded-2xl border border-border/40">
              {services.map(({ key, data }) => (
                <li
                  key={key}
                  className="flex items-center justify-between px-5 py-4 text-sm sm:text-base"
                >
                  <div>
                    <div className="font-medium text-foreground">{data!.service}</div>
                    <div className="text-xs text-muted-foreground">
                      {data!.waitTime} wait · {data!.driversNearby} nearby
                    </div>
                  </div>
                  <div className="font-display text-2xl text-foreground tabular-nums">
                    {data!.price}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ) : (
          <section className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-5 text-sm text-amber-200">
            Live estimates are temporarily unavailable for this route. Try the{' '}
            <Link href="/" className="underline">
              comparison tool
            </Link>{' '}
            for an on-demand quote.
          </section>
        )}

        <section className="rounded-xl border border-border/40 bg-muted/20 p-5 text-xs text-muted-foreground">
          <strong className="text-foreground">How this works:</strong> Fares are model-based
          estimates trained on historical Bay Area pricing across {pickup}, {destination}, and
          nearby clusters. Surge, traffic, and time-of-day are factored in. We are not affiliated
          with Uber, Lyft, Waymo, or any taxi provider — always confirm in the provider app before
          booking.
        </section>

        <section className="pt-4">
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-6 py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Compare a different route →
          </Link>
        </section>
      </article>
    </main>
  )
}
