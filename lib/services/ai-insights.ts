/**
 * AI Insights Service
 *
 * Transforms structured recommendation data into natural language
 * using OpenAI gpt-4o-mini. Falls back to template strings if API is unavailable.
 */

import OpenAI from 'openai'
import type { AIRecommendation } from '@/types'
import { getCached, incrementQuotaCounter } from '@/lib/cache/redis-cache'

const AI_DAILY_QUOTA = parseInt(process.env.AI_DAILY_QUOTA ?? '500', 10) || 500
const AI_CACHE_TTL_SECONDS = 7200 // 2 hours

function getOpenAIClient(): OpenAI | null {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return null
  return new OpenAI({ apiKey })
}

/**
 * Generate a cache key from recommendation data points.
 */
function buildCacheKey(recommendations: AIRecommendation[]): string {
  return recommendations.map(r => `${r.type}:${JSON.stringify(r.dataPoints)}`).join('|')
}

/**
 * Build a prompt for OpenAI to generate natural language insights.
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
 * Falls back to templates if OpenAI API is unavailable or quota exceeded.
 *
 * @returns Updated recommendations with improved messages
 */
export async function enhanceWithAI(
  recommendations: AIRecommendation[]
): Promise<AIRecommendation[]> {
  if (recommendations.length === 0) return recommendations

  const aiCacheKey = `ai:${buildCacheKey(recommendations)}`

  const { value: messages } = await getCached<string[]>(
    aiCacheKey,
    AI_CACHE_TTL_SECONDS,
    async () => {
      // Check quota using atomic Redis counter
      const quotaKey = `quota:ai:${new Date().toISOString().split('T')[0]}`
      const currentCount = await incrementQuotaCounter(quotaKey)
      const withinQuota = currentCount <= AI_DAILY_QUOTA

      const client = getOpenAIClient()
      if (client && withinQuota) {
        try {
          const prompt = buildPrompt(recommendations)
          const response = await client.chat.completions.create({
            model: 'gpt-4o-mini',
            max_tokens: 150 * recommendations.length,
            temperature: 0.3,
            messages: [{ role: 'user', content: prompt }],
          })
          const text = response.choices[0]?.message?.content ?? ''
          const lines = text
            .split('\n')
            .map(l => l.replace(/^\d+\.\s*/, '').trim())
            .filter(l => l.length > 0)
          if (lines.length >= recommendations.length) {
            return lines
          }
        } catch {
          // Swallow — fall through to template fallback below
        }
      }

      // Template fallback (no AI or quota exceeded or parse failure)
      return generateTemplateMessages(recommendations)
    }
  )

  return recommendations.map((rec, i) => ({
    ...rec,
    message: messages[i] ?? rec.message,
  }))
}
