import {
  AlertCircle,
  Share2,
  Bell,
  Bookmark,
  Zap,
  TrendingUp,
  TrendingDown,
  Minus,
  BarChart3,
  Sparkles,
} from 'lucide-react'
import { useState, memo, useMemo, useCallback, useEffect, useRef } from 'react'
import { toast } from 'sonner'
import PriceAlert from './price-alert'
import { useAuth } from '@/lib/auth-context'
import { AuthDialog } from './auth-dialog'
import ModalPortal from './ModalPortal'
import RecommendationsPanel from './recommendations-panel'
import type { AIRecommendation } from '@/types'

type RideData = {
  price: string
  waitTime: string
  driversNearby: number
  service: string
  surgeMultiplier?: string
}

type Results = Partial<Record<ServiceType, RideData>>

type ServiceType = 'uber' | 'lyft' | 'taxi' | 'waymo'

type PriceStats = {
  count: number
  avg: number
  min: number
  max: number
  stddev: number
}

type RouteClusterStats = {
  exact?: PriceStats
  cluster?: {
    count: number
    avg: number
    min: number
    max: number
    stddev: number
    precision: number
    pickupPrefix: string
    destinationPrefix: string
    usedNeighbors: boolean
  }
  confidence: number
  source: 'exact' | 'cluster' | 'model'
}

type RideComparisonResultsProps = {
  routeId?: string | null
  results: Results
  insights: string
  surgeInfo?: {
    isActive: boolean
    reason: string
    multiplier: number
  } | null
  pickup?: string
  destination?: string
  pickupCoords?: [number, number] | null
  destinationCoords?: [number, number] | null
  historicalStats?: Partial<Record<ServiceType, RouteClusterStats | null>>
  timeRecommendations?: string[]
  aiRecommendations?: AIRecommendation[]
}

