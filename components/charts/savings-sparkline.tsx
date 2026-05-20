'use client'

import dynamic from 'next/dynamic'
import { ChartWrapper } from './chart-wrapper'

const AreaChart = dynamic(() => import('recharts').then(m => m.AreaChart), { ssr: false })
const Area = dynamic(() => import('recharts').then(m => m.Area), { ssr: false })
const ResponsiveContainer = dynamic(() => import('recharts').then(m => m.ResponsiveContainer), {
  ssr: false,
})

interface SavingsSparklineProps {
  data: number[]
  color?: string
  className?: string
}

export function SavingsSparkline({ data, color = '#22c55e', className }: SavingsSparklineProps) {
  const chartData = data.map((value, index) => ({ index, value }))

  const hasValidData = data.some(v => v !== 0)

  return (
    <ChartWrapper
      isEmpty={!hasValidData}
      emptyMessage="No spending trend data yet"
      ariaLabel="Savings trend mini chart"
      height={60}
      className={className}
    >
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={chartData} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
          <Area
            type="monotone"
            dataKey="value"
            stroke={color}
            fill={color}
            fillOpacity={0.15}
            strokeWidth={1.5}
            dot={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </ChartWrapper>
  )
}
