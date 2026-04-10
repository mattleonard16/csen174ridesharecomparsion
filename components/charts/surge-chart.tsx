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

interface SurgeInsight {
  hour: number
  probability: number
}

interface SurgeChartProps {
  data: SurgeInsight[]
  loading?: boolean
}

function getSurgeColor(probability: number) {
  if (probability > 0.7) return '#ef4444' // red - high surge risk
  if (probability > 0.4) return '#f59e0b' // amber - moderate
  return '#22c55e' // green - low risk
}

export function SurgeChart({ data, loading }: SurgeChartProps) {
  const { colors } = useChartTheme()

  const chartData = data.map(d => ({
    hour: `${d.hour}:00`,
    probability: Math.round(d.probability * 100),
    fill: getSurgeColor(d.probability),
  }))

  return (
    <ChartWrapper
      loading={loading}
      isEmpty={chartData.length === 0}
      emptyMessage="No surge data available yet"
      ariaLabel="Surge Insights chart"
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
            tickFormatter={(v: number) => `${v}%`}
            domain={[0, 100]}
          />
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null
              return (
                <ChartTooltip
                  active={active}
                  payload={payload.map(p => ({
                    value: p.value as number,
                    name: 'Surge Probability',
                    color: p.color,
                  }))}
                  label={payload[0]?.payload?.hour as string}
                  formatter={(v: number) => `${v}%`}
                />
              )
            }}
          />
          <ReferenceLine
            y={50}
            stroke="#f59e0b"
            strokeDasharray="5 5"
            label={{ value: '50% threshold', fill: '#f59e0b', fontSize: 11 }}
          />
          <Bar dataKey="probability" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </ChartWrapper>
  )
}
