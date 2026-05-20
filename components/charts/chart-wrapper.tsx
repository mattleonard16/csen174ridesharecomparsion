'use client'

import { useSyncExternalStore, type ReactNode } from 'react'
import { useTheme } from 'next-themes'
import { ResponsiveContainer } from 'recharts'

// ============================================================================
// Theme-aware colors
// ============================================================================

export const CHART_COLORS = {
  uber: '#276EF1',
  lyft: '#FF00BF',
  taxi: '#FFB800',
  waymo: '#00D084',
} as const

export const CHART_THEME = {
  light: {
    grid: '#e5e7eb',
    text: '#374151',
    tooltipBg: '#ffffff',
    tooltipBorder: '#e5e7eb',
    tooltipText: '#111827',
  },
  dark: {
    grid: '#374151',
    text: '#9ca3af',
    tooltipBg: '#1f2937',
    tooltipBorder: '#374151',
    tooltipText: '#f9fafb',
  },
} as const

export function useChartTheme() {
  const { resolvedTheme } = useTheme()
  const theme = resolvedTheme === 'dark' ? 'dark' : 'light'
  return { colors: CHART_THEME[theme], theme }
}

// ============================================================================
// Chart Wrapper
// ============================================================================

interface ChartWrapperProps {
  children: ReactNode
  height?: number
  loading?: boolean
  isEmpty?: boolean
  emptyMessage?: string
  ariaLabel?: string
  className?: string
}

/**
 * Wraps Recharts with dynamic import handling, responsive container,
 * loading/empty states, and theme integration.
 */
export function ChartWrapper({
  children,
  height = 300,
  loading = false,
  isEmpty = false,
  emptyMessage = 'No data available',
  ariaLabel = 'Chart',
  className,
}: ChartWrapperProps) {
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  )

  if (!mounted || loading) {
    return (
      <div
        className={`flex items-center justify-center ${className ?? ''}`}
        style={{ height }}
        role="img"
        aria-label={ariaLabel}
      >
        <div
          className={
            mounted
              ? 'animate-spin rounded-full h-8 w-8 border-2 border-primary border-t-transparent'
              : 'animate-pulse text-muted-foreground text-sm'
          }
        >
          {!mounted && 'Loading chart...'}
        </div>
      </div>
    )
  }

  if (isEmpty) {
    return (
      <div
        className={`flex flex-col items-center justify-center text-muted-foreground ${className ?? ''}`}
        style={{ height }}
        role="img"
        aria-label={ariaLabel}
      >
        <svg
          className="w-8 h-8 mb-2 opacity-30"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M3 13h2v8H3zM9 8h2v13H9zM15 11h2v10h-2zM21 4h2v17h-2z"
          />
        </svg>
        <p className="text-sm">{emptyMessage}</p>
      </div>
    )
  }

  return (
    <div className={className} style={{ height }} role="img" aria-label={ariaLabel}>
      {children}
    </div>
  )
}

// ============================================================================
// Shared Tooltip
// ============================================================================

interface ChartTooltipProps {
  active?: boolean
  payload?: Array<{ value?: number; name?: string; color?: string }>
  label?: string
  formatter?: (value: number, name: string) => string
}

export function ChartTooltip({ active, payload, label, formatter }: ChartTooltipProps) {
  const { colors } = useChartTheme()

  if (!active || !payload?.length) return null

  return (
    <div
      className="rounded-lg border px-3 py-2 shadow-md text-sm"
      style={{
        backgroundColor: colors.tooltipBg,
        borderColor: colors.tooltipBorder,
        color: colors.tooltipText,
      }}
    >
      {label && <p className="font-medium mb-1">{label}</p>}
      {payload.map((entry: (typeof payload)[number], index: number) => (
        <p key={index} style={{ color: entry.color }}>
          {entry.name}:{' '}
          {formatter && entry.value != null
            ? formatter(entry.value, entry.name ?? '')
            : entry.value}
        </p>
      ))}
    </div>
  )
}
