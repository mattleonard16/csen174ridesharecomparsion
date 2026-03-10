# Testing Patterns

**Analysis Date:** 2026-03-10

## Test Framework

**Runner:**

- Jest 29.x with `jest-environment-jsdom`
- Config: `jest.config.js` (wraps Next.js Jest config via `next/jest`)

**Assertion Library:**

- `@testing-library/jest-dom` — DOM matchers (`toBeInTheDocument`, `toBeVisible`)
- `@testing-library/react` 16.x — component rendering utilities
- `@testing-library/user-event` 14.x — realistic user interaction simulation
- Built-in Jest matchers for service/API tests

**E2E Framework:**

- Playwright 1.57.x
- Config: `playwright.config.ts`
- Chromium only (Desktop Chrome device)

**Run Commands:**

```bash
npm test                  # Run all Jest tests
npm run test:watch        # Jest watch mode
npm run test:e2e          # Playwright E2E against dev server (port 3100)
npm run test:e2e:ui       # Playwright UI mode
npm run test:e2e:headed   # Playwright headed mode
npm run quality           # typecheck + lint + format:check + test (full CI gate)
```

## Test File Organization

**Location:**

- Jest unit/integration tests: `__tests__/` at repository root, mirroring source structure
- E2E tests: `e2e/` at repository root
- Fixtures: `__tests__/fixtures/` (JSON data files)

**Naming:**

- Unit/integration: `{source-name}.test.ts` or `{source-name}.test.tsx`
- E2E: `{feature}.spec.ts`

**Directory structure:**

```
__tests__/
├── api/                    # API route handler tests
│   ├── compare-rides-route.test.ts
│   ├── dashboard-route.test.ts
│   ├── price-alerts-route.test.ts
│   └── recommendation-actions-route.test.ts
├── app/                    # Next.js app-level tests
│   └── layout-metadata.test.ts
├── components/             # React component tests
│   ├── ui/
│   │   └── map.test.tsx
│   ├── 3d-adaptive-navigation-bar.test.tsx
│   ├── RouteMapClient.test.tsx
│   ├── ride-comparison-form.test.tsx
│   └── ride-comparison-results.test.tsx
├── fixtures/               # Shared JSON test data
│   └── uberSamples.json
├── lib/                    # Utility/library tests
│   ├── dom.test.ts
│   ├── pricing.test.ts
│   └── validation.test.ts
└── services/               # Service layer tests
    ├── ai-insights.test.ts
    ├── recommendations.test.ts
    └── ride-comparison.test.ts

e2e/
├── home-smoke.spec.ts
├── map-route.spec.ts
├── nav-smoke.spec.ts
└── popular-route-click.spec.ts
```

## Test Suite Structure

**Nested `describe` grouping by function/feature, then behavior:**

```typescript
describe('ride-comparison service', () => {
  describe('compareRidesByAddresses', () => {
    it('should geocode addresses and return comparison results', async () => { ... })
    it('should fail with a typed address error when geocoding returns no results', async () => { ... })
  })

  describe('caching behavior', () => {
    it('should cache geocoding results', async () => { ... })
  })

  describe('resilient fetch behavior', () => {
    it('should retry failed requests', async () => { ... })
  })
})
```

**Lifecycle hooks:**

- `beforeAll` — global setup (swap global `fetch`)
- `afterAll` — restore globals
- `beforeEach` — clear mocks (`jest.clearAllMocks()`), reset caches, switch to fake timers
- `afterEach` — flush pending timers (`jest.runOnlyPendingTimers()`), restore real timers

**Test naming convention:** `it('should <verb> <outcome> when <condition>')` for positive paths; `it('fails with <error> when <condition>')` for error paths.

## Mocking

**Framework:** Jest built-in mocking (`jest.mock`, `jest.fn`, `jest.spyOn`)

**Module mocking pattern:**

```typescript
// At top of file, before imports (Jest hoists these)
jest.mock('@/lib/database', () => ({
  findOrCreateRoute: jest.fn(async () => 'mock-route-id'),
  logPriceSnapshot: jest.fn(async () => undefined),
  logSearch: jest.fn(async () => undefined),
}))

// Cast to MockedFunction for type-safe call assertions
const mockCompareRides = compareRidesByAddresses as jest.MockedFunction<
  typeof compareRidesByAddresses
>
```

**Global fetch mocking:**

```typescript
// In setup file (jest.setup.ts)
global.fetch = jest.fn()

// In test file — replace globally per test suite
const mockFetch = jest.fn()
beforeAll(() => {
  global.fetch = mockFetch
})
afterAll(() => {
  global.fetch = originalFetch
})
beforeEach(() => {
  mockFetch.mockReset()
})
```

**AbortSignal simulation (for timeout tests):**

```typescript
mockFetch.mockImplementation((_url: string, init?: RequestInit) => {
  const signal = init?.signal as AbortSignal | undefined
  return new Promise((_, reject) => {
    signal?.addEventListener('abort', () => {
      const abortError = new Error('This operation was aborted')
      abortError.name = 'AbortError'
      reject(abortError)
    })
  })
})
```

**Fake timers for async/timeout tests:**

```typescript
beforeEach(() => {
  jest.useFakeTimers()
})
afterEach(() => {
  jest.runOnlyPendingTimers()
  jest.useRealTimers()
})

// Advance time to trigger timeout:
const promise = someAsyncOperation()
await jest.advanceTimersByTimeAsync(7000)
const result = await promise
```

