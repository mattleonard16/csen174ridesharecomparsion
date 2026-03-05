/**
 * Monitoring and observability utilities
 * Integrates with Sentry for error tracking and Axiom for structured logging
 */

import { prisma } from '@/lib/prisma'

interface LogContext {
  userId?: string
  routeId?: string
  service?: string
  [key: string]: any
}

interface ErrorContext extends LogContext {
  error: Error
  level?: 'error' | 'warning' | 'info'
}

/**
 * Structured logging utility
 * In production, sends to Axiom or similar service
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
 * Error tracking utility
 * In production, sends to Sentry
 */
export function logError(context: ErrorContext) {
  const { error, level = 'error', ...rest } = context

  // Always log to console in development
  if (process.env.NODE_ENV === 'development') {
    console.error('[ERROR]', {
      message: error.message,
      stack: error.stack,
      ...rest,
    })
  }

  // Send to Sentry in production
  if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
    // Sentry would be initialized in _app.tsx or layout.tsx
    // TODO: Integrate actual Sentry SDK when available
    // import * as Sentry from '@sentry/nextjs'
    // Sentry.captureException(error, { extra: rest, level })
  }

  // Also log to structured logging
  log(`Error: ${error.message}`, {
    level,
    stack: error.stack,
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
async function sendToAxiom(logEntry: any) {
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
