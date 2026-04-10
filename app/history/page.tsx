'use client'

import { useEffect } from 'react'
import { useAuth } from '@/lib/auth-context'
import { useRouter } from 'next/navigation'
import { ArrowLeft, History } from 'lucide-react'
import { useRideHistory } from '@/hooks/use-ride-history'
import { StatsCards } from '@/components/history/stats-cards'
import { RideHistoryCard } from '@/components/history/ride-history-card'

export default function HistoryPage() {
  const { user, loading } = useAuth()
  const router = useRouter()

  const {
    history,
    nextCursor,
    historyLoading,
    historyError,
    loadingMore,
    stats,
    statsLoading,
    statsError,
    loadHistory,
    loadStats,
    handleUpdateFare,
    handleDelete,
  } = useRideHistory({ userId: user?.id })

  useEffect(() => {
    if (!loading && !user) router.push('/')
  }, [user, loading, router])

  if (loading || !user) {
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
        <div className="mb-10">
          <span className="text-primary font-mono text-sm tracking-widest uppercase mb-4 block">
            History
          </span>
          <h1 className="text-4xl sm:text-5xl font-black text-foreground mb-2">Ride History</h1>
          <p className="text-muted-foreground text-lg">Track your rides and spending</p>
        </div>

        <StatsCards
          stats={stats}
          statsLoading={statsLoading}
          statsError={statsError}
          onRetry={() => void loadStats()}
        />

        {/* History error banner */}
        {historyError && (
          <div className="mb-6 flex items-start justify-between gap-4 rounded-lg border border-destructive/30 bg-destructive/5 p-4">
            <div>
              <p className="font-medium text-foreground">Couldn&apos;t load ride history</p>
              <p className="text-sm text-muted-foreground mt-1">{historyError}</p>
            </div>
            <button
              onClick={() => void loadHistory()}
              className="px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors text-sm font-medium"
            >
              Retry
            </button>
          </div>
        )}

        {/* History loading / empty / list */}
        {historyLoading ? (
          <div className="text-center py-20">
            <div className="animate-spin rounded-full h-12 w-12 border-2 border-primary border-t-transparent mx-auto mb-4" />
            <p className="text-muted-foreground">Loading rides...</p>
          </div>
        ) : history.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <History className="w-12 h-12 mx-auto mb-4 opacity-30" />
            <p>No rides logged yet</p>
            <p className="text-sm mt-2">Start comparing rides and log which ones you take!</p>
            <button
              onClick={() => router.push('/')}
              className="mt-4 px-6 py-2.5 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors font-medium text-sm"
            >
              Compare Rides
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {history.map(entry => (
              <RideHistoryCard
                key={entry.id}
                entry={entry}
                onUpdateFare={handleUpdateFare}
                onDelete={handleDelete}
              />
            ))}

            {nextCursor && (
              <div className="text-center pt-4">
                <button
                  onClick={() => void loadHistory(nextCursor)}
                  disabled={loadingMore}
                  className="px-6 py-2.5 rounded-lg bg-muted hover:bg-muted/80 text-foreground transition-colors font-medium text-sm disabled:opacity-50"
                >
                  {loadingMore ? 'Loading...' : 'Load more'}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
