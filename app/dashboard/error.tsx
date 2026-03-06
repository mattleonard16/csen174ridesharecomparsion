'use client'

export default function DashboardError({
  error: _error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <div className="max-w-md w-full rounded-2xl border border-destructive/20 bg-destructive/5 p-6 text-center">
        <h2 className="text-2xl font-semibold text-foreground mb-2">Dashboard unavailable</h2>
        <p className="text-muted-foreground mb-6">
          We couldn&apos;t render your analytics view. Retry the page and your saved data will be
          requested again.
        </p>
        <button
          onClick={reset}
          className="px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          Reload dashboard
        </button>
      </div>
    </div>
  )
}
