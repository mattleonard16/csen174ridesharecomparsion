'use client'

import { useState, useCallback, useEffect } from 'react'
import { Trash2, Check, X, Pencil } from 'lucide-react'
import type { RideHistoryEntry } from '@/types'

interface RideHistoryCardProps {
  entry: RideHistoryEntry
  onUpdateFare: (id: string, editValue: string) => Promise<void>
  onDelete: (id: string) => Promise<void>
}

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })

const formatTime = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

export function RideHistoryCard({ entry, onUpdateFare, onDelete }: RideHistoryCardProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [editValue, setEditValue] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    if (!confirmDelete) return
    const timer = setTimeout(() => setConfirmDelete(false), 3000)
    return () => clearTimeout(timer)
  }, [confirmDelete])

  const startEdit = useCallback(() => {
    setIsEditing(true)
    setEditValue(entry.finalFare != null ? String(entry.finalFare) : '')
  }, [entry.finalFare])

  const cancelEdit = useCallback(() => {
    setIsEditing(false)
    setEditValue('')
  }, [])

  const handleSave = useCallback(async () => {
    setIsSaving(true)
    try {
      await onUpdateFare(entry.id, editValue)
      setIsEditing(false)
      setEditValue('')
    } finally {
      setIsSaving(false)
    }
  }, [entry.id, editValue, onUpdateFare])

  const route =
    entry.pickupAddress && entry.destinationAddress
      ? `${entry.pickupAddress} → ${entry.destinationAddress}`
      : 'Unknown route'

  return (
    <div className="card-elevated rounded-xl p-6">
      <div className="flex items-start justify-between gap-4">
        {/* Left: ride info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="font-bold text-foreground capitalize">{entry.service}</span>
            <span className="text-muted-foreground text-sm">•</span>
            <span className="text-sm text-muted-foreground" suppressHydrationWarning>
              {formatDate(entry.requestedAt)} {formatTime(entry.requestedAt)}
            </span>
          </div>

          <p className="text-sm text-muted-foreground truncate mb-3">{route}</p>

          <div className="flex items-center gap-4 flex-wrap">
            <div className="text-sm">
              <span className="text-muted-foreground">Est: </span>
              <span className="font-medium text-foreground">${entry.estimatedFare.toFixed(2)}</span>
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
                    if (e.key === 'Enter') void handleSave()
                    if (e.key === 'Escape') cancelEdit()
                  }}
                />
                <button
                  onClick={() => void handleSave()}
                  disabled={isSaving}
                  className="p-1 rounded text-secondary hover:bg-secondary/10 transition-colors disabled:opacity-50"
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
                <span className="font-medium text-foreground">${entry.finalFare.toFixed(2)}</span>
                <button
                  onClick={startEdit}
                  className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                  title="Edit fare"
                >
                  <Pencil className="w-3 h-3" />
                </button>
              </div>
            ) : (
              <button
                onClick={startEdit}
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
          {confirmDelete ? (
            <>
              <button
                onClick={() => void onDelete(entry.id)}
                className="px-3 py-1.5 rounded-lg bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors text-xs font-medium"
              >
                Confirm
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                className="p-1.5 rounded text-muted-foreground hover:bg-muted transition-colors"
                title="Cancel"
              >
                <X className="w-4 h-4" />
              </button>
            </>
          ) : (
            <button
              onClick={() => setConfirmDelete(true)}
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
}
