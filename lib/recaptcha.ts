/**
 * reCAPTCHA Enterprise Integration for Bot Protection
 *
 * Setup Instructions:
 * 1. Go to Google Cloud Console > reCAPTCHA Enterprise
 * 2. Create a key for your website
 * 3. Add your domains (localhost, your-domain.vercel.app)
 * 4. Create a Google Cloud API key with reCAPTCHA Enterprise API access
 * 5. Add keys to your environment variables:
 *    NEXT_PUBLIC_RECAPTCHA_SITE_KEY=your_site_key
 *    RECAPTCHA_API_KEY=your_google_cloud_api_key
 *    RECAPTCHA_PROJECT_ID=your_google_cloud_project_id
 */

// Get reCAPTCHA keys from environment
export const RECAPTCHA_SITE_KEY = process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY || ''
export const RECAPTCHA_API_KEY = process.env.RECAPTCHA_API_KEY || ''
export const RECAPTCHA_PROJECT_ID = process.env.RECAPTCHA_PROJECT_ID || ''

/**
 * Get the reCAPTCHA site key for the current environment
 */
export function getRecaptchaSiteKey(): string {
  const siteKey = process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY || RECAPTCHA_SITE_KEY

  if (!siteKey) {
    return ''
  }

  return siteKey
}

/**
 * Load reCAPTCHA Enterprise script with timeout protection
 */
export function loadRecaptchaScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    // Check if already loaded
    if (typeof window !== 'undefined' && window.grecaptcha?.enterprise) {
      resolve()
      return
    }

    const siteKey = getRecaptchaSiteKey()
    if (!siteKey) {
      reject(new Error('reCAPTCHA site key not configured'))
      return
    }

    // Timeout configuration
    const LOAD_TIMEOUT_MS = 10000
    const POLL_INTERVAL_MS = 100
    const MAX_POLL_COUNT = 50 // 5 seconds max (50 * 100ms)

    const timeoutId = setTimeout(() => {
      reject(new Error('reCAPTCHA script load timeout'))
    }, LOAD_TIMEOUT_MS)

    // Create script element for Enterprise
    const script = document.createElement('script')
    script.src = `https://www.google.com/recaptcha/enterprise.js?render=${siteKey}`
    script.async = true
    script.defer = true

    script.onload = () => {
      // Wait for grecaptcha.enterprise to be ready with poll limit
      let pollCount = 0

      const checkReady = () => {
        if (window.grecaptcha?.enterprise?.ready) {
          clearTimeout(timeoutId)
          window.grecaptcha.enterprise.ready(() => {
            resolve()
          })
        } else if (pollCount >= MAX_POLL_COUNT) {
          clearTimeout(timeoutId)
          reject(new Error('reCAPTCHA ready timeout'))
        } else {
          pollCount++
          setTimeout(checkReady, POLL_INTERVAL_MS)
        }
      }
      checkReady()
    }

    script.onerror = () => {
      clearTimeout(timeoutId)
      reject(new Error('Failed to load reCAPTCHA Enterprise script'))
    }

    document.head.appendChild(script)
  })
}

/**
 * Execute reCAPTCHA Enterprise and get token
 */
export async function executeRecaptcha(action: string = 'submit'): Promise<string> {
  if (typeof window === 'undefined') {
    throw new Error('reCAPTCHA can only be executed in browser environment')
  }

  const siteKey = getRecaptchaSiteKey()
  if (!siteKey) {
    throw new Error('reCAPTCHA site key not configured')
  }

  // Ensure reCAPTCHA is loaded
  await loadRecaptchaScript()

  return new Promise((resolve, reject) => {
    window.grecaptcha.enterprise.ready(() => {
      window.grecaptcha.enterprise
        .execute(siteKey, { action })
        .then((token: string) => {
          resolve(token)
        })
        .catch((error: Error) => {
          reject(error)
        })
    })
  })
}

/**
 * Verify reCAPTCHA Enterprise token on server side
 * Uses the Google Cloud reCAPTCHA Enterprise API
 */
