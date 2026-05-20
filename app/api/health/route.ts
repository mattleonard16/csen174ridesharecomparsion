import { NextRequest, NextResponse } from 'next/server'
import { handleOptions, withCors } from '@/lib/cors'
import { healthCheck } from '@/lib/monitoring'

async function handleGet(_request: NextRequest) {
  try {
    const health = await healthCheck()

    const statusCode = health.status === 'healthy' ? 200 : health.status === 'degraded' ? 200 : 503

    return NextResponse.json(health, { status: statusCode })
  } catch (error) {
    return NextResponse.json(
      {
        status: 'unhealthy',
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 503 }
    )
  }
}

export const GET = withCors(handleGet)
export const OPTIONS = handleOptions
