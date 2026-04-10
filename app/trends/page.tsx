'use client'

import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '@/lib/auth-context'
import { useRouter, useSearchParams } from 'next/navigation'
import { ArrowLeft, BarChart3, TrendingUp, Zap, Thermometer } from 'lucide-react'
import { PriceTrendsChart } from '@/components/charts/price-trends-chart'
import { HourlyPriceChart } from '@/components/charts/hourly-price-chart'
import { SurgeChart } from '@/components/charts/surge-chart'
import { CHART_COLORS } from '@/components/charts/chart-wrapper'
import type { RideServiceName } from '@/lib/service-mappings'

// ============================================================================
// Types
// ============================================================================

interface SavedRoute {
  id: string
  routeId: string | null
  fromName: string
  toName: string
}

interface TrendSnapshot {
  id: string
  timestamp: string
  service: RideServiceName
  basePrice: number
  surgeMultiplier: number
  finalPrice: number
  waitTimeMinutes: number | null
  dayOfWeek: number
  hourOfDay: number
  weatherCondition: string | null
  weatherTempF: number | null
  isRaining: boolean
  trafficLevel: string | null
  nearbyEvents: string[]
  isHoliday: boolean
  confidence: number | null
}

interface ServiceSummary {
  service: RideServiceName
  avgPrice: number
  minPrice: number
  maxPrice: number
  cheapestHour: number
  surgeProbabilityByHour: { hour: number; probability: number }[]
  priceByDayOfWeek: { day: number; avgPrice: number }[]
  sampleSize: number
}

interface TrendsSummary {
  routeId: string
  daysBack: number
  services: ServiceSummary[]
}

type DayRange = 7 | 30 | 90

const SERVICE_LIST: RideServiceName[] = ['uber', 'lyft', 'taxi', 'waymo']
const DAY_OPTIONS: { label: string; value: DayRange }[] = [
  { label: '7 Days', value: 7 },
  { label: '30 Days', value: 30 },
  { label: '90 Days', value: 90 },
]

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// ============================================================================
// Service Comparison Sub-component
// ============================================================================

function ServiceComparisonChart({ services }: { services: ServiceSummary[] }) {
  if (services.length === 0) return null

  const chartData = services.map(s => ({
    service: s.service.charAt(0).toUpperCase() + s.service.slice(1),
    avgPrice: s.avgPrice,
    minPrice: s.minPrice,
    maxPrice: s.maxPrice,
    fill: CHART_COLORS[s.service],
  }))

  return (
    <div className="space-y-3">
      {chartData.map(d => (
        <div key={d.service} className="space-y-1">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium" style={{ color: d.fill }}>
              {d.service}
            </span>
            <span className="text-muted-foreground">
              ${d.minPrice.toFixed(0)} - ${d.maxPrice.toFixed(0)} (avg ${d.avgPrice.toFixed(2)})
            </span>
          </div>
          <div className="w-full h-3 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full rounded-full"
              style={{
                width: `${(d.avgPrice / Math.max(...chartData.map(x => x.maxPrice))) * 100}%`,
                backgroundColor: d.fill,
              }}
            />
          </div>
        </div>
      ))}
    </div>
  )
}

// ============================================================================
// Surge Heatmap Sub-component
// ============================================================================

