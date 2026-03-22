'use client'

import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '@/lib/auth-context'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft,
  DollarSign,
  History,
  TrendingDown,
  BarChart3,
  Trash2,
  Check,
  X,
  Pencil,
} from 'lucide-react'
import { toast } from 'sonner'
import type { RideHistoryEntry, RideHistoryStats } from '@/types'

export default function HistoryPage() {
  const { user, loading } = useAuth()
  const router = useRouter()

  const [history, setHistory] = useState<RideHistoryEntry[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [historyLoading, setHistoryLoading] = useState(true)
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)

  const [stats, setStats] = useState<RideHistoryStats | null>(null)
  const [statsLoading, setStatsLoading] = useState(true)
  const [statsError, setStatsError] = useState<string | null>(null)

  // Per-entry UI state: editing fare or confirming delete
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  useEffect(() => {
    if (!loading && !user) router.push('/')
  }, [user, loading, router])

  // Auto-dismiss delete confirmation after 3 seconds
  useEffect(() => {
    if (!confirmDeleteId) return
    const timer = setTimeout(() => setConfirmDeleteId(null), 3000)
    return () => clearTimeout(timer)
  }, [confirmDeleteId])

  const loadStats = useCallback(async () => {
    if (!user) return
    setStatsLoading(true)
    setStatsError(null)
    try {
      const res = await fetch('/api/ride-history?analytics=true&daysBack=30')
      if (!res.ok) throw new Error('Unable to load spending analytics right now.')
      const data = (await res.json()) as RideHistoryStats
      setStats(data)
    } catch (error) {
      setStatsError(
        error instanceof Error ? error.message : 'Unable to load spending analytics right now.'
      )
    } finally {
      setStatsLoading(false)
    }
  }, [user])

  const loadHistory = useCallback(
    async (cursor?: string) => {
      if (!user) return
      if (cursor) {
        setLoadingMore(true)
      } else {
        setHistoryLoading(true)
        setHistoryError(null)
      }
      try {
        const url = cursor
          ? `/api/ride-history?cursor=${encodeURIComponent(cursor)}`
          : '/api/ride-history'
        const res = await fetch(url)
        if (!res.ok) throw new Error('Unable to load your ride history right now.')
        const data = await res.json()
        if (cursor) {
          setHistory(prev => [...prev, ...(data.history ?? [])])
        } else {
          setHistory(data.history ?? [])
        }
        setNextCursor(data.nextCursor ?? null)
      } catch (error) {
        setHistoryError(
          error instanceof Error ? error.message : 'Unable to load your ride history right now.'
        )
      } finally {
        setHistoryLoading(false)
        setLoadingMore(false)
      }
    },
    [user]
  )

  useEffect(() => {
    void loadStats()
  }, [loadStats])

  useEffect(() => {
    void loadHistory()
  }, [loadHistory])

  const handleUpdateFare = useCallback(
    async (id: string) => {
      const parsed = parseFloat(editValue)
      if (isNaN(parsed) || parsed <= 0) {
        toast.error('Please enter a valid fare amount.')
        return
      }
      try {
        const res = await fetch(`/api/ride-history/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ finalFare: parsed }),
        })
        if (!res.ok) throw new Error('Failed to update fare.')
        const updated = (await res.json()) as RideHistoryEntry
        setHistory(prev =>
          prev.map(entry => (entry.id === id ? { ...entry, finalFare: updated.finalFare } : entry))
        )
        setEditingId(null)
        setEditValue('')
        toast.success('Fare updated successfully.')
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Failed to update fare.')
      }
    },
    [editValue]
  )

  const handleDelete = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/ride-history/${id}`, { method: 'DELETE' })
      if (!res.ok && res.status !== 404) throw new Error('Failed to delete ride.')
      setHistory(prev => prev.filter(entry => entry.id !== id))
      setConfirmDeleteId(null)
      toast.success('Ride removed from history.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to delete ride.')
    }
  }, [])

  const startEdit = useCallback((entry: RideHistoryEntry) => {
    setEditingId(entry.id)
    setEditValue(entry.finalFare != null ? String(entry.finalFare) : '')
  }, [])

  const cancelEdit = useCallback(() => {
    setEditingId(null)
    setEditValue('')
  }, [])

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })

  const formatTime = (iso: string) =>
    new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

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

        {/* Stats Cards */}
        {statsError ? (
          <div className="mb-8 flex items-start justify-between gap-4 rounded-lg border border-destructive/30 bg-destructive/5 p-4">
            <div>
              <p className="font-medium text-foreground">Spending analytics unavailable</p>
              <p className="text-sm text-muted-foreground mt-1">{statsError}</p>
            </div>
            <button
              onClick={() => void loadStats()}
              className="px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors text-sm font-medium"
            >
              Retry
            </button>
          </div>
        ) : statsLoading ? (
          <div className="mb-8 grid grid-cols-2 gap-4">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="card-elevated rounded-xl p-6 animate-pulse">
                <div className="h-4 bg-muted rounded w-24 mb-3" />
                <div className="h-8 bg-muted rounded w-20" />
              </div>
            ))}
          </div>
        ) : stats ? (
          <div className="mb-8 grid grid-cols-2 gap-4">
            <div className="card-elevated rounded-xl p-6">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
                  <DollarSign className="w-5 h-5 text-primary" />
                </div>
                <span className="text-sm text-muted-foreground font-medium">Total Spent</span>
              </div>
              <div className="text-3xl font-black text-foreground">
                ${stats.totalSpent.toFixed(2)}
              </div>
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
              <div className="text-3xl font-black text-secondary">
                ${stats.totalSavings.toFixed(2)}
              </div>
            </div>
          </div>
        ) : null}

        {/* Ride History List */}
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
            {history.map(entry => {
              const route =
                entry.pickupAddress && entry.destinationAddress
                  ? `${entry.pickupAddress} → ${entry.destinationAddress}`
                  : 'Unknown route'
              const isEditing = editingId === entry.id
              const isConfirmingDelete = confirmDeleteId === entry.id

              return (
                <div key={entry.id} className="card-elevated rounded-xl p-6">
                  <div className="flex items-start justify-between gap-4">
                    {/* Left: ride info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className="font-bold text-foreground capitalize">
                          {entry.service}
                        </span>
                        <span className="text-muted-foreground text-sm">•</span>
                        <span className="text-sm text-muted-foreground" suppressHydrationWarning>
                          {formatDate(entry.requestedAt)} {formatTime(entry.requestedAt)}
                        </span>
                      </div>

                      <p className="text-sm text-muted-foreground truncate mb-3">{route}</p>

                      <div className="flex items-center gap-4 flex-wrap">
                        <div className="text-sm">
                          <span className="text-muted-foreground">Est: </span>
                          <span className="font-medium text-foreground">
                            ${entry.estimatedFare.toFixed(2)}
                          </span>
                        </div>

                        {/* Actual fare / inline edit */}
                        {isEditing ? (
                          <div className="flex items-center gap-2">
                            <span className="text-muted-foreground text-sm">Actual: $</span>
                            <input
                              type="number"
                              step="0.01"
                              min="0.01"
                              max="1000"
                              value={editValue}
                              onChange={e => setEditValue(e.target.value)}
                              className="w-24 px-2 py-1 rounded border border-border bg-background text-foreground text-sm focus:border-primary focus:ring-1 focus:ring-primary"
                              autoFocus
                              onKeyDown={e => {
                                if (e.key === 'Enter') void handleUpdateFare(entry.id)
                                if (e.key === 'Escape') cancelEdit()
                              }}
                            />
                            <button
                              onClick={() => void handleUpdateFare(entry.id)}
                              className="p-1 rounded text-secondary hover:bg-secondary/10 transition-colors"
                              title="Save"
                            >
                              <Check className="w-4 h-4" />
                            </button>
                            <button
                              onClick={cancelEdit}
                              className="p-1 rounded text-muted-foreground hover:bg-muted transition-colors"
                              title="Cancel"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                        ) : entry.finalFare != null ? (
                          <div className="flex items-center gap-1.5 text-sm">
                            <span className="text-muted-foreground">Actual: </span>
                            <span className="font-medium text-foreground">
                              ${entry.finalFare.toFixed(2)}
                            </span>
                            <button
                              onClick={() => startEdit(entry)}
                              className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                              title="Edit fare"
                            >
                              <Pencil className="w-3 h-3" />
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => startEdit(entry)}
                            className="text-sm text-primary hover:text-primary/80 transition-colors font-medium"
                          >
                            + Add fare
                          </button>
                        )}

                        {entry.surgeMultiplier != null && entry.surgeMultiplier > 1 && (
                          <span className="text-xs font-medium text-primary bg-primary/10 px-2 py-0.5 rounded-full">
                            {entry.surgeMultiplier}x surge
                          </span>
                        )}
                        {entry.waitTimeMinutes != null && (
                          <span className="text-xs text-muted-foreground">
                            {entry.waitTimeMinutes} min wait
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Right: delete */}
                    <div className="flex items-center gap-2 shrink-0">
                      {isConfirmingDelete ? (
                        <>
                          <button
                            onClick={() => void handleDelete(entry.id)}
                            className="px-3 py-1.5 rounded-lg bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors text-xs font-medium"
                          >
                            Confirm
                          </button>
                          <button
                            onClick={() => setConfirmDeleteId(null)}
                            className="p-1.5 rounded text-muted-foreground hover:bg-muted transition-colors"
                            title="Cancel"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={() => setConfirmDeleteId(entry.id)}
                          className="p-2 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                          title="Delete ride"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}

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
