import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Bell, X } from 'lucide-react'
import ModalPortal from './ModalPortal'

interface PriceAlertProps {
  currentBestPrice: number
  onSetAlert: (threshold: number) => void
  onClose: () => void
}

export default function PriceAlert({ currentBestPrice, onSetAlert, onClose }: PriceAlertProps) {
  const [threshold, setThreshold] = useState(Math.max(currentBestPrice - 5, 5))
  const [isSubmitting, setIsSubmitting] = useState(false)
  const thresholdInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    thresholdInputRef.current?.focus()

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
    }

    const originalOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', handleKeyDown)

    return () => {
      document.body.style.overflow = originalOverflow
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (threshold >= currentBestPrice) {
      toast.error('Alert threshold must be lower than current best price!')
      return
    }

    setIsSubmitting(true)
    try {
      onSetAlert(threshold)

      if ('Notification' in window && Notification.permission === 'default') {
        await Notification.requestPermission()
      }

      toast.success(
        `Price alert set! You'll be notified when rides drop below $${threshold.toFixed(2)}`
      )
      onClose()
    } catch {
      toast.error('Failed to set price alert. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <ModalPortal>
      <div
        className="fixed inset-0 bg-background/90 flex items-center justify-center z-50 p-4"
        role="presentation"
        onClick={onClose}
      >
        <div
          className="card-elevated rounded-xl p-6 max-w-md w-full"
          role="dialog"
          aria-modal="true"
          aria-labelledby="price-alert-title"
          onClick={event => event.stopPropagation()}
        >
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
                <Bell className="h-5 w-5 text-primary" />
              </div>
              <h3 id="price-alert-title" className="text-xl font-bold text-foreground">
                Set Price Alert
              </h3>
            </div>
            <button
              onClick={onClose}
              className="text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Close price alert dialog"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="mb-6">
            <p className="text-muted-foreground mb-2">
              Current best price:{' '}
              <strong className="text-foreground">${currentBestPrice.toFixed(2)}</strong>
            </p>
            <p className="text-sm text-muted-foreground">
              We&apos;ll notify you when any ride option drops below your threshold.
            </p>
          </div>

          <form onSubmit={handleSubmit}>
            <div className="mb-6">
              <label htmlFor="threshold" className="block text-sm font-medium text-foreground mb-2">
                Alert me when prices drop below:
              </label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 transform -translate-y-1/2 text-muted-foreground">
                  $
                </span>
                <input
                  ref={thresholdInputRef}
                  type="number"
                  id="threshold"
                  value={threshold}
                  onChange={e => setThreshold(Number(e.target.value))}
                  className="w-full pl-8 pr-4 py-3 bg-muted border border-border rounded-lg text-foreground focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all outline-none"
                  min="1"
                  max={currentBestPrice - 0.01}
                  step="0.01"
                  required
                />
              </div>
            </div>

            <div className="flex gap-3">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 py-3 px-4 card-interactive rounded-lg text-muted-foreground hover:text-foreground transition-all"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="flex-1 py-3 px-4 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 transition-all font-semibold"
              >
                {isSubmitting ? 'Setting...' : 'Set Alert'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </ModalPortal>
  )
}