**React component mocking:**

```typescript
jest.mock('next/dynamic', () => ({
  __esModule: true,
  default: () =>
    function DynamicStub() {
      return <div data-testid="route-map-stub" />
    },
}))

// Lightweight inline mock components
jest.mock('@/components/location-input', () => ({
  LocationInput: ({ id, label, value, onChange }: Props) => (
    <div>
      <label htmlFor={id}>{label}</label>
      <input id={id} aria-label={label} value={value} onChange={e => onChange(e.target.value)} />
    </div>
  ),
}))
```

**Global setup mocks (applied to all tests via `jest.setup.ts`):**

- `next-auth/react` — `useSession` returns unauthenticated state
- `@/auth` — `auth()` returns `null`
- `global.fetch` — set to `jest.fn()`
- `navigator.geolocation`, `navigator.vibrate`, `navigator.share`, `navigator.clipboard` — all mocked

**What to Mock:**

- All external API calls (Nominatim, OSRM) — never make real HTTP calls in tests
- Database layer (`lib/database`, `lib/prisma`) — always mock Prisma client
- `next-auth` and `@/auth` — always mock authentication
- Third-party SDKs (`maplibre-gl`, `next/dynamic`) in component tests
- `lib/services/*` in API route tests — mock entire service modules

**What NOT to Mock:**

- The module being tested itself
- Pure utility functions (`lib/validation.ts`, `lib/geo.ts`) — test real implementations
- Zod schemas — test real schema behavior in validation tests

## Fixtures and Factories

**JSON fixtures:**

- Location: `__tests__/fixtures/uberSamples.json`
- Used for static sample API response data

**Inline factory functions in test files:**

```typescript
// Factory pattern for building test data objects
function createInsights(overrides: Partial<InsightsData> = {}) {
  return {
    cheapestHour: 14,
    cheapestAvgPrice: 12.5,
    expensiveHour: 8,
    expensiveAvgPrice: 25.0,
    ...overrides,
  }
}

// Shared request builder
function createRequest(body: object, ip: string) {
  return new NextRequest('http://localhost:3000/api/compare-rides', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify(body),
  })
}
```

**Mock API response constants — defined at file scope:**

```typescript
const MOCK_NOMINATIM_RESPONSE = [{ lat: '37.7749', lon: '-122.4194' }]
const MOCK_OSRM_RESPONSE = {
  code: 'Ok',
  routes: [{ distance: 5000, duration: 600 }],
}
```

**Test coordinate fixtures defined as named constants:**

```typescript
const COORDS = {
  regular: [-122.45, 37.75] as Coordinates,
  downtownSF: [-122.405, 37.79] as Coordinates,
  sfo: [-122.379, 37.6213] as Coordinates,
}
```

## Coverage

**Requirements:** No enforced coverage threshold configured in `jest.config.js`

**View Coverage:**

```bash
npm test -- --coverage
```

## Test Types

**Unit Tests (`__tests__/lib/`, `__tests__/services/`):**

- Test individual functions and class methods in isolation
- Mock all dependencies
- High granularity: one `it` per distinct behavior/branch
- Include boundary conditions: empty arrays, null returns, max values

**Integration Tests (`__tests__/api/`, `__tests__/components/`):**

- API route tests: instantiate real `NextRequest`, import real route handler, mock service/DB layer
- Component tests: use `@testing-library/react` `render()` with mocked children and hooks
- Test full request/response cycle including status codes and JSON body

**E2E Tests (`e2e/`):**

- Playwright against real dev server (`http://localhost:3100`)
- `page.route('**/api/compare-rides', ...)` used to intercept and stub API responses
- All specs use `test.setTimeout(30000)` given cold dev-server start
- Viewport testing for mobile via `browser.newContext({ viewport: { width: 390, height: 844 } })`
- `page.waitForLoadState('networkidle')` before asserting UI state

## Common Patterns

**Async Testing:**

```typescript
// waitFor for eventual UI updates
await waitFor(() => {
  expect(screen.getByText('Results loaded: $21.00')).toBeInTheDocument()
})

// Async API route responses
expect(response.status).toBe(200)
await expect(response.json()).resolves.toMatchObject({
  routeId: 'route-123',
})
```

**Error Testing:**

```typescript
// Typed error assertions with rejects.toMatchObject
await expect(compareRidesByAddresses('Invalid Address', 'Oakland, CA')).rejects.toMatchObject({
  code: 'ADDRESS_NOT_FOUND',
})

// HTTP error status assertion
const response = await POST(createRequest({ pickup: 'bad', destination: 'ok' }, '10.0.0.1'))
expect(response.status).toBe(400)
await expect(response.json()).resolves.toMatchObject({ code: 'ADDRESS_NOT_FOUND' })
```

**Node environment for API route tests:**

```typescript
/** @jest-environment node */
// Required at top of API route test files to override jsdom default
```

**Cache isolation between tests:**

```typescript
beforeEach(() => {
  resetRideComparisonCaches() // exported test helper to clear module-level Maps
})
```

**Regex matchers for text content:**

```typescript
// Case-insensitive screen queries
screen.getByLabelText(/pickup location/i)
screen.getByRole('button', { name: /compare rides/i })

// Response body matching
await expect(response.json()).resolves.toMatchObject({
  routeWarning: expect.stringMatching(/estimated route metrics/i),
})
```

---

_Testing analysis: 2026-03-10_
