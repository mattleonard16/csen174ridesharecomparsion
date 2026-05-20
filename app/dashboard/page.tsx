'use client'

import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '@/lib/auth-context'
import { useRouter } from 'next/navigation'
import { TrendingDown, Clock, Zap, ArrowLeft, BarChart3, MapPin, TrendingUp } from 'lucide-react'
import { PriceTrendsChart } from '@/components/charts/price-trends-chart'
import { HourlyPriceChart } from '@/components/charts/hourly-price-chart'
import { SurgeChart } from '@/components/charts/surge-chart'
import { SavingsSparkline } from '@/components/charts/savings-sparkline'
import type { DashboardHourlyAverage, DashboardPriceSnapshot, DashboardSavedRoute } from '@/types'

export default function DashboardPage() {
  const { user, loading } = useAuth()
  const router = useRouter()
  const [savedRoutes, setSavedRoutes] = useState<DashboardSavedRoute[]>([])
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null)
  const [priceData, setPriceData] = useState<DashboardPriceSnapshot[]>([])
  const [hourlyAverages, setHourlyAverages] = useState<DashboardHourlyAverage[]>([])
  const [selectedService, setSelectedService] = useState<'uber' | 'lyft' | 'taxi' | 'waymo'>('uber')
  const [dataLoading, setDataLoading] = useState(true)
  const [routesLoading, setRoutesLoading] = useState(true)
  const [routesError, setRoutesError] = useState<string | null>(null)
  const [savingsError, setSavingsError] = useState<string | null>(null)
  const [dataError, setDataError] = useState<string | null>(null)
  const [savingsData, setSavingsData] = useState<{
    totalSavings: number
    comparisonCount: number
    recsFollowed: number
    alertsSet: number
  }>({ totalSavings: 0, comparisonCount: 0, recsFollowed: 0, alertsSet: 0 })
  const [surgeInsights, setSurgeInsights] = useState<{ hour: number; probability: number }[]>([])

  useEffect(() => {
    if (!loading && !user) {
      router.push('/')
    }
  }, [user, loading, router])

  const loadSavedRoutes = useCallback(async () => {
    if (!user) return

    setRoutesLoading(true)
    setRoutesError(null)

    try {
      const response = await fetch('/api/dashboard?savedRoutes=true')
      if (!response.ok) {
        throw new Error('Unable to load your saved routes right now.')
      }

      const data = await response.json()
      setSavedRoutes(data.savedRoutes || [])
      if (data.savedRoutes?.length > 0 && data.savedRoutes[0].routeId) {
        setSelectedRouteId(current => current ?? data.savedRoutes[0].routeId)
      }
    } catch (error) {
      setRoutesError(
        error instanceof Error ? error.message : 'Unable to load your saved routes right now.'
      )
    } finally {
      setRoutesLoading(false)
    }
  }, [user])

  const loadSavingsData = useCallback(async () => {
    if (!user) return

    setSavingsError(null)

    try {
      const response = await fetch('/api/dashboard?savings=true')
      if (!response.ok) {
        throw new Error('Unable to refresh savings insights right now.')
      }

      const data = await response.json()
      if (data.savings) {
        setSavingsData(data.savings)
      }
      if (data.surgeInsights) {
        setSurgeInsights(data.surgeInsights)
      }
    } catch (error) {
      setSavingsError(
        error instanceof Error ? error.message : 'Unable to refresh savings insights right now.'
      )
    }
  }, [user])

  const loadData = useCallback(async () => {
    if (!user || !selectedRouteId) {
      setDataLoading(false)
      setDataError(null)
      return
    }

    setDataLoading(true)
    setDataError(null)

    try {
      const response = await fetch(
        `/api/dashboard?routeId=${encodeURIComponent(selectedRouteId)}&service=${selectedService}&daysBack=7`
      )

      if (!response.ok) {
        throw new Error('Unable to refresh route analytics right now.')
      }

      const data = await response.json()
      setPriceData(data.priceHistory || [])
      setHourlyAverages(data.hourlyAverages || [])
    } catch (error) {
      setDataError(
        error instanceof Error ? error.message : 'Unable to refresh route analytics right now.'
      )
    } finally {
      setDataLoading(false)
    }
  }, [selectedRouteId, selectedService, user])

  useEffect(() => {
    void loadSavedRoutes()
  }, [loadSavedRoutes])

  useEffect(() => {
    void loadSavingsData()
  }, [loadSavingsData])

  useEffect(() => {
    void loadData()
  }, [loadData])

  if (loading || !user) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-2 border-primary border-t-transparent mx-auto mb-4"></div>
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Subtle background */}
      <div className="fixed inset-0 bg-diagonal-lines opacity-10 pointer-events-none" />

      <div className="relative z-10 container mx-auto px-4 py-8 max-w-7xl pt-24">
        {/* Header */}
        <div className="mb-10">
          <span className="text-primary font-mono text-sm tracking-widest uppercase mb-4 block">
            Analytics
          </span>
          <h1 className="text-4xl sm:text-5xl font-black text-foreground mb-2">Dashboard</h1>
          <p className="text-muted-foreground text-lg">
            Track price trends and optimize your ride timing
          </p>
        </div>

        {/* Route Selector */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-muted-foreground mb-2">
            Select Route
          </label>
          {routesLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <div className="animate-spin rounded-full h-4 w-4 border-2 border-primary border-t-transparent"></div>
              <span>Loading routes...</span>
            </div>
          ) : routesError ? (
            <div className="flex items-start justify-between gap-4 rounded-lg border border-destructive/30 bg-destructive/5 p-4">
              <div>
                <p className="font-medium text-foreground">Couldn&apos;t load your routes</p>
                <p className="text-sm text-muted-foreground mt-1">{routesError}</p>
              </div>
              <button
                onClick={() => void loadSavedRoutes()}
                className="px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors text-sm font-medium"
              >
                Retry
              </button>
            </div>
          ) : savedRoutes.length > 0 ? (
            <select
              value={selectedRouteId || ''}
              onChange={e => setSelectedRouteId(e.target.value || null)}
              className="w-full md:w-auto px-4 py-2.5 rounded-lg bg-muted border border-border text-foreground focus:border-primary focus:ring-1 focus:ring-primary transition-all duration-200"
            >
              <option value="">Select a route...</option>
              {savedRoutes.map(route => (
                <option key={route.id} value={route.routeId || ''}>
                  {route.fromName} → {route.toName}
                </option>
              ))}
            </select>
          ) : (
            <div className="flex items-center gap-3 p-4 bg-muted/50 rounded-lg border border-border">
              <MapPin className="w-5 h-5 text-muted-foreground" />
              <div>
                <p className="text-foreground font-medium">No saved routes yet</p>
                <p className="text-sm text-muted-foreground">
                  Save routes from the home page to track their price history here.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Service Selector */}
        <div className="mb-8 flex flex-wrap gap-2">
          {(['uber', 'lyft', 'taxi', 'waymo'] as const).map(service => (
            <button
              key={service}
              onClick={() => setSelectedService(service)}
              className={`px-5 py-2.5 rounded-lg font-medium transition-all duration-200 ${
                selectedService === service
                  ? 'bg-primary text-primary-foreground'
                  : 'card-interactive text-muted-foreground hover:text-foreground'
              }`}
            >
              {service.charAt(0).toUpperCase() + service.slice(1)}
            </button>
          ))}
        </div>

        {savingsError && (
          <div className="mb-6 flex items-start justify-between gap-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4">
            <div>
              <p className="font-medium text-foreground">
                Savings insights are temporarily unavailable
              </p>
              <p className="text-sm text-muted-foreground mt-1">{savingsError}</p>
            </div>
            <button
              onClick={() => void loadSavingsData()}
              className="px-4 py-2 rounded-lg bg-background border border-border hover:bg-muted transition-colors text-sm font-medium"
            >
              Retry
            </button>
          </div>
        )}

        {dataError && (
          <div className="mb-6 flex items-start justify-between gap-4 rounded-lg border border-destructive/30 bg-destructive/5 p-4">
            <div>
              <p className="font-medium text-foreground">Route analytics failed to load</p>
              <p className="text-sm text-muted-foreground mt-1">{dataError}</p>
            </div>
            <button
              onClick={() => void loadData()}
              className="px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors text-sm font-medium"
            >
              Retry
            </button>
          </div>
        )}

        {dataLoading ? (
          <div className="text-center py-20">
            <div className="animate-spin rounded-full h-12 w-12 border-2 border-primary border-t-transparent mx-auto mb-4"></div>
            <p className="text-muted-foreground">Loading analytics...</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Price Trends Card */}
            <div className="card-elevated rounded-xl p-6">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
                  <BarChart3 className="w-5 h-5 text-primary" />
                </div>
                <h2 className="text-xl font-bold text-foreground">7-Day Price Trends</h2>
              </div>
              <PriceTrendsChart data={priceData} loading={dataLoading} />
            </div>

            {/* Hourly Averages Card */}
            <div className="card-elevated rounded-xl p-6">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 bg-secondary/10 rounded-lg flex items-center justify-center">
                  <Clock className="w-5 h-5 text-secondary" />
                </div>
                <h2 className="text-xl font-bold text-foreground">Best Times to Ride</h2>
              </div>
              <HourlyPriceChart data={hourlyAverages} loading={dataLoading} />
            </div>

            {/* Surge Insights Card */}
            <div className="card-elevated rounded-xl p-6">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
                  <Zap className="w-5 h-5 text-primary" />
                </div>
                <h2 className="text-xl font-bold text-foreground">Surge Insights</h2>
              </div>
              {surgeInsights.length > 0 ? (
                <SurgeChart data={surgeInsights} loading={dataLoading} />
              ) : (
                <div className="space-y-4">
                  <div className="p-4 bg-secondary/10 border border-secondary/20 rounded-lg">
                    <div className="font-medium text-foreground mb-1">Pro Tip</div>
                    <p className="text-sm text-muted-foreground">
                      Prices are typically lowest between 10 AM - 3 PM on weekdays
                    </p>
                  </div>
                  <div className="p-4 bg-primary/10 border border-primary/20 rounded-lg">
                    <div className="font-medium text-foreground mb-1">Peak Hours</div>
                    <p className="text-sm text-muted-foreground">
                      Expect 1.5-2.5x surge during rush hours (7-9 AM, 5-7 PM)
                    </p>
                  </div>
                  <div className="p-4 bg-muted rounded-lg">
                    <div className="font-medium text-foreground mb-1">Weather Impact</div>
                    <p className="text-sm text-muted-foreground">
                      Rain can increase prices by 20-40% due to higher demand
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Savings Card */}
            <div className="card-elevated rounded-xl p-6">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 bg-secondary/10 rounded-lg flex items-center justify-center">
                  <TrendingDown className="w-5 h-5 text-secondary" />
                </div>
                <h2 className="text-xl font-bold text-foreground">Your Savings</h2>
              </div>
              <div className="space-y-6">
                <div className="text-center py-4">
                  <div className="text-5xl font-black text-secondary mb-2">
                    ${savingsData.totalSavings.toFixed(2)}
                  </div>
                  <div className="text-muted-foreground">Total saved this month</div>
                  {savingsData.recsFollowed > 0 && (
                    <div className="flex items-center justify-center gap-1 mt-2 text-xs text-secondary">
                      <TrendingDown className="w-3 h-3" />
                      <span>
                        From {savingsData.recsFollowed} tip
                        {savingsData.recsFollowed !== 1 ? 's' : ''} followed
                      </span>
                    </div>
                  )}
                </div>
                {savingsData.totalSavings > 0 && (
                  <SavingsSparkline
                    data={[
                      savingsData.totalSavings * 0.2,
                      savingsData.totalSavings * 0.4,
                      savingsData.totalSavings * 0.6,
                      savingsData.totalSavings * 0.8,
                      savingsData.totalSavings,
                    ]}
                  />
                )}
                <div className="grid grid-cols-2 gap-4 pt-4 border-t border-border">
                  <div className="text-center">
                    <div className="text-3xl font-black text-foreground">
                      {savingsData.comparisonCount}
                    </div>
                    <div className="text-sm text-muted-foreground">Comparisons</div>
                  </div>
                  <div className="text-center">
                    <div className="text-3xl font-black text-foreground">
                      {savingsData.alertsSet}
                    </div>
                    <div className="text-sm text-muted-foreground">Alerts Set</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Navigation */}
        <div className="mt-12 text-center flex flex-wrap items-center justify-center gap-4">
          <button
            onClick={() => router.push('/')}
            className="inline-flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-all duration-200 font-semibold hover-lift"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Home
          </button>
          <button
            onClick={() => router.push('/trends')}
            className="inline-flex items-center gap-2 px-6 py-3 bg-muted text-foreground rounded-lg hover:bg-muted/80 transition-all duration-200 font-semibold"
          >
            <TrendingUp className="w-4 h-4" />
            Price Trends
          </button>
        </div>
      </div>
    </div>
  )
}
