'use client'

const CLIENT_SESSION_STORAGE_KEY = 'ridecompare-client-session-id'

function createSessionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  return `session-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

export function getClientSessionId(): string | null {
  if (typeof window === 'undefined') {
    return null
  }

  try {
    const existing = window.localStorage.getItem(CLIENT_SESSION_STORAGE_KEY)
    if (existing) {
      return existing
    }

    const nextId = createSessionId()
    window.localStorage.setItem(CLIENT_SESSION_STORAGE_KEY, nextId)
    return nextId
  } catch {
    return null
  }
}
