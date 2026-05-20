'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { API_PATHS } from '@/lib/constants'
import type { RideHistoryEntry, RideHistoryStats } from '@/types'

interface UseRideHistoryOptions {
  userId: string | undefined
}

interface UseRideHistoryReturn {
  history: RideHistoryEntry[]
  nextCursor: string | null
  historyLoading: boolean
  historyError: string | null
  loadingMore: boolean
  stats: RideHistoryStats | null
  statsLoading: boolean
  statsError: string | null
  loadHistory: (cursor?: string) => Promise<void>
  loadStats: () => Promise<void>
  handleUpdateFare: (id: string, editValue: string) => Promise<void>
  handleDelete: (id: string) => Promise<void>
}

export function useRideHistory({ userId }: UseRideHistoryOptions): UseRideHistoryReturn {
  const [history, setHistory] = useState<RideHistoryEntry[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [historyLoading, setHistoryLoading] = useState(true)
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)

  const [stats, setStats] = useState<RideHistoryStats | null>(null)
  const [statsLoading, setStatsLoading] = useState(true)
  const [statsError, setStatsError] = useState<string | null>(null)

  const loadStats = useCallback(async () => {
    if (!userId) return
    setStatsLoading(true)
    setStatsError(null)
    try {
      const res = await fetch(API_PATHS.RIDE_HISTORY_ANALYTICS())
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
  }, [userId])

  const loadHistory = useCallback(
    async (cursor?: string) => {
      if (!userId) return
      if (cursor) {
        setLoadingMore(true)
      } else {
        setHistoryLoading(true)
        setHistoryError(null)
      }
      try {
        const url = cursor
          ? `${API_PATHS.RIDE_HISTORY}?cursor=${encodeURIComponent(cursor)}`
          : API_PATHS.RIDE_HISTORY
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
    [userId]
  )

  useEffect(() => {
    void loadStats()
  }, [loadStats])

  useEffect(() => {
    void loadHistory()
  }, [loadHistory])

  const handleUpdateFare = useCallback(async (id: string, editValue: string) => {
    const parsed = parseFloat(editValue)
    if (isNaN(parsed) || parsed <= 0) {
      toast.error('Please enter a valid fare amount.')
      return
    }
    try {
      const res = await fetch(API_PATHS.RIDE_HISTORY_ENTRY(id), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ finalFare: parsed }),
      })
      if (!res.ok) throw new Error('Failed to update fare.')
      const updated = (await res.json()) as RideHistoryEntry
      setHistory(prev =>
        prev.map(entry => (entry.id === id ? { ...entry, finalFare: updated.finalFare } : entry))
      )
      toast.success('Fare updated successfully.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to update fare.')
    }
  }, [])

  const handleDelete = useCallback(async (id: string) => {
    try {
      const res = await fetch(API_PATHS.RIDE_HISTORY_ENTRY(id), { method: 'DELETE' })
      if (!res.ok && res.status !== 404) throw new Error('Failed to delete ride.')
      setHistory(prev => prev.filter(entry => entry.id !== id))
      toast.success('Ride removed from history.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to delete ride.')
    }
  }, [])

  return {
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
  }
}
