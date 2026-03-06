/**
 * AI Insights Service
 *
 * Transforms structured recommendation data into natural language
 * using Claude Haiku. Falls back to template strings if API is unavailable.
 */

import Anthropic from '@anthropic-ai/sdk'
import type { AIRecommendation } from '@/types'

// Daily quota tracking (resets at midnight UTC)
let dailyCallCount = 0
let lastResetDate = new Date().toISOString().split('T')[0]

const AI_DAILY_QUOTA = parseInt(process.env.AI_DAILY_QUOTA ?? '500', 10) || 500
const AI_RESPONSE_CACHE = new Map<string, { value: string[]; expiresAt: number }>()
const AI_CACHE_TTL_MS = 2 * 60 * 60 * 1000 // 2 hours
const MAX_AI_CACHE_SIZE = 200

function cleanupExpiredEntries<T>(cache: Map<string, { value: T; expiresAt: number }>): void {
  const now = Date.now()
  for (const [key, entry] of Array.from(cache.entries())) {
    if (entry.expiresAt <= now) cache.delete(key)
  }
}

function getAnthropicClient(): Anthropic | null {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return null
  return new Anthropic({ apiKey })
}

function resetDailyQuotaIfNeeded(): void {
  const today = new Date().toISOString().split('T')[0]
  if (today !== lastResetDate) {
    dailyCallCount = 0
    lastResetDate = today
  }
}

function isWithinQuota(): boolean {
  resetDailyQuotaIfNeeded()
  return dailyCallCount < AI_DAILY_QUOTA
}

/**
 * Generate a cache key from recommendation data points.
 */
function buildCacheKey(recommendations: AIRecommendation[]): string {
  return recommendations.map(r => `${r.type}:${JSON.stringify(r.dataPoints)}`).join('|')
}

/**
 * Build a prompt for Claude to generate natural language insights.
 * Privacy: only sends aggregated stats, no PII or raw addresses.
 */
function buildPrompt(recommendations: AIRecommendation[]): string {
  const recDescriptions = recommendations
    .map((rec, i) => {
      const dp = rec.dataPoints
      switch (rec.type) {
        case 'DEPARTURE_TIME':
          return `${i + 1}. DEPARTURE_TIME: Current avg price $${dp.currentPrice}, cheapest at ${dp.bestHour}:00 ($${dp.bestPrice}), potential savings $${dp.potentialSavings}`
        case 'SERVICE_CHOICE':
          return `${i + 1}. SERVICE_CHOICE: Best service "${dp.bestService}" is cheaper by $${dp.potentialSavings} (avg $${dp.bestPrice})`
        case 'SURGE_FORECAST':
          return `${i + 1}. SURGE_FORECAST: Surge likely to end by ${dp.surgeEndEstimate}`
        case 'SAVINGS_INSIGHT':
          return `${i + 1}. SAVINGS_INSIGHT: User saved $${dp.potentialSavings} from recommendations`
        default:
          return `${i + 1}. ${rec.type}: ${rec.message}`
      }
    })
    .join('\n')

  return `You are a concise ride pricing advisor. Given this data, write a 1-2 sentence actionable tip for each recommendation. Be friendly and specific. Include dollar amounts when available.

Recommendations to rewrite:
${recDescriptions}

Write ${recommendations.length} tips, one per line, numbered to match. Keep each under 25 words.`
}

/**
 * Generate template fallback messages (no AI needed).
 */
function generateTemplateMessages(recommendations: AIRecommendation[]): string[] {
  return recommendations.map(rec => {
    const dp = rec.dataPoints
    switch (rec.type) {
      case 'DEPARTURE_TIME':
        return dp.potentialSavings && dp.bestHour !== undefined
          ? `Prices for this route are typically ${dp.potentialSavings > 5 ? 'much ' : ''}cheaper at ${formatHour(dp.bestHour as number)}. You could save ~$${dp.potentialSavings}.`
          : rec.message
      case 'SERVICE_CHOICE':
        return dp.bestService && dp.potentialSavings
          ? `${capitalize(dp.bestService as string)} tends to be $${dp.potentialSavings} cheaper for this route on average.`
          : rec.message
      case 'SURGE_FORECAST':
        return dp.surgeEndEstimate
          ? `Surge pricing is typically over by ${dp.surgeEndEstimate}. Consider waiting for better rates.`
          : rec.message
      case 'SAVINGS_INSIGHT':
        return rec.message
      default:
        return rec.message
    }
  })
}

function formatHour(hour: number): string {
  if (hour === 0) return '12 AM'
  if (hour === 12) return '12 PM'
  if (hour < 12) return `${hour} AM`
  return `${hour - 12} PM`
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/**
 * Enhance recommendations with AI-generated natural language messages.
 * Falls back to templates if Claude API is unavailable or quota exceeded.
 *
 * @returns Updated recommendations with improved messages
 */
export async function enhanceWithAI(
  recommendations: AIRecommendation[]
): Promise<AIRecommendation[]> {
  if (recommendations.length === 0) return recommendations

  // Check cache first
  const cacheKey = buildCacheKey(recommendations)
  const cached = AI_RESPONSE_CACHE.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) {
    return recommendations.map((rec, i) => ({
      ...rec,
      message: cached.value[i] ?? rec.message,
    }))
  }

  // Try AI enhancement
  const client = getAnthropicClient()
  if (client && isWithinQuota()) {
    try {
      const prompt = buildPrompt(recommendations)
      dailyCallCount++

      const response = await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 150 * recommendations.length,
        temperature: 0.3,
        messages: [{ role: 'user', content: prompt }],
      })

      const text = response.content[0].type === 'text' ? response.content[0].text : ''

      // Parse numbered responses
      const lines = text
        .split('\n')
        .map(l => l.replace(/^\d+\.\s*/, '').trim())
        .filter(l => l.length > 0)

      if (lines.length >= recommendations.length) {
        // Cache AI responses
        cleanupExpiredEntries(AI_RESPONSE_CACHE)
        if (AI_RESPONSE_CACHE.size >= MAX_AI_CACHE_SIZE) {
          const firstKey = AI_RESPONSE_CACHE.keys().next().value
          if (firstKey) AI_RESPONSE_CACHE.delete(firstKey)
        }
        AI_RESPONSE_CACHE.set(cacheKey, {
          value: lines,
          expiresAt: Date.now() + AI_CACHE_TTL_MS,
        })

        return recommendations.map((rec, i) => ({
          ...rec,
          message: lines[i] ?? rec.message,
        }))
      }
    } catch (error) {
      console.warn('AI enhancement failed, falling back to templates:', error)
    }
  }

  // Fallback to templates
  const templateMessages = generateTemplateMessages(recommendations)

  // Cache template responses too (shorter TTL)
  cleanupExpiredEntries(AI_RESPONSE_CACHE)
  if (AI_RESPONSE_CACHE.size >= MAX_AI_CACHE_SIZE) {
    const firstKey = AI_RESPONSE_CACHE.keys().next().value
    if (firstKey) AI_RESPONSE_CACHE.delete(firstKey)
  }
  AI_RESPONSE_CACHE.set(cacheKey, {
    value: templateMessages,
    expiresAt: Date.now() + AI_CACHE_TTL_MS / 2,
  })

  return recommendations.map((rec, i) => ({
    ...rec,
    message: templateMessages[i] ?? rec.message,
  }))
}