export default memo(function RideComparisonResults({
  routeId = null,
  results,
  insights,
  surgeInfo,
  pickup = '',
  destination = '',
  pickupCoords = null,
  destinationCoords = null,
  historicalStats,
  timeRecommendations = [],
  aiRecommendations = [],
}: RideComparisonResultsProps) {
  const { user } = useAuth()
  const [showPriceAlert, setShowPriceAlert] = useState(false)
  const [showAuthDialog, setShowAuthDialog] = useState(false)
  const [routeSaved, setRouteSaved] = useState(false)

  // AI insight state
  type AiInsightState = 'idle' | 'loading' | 'success' | 'rate-limited' | 'error'
  const [aiInsightState, setAiInsightState] = useState<AiInsightState>('idle')
  const [aiInsight, setAiInsight] = useState('')
  const viewedRecommendationIdsRef = useRef<Set<string>>(new Set())

  const routeRecommendations = useMemo(() => {
    if (aiRecommendations.length > 0) {
      return aiRecommendations
    }

    return timeRecommendations.map<AIRecommendation>((message, index) => ({
      type: 'DEPARTURE_TIME' as const,
      title: index === 0 ? 'Timing Tip' : `Timing Tip ${index + 1}`,
      message,
      confidence: 0.4,
      dataPoints: {},
    }))
  }, [aiRecommendations, timeRecommendations])

  useEffect(() => {
    if (!pickup || !destination) return

    setAiInsightState('loading')

    fetch('/api/ai-insights', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pickup, destination, results, surgeInfo }),
    })
      .then(async res => {
        if (res.status === 429) {
          setAiInsightState('rate-limited')
          return
        }
        if (!res.ok) {
          setAiInsightState('error')
          return
        }
        const data = (await res.json()) as { insight?: string }
        if (data.insight) {
          setAiInsight(data.insight)
          setAiInsightState('success')
        } else {
          setAiInsightState('error')
        }
      })
      .catch(() => {
        setAiInsightState('error')
      })
    // Only run when results first load — pickup/destination/results identity won't change mid-session
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!showAuthDialog) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setShowAuthDialog(false)
      }
    }

    const originalOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', handleKeyDown)

    return () => {
      document.body.style.overflow = originalOverflow
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [showAuthDialog])

  // Memoize services array first (used by handlers below)
  const services = useMemo(
    () => [
      ...(results.uber
        ? [
            {
              name: 'Uber',
              data: results.uber,
              bgColor: 'bg-black',
              textColor: 'text-foreground',
            },
          ]
        : []),
      ...(results.lyft
        ? [
            {
              name: 'Lyft',
              data: results.lyft,
              bgColor: 'bg-pink-600',
              textColor: 'text-foreground',
            },
          ]
        : []),
      ...(results.taxi
        ? [
            {
              name: 'Taxi',
              data: results.taxi,
              bgColor: 'bg-amber-500',
              textColor: 'text-black',
            },
          ]
        : []),
      ...(results.waymo
        ? [
            {
              name: 'Waymo',
              data: results.waymo,
              bgColor: 'bg-teal-500',
              textColor: 'text-white',
            },
          ]
        : []),
    ],
    [results.uber, results.lyft, results.taxi, results.waymo]
  )

  const getBookingUrl = useCallback(
    (serviceName: string) => {
      // Coordinates are [longitude, latitude] format from geocoding
      const pickupLat = pickupCoords ? pickupCoords[1] : null
      const pickupLng = pickupCoords ? pickupCoords[0] : null
      const destLat = destinationCoords ? destinationCoords[1] : null
      const destLng = destinationCoords ? destinationCoords[0] : null

      const pickupName = pickup ? encodeURIComponent(pickup.split(',')[0]) : ''
      const destName = destination ? encodeURIComponent(destination.split(',')[0]) : ''

      switch (serviceName.toLowerCase()) {
        case 'uber':
          if (pickupLat && pickupLng && destLat && destLng) {
            return `https://m.uber.com/ul/?action=setPickup&pickup[latitude]=${pickupLat}&pickup[longitude]=${pickupLng}&pickup[nickname]=${pickupName}&dropoff[latitude]=${destLat}&dropoff[longitude]=${destLng}&dropoff[nickname]=${destName}`
          }
          return 'https://m.uber.com/looking'
        case 'lyft':
          if (pickupLat && pickupLng && destLat && destLng) {
            return `https://lyft.com/ride?pickup[latitude]=${pickupLat}&pickup[longitude]=${pickupLng}&destination[latitude]=${destLat}&destination[longitude]=${destLng}`
          }
          return 'https://www.lyft.com/'
        case 'waymo':
          if (pickupLat && pickupLng && destLat && destLng) {
            return `https://waymo.com/ride?pickup_lat=${pickupLat}&pickup_lng=${pickupLng}&dest_lat=${destLat}&dest_lng=${destLng}`
          }
          return 'https://waymo.com/waymo-one/'
        default:
          return '#'
      }
    },
    [pickupCoords, destinationCoords, pickup, destination]
  )

  const handleBooking = useCallback(
    (serviceName: string) => {
      const url = getBookingUrl(serviceName)
      if (url !== '#') {
        // For mobile, try to open directly (which may open the app)
        // For desktop, open in new tab
        window.open(url, '_blank', 'noopener,noreferrer')
      }
    },
    [getBookingUrl]
  )

  const handleShare = useCallback(async () => {
    const bestPriceService = services.reduce((best, current) => {
      const currentPrice = Number.parseFloat(current.data.price.replace('$', ''))
      const bestPriceVal = Number.parseFloat(best.data.price.replace('$', ''))
      return currentPrice < bestPriceVal ? current : best
    }, services[0])

    const routeInfo = pickup && destination ? `${pickup} → ${destination}` : 'ride comparison'
    const shareData = {
      title: 'Ride Comparison Results',
      text: `${routeInfo}: Best option is ${bestPriceService.name} at ${bestPriceService.data.price} with ${bestPriceService.data.waitTime} wait time. Compare more rides with RideCompare!`,
      url: window.location.href,
    }

    try {
      if (navigator.share && navigator.canShare && navigator.canShare(shareData)) {
        await navigator.share(shareData)
      } else {
        await navigator.clipboard.writeText(`${shareData.text} ${shareData.url}`)
        toast.success('Ride comparison copied to clipboard!')
      }
    } catch {
      try {
        await navigator.clipboard.writeText(`${shareData.text} ${window.location.href}`)
        toast.success('Ride comparison copied to clipboard!')
      } catch {
        // Clipboard also failed - ignore silently
      }
    }
  }, [services, pickup, destination])

  const handleShareETA = useCallback(
    async (serviceName: string, waitTime: string) => {
      const estimatedPickupTime = new Date(Date.now() + parseInt(waitTime) * 60000)
      const timeString = estimatedPickupTime.toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      })

      const etaMessage =
        pickup && destination
          ? `I'm taking a ${serviceName} from ${pickup.split(',')[0]} to ${destination.split(',')[0]}. Estimated pickup at ${timeString}. I'll update you when I'm on my way!`
          : `I'm taking a ${serviceName}. Estimated pickup at ${timeString}. I'll update you when I'm on my way!`

      const shareData = {
        title: 'My Ride ETA',
        text: etaMessage,
      }

      try {
        if (navigator.share && navigator.canShare && navigator.canShare(shareData)) {
          await navigator.share(shareData)
        } else {
          await navigator.clipboard.writeText(etaMessage)
          toast.success('ETA message copied to clipboard!')
        }
      } catch {
        try {
          await navigator.clipboard.writeText(etaMessage)
          toast.success('ETA message copied to clipboard!')
        } catch {
          // Clipboard also failed - ignore silently
        }
      }
    },
    [pickup, destination]
  )

  const handleSaveRoute = useCallback(async () => {
    if (!user) {
      setShowAuthDialog(true)
      return
    }

    if (!routeId) {
      return
    }

    const nickname = `${pickup?.split(',')[0] || 'Pickup'} → ${destination?.split(',')[0] || 'Destination'}`

    try {
      const response = await fetch('/api/saved-routes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ routeId, nickname }),
      })

      if (!response.ok) {
        throw new Error('Failed to save route')
      }

      setRouteSaved(true)
      setTimeout(() => setRouteSaved(false), 3000)
    } catch {
      toast.error('Failed to save this route. Please try again.')
    }
  }, [user, routeId, pickup, destination])

  const handleRecommendationAction = useCallback(
    async (
      recommendationId: string,
      action: 'VIEWED' | 'CLICKED' | 'FOLLOWED' | 'DISMISSED',
      estimatedSavings?: number
    ) => {
      try {
        await fetch('/api/recommendations/actions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ recommendationId, action, estimatedSavings }),
        })
      } catch {
        // Recommendation tracking should never block the core compare experience.
      }
    },
    []
  )

  useEffect(() => {
    routeRecommendations.forEach(rec => {
      if (rec.id && !viewedRecommendationIdsRef.current.has(rec.id)) {
        viewedRecommendationIdsRef.current.add(rec.id)
        void handleRecommendationAction(rec.id, 'VIEWED', rec.dataPoints.potentialSavings)
      }
    })
  }, [routeRecommendations, handleRecommendationAction])

  const handleSetPriceAlert = useCallback(
    async (threshold: number) => {
      if (!user) {
        setShowAuthDialog(true)
        return
      }

      // If we have a routeId, use the API to persist the alert
      if (routeId) {
        try {
          const response = await fetch('/api/price-alerts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              routeId,
              targetPrice: threshold,
              service: 'any',
              alertType: 'below',
            }),
          })

          if (response.ok) {
            // Also store in localStorage for quick access
            const localAlert = {
              threshold,
              timestamp: new Date().toISOString(),
              pickup: pickup?.split(',')[0],
              destination: destination?.split(',')[0],
              route:
                pickup && destination
                  ? `${pickup.split(',')[0]} → ${destination.split(',')[0]}`
                  : 'Route',
              routeId,
              synced: true,
            }
            const existingAlerts = JSON.parse(localStorage.getItem('priceAlerts') || '[]')
            const updatedAlerts = [...existingAlerts, localAlert]
            localStorage.setItem('priceAlerts', JSON.stringify(updatedAlerts))
            return
          }
        } catch {
          // API save failed - fall through to localStorage
        }
      }

      // Fallback to localStorage only (for routes without ID or API errors)
      const newAlert = {
        threshold,
        timestamp: new Date().toISOString(),
        pickup: pickup?.split(',')[0],
        destination: destination?.split(',')[0],
        route:
          pickup && destination
            ? `${pickup.split(',')[0]} → ${destination.split(',')[0]}`
            : 'Route',
        synced: false,
      }
      const existingAlerts = JSON.parse(localStorage.getItem('priceAlerts') || '[]')
      const updatedAlerts = [...existingAlerts, newAlert]
      localStorage.setItem('priceAlerts', JSON.stringify(updatedAlerts))
    },
    [user, routeId, pickup, destination]
  )

  // Memoize best price/wait time calculations
  const bestPrice = useMemo(
    () =>
      services.reduce((best, current) => {
        const currentPrice = Number.parseFloat(current.data.price.replace('$', ''))
        const bestPriceVal = Number.parseFloat(best.data.price.replace('$', ''))
        return currentPrice < bestPriceVal ? current : best
      }, services[0]),
    [services]
  )

  const bestWaitTime = useMemo(
    () =>
      services.reduce((best, current) => {
        const currentTime = Number.parseInt(current.data.waitTime.replace(' min', ''))
        const bestTime = Number.parseInt(best.data.waitTime.replace(' min', ''))
        return currentTime < bestTime ? current : best
      }, services[0]),
    [services]
  )

  // Helper to get price comparison vs historical average
  const getPriceComparison = useCallback(
    (serviceName: string, currentPrice: number) => {
      const serviceKey = serviceName.toLowerCase() as ServiceType
      const stats = historicalStats?.[serviceKey]
      if (!stats) return null

      const statsForSource =
        stats.source === 'exact' ? stats.exact : stats.source === 'cluster' ? stats.cluster : null
      if (!statsForSource) return null

      const historicalAvg = statsForSource.avg
      if (!historicalAvg) return null

      const diff = currentPrice - historicalAvg
      const percentDiff = ((diff / historicalAvg) * 100).toFixed(0)
      const isHigher = diff > historicalAvg * 0.05 // 5% threshold
      const isLower = diff < -historicalAvg * 0.05

      return {
        avg: historicalAvg,
        diff,
        percentDiff,
        isHigher,
        isLower,
        isTypical: !isHigher && !isLower,
        source: stats.source,
        confidence: stats.confidence,
        sampleCount: statsForSource.count,
      }
    },
    [historicalStats]
  )

  // Check if we have any historical stats to display
  const hasHistoricalStats = useMemo(
    () =>
      historicalStats &&
      Object.values(historicalStats).some(
        s => s && ((s.source === 'exact' && s.exact) || (s.source === 'cluster' && s.cluster))
      ),
    [historicalStats]
  )

  return (
    <div className="w-full max-w-6xl mx-auto space-y-8">
      {/* Header with actions */}
      <div className="flex items-center justify-between">
        <h2 className="text-3xl sm:text-4xl md:text-5xl font-display font-normal text-foreground tracking-tight">
          Compare & Choose
        </h2>
        <div className="flex gap-2">
          <button
            onClick={handleSaveRoute}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg border transition-all duration-200 text-sm font-medium ${
              routeSaved
                ? 'bg-secondary/20 border-secondary/50 text-secondary'
                : 'border-border text-muted-foreground hover:text-foreground hover:border-foreground'
            }`}
            title={user ? 'Save this route' : 'Sign in to save routes'}
            aria-label="Save route"
          >
            <Bookmark className={`h-4 w-4 ${routeSaved ? 'fill-current' : ''}`} />
            <span className="hidden sm:inline">{routeSaved ? 'Saved!' : 'Save'}</span>
          </button>
          <button
            onClick={handleShare}
            className="flex items-center gap-2 px-4 py-2 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:border-foreground transition-all duration-200 text-sm font-medium"
            aria-label="Share route"
          >
            <Share2 className="h-4 w-4" />
            <span className="hidden sm:inline">Share</span>
          </button>
          <button
            onClick={() => setShowPriceAlert(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:border-foreground transition-all duration-200 text-sm font-medium"
            title={user ? 'Set price alert' : 'Sign in to set alerts'}
            aria-label="Set price alert"
          >
            <Bell className="h-4 w-4" />
            <span className="hidden sm:inline">Alert</span>
          </button>
        </div>
      </div>

      {/* Quick Summary */}
      <div className="card-elevated rounded-2xl p-6 sm:p-8 shadow-lg">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-center">
          <div className="space-y-1">
            <div className="text-4xl font-display text-secondary">{bestPrice.data.price}</div>
            <div className="text-sm text-muted-foreground">
              Best Price <span className="text-foreground font-medium">({bestPrice.name})</span>
            </div>
          </div>
          <div className="space-y-1">
            <div className="text-4xl font-display text-primary">{bestWaitTime.data.waitTime}</div>
            <div className="text-sm text-muted-foreground">
              Fastest <span className="text-foreground font-medium">({bestWaitTime.name})</span>
            </div>
          </div>
          <div className="space-y-1">
            <div className="text-4xl font-display text-foreground">
              $
              {(
                services.reduce((sum, s) => sum + parseFloat(s.data.price.replace('$', '')), 0) /
                services.length
              ).toFixed(0)}
            </div>
            <div className="text-sm text-muted-foreground">Average Price</div>
          </div>
        </div>
      </div>

      {/* AI Recommendation Card (with rule-based fallback) */}
      {routeRecommendations.length > 0 && (
        <RecommendationsPanel
          recommendations={routeRecommendations}
          onAction={(recommendationId, action) => {
            const recommendation = routeRecommendations.find(rec => rec.id === recommendationId)
            void handleRecommendationAction(
              recommendationId,
              action,
              recommendation?.dataPoints.potentialSavings
            )
          }}
        />
      )}

      {aiInsightState === 'loading' && (
        <div className="card-elevated rounded-2xl border border-border/50 bg-gradient-to-r from-violet-500/5 to-blue-500/5 p-5 animate-pulse">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-8 h-8 bg-violet-500/20 rounded-xl flex items-center justify-center flex-shrink-0">
              <Sparkles className="h-4 w-4 text-violet-400" />
            </div>
            <span className="text-sm font-medium text-muted-foreground">
              Analyzing your options…
            </span>
          </div>
          <div className="space-y-2">
            <div className="h-3 bg-muted/40 rounded w-full" />
            <div className="h-3 bg-muted/40 rounded w-5/6" />
            <div className="h-3 bg-muted/40 rounded w-4/6" />
          </div>
        </div>
      )}

      {aiInsightState === 'success' && aiInsight && (
        <div className="card-elevated rounded-2xl border border-violet-500/30 bg-gradient-to-r from-violet-500/5 to-blue-500/5 p-5">
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 bg-violet-500/15 rounded-xl flex items-center justify-center flex-shrink-0">
              <Sparkles className="h-5 w-5 text-violet-400" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1.5">
                <span className="text-sm font-medium text-violet-400">AI Recommendation</span>
                <span className="text-xs text-muted-foreground bg-muted/40 px-2 py-0.5 rounded-full">
                  Powered by AI
                </span>
              </div>
              <p className="text-foreground text-sm leading-relaxed">{aiInsight}</p>
            </div>
          </div>
        </div>
      )}

      {(aiInsightState === 'error' || aiInsightState === 'rate-limited') && insights && (
        <div className="card-elevated rounded-2xl border-l-4 border-l-secondary bg-secondary/5">
          <div className="p-5 flex items-start gap-4">
            <div className="w-10 h-10 bg-secondary/10 text-secondary flex items-center justify-center flex-shrink-0 rounded-xl">
              <AlertCircle className="h-5 w-5" />
            </div>
            <div className="flex-1">
              <div className="font-medium text-secondary text-sm mb-1">Our Recommendation</div>
              <div className="text-foreground text-sm leading-relaxed">{insights}</div>
            </div>
          </div>
        </div>
      )}

      {/* Main Comparison Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {services.map(service => (
          <div
            key={service.name}
            className={`card-elevated card-shine rounded-2xl overflow-hidden transition-all duration-300 relative group hover:-translate-y-1 hover:shadow-xl
              ${service.name === bestPrice.name ? 'border-secondary shadow-[0_0_20px_hsl(var(--secondary)/0.3)]' : 'hover:border-foreground/30'}
            `}
          >
            {/* Recommended Banner */}
            {service.name === bestPrice.name && (
              <div className="absolute top-3 right-3 bg-secondary text-secondary-foreground text-xs font-medium px-3 py-1 rounded-full z-10">
                Best Price
              </div>
            )}

            {/* Service Header - Subtle Gradient Border Top */}
            <div
              className={`h-1 w-full bg-gradient-to-r ${
                service.name === 'Uber'
                  ? 'from-zinc-900 to-zinc-700'
                  : service.name === 'Lyft'
                    ? 'from-pink-600 to-pink-400'
                    : service.name === 'Waymo'
                      ? 'from-teal-500 to-teal-300'
                      : 'from-amber-500 to-amber-300'
              }`}
            ></div>

            <div className="p-5">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                  <div
                    className={`w-12 h-12 rounded-xl flex items-center justify-center ${service.bgColor} text-white font-bold text-xl font-display shadow-md`}
                  >
                    {service.name[0]}
                  </div>
                  <div>
                    <h3 className="text-2xl font-display font-normal text-foreground leading-none">
                      {service.name}
                    </h3>
                    <div className="text-xs text-muted-foreground mt-1">Standard Service</div>
                  </div>
                </div>
                {service.data.surgeMultiplier && (
                  <div className="flex flex-col items-end">
                    <span className="bg-accent/20 text-accent-foreground text-xs font-semibold px-2 py-1 rounded-lg">
                      {service.data.surgeMultiplier}x
                    </span>
                    <span className="text-xs text-muted-foreground mt-1">Surge Active</span>
                  </div>
                )}
              </div>

              {/* Price Display */}
              <div className="mb-6 pb-6 border-b border-border/50">
                <div className="flex items-baseline justify-between">
                  <span className="text-sm text-muted-foreground">Estimated Fare</span>
                  <div
                    className={`text-4xl font-display font-semibold tracking-tight tabular-nums ${
                      service.name === bestPrice.name ? 'text-secondary' : 'text-foreground'
                    }`}
                  >
                    {service.data.price}
                  </div>
                </div>
              </div>

              {/* Metrics Grid */}
              <div className="grid grid-cols-2 gap-3 mb-6">
                <div className="bg-muted/30 p-3 rounded-xl">
                  <div className="text-xs text-muted-foreground mb-1">Wait Time</div>
                  <div
                    className={`text-xl font-semibold ${
                      service.name === bestWaitTime.name ? 'text-primary' : 'text-foreground'
                    }`}
                  >
                    {service.data.waitTime}
                  </div>
                </div>
                <div className="bg-muted/30 p-3 rounded-xl">
                  <div className="text-xs text-muted-foreground mb-1">Nearby Drivers</div>
                  <div className="text-xl font-semibold text-foreground">
                    {service.data.driversNearby}
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="space-y-3">
                <button
                  onClick={() => handleBooking(service.name)}
                  className={`w-full py-3 px-4 text-sm font-semibold rounded-xl transition-all duration-200 relative overflow-hidden
                    ${
                      service.name === 'Taxi'
                        ? 'bg-muted/50 text-muted-foreground cursor-not-allowed'
                        : 'bg-foreground text-background hover:bg-foreground/90 hover:shadow-lg'
                    }`}
                  disabled={service.name === 'Taxi'}
                >
                  <span className="relative z-10 flex items-center justify-center gap-2">
                    {service.name === 'Taxi'
                      ? `Call Dispatch`
                      : service.name === 'Waymo'
                        ? `Book Waymo One`
                        : `Book with ${service.name}`}
                    {service.name !== 'Taxi' && <span className="text-sm">&#8594;</span>}
                  </span>
                </button>

                <button
                  onClick={() => handleShareETA(service.name, service.data.waitTime)}
                  className="w-full py-2 px-4 text-sm text-muted-foreground hover:text-foreground transition-colors flex items-center justify-center gap-2 group"
                >
                  <Share2 className="h-4 w-4 group-hover:text-primary transition-colors" />
                  Share ETA
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Additional Information */}
      <div className="space-y-4">
        {/* Surge Information */}
        {surgeInfo && surgeInfo.isActive && (
          <div className="card-elevated rounded-2xl border-primary/30 p-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-primary/10 rounded-xl flex items-center justify-center flex-shrink-0">
                <Zap className="w-5 h-5 text-primary" />
              </div>
              <div className="text-foreground">
                <span className="font-medium">Surge Active:</span>{' '}
                <span className="text-muted-foreground">{surgeInfo.reason}</span>{' '}
                <span className="text-primary font-semibold">
                  ({surgeInfo.multiplier.toFixed(1)}x)
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Historical Price Context */}
        {hasHistoricalStats && (
          <div className="card-elevated rounded-2xl border-muted/30 p-5">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-muted/30 rounded-xl flex items-center justify-center flex-shrink-0">
                <BarChart3 className="w-5 h-5 text-muted-foreground" />
              </div>
              <div>
                <span className="font-medium text-foreground">Historical Price Context</span>
                <div className="text-xs text-muted-foreground">
                  Based on recent trips in this area
                </div>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {services.map(service => {
                const currentPrice = Number.parseFloat(service.data.price.replace('$', ''))
                const comparison = getPriceComparison(service.name, currentPrice)

                if (!comparison) return null

                return (
                  <div
                    key={`hist-${service.name}`}
                    className="bg-muted/10 border border-border/30 p-3 rounded-xl"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm text-muted-foreground">{service.name}</span>
                      <div className="flex items-center gap-1">
                        {comparison.isHigher && (
                          <>
                            <TrendingUp className="w-3 h-3 text-destructive" />
                            <span className="text-xs text-destructive">
                              +{comparison.percentDiff}%
                            </span>
                          </>
                        )}
                        {comparison.isLower && (
                          <>
                            <TrendingDown className="w-3 h-3 text-secondary" />
                            <span className="text-xs text-secondary">
                              {comparison.percentDiff}%
                            </span>
                          </>
                        )}
                        {comparison.isTypical && (
                          <>
                            <Minus className="w-3 h-3 text-muted-foreground" />
                            <span className="text-xs text-muted-foreground">typical</span>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="flex items-baseline justify-between">
                      <span className="text-xs text-muted-foreground">Avg:</span>
                      <span className="text-sm font-medium text-foreground">
                        ${comparison.avg.toFixed(2)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between mt-1">
                      <span className="text-xs text-muted-foreground">
                        {comparison.sampleCount} samples
                      </span>
                      <span
                        className={`text-xs ${
                          comparison.confidence >= 0.8
                            ? 'text-secondary'
                            : comparison.confidence >= 0.6
                              ? 'text-muted-foreground'
                              : 'text-muted-foreground/60'
                        }`}
                      >
                        {comparison.source === 'exact'
                          ? 'Exact Route'
                          : comparison.source === 'cluster'
                            ? 'Area Avg'
                            : 'Estimate'}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {/* Action Buttons */}
      <div className="flex justify-center gap-4 pt-6 border-t border-border/50">
        <button
          onClick={handleShare}
          className="flex items-center gap-2 px-6 py-3 rounded-xl border border-foreground/20 text-foreground hover:bg-foreground hover:text-background transition-all duration-200 font-medium text-sm"
        >
          <Share2 className="h-4 w-4" />
          Share Results
        </button>
        <button
          onClick={() => setShowPriceAlert(true)}
          className="flex items-center gap-2 px-6 py-3 rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 transition-all duration-200 font-medium text-sm shadow-md hover:shadow-lg"
        >
          <Bell className="h-4 w-4" />
          Set Price Alert
        </button>
      </div>

      {/* Price Alert Modal */}
      {showPriceAlert && (
        <PriceAlert
          currentBestPrice={Number.parseFloat(bestPrice.data.price.replace('$', ''))}
          onSetAlert={handleSetPriceAlert}
          onClose={() => setShowPriceAlert(false)}
        />
      )}

      {/* Auth Dialog */}
      {showAuthDialog && (
        <ModalPortal>
          <div
            className="fixed inset-0 z-[9999] flex items-center justify-center bg-background/80 backdrop-blur-sm p-4"
            role="presentation"
            onClick={() => setShowAuthDialog(false)}
          >
            <div
              className="relative z-[10000] w-full max-w-md glass-card rounded-2xl overflow-hidden"
              role="dialog"
              aria-modal="true"
              aria-labelledby="auth-dialog-title"
              onClick={event => event.stopPropagation()}
            >
              <AuthDialog
                onClose={() => setShowAuthDialog(false)}
                onSuccess={() => setShowAuthDialog(false)}
              />
            </div>
          </div>
        </ModalPortal>
      )}
    </div>
  )
})
