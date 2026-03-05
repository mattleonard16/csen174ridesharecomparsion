import { useState, useCallback, memo } from 'react'
import { Clock, Zap, TrendingDown, ChevronDown, ChevronUp, X } from 'lucide-react'
import type { AIRecommendation } from '@/types'

interface RecommendationsPanelProps {
  recommendations: AIRecommendation[]
  onAction?: (
    recommendationId: string,
    action: 'VIEWED' | 'CLICKED' | 'FOLLOWED' | 'DISMISSED'
  ) => void
}

function getIcon(type: AIRecommendation['type']) {
  switch (type) {
    case 'DEPARTURE_TIME':
      return <Clock className="w-4 h-4 text-secondary mt-0.5 flex-shrink-0" />
    case 'SERVICE_CHOICE':
      return <TrendingDown className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
    case 'SURGE_FORECAST':
      return <Zap className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" />
    case 'SAVINGS_INSIGHT':
      return <TrendingDown className="w-4 h-4 text-secondary mt-0.5 flex-shrink-0" />
    default:
      return <Clock className="w-4 h-4 text-muted-foreground mt-0.5 flex-shrink-0" />
  }
}

export default memo(function RecommendationsPanel({
  recommendations,
  onAction,
}: RecommendationsPanelProps) {
  const [isExpanded, setIsExpanded] = useState(true)
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set())

  const handleDismiss = useCallback(
    (rec: AIRecommendation) => {
      const id = rec.id ?? rec.type
      setDismissedIds(prev => {
        const next = new Set(prev)
        next.add(id)
        return next
      })
      if (rec.id && onAction) {
        onAction(rec.id, 'DISMISSED')
      }
    },
    [onAction]
  )

  const visibleRecs = recommendations.filter(r => !dismissedIds.has(r.id ?? r.type))

  if (visibleRecs.length === 0) return null

  return (
    <div className="rounded-2xl overflow-hidden border border-border/40 bg-card">
      {/* Header */}
      <button
        onClick={() => setIsExpanded(prev => !prev)}
        className="w-full flex items-center justify-between p-5 hover:bg-muted/30 transition-colors"
      >
        <div className="text-left">
          <span className="font-display text-lg text-foreground">Route Insights</span>
          <div className="text-xs text-muted-foreground mt-0.5">
            {visibleRecs.length} tip{visibleRecs.length !== 1 ? 's' : ''} for this trip
          </div>
        </div>
        {isExpanded ? (
          <ChevronUp className="w-4 h-4 text-muted-foreground" />
        ) : (
          <ChevronDown className="w-4 h-4 text-muted-foreground" />
        )}
      </button>

      {/* Content */}
      {isExpanded && (
        <div className="px-5 pb-5 space-y-3">
          {visibleRecs.map((rec, idx) => {
            const savings = rec.dataPoints.potentialSavings
            return (
              <div
                key={rec.id ?? `${rec.type}-${idx}`}
                className="group relative flex items-start gap-3 p-4 rounded-xl border border-border/30 bg-card/50 hover:bg-muted/30 transition-colors"
              >
                {getIcon(rec.type)}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-foreground">{rec.title}</span>
                    <button
                      onClick={e => {
                        e.stopPropagation()
                        handleDismiss(rec)
                      }}
                      className="p-1 rounded-md hover:bg-muted text-muted-foreground/50 hover:text-muted-foreground transition-colors"
                      aria-label="Dismiss recommendation"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <p className="text-sm text-muted-foreground leading-relaxed mt-0.5">
                    {rec.message}
                    {savings !== undefined && savings > 0 && (
                      <span className="font-medium text-secondary">
                        {' '}
                        Save ~${savings.toFixed(0)}.
                      </span>
                    )}
                  </p>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
})
