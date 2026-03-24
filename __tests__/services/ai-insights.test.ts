import { enhanceWithAI } from '@/lib/services/ai-insights'
import type { AIRecommendation } from '@/types'
import { getCached, incrementQuotaCounter } from '@/lib/cache/redis-cache'

// Mock redis-cache — pass-through by default (cache miss: always call compute)
jest.mock('@/lib/cache/redis-cache', () => ({
  getCached: jest.fn(async (_key: string, _ttl: number, compute: () => Promise<unknown>) => ({
    value: await compute(),
    cacheHit: false,
  })),
  incrementQuotaCounter: jest.fn().mockResolvedValue(1),
}))

const mockGetCached = getCached as jest.MockedFunction<typeof getCached>
const mockIncrementQuotaCounter = incrementQuotaCounter as jest.MockedFunction<
  typeof incrementQuotaCounter
>

// Mock OpenAI SDK
jest.mock('openai', () => {
  return jest.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: jest.fn().mockResolvedValue({
          choices: [
            {
              message: {
                content:
                  '1. Save $12 by riding at 2 PM instead.\n2. Switch to Lyft for this route to save 15% on average.\n3. Surge pricing typically drops after 8 PM.',
              },
            },
          ],
        }),
      },
    },
  }))
})

const sampleRecommendations: AIRecommendation[] = [
  {
    type: 'DEPARTURE_TIME',
    title: 'Better Time to Ride',
    message: 'Prices drop ~$12 at 2 PM (48% cheaper than now)',
    confidence: 0.85,
    dataPoints: {
      potentialSavings: 12,
      bestHour: 14,
      currentPrice: 25,
      bestPrice: 13,
    },
  },
  {
    type: 'SERVICE_CHOICE',
    title: 'Best Service for This Route',
    message: 'Lyft is 15% cheaper for this route',
    confidence: 0.8,
    dataPoints: {
      bestService: 'lyft',
      potentialSavings: 3.5,
      bestPrice: 18.5,
    },
  },
  {
    type: 'SURGE_FORECAST',
    title: 'Surge Likely to End Soon',
    message: 'Surge typically ends by 8 PM',
    confidence: 0.7,
    dataPoints: {
      surgeEndEstimate: '8 PM',
      bestHour: 20,
    },
  },
]

