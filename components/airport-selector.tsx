'use client'

import { useEffect, useRef } from 'react'
import { MapPin, Plane } from 'lucide-react'
import { getPopularAirports } from '@/lib/airports'
import ModalPortal from './ModalPortal'

export interface AirportSelectorProps {
  isOpen: boolean
  onClose: () => void
  onSelect: (airportCode: string, airportName: string) => void
  mode: 'pickup' | 'destination'
}

/**
 * AirportSelector - Modal component for selecting an airport as pickup or destination
 */
export function AirportSelector({ isOpen, onClose, onSelect, mode }: AirportSelectorProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!isOpen) return

    closeButtonRef.current?.focus()

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
  }, [isOpen, onClose])

  if (!isOpen) return null

  const airports = getPopularAirports()

  return (
    <ModalPortal>
      <div
        className="fixed inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center z-50 p-4"
        role="presentation"
        onClick={onClose}
      >
        <div
          className="glass-card rounded-2xl max-w-md w-full max-h-[80vh] overflow-hidden shadow-xl border border-border/50"
          role="dialog"
          aria-modal="true"
          aria-labelledby="airport-selector-title"
          onClick={event => event.stopPropagation()}
        >
          {/* Header */}
          <div className="p-6 border-b border-border/50">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                  <Plane className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <div
                    id="airport-selector-title"
                    className="font-semibold text-foreground text-lg"
                  >
                    Select Airport
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {mode === 'pickup' ? 'Pickup' : 'Destination'} location
                  </div>
                </div>
              </div>
              <button
                ref={closeButtonRef}
                onClick={onClose}
                className="text-muted-foreground hover:text-foreground transition-colors w-8 h-8 flex items-center justify-center rounded-full hover:bg-muted"
                aria-label="Close airport selector"
              >
                <span className="text-xl leading-none">&times;</span>
              </button>
            </div>
          </div>

          {/* Airport List */}
          <div className="p-3 max-h-80 overflow-y-auto">
            <div className="grid grid-cols-1 gap-2">
              {airports.map(airport => (
                <button
                  key={airport.code}
                  onClick={() => onSelect(airport.code, airport.name)}
                  className="p-4 text-left hover:bg-muted/50 rounded-xl transition-all duration-200 group"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <div className="font-medium text-foreground group-hover:text-primary transition-colors">
                        {airport.code} - {airport.name}
                      </div>
                      <div className="text-sm text-muted-foreground mt-0.5">
                        {airport.city}, {airport.state}
                      </div>
                      {airport.terminals.length > 1 && (
                        <div className="text-xs text-primary/70 mt-1">
                          {airport.terminals.length} terminals
                        </div>
                      )}
                    </div>
                    <MapPin className="h-4 w-4 text-muted-foreground group-hover:text-primary ml-2 transition-colors" />
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Footer */}
          <div className="p-4 border-t border-border/50 bg-muted/30">
            <div className="text-xs text-muted-foreground text-center">
              Don&apos;t see your airport? Use the search field above.
            </div>
          </div>
        </div>
      </div>
    </ModalPortal>
  )
}
