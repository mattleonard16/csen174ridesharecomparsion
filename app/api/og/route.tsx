import { ImageResponse } from 'next/og'
import type { NextRequest } from 'next/server'

export const runtime = 'edge'

const WIDTH = 1200
const HEIGHT = 630

function clamp(value: string | null, max = 60): string {
  if (!value) return ''
  const trimmed = value.trim()
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const pickup = clamp(searchParams.get('pickup')) || 'Pickup'
  const destination = clamp(searchParams.get('dest')) || 'Destination'
  const price = clamp(searchParams.get('price'), 12) || '—'
  const service = clamp(searchParams.get('service'), 16) || 'Best ride'

  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 60%, #312e81 100%)',
        color: '#f8fafc',
        padding: '64px',
        fontFamily: 'sans-serif',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          fontSize: 28,
          color: '#a5b4fc',
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
        }}
      >
        <span style={{ fontSize: 36 }}>◇</span>
        Comparative Rideshares
      </div>

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          marginTop: '60px',
          gap: '8px',
        }}
      >
        <div style={{ fontSize: 36, color: '#cbd5e1' }}>{pickup}</div>
        <div style={{ fontSize: 48, color: '#64748b' }}>↓</div>
        <div style={{ fontSize: 36, color: '#cbd5e1' }}>{destination}</div>
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
          marginTop: 'auto',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <div style={{ fontSize: 24, color: '#94a3b8' }}>Best estimate</div>
          <div style={{ fontSize: 36, color: '#f8fafc', fontWeight: 600 }}>{service}</div>
        </div>
        <div
          style={{
            fontSize: 144,
            fontWeight: 700,
            color: '#34d399',
            lineHeight: 1,
            letterSpacing: '-0.04em',
          }}
        >
          {price}
        </div>
      </div>
    </div>,
    {
      width: WIDTH,
      height: HEIGHT,
    }
  )
}