function SurgeHeatmap({ services }: { services: ServiceSummary[] }) {
  if (services.length === 0) return null

  const primaryService = services[0]
  const surgeData = primaryService.surgeProbabilityByHour
  const hours = Array.from({ length: 24 }, (_, i) => i)
  const days = Array.from({ length: 7 }, (_, i) => i)

  // Create a simple grid: hour x day using probability from primary service
  // (Full day-of-week breakdown would require per-day data, which we approximate)
  return (
    <div className="overflow-x-auto">
      <div className="min-w-[500px]">
        <div className="flex gap-0.5 mb-1">
          <div className="w-10" />
          {hours.map(h => (
            <div key={h} className="flex-1 text-center text-[9px] text-muted-foreground">
              {h % 3 === 0 ? `${h}` : ''}
            </div>
          ))}
        </div>
        {days.map(day => (
          <div key={day} className="flex gap-0.5 mb-0.5">
            <div className="w-10 text-[10px] text-muted-foreground flex items-center">
              {DAY_NAMES[day]}
            </div>
            {hours.map(hour => {
              const surgeEntry = surgeData.find(s => s.hour === hour)
              const prob = surgeEntry?.probability ?? 0
              // Adjust probability by day (weekday vs weekend)
              const isWeekend = day === 0 || day === 6
              const adjustedProb = isWeekend ? prob * 0.7 : prob

              return (
                <div
                  key={hour}
                  className="flex-1 h-5 rounded-sm"
                  style={{
                    backgroundColor:
                      adjustedProb > 0.7
                        ? '#ef4444'
                        : adjustedProb > 0.4
                          ? '#f59e0b'
                          : adjustedProb > 0.1
                            ? '#22c55e33'
                            : '#22c55e11',
                  }}
                  title={`${DAY_NAMES[day]} ${hour}:00 - ${(adjustedProb * 100).toFixed(0)}% surge`}
                />
              )
            })}
          </div>
        ))}
        <div className="flex items-center gap-2 mt-2 text-[10px] text-muted-foreground">
          <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: '#22c55e33' }} /> Low
          <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: '#f59e0b' }} /> Moderate
          <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: '#ef4444' }} /> High
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// Weather Correlation Sub-component
// ============================================================================

