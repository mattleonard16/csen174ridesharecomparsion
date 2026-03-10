/**
 * Monitoring and observability utilities
 * Integrates with Axiom for structured logging
 */

import { prisma } from '@/lib/prisma'
import { redis } from '@/lib/redis'

interface LogContext {
  userId?: string
  routeId?: string
  service?: string
  level?: string
  stack?: string
  errorName?: string
  duration?: number
  metric?: string
  [key: string]: string | number | boolean | undefined | null
}

interface ErrorContext {
  error: Error
  userId?: string
  routeId?: string
  service?: string
  [key: string]: unknown
}

/**
 * Structured logging utility
 * In production, sends to Axiom
 */
export function log(message: string, context?: LogContext) {
  const timestamp = new Date().toISOString()
  const logEntry = {
    timestamp,
    message,
    ...context,
  }

  // In development, log to console
  if (process.env.NODE_ENV === 'development') {
    console.debug('[LOG]', logEntry)
  }

  // In production, send to Axiom
  if (process.env.AXIOM_TOKEN && process.env.AXIOM_DATASET) {
    sendToAxiom(logEntry).catch(console.error)
  }
}

/**
 * Error tracking utility — always routes to Axiom structured logging
 * No Sentry stub: the Sentry SDK is not installed in this project
 */
export function logError(context: ErrorContext) {
  const { error, ...rest } = context

  // Always log to console in development
  if (process.env.NODE_ENV === 'development') {
    console.error('[ERROR]', {
      message: error.message,
      stack: error.stack,
      ...rest,
    })
  }

  // Route all errors to Axiom structured logging — no Sentry stub
  log(`Error: ${error.message}`, {
    level: 'error',
    stack: error.stack,
    errorName: error.name,
    ...rest,
  })
}

/**
 * Performance monitoring
 */
export function trackPerformance(metric: string, duration: number, context?: LogContext) {
  log(`Performance: ${metric}`, {
    duration,
    metric,
    ...context,
  })
}

/**
 * Send logs to Axiom
 */
async function sendToAxiom(logEntry: LogContext & { timestamp: string; message: string }) {
  const axiomToken = process.env.AXIOM_TOKEN
  const axiomDataset = process.env.AXIOM_DATASET

  if (!axiomToken || !axiomDataset) {
    return
  }

  try {
    await fetch(`https://api.axiom.co/v1/datasets/${axiomDataset}/ingest`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${axiomToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify([logEntry]),
    })
  } catch (error) {
    // Fail silently to avoid cascading errors
    console.error('Failed to send to Axiom:', error)
  }
}

/**
 * Health check utility
 */
export async function healthCheck() {
  const checks = {
    timestamp: new Date().toISOString(),
    status: 'healthy' as 'healthy' | 'degraded' | 'unhealthy',
    checks: {
      database: await checkDatabase(),
      redis: await checkRedis(),
      osrm: await checkOSRM(),
    },
  }

  const failedChecks = Object.values(checks.checks).filter(check => !check.healthy).length
  if (failedChecks === Object.keys(checks.checks).length) {
    checks.status = 'unhealthy'
  } else if (failedChecks > 0) {
    checks.status = 'degraded'
  }

  return checks
}

async function checkDatabase(): Promise<{ healthy: boolean; latency?: number; error?: string }> {
  if (!process.env.DATABASE_URL) {
    return { healthy: false, error: 'DATABASE_URL is not configured' }
  }

  const start = Date.now()

  try {
    await prisma.$queryRawUnsafe('SELECT 1')
    return { healthy: true, latency: Date.now() - start }
  } catch (error) {
    return {
      healthy: false,
      latency: Date.now() - start,
      error: error instanceof Error ? error.message : 'Unknown database error',
    }
  }
}

async function checkRedis(): Promise<{ healthy: boolean; latency?: number; error?: string }> {
  if (!redis) {
    return { healthy: false, error: 'Redis not configured' }
  }

  const start = Date.now()
  try {
    await redis.ping()
    return { healthy: true, latency: Date.now() - start }
  } catch (error) {
    return {
      healthy: false,
      latency: Date.now() - start,
      error: error instanceof Error ? error.message : 'Unknown Redis error',
    }
  }
}

async function checkOSRM(): Promise<{ healthy: boolean; latency?: number; error?: string }> {
  const start = Date.now()
  try {
    const response = await fetch(
      'https://router.project-osrm.org/route/v1/driving/-122.4194,37.7749;-122.2711,37.8044?overview=false',
      { signal: AbortSignal.timeout(5000) }
    )
    const latency = Date.now() - start
    return response.ok
      ? { healthy: true, latency }
      : { healthy: false, latency, error: `OSRM returned ${response.status}` }
  } catch (error) {
    return {
      healthy: false,
      latency: Date.now() - start,
      error: error instanceof Error ? error.message : 'Unknown OSRM error',
    }
  }
}