export async function verifyRecaptchaToken(
  token: string,
  expectedAction: string = 'submit',
  minimumScore: number = 0.5
): Promise<{
  success: boolean
  score?: number
  action?: string
  error?: string
}> {
  try {
    const apiKey = process.env.RECAPTCHA_API_KEY
    const projectId = process.env.RECAPTCHA_PROJECT_ID
    const siteKey = process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY
    const isProduction = process.env.NODE_ENV === 'production'

    // Check required configuration
    if (!apiKey || !projectId || !siteKey) {
      const missing = []
      if (!apiKey) missing.push('RECAPTCHA_API_KEY')
      if (!projectId) missing.push('RECAPTCHA_PROJECT_ID')
      if (!siteKey) missing.push('NEXT_PUBLIC_RECAPTCHA_SITE_KEY')

      if (isProduction) {
        return {
          success: false,
          error: `reCAPTCHA Enterprise not properly configured: missing ${missing.join(', ')}`,
        }
      } else {
        // In development, allow through
        return {
          success: true,
          score: 1.0,
          action: expectedAction,
        }
      }
    }

    // Call the reCAPTCHA Enterprise Assessment API
    const assessmentUrl = `https://recaptchaenterprise.googleapis.com/v1/projects/${projectId}/assessments?key=${apiKey}`

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 5000)

    let response: Response
    try {
      response = await fetch(assessmentUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          event: {
            token: token,
            siteKey: siteKey,
            expectedAction: expectedAction,
          },
        }),
        signal: controller.signal,
      })
      clearTimeout(timeoutId)
    } catch (fetchError) {
      clearTimeout(timeoutId)
      if (fetchError instanceof Error && fetchError.name === 'AbortError') {
        return { success: false, score: 0, error: 'reCAPTCHA verification timed out' }
      }
      throw fetchError
    }

    if (!response.ok) {
      return {
        success: false,
        error: `reCAPTCHA Enterprise API request failed: ${response.status} ${response.statusText}`,
      }
    }

    const data = await response.json()

    // Check if token is valid
    if (!data.tokenProperties?.valid) {
      const invalidReason = data.tokenProperties?.invalidReason || 'Unknown'
      return {
        success: false,
        error: `reCAPTCHA token invalid: ${invalidReason}`,
      }
    }

    // Get the risk score (0.0 = bot, 1.0 = human)
    const score = data.riskAnalysis?.score ?? 0

    // Check action matches
    if (data.tokenProperties?.action !== expectedAction) {
      return {
        success: false,
        score,
        action: data.tokenProperties?.action,
        error: `Action mismatch: expected '${expectedAction}', got '${data.tokenProperties?.action}'`,
      }
    }

    // Check score threshold
    if (score < minimumScore) {
      return {
        success: false,
        score,
        action: data.tokenProperties?.action,
        error: `Score too low: ${score} < ${minimumScore}`,
      }
    }

    return {
      success: true,
      score,
      action: data.tokenProperties?.action,
    }
  } catch (error) {
    return {
      success: false,
      error: `reCAPTCHA verification error: ${error instanceof Error ? error.message : 'Unknown error'}`,
    }
  }
}

/**
 * reCAPTCHA configuration
 */
export const RECAPTCHA_CONFIG = {
  // Score thresholds (0.0 = bot, 1.0 = human)
  STRICT_THRESHOLD: 0.7, // High security
  NORMAL_THRESHOLD: 0.5, // Balanced
  LENIENT_THRESHOLD: 0.3, // Low friction

  // Actions
  ACTIONS: {
    RIDE_COMPARISON: 'ride_comparison',
    FORM_SUBMIT: 'form_submit',
    API_REQUEST: 'api_request',
  },
} as const

// Type declarations for window.grecaptcha (Enterprise)
declare global {
  interface Window {
    grecaptcha: {
      enterprise: {
        ready: (callback: () => void) => void
        execute: (siteKey: string, options: { action: string }) => Promise<string>
      }
    }
  }
}
