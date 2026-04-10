'use client'

import { DollarSign, History, TrendingDown, BarChart3 } from 'lucide-react'
import type { RideHistoryStats } from '@/types'

interface StatsCardsProps {
  stats: RideHistoryStats | null
  statsLoading: boolean
  statsError: string | null
  onRetry: () => void
}

export function StatsCards({ stats, statsLoading, statsError, onRetry }: StatsCardsProps) {
  if (statsError) {
    return (
      <div className="mb-8 flex items-start justify-between gap-4 rounded-lg border border-destructive/30 bg-destructive/5 p-4">
        <div>
          <p className="font-medium text-foreground">Spending analytics unavailable</p>
          <p className="text-sm text-muted-foreground mt-1">{statsError}</p>
        </div>
        <button
          onClick={onRetry}
          className="px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors text-sm font-medium"
        >
          Retry
        </button>
      </div>
    )
  }

  if (statsLoading) {
    return (
      <div className="mb-8 grid grid-cols-2 gap-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="card-elevated rounded-xl p-6 animate-pulse">
            <div className="h-4 bg-muted rounded w-24 mb-3" />
            <div className="h-8 bg-muted rounded w-20" />
          </div>
        ))}
      </div>
    )
  }

  if (!stats) return null

  return (
    <div className="mb-8 grid grid-cols-2 gap-4">
      <div className="card-elevated rounded-xl p-6">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
            <DollarSign className="w-5 h-5 text-primary" />
          </div>
          <span className="text-sm text-muted-foreground font-medium">Total Spent</span>
        </div>
        <div className="text-3xl font-black text-foreground">${stats.totalSpent.toFixed(2)}</div>
      </div>

      <div className="card-elevated rounded-xl p-6">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
            <BarChart3 className="w-5 h-5 text-primary" />
          </div>
          <span className="text-sm text-muted-foreground font-medium">Rides Taken</span>
        </div>
        <div className="text-3xl font-black text-foreground">{stats.rideCount}</div>
      </div>

      <div className="card-elevated rounded-xl p-6">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
            <History className="w-5 h-5 text-primary" />
          </div>
          <span className="text-sm text-muted-foreground font-medium">Avg Fare</span>
        </div>
        <div className="text-3xl font-black text-foreground">${stats.avgFare.toFixed(2)}</div>
      </div>

      <div className="card-elevated rounded-xl p-6">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 bg-secondary/10 rounded-lg flex items-center justify-center">
            <TrendingDown className="w-5 h-5 text-secondary" />
          </div>
          <span className="text-sm text-muted-foreground font-medium">Saved</span>
        </div>
        <div className="text-3xl font-black text-secondary">${stats.totalSavings.toFixed(2)}</div>
      </div>
    </div>
  )
}
