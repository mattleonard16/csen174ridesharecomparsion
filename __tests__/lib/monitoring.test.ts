import { healthCheck } from '@/lib/monitoring'

jest.mock('@/lib/prisma', () => ({
  prisma: {
    $queryRawUnsafe: jest.fn(),
  },
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

  it('reports healthy when database and OSRM checks succeed', async () => {
    prisma.$queryRawUnsafe.mockResolvedValue([{ '?column?': 1 }])

    const result = await healthCheck()

    expect(result.status).toBe('healthy')
    expect(prisma.$queryRawUnsafe).toHaveBeenCalledWith('SELECT 1')
    expect(result.checks.database.healthy).toBe(true)
    expect(result.checks.osrm.healthy).toBe(true)
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
})
