'use client'

import dynamic from 'next/dynamic'
import { ChartWrapper, CHART_COLORS, useChartTheme, ChartTooltip } from './chart-wrapper'
import type { RideServiceName } from '@/lib/service-mappings'

const LineChart = dynamic(() => import('recharts').then(m => m.LineChart), { ssr: false })
const Line = dynamic(() => import('recharts').then(m => m.Line), { ssr: false })
const XAxis = dynamic(() => import('recharts').then(m => m.XAxis), { ssr: false })
const YAxis = dynamic(() => import('recharts').then(m => m.YAxis), { ssr: false })
const CartesianGrid = dynamic(() => import('recharts').then(m => m.CartesianGrid), { ssr: false })
const Legend = dynamic(() => import('recharts').then(m => m.Legend), { ssr: false })
const ResponsiveContainer = dynamic(() => import('recharts').then(m => m.ResponsiveContainer), {
  ssr: false,
})
const Tooltip = dynamic(() => import('recharts').then(m => m.Tooltip), { ssr: false })

interface PriceTrendDataPoint {
  timestamp: string
  service_type: string
  final_price: number
  surge_multiplier: number
  weather_condition?: string | null
}

interface PriceTrendsChartProps {
  data: PriceTrendDataPoint[]
  activeServices?: RideServiceName[]
  loading?: boolean
}

function formatDate(iso: string) {
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function formatTime(iso: string) {
  const d = new Date(iso)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export function PriceTrendsChart({
  data,
  activeServices = ['uber', 'lyft', 'taxi', 'waymo'],
  loading,
}: PriceTrendsChartProps) {
  const { colors, theme } = useChartTheme()

  // Group data by timestamp to create multi-service lines
  const timeMap = new Map<string, Record<string, number>>()
  const sorted = [...data].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  )

  for (const point of sorted) {
    const key = point.timestamp
    const existing = timeMap.get(key) ?? {}
    existing[point.service_type] = point.final_price
    timeMap.set(key, existing)
  }

  const chartData = Array.from(timeMap.entries()).map(([timestamp, prices]) => ({
    timestamp,
    date: formatDate(timestamp),
    time: formatTime(timestamp),
    ...prices,
  }))

  const servicesWithData = activeServices.filter(s => data.some(d => d.service_type === s))

  return (
    <ChartWrapper
      loading={loading}
      isEmpty={chartData.length === 0}
      emptyMessage="No price data available yet"
      ariaLabel="7-Day Price Trends chart"
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={colors.grid} />
          <XAxis
            dataKey="date"
            stroke={colors.text}
            tick={{ fill: colors.text, fontSize: 12 }}
            tickLine={false}
          />
          <YAxis
            stroke={colors.text}
            tick={{ fill: colors.text, fontSize: 12 }}
            tickLine={false}
            tickFormatter={(v: number) => `$${v}`}
          />
          <Tooltip
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null
              const point = payload[0]?.payload as (typeof chartData)[number] | undefined
              return (
                <ChartTooltip
                  active={active}
                  payload={payload.map(p => ({
                    value: p.value as number,
                    name: String(p.name ?? ''),
                    color: p.color,
                  }))}
                  label={point ? `${point.date} ${point.time}` : String(label ?? '')}
                  formatter={(v: number) => `$${v.toFixed(2)}`}
                />
              )
            }}
          />
          <Legend />
          {servicesWithData.map(service => (
            <Line
              key={service}
              type="monotone"
              dataKey={service}
              stroke={CHART_COLORS[service]}
              strokeWidth={2}
              dot={chartData.length <= 20 ? { r: 3, fill: CHART_COLORS[service] } : false}
              activeDot={{ r: 5 }}
              name={service.charAt(0).toUpperCase() + service.slice(1)}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </ChartWrapper>
  )
}