describe('AI Insights Service', () => {
  const originalEnv = process.env

  beforeEach(() => {
    jest.clearAllMocks()
    process.env = { ...originalEnv }
    // Restore default pass-through (cache miss) behavior for getCached
    mockGetCached.mockImplementation(
      async (_key: string, _ttl: number, compute: () => Promise<unknown>) => ({
        value: await compute(),
        cacheHit: false,
      })
    )
    // Restore default quota counter (within quota)
    mockIncrementQuotaCounter.mockResolvedValue(1)
  })

  afterEach(() => {
    process.env = originalEnv
  })

  it('returns original messages when no API key is configured', async () => {
    delete process.env.OPENAI_API_KEY

    const result = await enhanceWithAI(sampleRecommendations)

    expect(result).toHaveLength(3)
    // Should use template fallbacks, not original messages
    expect(result[0].type).toBe('DEPARTURE_TIME')
    expect(result[1].type).toBe('SERVICE_CHOICE')
    expect(result[2].type).toBe('SURGE_FORECAST')
  })

  it('returns template-enhanced messages when API key is set but SDK is mocked', async () => {
    process.env.OPENAI_API_KEY = 'sk-openai-test-key'

    const result = await enhanceWithAI(sampleRecommendations)

    expect(result).toHaveLength(3)
    expect(result[0].type).toBe('DEPARTURE_TIME')
    // Template fallback should include price and time info
    expect(result[0].message).toContain('2 PM')
    expect(result[0].message).toContain('$12')
  })

  it('returns empty array for empty input', async () => {
    const result = await enhanceWithAI([])
    expect(result).toEqual([])
  })

  it('preserves recommendation structure', async () => {
    process.env.OPENAI_API_KEY = 'sk-openai-test-key'

    const result = await enhanceWithAI(sampleRecommendations)

    for (const rec of result) {
      expect(rec).toHaveProperty('type')
      expect(rec).toHaveProperty('title')
      expect(rec).toHaveProperty('message')
      expect(rec).toHaveProperty('confidence')
      expect(rec).toHaveProperty('dataPoints')
    }
  })

  it('uses template fallbacks when API key is missing', async () => {
    delete process.env.OPENAI_API_KEY

    const recs: AIRecommendation[] = [
      {
        type: 'DEPARTURE_TIME',
        title: 'Test',
        message: 'Original message',
        confidence: 0.8,
        dataPoints: { potentialSavings: 5, bestHour: 14 },
      },
    ]

    const result = await enhanceWithAI(recs)

    expect(result[0].message).toContain('cheaper')
    expect(result[0].message).toContain('2 PM')
  })

  it('generates appropriate templates for each recommendation type', async () => {
    delete process.env.OPENAI_API_KEY

    const allTypes: AIRecommendation[] = [
      {
        type: 'DEPARTURE_TIME',
        title: 'Time',
        message: '',
        confidence: 0.8,
        dataPoints: { potentialSavings: 8, bestHour: 14 },
      },
      {
        type: 'SERVICE_CHOICE',
        title: 'Service',
        message: '',
        confidence: 0.8,
        dataPoints: { bestService: 'lyft', potentialSavings: 3 },
      },
      {
        type: 'SURGE_FORECAST',
        title: 'Surge',
        message: '',
        confidence: 0.7,
        dataPoints: { surgeEndEstimate: '8 PM' },
      },
      {
        type: 'SAVINGS_INSIGHT',
        title: 'Savings',
        message: 'You saved $47',
        confidence: 0.95,
        dataPoints: { potentialSavings: 47 },
      },
    ]

    const result = await enhanceWithAI(allTypes)

    expect(result[0].message).toContain('2 PM')
    expect(result[1].message).toContain('Lyft')
    expect(result[2].message).toContain('8 PM')
    expect(result[3].message).toContain('$47')
  })

  describe('quota counter', () => {
    it('blocks AI call and uses templates when quota is exceeded', async () => {
      process.env.OPENAI_API_KEY = 'sk-openai-test-key'
      // Return a count that exceeds AI_DAILY_QUOTA (default 500)
      mockIncrementQuotaCounter.mockResolvedValue(501)

      const OpenAI = jest.requireMock('openai') as jest.Mock
      const mockCreate = OpenAI.mock.results[0]?.value?.chat?.completions?.create

      const result = await enhanceWithAI(sampleRecommendations)

      // incrementQuotaCounter should be called
      expect(mockIncrementQuotaCounter).toHaveBeenCalledWith(
        expect.stringMatching(/^quota:ai:\d{4}-\d{2}-\d{2}$/)
      )

      // AI client should NOT be called since quota exceeded
      if (mockCreate) {
        expect(mockCreate).not.toHaveBeenCalled()
      }

      // Template fallback should be used — DEPARTURE_TIME message contains price/time info
      expect(result[0].message).toContain('2 PM')
      expect(result[0].message).toContain('$12')
    })

    it('calls AI when quota is within limit — incrementQuotaCounter returns 1', async () => {
      process.env.OPENAI_API_KEY = 'sk-openai-test-key'
      mockIncrementQuotaCounter.mockResolvedValue(1)

      // Make OpenAI return parseable AI responses (3 lines for 3 recs)
      const OpenAI = jest.requireMock('openai') as jest.Mock
      const instance = new OpenAI()
      instance.chat.completions.create.mockResolvedValue({
        choices: [
          {
            message: {
              content:
                '1. Ride at 2 PM to save $12 on this trip.\n2. Switch to Lyft to save $3.50 on average.\n3. Surge ends by 8 PM — wait if you can.',
            },
          },
        ],
      })

      // Re-instantiate with fresh mock
      OpenAI.mockImplementation(() => instance)

      const result = await enhanceWithAI(sampleRecommendations)

      expect(mockIncrementQuotaCounter).toHaveBeenCalledWith(
        expect.stringMatching(/^quota:ai:\d{4}-\d{2}-\d{2}$/)
      )
      expect(result).toHaveLength(3)
    })

    it('uses UTC date format for quota key', async () => {
      delete process.env.OPENAI_API_KEY

      await enhanceWithAI(sampleRecommendations)

      const expectedDate = new Date().toISOString().split('T')[0]
      expect(mockIncrementQuotaCounter).toHaveBeenCalledWith(`quota:ai:${expectedDate}`)
    })
  })

  describe('getCached integration', () => {
    it('getCached hit path — compute not called — recommendations returned from cache', async () => {
      const cachedMessages = ['Cached message 1', 'Cached message 2', 'Cached message 3']

      // Simulate a cache hit — compute is never called
      mockGetCached.mockResolvedValueOnce({ value: cachedMessages, cacheHit: true })

      const result = await enhanceWithAI(sampleRecommendations)

      expect(result).toHaveLength(3)
      expect(result[0].message).toBe('Cached message 1')
      expect(result[1].message).toBe('Cached message 2')
      expect(result[2].message).toBe('Cached message 3')

      // incrementQuotaCounter should NOT be called on a cache hit
      // (it's inside the compute callback which wasn't invoked)
      expect(mockIncrementQuotaCounter).not.toHaveBeenCalled()
    })

    it('getCached is called with ai: prefixed key and correct TTL', async () => {
      delete process.env.OPENAI_API_KEY

      await enhanceWithAI(sampleRecommendations)

      expect(mockGetCached).toHaveBeenCalledWith(
        expect.stringMatching(/^ai:/),
        7200,
        expect.any(Function)
      )
    })
  })
})
