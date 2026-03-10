import { healthCheck, logError, log } from '@/lib/monitoring'

jest.mock('@/lib/prisma', () => ({
  prisma: {
    $queryRawUnsafe: jest.fn(),
  },
}))

jest.mock('@/lib/redis', () => ({
  redis: null,
}))

const { prisma } = jest.requireMock('@/lib/prisma') as {
  prisma: { $queryRawUnsafe: jest.Mock }
}

describe('monitoring health checks', () => {
  const originalFetch = global.fetch
  const originalDatabaseUrl = process.env.DATABASE_URL
  const originalAbortTimeout = AbortSignal.timeout

  beforeEach(() => {
    jest.clearAllMocks()
    process.env.DATABASE_URL = 'postgres://example'
    ;(AbortSignal as typeof AbortSignal & { timeout: (ms: number) => AbortSignal }).timeout = jest
      .fn()
      .mockReturnValue(undefined as unknown as AbortSignal)
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
    } as Response)
  })

  afterEach(() => {
    process.env.DATABASE_URL = originalDatabaseUrl
  })

  afterAll(() => {
    global.fetch = originalFetch
    ;(AbortSignal as typeof AbortSignal & { timeout: typeof AbortSignal.timeout }).timeout =
      originalAbortTimeout
  })

  it('reports degraded when database and OSRM succeed but Redis is unconfigured', async () => {
    // Redis is mocked as null (not configured) at the module level, so status is always degraded
    prisma.$queryRawUnsafe.mockResolvedValue([{ '?column?': 1 }])

    const result = await healthCheck()

    expect(result.status).toBe('degraded')
    expect(prisma.$queryRawUnsafe).toHaveBeenCalledWith('SELECT 1')
    expect(result.checks.database.healthy).toBe(true)
    expect(result.checks.osrm.healthy).toBe(true)
    expect(result.checks.redis.healthy).toBe(false)
  })

  it('reports degraded when a single dependency fails', async () => {
    prisma.$queryRawUnsafe.mockRejectedValue(new Error('DB down'))

    const result = await healthCheck()

    expect(result.status).toBe('degraded')
    expect(result.checks.database.healthy).toBe(false)
    expect(result.checks.osrm.healthy).toBe(true)
  })

  it('reports unhealthy when every dependency fails', async () => {
    prisma.$queryRawUnsafe.mockRejectedValue(new Error('DB down'))
    global.fetch = jest.fn().mockRejectedValue(new Error('OSRM timeout'))

    const result = await healthCheck()

    expect(result.status).toBe('unhealthy')
    expect(result.checks.database.healthy).toBe(false)
    expect(result.checks.osrm.healthy).toBe(false)
  })

  it('fails the database probe when DATABASE_URL is missing', async () => {
    delete process.env.DATABASE_URL

    const result = await healthCheck()

    expect(result.checks.database.healthy).toBe(false)
    expect(result.checks.database.error).toContain('DATABASE_URL')
  })

  describe('Redis health check', () => {
    it('returns healthy: false and includes redis in checks when redis is null (not configured)', async () => {
      prisma.$queryRawUnsafe.mockResolvedValue([{ '?column?': 1 }])

      const result = await healthCheck()

      expect(result.checks).toHaveProperty('redis')
      expect(result.checks.redis.healthy).toBe(false)
      expect(result.checks.redis.error).toMatch(/not configured/i)
    })

    it('reports degraded when only redis fails (database + OSRM healthy)', async () => {
      prisma.$queryRawUnsafe.mockResolvedValue([{ '?column?': 1 }])

      // redis is mocked as null (not configured), so redis check fails
      const result = await healthCheck()

      expect(result.status).toBe('degraded')
      expect(result.checks.database.healthy).toBe(true)
      expect(result.checks.osrm.healthy).toBe(true)
      expect(result.checks.redis.healthy).toBe(false)
    })

    it('reports unhealthy when all checks fail including redis', async () => {
      prisma.$queryRawUnsafe.mockRejectedValue(new Error('DB down'))
      global.fetch = jest.fn().mockRejectedValue(new Error('OSRM timeout'))
      // redis is null (not configured) - also fails

      const result = await healthCheck()

      expect(result.status).toBe('unhealthy')
      expect(result.checks.redis.healthy).toBe(false)
    })
  })
})

describe('logError', () => {
  let axiomCalls: unknown[]

  beforeEach(() => {
    axiomCalls = []
    // Capture Axiom fetch calls to verify log() was called with level: error
    process.env.AXIOM_TOKEN = 'test-token'
    process.env.AXIOM_DATASET = 'test-dataset'
    global.fetch = jest.fn().mockImplementation((url: string, opts: RequestInit) => {
      if (typeof url === 'string' && url.includes('axiom')) {
        const body = JSON.parse(opts.body as string)
        axiomCalls.push(...body)
      }
      return Promise.resolve({ ok: true, status: 200 } as Response)
    })
  })

  afterEach(() => {
    delete process.env.AXIOM_TOKEN
    delete process.env.AXIOM_DATASET
  })

  it('sends log entry with level: error and stack fields — no Sentry branch', async () => {
    const testError = new Error('test error')
    logError({ error: testError })

    // Allow async Axiom flush
    await new Promise(resolve => setTimeout(resolve, 10))

    expect(axiomCalls.length).toBeGreaterThan(0)
    const entry = axiomCalls[0] as Record<string, unknown>
    expect(entry.level).toBe('error')
    expect(entry.stack).toBe(testError.stack)
    expect(entry.message).toContain('test error')
  })

  it('always routes to Axiom regardless of NEXT_PUBLIC_SENTRY_DSN', async () => {
    const savedSentryDsn = process.env.NEXT_PUBLIC_SENTRY_DSN
    delete process.env.NEXT_PUBLIC_SENTRY_DSN

    const testError = new Error('sentry-free error')
    logError({ error: testError })

    await new Promise(resolve => setTimeout(resolve, 10))

    expect(axiomCalls.length).toBeGreaterThan(0)
    const entry = axiomCalls[0] as Record<string, unknown>
    expect(entry.level).toBe('error')
    expect(entry.message).toContain('sentry-free error')

    process.env.NEXT_PUBLIC_SENTRY_DSN = savedSentryDsn
  })
})
