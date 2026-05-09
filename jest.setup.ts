import '@testing-library/jest-dom'

// Mock next-auth/react
jest.mock('next-auth/react', () => ({
  useSession: jest.fn(() => ({
    data: null,
    status: 'unauthenticated',
  })),
  signIn: jest.fn(),
  signOut: jest.fn(),
  getSession: jest.fn(() => Promise.resolve(null)),
  SessionProvider: ({ children }: { children: React.ReactNode }) => children,
}))

// Mock @/auth
jest.mock('@/auth', () => ({
  auth: jest.fn(() => Promise.resolve(null)),
  signIn: jest.fn(),
  signOut: jest.fn(),
  handlers: {
    GET: jest.fn(),
    POST: jest.fn(),
  },
}))

// Mock fetch globally
global.fetch = jest.fn()

// Navigator-related mocks only apply to jsdom-style environments. Node test
// environments (used for API route tests via `@jest-environment node`) don't
// expose a global `navigator` on Node 20, so guard the access — touching
// `navigator` directly would throw ReferenceError before any test runs.
if (typeof navigator !== 'undefined') {
  Object.defineProperty(navigator, 'geolocation', {
    value: {
      getCurrentPosition: jest.fn(),
    },
    writable: true,
  })

  Object.defineProperty(navigator, 'vibrate', {
    value: jest.fn(),
    writable: true,
  })

  Object.defineProperty(navigator, 'share', {
    value: jest.fn(),
    writable: true,
  })

  Object.defineProperty(navigator, 'canShare', {
    value: jest.fn(),
    writable: true,
  })

  Object.defineProperty(navigator, 'clipboard', {
    value: {
      writeText: jest.fn(),
    },
    writable: true,
  })
}