function WeatherCorrelation({ snapshots }: { snapshots: TrendSnapshot[] }) {
  const weatherGroups = new Map<string, { sum: number; count: number }>()

  for (const s of snapshots) {
    const condition = s.weatherCondition || 'Clear'
    const existing = weatherGroups.get(condition) ?? { sum: 0, count: 0 }
    weatherGroups.set(condition, {
      sum: existing.sum + s.finalPrice,
      count: existing.count + 1,
    })
  }

  const weatherData = Array.from(weatherGroups.entries())
    .map(([condition, { sum, count }]) => ({
      condition,
      avgPrice: sum / count,
      count,
    }))
    .sort((a, b) => a.avgPrice - b.avgPrice)

  if (weatherData.length <= 1) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <Thermometer className="w-8 h-8 mx-auto mb-2 opacity-30" />
        <p className="text-sm">Not enough weather data for correlation analysis</p>
      </div>
    )
  }

  const maxPrice = Math.max(...weatherData.map(d => d.avgPrice))

  return (
    <div className="space-y-3">
      {weatherData.map(d => (
        <div key={d.condition} className="space-y-1">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium">{d.condition}</span>
            <span className="text-muted-foreground">
              ${d.avgPrice.toFixed(2)} ({d.count} snapshots)
            </span>
          </div>
          <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full rounded-full bg-primary"
              style={{ width: `${(d.avgPrice / maxPrice) * 100}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  )
}

// ============================================================================
// Main Trends Page
// ============================================================================

export default function TrendsPage() {
  const { user, loading: authLoading } = useAuth()
  const router = useRouter()
  const searchParams = useSearchParams()

  // State from URL params
  const [savedRoutes, setSavedRoutes] = useState<SavedRoute[]>([])
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(
    searchParams.get('route') ?? null
  )
  const [daysBack, setDaysBack] = useState<DayRange>(
    (Number(searchParams.get('days')) as DayRange) || 7
  )
  const [activeServices, setActiveServices] = useState<Set<RideServiceName>>(() => {
    const serviceParam = searchParams.get('service')
    if (serviceParam) {
      const valid = serviceParam
        .split(',')
        .filter((s): s is RideServiceName => SERVICE_LIST.includes(s as RideServiceName))
      if (valid.length > 0) return new Set(valid)
    }
    return new Set<RideServiceName>(SERVICE_LIST)
  })

  // Data state
  const [snapshots, setSnapshots] = useState<TrendSnapshot[]>([])
  const [summary, setSummary] = useState<TrendsSummary | null>(null)
  const [dataLoading, setDataLoading] = useState(false)
  const [dataError, setDataError] = useState<string | null>(null)
  const [routesLoading, setRoutesLoading] = useState(true)

  // Auth redirect
  useEffect(() => {
    if (!authLoading && !user) router.push('/')
  }, [user, authLoading, router])

  // Load saved routes
  useEffect(() => {
    if (!user) return

    const loadRoutes = async () => {
      try {
        const res = await fetch('/api/dashboard?savedRoutes=true')
        if (!res.ok) throw new Error('Failed to load routes')
        const data = await res.json()
        setSavedRoutes(data.savedRoutes || [])
        if (!selectedRouteId && data.savedRoutes?.length > 0 && data.savedRoutes[0].routeId) {
          setSelectedRouteId(data.savedRoutes[0].routeId)
        }
      } catch {
        // Silently fail - routes will show as empty
      } finally {
        setRoutesLoading(false)
      }
    }

    void loadRoutes()
  }, [user, selectedRouteId])

  // Fetch trend data
  const loadTrendData = useCallback(async () => {
    if (!selectedRouteId) {
      setSnapshots([])
      setSummary(null)
      return
    }

    setDataLoading(true)
    setDataError(null)

    try {
      const [snapRes, sumRes] = await Promise.all([
        fetch(
          `/api/price-trends?routeId=${encodeURIComponent(selectedRouteId)}&daysBack=${daysBack}`
        ),
        fetch(
          `/api/price-trends/summary?routeId=${encodeURIComponent(selectedRouteId)}&daysBack=${daysBack}`
        ),
      ])

      if (!snapRes.ok) throw new Error('Failed to load price trends')
      if (!sumRes.ok) throw new Error('Failed to load trend summary')

      const snapData = await snapRes.json()
      const sumData = await sumRes.json()

      setSnapshots(snapData.snapshots || [])
      setSummary(sumData)
    } catch (err) {
      setDataError(err instanceof Error ? err.message : 'Failed to load trend data')
    } finally {
      setDataLoading(false)
    }
  }, [selectedRouteId, daysBack])

  useEffect(() => {
    void loadTrendData()
  }, [loadTrendData])

  // Update URL when params change
  useEffect(() => {
    if (!selectedRouteId) return
    const params = new URLSearchParams()
    params.set('route', selectedRouteId)
    params.set('days', String(daysBack))
    const activeList = SERVICE_LIST.filter(s => activeServices.has(s))
    if (activeList.length < SERVICE_LIST.length) {
      params.set('service', activeList.join(','))
    }
    window.history.replaceState(null, '', `/trends?${params.toString()}`)
  }, [selectedRouteId, daysBack, activeServices])

  // Toggle service
  const toggleService = (service: RideServiceName) => {
    setActiveServices(prev => {
      const next = new Set(prev)
      if (next.has(service)) {
        if (next.size > 1) next.delete(service)
      } else {
        next.add(service)
      }
      return next
    })
  }

  // Filter snapshots by active services
  const filteredSnapshots = snapshots.filter(s => activeServices.has(s.service))

  // Convert snapshots to format expected by PriceTrendsChart
  const chartData = filteredSnapshots.map(s => ({
    timestamp: s.timestamp,
    service_type: s.service,
    final_price: s.finalPrice,
    surge_multiplier: s.surgeMultiplier,
    weather_condition: s.weatherCondition,
  }))

  // Auth loading
  if (authLoading || !user) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-2 border-primary border-t-transparent mx-auto mb-4" />
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="fixed inset-0 bg-diagonal-lines opacity-10 pointer-events-none" />

      <div className="relative z-10 container mx-auto px-4 py-8 max-w-7xl pt-24">
        {/* Back navigation */}
        <button
          onClick={() => router.push('/dashboard')}
          className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors mb-6"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Dashboard
        </button>

        {/* Header */}
        <div className="mb-8">
          <span className="text-primary font-mono text-sm tracking-widest uppercase mb-4 block">
            Deep Dive
          </span>
          <h1 className="text-4xl sm:text-5xl font-black text-foreground mb-2">Price Trends</h1>
          <p className="text-muted-foreground text-lg">
            In-depth price analysis and surge forecasting
          </p>
        </div>

        {/* Controls */}
        <div className="mb-8 space-y-4">
          {/* Route Selector */}
          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-2">Route</label>
            {routesLoading ? (
              <div className="animate-pulse h-10 bg-muted rounded-lg w-full md:w-64" />
            ) : savedRoutes.length > 0 ? (
              <select
                value={selectedRouteId || ''}
                onChange={e => setSelectedRouteId(e.target.value || null)}
                className="w-full md:w-auto px-4 py-2.5 rounded-lg bg-muted border border-border text-foreground focus:border-primary focus:ring-1 focus:ring-primary transition-all"
              >
                <option value="">Select a route...</option>
                {savedRoutes.map(route => (
                  <option key={route.id} value={route.routeId || ''}>
                    {route.fromName} → {route.toName}
                  </option>
                ))}
              </select>
            ) : (
              <p className="text-muted-foreground">
                No saved routes. Save routes from the home page first.
              </p>
            )}
          </div>

          {/* Date Range + Service Toggles */}
          <div className="flex flex-wrap items-center gap-4">
            {/* Date Range */}
            <div className="flex gap-1">
              {DAY_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => setDaysBack(opt.value)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                    daysBack === opt.value
                      ? 'bg-primary text-primary-foreground'
                      : 'card-interactive text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            {/* Service Toggles */}
            <div className="flex gap-1">
              {SERVICE_LIST.map(service => (
                <button
                  key={service}
                  onClick={() => toggleService(service)}
                  className={`px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                    activeServices.has(service)
                      ? 'text-white'
                      : 'card-interactive text-muted-foreground hover:text-foreground'
                  }`}
                  style={
                    activeServices.has(service)
                      ? { backgroundColor: CHART_COLORS[service] }
                      : undefined
                  }
                >
                  {service.charAt(0).toUpperCase() + service.slice(1)}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Error banner */}
        {dataError && (
          <div className="mb-6 flex items-start justify-between gap-4 rounded-lg border border-destructive/30 bg-destructive/5 p-4">
            <p className="text-foreground">{dataError}</p>
            <button
              onClick={() => void loadTrendData()}
              className="px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors text-sm font-medium"
            >
              Retry
            </button>
          </div>
        )}

        {!selectedRouteId ? (
          <div className="text-center py-20 text-muted-foreground">
            <BarChart3 className="w-16 h-16 mx-auto mb-4 opacity-30" />
            <p className="text-lg">Select a route to view price trends</p>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Price History Chart */}
            <div className="card-elevated rounded-xl p-6">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
                  <TrendingUp className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-foreground">Price History</h2>
                  <p className="text-sm text-muted-foreground">Last {daysBack} days</p>
                </div>
              </div>
              <div style={{ height: 400 }}>
                <PriceTrendsChart
                  data={chartData}
                  activeServices={SERVICE_LIST.filter(s => activeServices.has(s))}
                  loading={dataLoading}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Surge Heatmap */}
              <div className="card-elevated rounded-xl p-6">
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
                    <Zap className="w-5 h-5 text-primary" />
                  </div>
                  <h2 className="text-xl font-bold text-foreground">Surge Heatmap</h2>
                </div>
                {summary?.services?.length ? (
                  <SurgeHeatmap services={summary.services} />
                ) : (
                  <div className="text-center py-12 text-muted-foreground">
                    <p className="text-sm">No surge data available</p>
                  </div>
                )}
              </div>

              {/* Service Comparison */}
              <div className="card-elevated rounded-xl p-6">
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-10 h-10 bg-secondary/10 rounded-lg flex items-center justify-center">
                    <BarChart3 className="w-5 h-5 text-secondary" />
                  </div>
                  <h2 className="text-xl font-bold text-foreground">Service Comparison</h2>
                </div>
                {summary?.services?.length ? (
                  <ServiceComparisonChart services={summary.services} />
                ) : (
                  <div className="text-center py-12 text-muted-foreground">
                    <p className="text-sm">No comparison data available</p>
                  </div>
                )}
              </div>

              {/* Weather/Price Correlation */}
              <div className="card-elevated rounded-xl p-6 lg:col-span-2">
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-10 h-10 bg-secondary/10 rounded-lg flex items-center justify-center">
                    <Thermometer className="w-5 h-5 text-secondary" />
                  </div>
                  <h2 className="text-xl font-bold text-foreground">Weather Impact on Pricing</h2>
                </div>
                <WeatherCorrelation snapshots={filteredSnapshots} />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
