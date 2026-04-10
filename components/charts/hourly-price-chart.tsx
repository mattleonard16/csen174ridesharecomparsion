'use client'

import dynamic from 'next/dynamic'
import { ChartWrapper, useChartTheme, ChartTooltip } from './chart-wrapper'

const BarChart = dynamic(() => import('recharts').then(m => m.BarChart), { ssr: false })
const Bar = dynamic(() => import('recharts').then(m => m.Bar), { ssr: false })
const XAxis = dynamic(() => import('recharts').then(m => m.XAxis), { ssr: false })
const YAxis = dynamic(() => import('recharts').then(m => m.YAxis), { ssr: false })
const CartesianGrid = dynamic(() => import('recharts').then(m => m.CartesianGrid), { ssr: false })
const ResponsiveContainer = dynamic(() => import('recharts').then(m => m.ResponsiveContainer), {
  ssr: false,
})
const Tooltip = dynamic(() => import('recharts').then(m => m.Tooltip), { ssr: false })
const ReferenceLine = dynamic(() => import('recharts').then(m => m.ReferenceLine), { ssr: false })

interface HourlyAverage {
  hour: number
  avg_price: number
}

interface HourlyPriceChartProps {
  data: HourlyAverage[]
  loading?: boolean
}

function getBarColor(price: number, avg: number) {
  if (price < avg * 0.85) return '#22c55e' // green - cheap
  if (price > avg * 1.15) return '#ef4444' // red - expensive
  return '#f59e0b' // yellow/amber - moderate
}

export function HourlyPriceChart({ data, loading }: HourlyPriceChartProps) {
  const { colors } = useChartTheme()

  const avgPrice = data.length > 0 ? data.reduce((s, d) => s + d.avg_price, 0) / data.length : 0

  const chartData = data.map(d => ({
    hour: `${d.hour}:00`,
    avgPrice: d.avg_price,
    fill: getBarColor(d.avg_price, avgPrice),
  }))

  return (
    <ChartWrapper
      loading={loading}
      isEmpty={chartData.length === 0}
      emptyMessage="No hourly data available yet"
      ariaLabel="Best Times to Ride chart"
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={colors.grid} />
          <XAxis
            dataKey="hour"
            stroke={colors.text}
            tick={{ fill: colors.text, fontSize: 11 }}
            tickLine={false}
          />
          <YAxis
            stroke={colors.text}
            tick={{ fill: colors.text, fontSize: 12 }}
            tickLine={false}
            tickFormatter={(v: number) => `$${v}`}
          />
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null
              return (
                <ChartTooltip
                  active={active}
                  payload={payload.map(p => ({
                    value: p.value as number,
                    name: 'Avg Price',
                    color: p.color,
                  }))}
                  label={payload[0]?.payload?.hour as string}
                  formatter={(v: number) => `$${v.toFixed(2)}`}
                />
              )
            }}
          />
          {avgPrice > 0 && (
            <ReferenceLine
              y={avgPrice}
              stroke={colors.text}
              strokeDasharray="5 5"
              label={{ value: `Avg $${avgPrice.toFixed(0)}`, fill: colors.text, fontSize: 11 }}
            />
          )}
          <Bar dataKey="avgPrice" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </ChartWrapper>
  )
}
