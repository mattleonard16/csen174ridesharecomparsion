# Phase 1: Foundation - Research

**Researched:** 2026-03-10
**Domain:** Jest test infrastructure, Axiom observability, Next.js health checks
**Confidence:** HIGH

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| TEST-01 | Jest setup file loads correctly (`setupFilesAfterEnv` typo fixed) | Confirmed typo in `jest.config.js` line 10: `setupFilesAfterSetup` → `setupFilesAfterEnv`. One-line fix. Official Next.js Jest docs confirm the correct key. |
| TEST-02 | Coverage config measures full codebase (components, lib, hooks — not just app/api/ and lib/services/) | Current `collectCoverageFrom` has 3 entries covering ~30% of actual code. Expanding to `components/**` and `lib/**` globs is a config-only change. |
| OBSV-01 | Health check endpoint probes real database connectivity with measured latency | `lib/monitoring.ts` `checkDatabase()` already runs `prisma.$queryRawUnsafe('SELECT 1')` and measures latency — it is NOT a stub (CONCERNS.md was outdated). The real gap is Redis is absent from `healthCheck()`. |
| OBSV-02 | Health check endpoint probes Redis connectivity with measured latency | `healthCheck()` in `lib/monitoring.ts` has `database` and `osrm` checks but no Redis check. Need to add `checkRedis()` using `redis.ping()` from `lib/redis.ts`. |
| OBSV-03 | Error tracking captures production errors via Axiom (`@axiomhq/nextjs`; Sentry stub replaced) | `lib/monitoring.ts` `logError()` has dead Sentry stub (lines 60–65). No `@axiomhq/*` packages installed. Must install and wire `@axiomhq/js @axiomhq/logging @axiomhq/nextjs`. |
| OBSV-04 | Cache hit/miss events visible as structured entries in Axiom logs | Existing `log()` function in `lib/monitoring.ts` sends to Axiom via raw `fetch`. Cache calls use `log()` but without structured `event: "cache_hit"` / `event: "cache_miss"` fields. Need structured log fields, not free-text messages. |
</phase_requirements>

## Summary

Phase 1 has two independent tracks: fix Jest so tests are trustworthy, and wire real observability so production errors are visible. Neither track depends on the other. Both tracks make changes to a small number of files with well-understood, documented solutions.

**Test track (TEST-01, TEST-02):** The entire test infrastructure is broken by a single typo on line 10 of `jest.config.js` — `setupFilesAfterSetup` is not a valid Jest key. Jest silently ignores it, `jest.setup.ts` never loads, and every `toBeInTheDocument()` assertion in the codebase throws "not a function". Fixing the typo is a one-character correction. The coverage config fix is a glob expansion — no new packages, no new test files.

**Observability track (OBSV-01 through OBSV-04):** Three distinct gaps. First, `healthCheck()` probes DB (real, working) and OSRM but has no Redis check — adding one requires a 15-line function using the existing `lib/redis.ts` client. Second, `logError()` has a dead Sentry stub that should be replaced with a direct Axiom structured log at `level: "error"`. Third, cache operations use unstructured free-text logging; the fix is adding an `event` field to distinguish hit/miss. The `@axiomhq/nextjs` package stack (three packages) replaces the manual `sendToAxiom` fetch call with a proper transport, but this is an enhancement — the core fixes (Redis health check, logError cleanup, structured cache logs) can be done without changing the Axiom transport at all.

**Primary recommendation:** Fix the Jest typo first (unlocks all test validation), then add Redis health check, then clean up `logError` and structured cache logging. The Axiom package upgrade is optional for this phase — the existing raw-fetch Axiom approach is functional.

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `jest` | 29.7.0 (existing) | Test runner | Already installed; no upgrade needed for this phase |
| `@testing-library/jest-dom` | 6.6.3 (existing) | DOM matchers (`toBeInTheDocument`) | Already installed; broken only because setup file never loads |
| `@upstash/redis` | 1.35.7 (existing) | Redis client for health probe | Already used for rate limiting; `redis.ping()` is the health check method |
| `@axiomhq/js` | latest (new install) | Core Axiom API client | Required peer for `@axiomhq/logging`; handles token auth and dataset ingest |
| `@axiomhq/logging` | latest (new install) | Logger with `AxiomJSTransport` | Provides `Logger` class with transport abstraction; replaces manual `sendToAxiom` fetch |
| `@axiomhq/nextjs` | latest (new install) | Next.js route handler wrapper | `createAxiomRouteHandler` + `createOnRequestError`; replaces Sentry stub pattern |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@axiomhq/react` | latest (optional) | Client-side error boundary flush | Only needed if adding a React error boundary in `app/error.tsx`; not required for Phase 1 |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `@axiomhq/nextjs` package upgrade | Keep manual `sendToAxiom` fetch | Manual fetch works but lacks `onError` middleware, `instrumentation.ts` hook, and typed transport. Upgrade is cleaner but not strictly required for the success criteria. |
| `@axiomhq/nextjs` | `@sentry/nextjs` | Sentry adds webpack plugin overhead, source-map uploads, second billing account. Out of scope per REQUIREMENTS.md. |

**Installation:**
```bash
npm install @axiomhq/js @axiomhq/logging @axiomhq/nextjs
```

## Architecture Patterns

### Pattern 1: Jest `setupFilesAfterEnv` Fix

**What:** Rename the misspelled key in `jest.config.js` so `jest.setup.ts` is actually loaded.

**When to use:** This is a one-time fix, not a recurring pattern.

**The fix:**
```javascript
// jest.config.js — line 10
// BEFORE (broken):
setupFilesAfterSetup: ['<rootDir>/jest.setup.ts'],

// AFTER (correct):
setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
```

Verify with:
```bash
npx jest --showConfig | grep setupFilesAfterEnv
# Should show: [ '<rootDir>/jest.setup.ts' ]
```

### Pattern 2: Coverage Glob Expansion

**What:** Expand `collectCoverageFrom` to include `components/**` and full `lib/**`.

**When to use:** One-time config update; do not add `coverageProvider` as a separate concern — can be bundled.

```javascript
// jest.config.js
collectCoverageFrom: [
  'app/api/**/*.{ts,tsx}',
  'components/**/*.{ts,tsx}',
  'lib/**/*.{ts,tsx}',
  'hooks/**/*.{ts,tsx}',
  '!**/*.d.ts',
  '!lib/generated/**',
  '!lib/prisma.ts',   // Prisma singleton — not unit-testable in isolation
],
coverageProvider: 'v8',  // Faster than babel, recommended by Next.js docs
```

**Important exclusion:** `lib/generated/**` must be excluded — Prisma generated client is auto-generated code, not authored code.

### Pattern 3: Redis Health Check

**What:** Add `checkRedis()` to `lib/monitoring.ts` and include it in `healthCheck()`.

**When to use:** Redis is nullable (`lib/redis.ts` exports `redis | null`). The check must handle the unconfigured case gracefully.

```typescript
// lib/monitoring.ts — add this function
async function checkRedis(): Promise<{ healthy: boolean; latency?: number; error?: string }> {
  if (!redis) {
    return { healthy: false, error: 'Redis not configured' }
  }
  const start = Date.now()
  try {
    await redis.ping()
    return { healthy: true, latency: Date.now() - start }
  } catch (error) {
    return {
      healthy: false,
      latency: Date.now() - start,
      error: error instanceof Error ? error.message : 'Unknown Redis error',
    }
  }
}

// Update healthCheck() to include redis:
checks: {
  database: await checkDatabase(),
  redis: await checkRedis(),
  osrm: await checkOSRM(),
},
```

### Pattern 4: `logError` Sentry Stub Removal

**What:** Remove the dead `NEXT_PUBLIC_SENTRY_DSN` branch from `logError()` and ensure the Axiom path always fires for `level: "error"`.

**Option A — Minimal (no new packages):** Replace Sentry stub with an explicit Axiom structured log that forces `level: "error"`:

```typescript
// lib/monitoring.ts
export function logError(context: ErrorContext) {
  const { error, level = 'error', ...rest } = context

  if (process.env.NODE_ENV === 'development') {
    console.error('[ERROR]', { message: error.message, stack: error.stack, ...rest })
  }

  // Remove Sentry stub entirely. Send structured error log to Axiom.
  log(`Error: ${error.message}`, {
    level: 'error',   // Always force error level, ignore passed-in level for errors
    stack: error.stack,
    errorName: error.name,
    ...rest,
  })
}
```

**Option B — Full Axiom SDK (with new packages):** Set up `lib/axiom/server.ts` with `Logger` + `AxiomJSTransport`, update `sendToAxiom` to use the transport, and wrap route handlers with `createAxiomRouteHandler`. This is the recommended long-term approach per official Axiom docs but is optional for the Phase 1 success criteria.

**For Phase 1, Option A satisfies success criterion 4.** Option B is a quality-of-life improvement.

### Pattern 5: Structured Cache Logging

**What:** When cache operations log hit/miss, include `event` and `cacheKey` fields so Axiom queries can group by event type.

**When to use:** Wherever cache hits/misses are currently logged in services.

```typescript
// Cache hit — structured fields that Axiom can query on
log('Cache hit', {
  event: 'cache_hit',
  cacheKey: 'geocode:san francisco',
  cacheLayer: 'memory',  // or 'redis' after Phase 2
})

// Cache miss
log('Cache miss', {
  event: 'cache_miss',
  cacheKey: 'geocode:san francisco',
  cacheLayer: 'memory',
})
```

**Axiom query to verify:**
```
['your-dataset'] | where event == "cache_hit" or event == "cache_miss" | summarize count() by event
```

### Pattern 6: Axiom SDK Setup (Option B — full upgrade)

If the team opts for the full `@axiomhq/nextjs` integration:

```typescript
// lib/axiom/axiom.ts
import { Axiom } from '@axiomhq/js'
export default new Axiom({ token: process.env.AXIOM_TOKEN! })
```

```typescript
// lib/axiom/server.ts
import axiomClient from './axiom'
import { Logger, AxiomJSTransport } from '@axiomhq/logging'
import { createAxiomRouteHandler, nextJsFormatters } from '@axiomhq/nextjs'

export const logger = new Logger({
  transports: [
    new AxiomJSTransport({
      axiom: axiomClient,
      dataset: process.env.NEXT_PUBLIC_AXIOM_DATASET!,
    }),
  ],
  formatters: nextJsFormatters,
})

export const withAxiom = createAxiomRouteHandler(logger)
```

```typescript
// instrumentation.ts (Next.js App Router convention — root of project)
import { logger } from '@/lib/axiom/server'
import { createOnRequestError } from '@axiomhq/nextjs'
export const onRequestError = createOnRequestError(logger)
```

### Anti-Patterns to Avoid

- **Do not use `setupFilesAfterSetup`, `setupFilesAfterEach`, or `setupFilesAfterFramework`** — none of these are valid Jest keys. Only `setupFilesAfterEnv` works.
- **Do not add `coverageThreshold` in this phase** — there are no enforced thresholds currently; adding one before coverage is measured would cause CI failures on pre-existing untested code.
- **Do not run `redis.ping()` in the request path of non-health routes** — the Redis check is health-endpoint-only; avoid adding latency to comparison requests.
- **Do not check `NEXT_PUBLIC_SENTRY_DSN`** — the variable is not set and the Sentry SDK is not installed; this branch provides false confidence. Remove the check entirely.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Axiom log transport | Custom `sendToAxiom` fetch loop | `AxiomJSTransport` from `@axiomhq/logging` | Handles batching, retries, flush-on-shutdown, auth; the manual fetch has none of these |
| Route handler error capture | Try/catch wrapper in every route file | `createAxiomRouteHandler` from `@axiomhq/nextjs` | Middleware approach is 1 line per route; manual wrapping duplicates error-handling logic |
| Coverage calculation | Manual line counting | `npm test -- --coverage` with `collectCoverageFrom` | Jest/V8 coverage is accurate and integrates with CI; manual counting drifts |

**Key insight:** The Sentry stub pattern was a hand-rolled "I'll wire this up later" placeholder. Replacing it with a real transport (even the simple Option A approach) is the correct move — don't create a new placeholder.

## Common Pitfalls

### Pitfall 1: Jest Silently Ignores Unknown Config Keys
**What goes wrong:** `setupFilesAfterSetup` passes schema validation in Jest 29 (Jest does not error on unknown config keys). `jest.setup.ts` never loads. All `jest-dom` matchers throw "not a function" at runtime, not at config parse time.
**Why it happens:** Jest uses loose config parsing; typos in key names produce no warning.
**How to avoid:** After fixing the key, run `npx jest --showConfig | grep setupFilesAfterEnv` to confirm the path appears in the output before running any tests.
**Warning signs:** `expect(...).toBeInTheDocument is not a function` errors in component tests.

### Pitfall 2: `lib/generated/**` in Coverage Globs
**What goes wrong:** If `lib/generated/**` is not excluded from `collectCoverageFrom`, Prisma's generated client (hundreds of files) appears in coverage reports with 0% coverage, making overall coverage look catastrophically low.
**Why it happens:** `lib/**/*.{ts,tsx}` matches generated files unless explicitly excluded.
**How to avoid:** Add `'!lib/generated/**'` to the exclusion list in `collectCoverageFrom`.
**Warning signs:** Coverage report shows hundreds of files under `lib/generated/prisma/`.

### Pitfall 3: Redis `null` Dereference in Health Check
**What goes wrong:** `lib/redis.ts` exports `redis` as `Redis | null`. Calling `redis.ping()` without a null check throws at runtime if Redis env vars are not configured.
**Why it happens:** The existing pattern for Redis use (in `lib/rate-limiter.ts`) always guards with `if (!redis)` before use.
**How to avoid:** The `checkRedis()` function must check `if (!redis)` and return `{ healthy: false, error: 'Redis not configured' }` before attempting any Redis call.
**Warning signs:** TypeScript compiler will catch this if strict null checks are enabled — the type of `redis` is `Redis | null`.

### Pitfall 4: `sendToAxiom` Fires in Tests
**What goes wrong:** If `sendToAxiom` (or the Axiom SDK transport) is not mocked in tests, every test that calls `log()` or `logError()` will attempt a real HTTP call to `https://api.axiom.co`. In CI without `AXIOM_TOKEN`, these fail silently (the current implementation catches errors). With the SDK, they may throw.
**Why it happens:** `log()` and `logError()` are used in service modules that are not always mocked at the monitoring layer.
**How to avoid:** Add `jest.mock('@/lib/monitoring', () => ({ log: jest.fn(), logError: jest.fn(), trackPerformance: jest.fn() }))` to any test file that exercises code paths calling these functions. The existing test suite already does this for service tests.
**Warning signs:** Test output shows "Failed to send to Axiom" warnings; slow tests due to hanging HTTP requests.

### Pitfall 5: `next-auth/react` Duplicate Mock in `jest.setup.ts`
**What goes wrong:** `jest.setup.ts` already has two identical `jest.mock('next-auth/react', ...)` blocks (lines 3–13 and 29–36). When `setupFilesAfterEnv` is fixed and the setup file actually loads, the duplicate mocks may produce a Jest warning about re-mocking.
**Why it happens:** The duplication was invisible because the setup file never loaded.
**How to avoid:** Remove the second duplicate `jest.mock` block for `next-auth/react` (lines 29–36) and the second `jest.mock('@/auth', ...)` block (lines 38–44) when fixing the typo.
**Warning signs:** Jest console output shows "Cannot mock module that was already mocked" warnings after the typo fix.

## Code Examples

Verified patterns from official sources:

### Jest Config — Correct `setupFilesAfterEnv` Key
```javascript
// Source: https://nextjs.org/docs/app/guides/testing/jest
const customJestConfig = {
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],  // NOT setupFilesAfterSetup
  testEnvironment: 'jest-environment-jsdom',
  coverageProvider: 'v8',
  collectCoverageFrom: [
    'app/api/**/*.{ts,tsx}',
    'components/**/*.{ts,tsx}',
    'lib/**/*.{ts,tsx}',
    'hooks/**/*.{ts,tsx}',
    '!**/*.d.ts',
    '!lib/generated/**',
  ],
}
```

### Redis Ping for Health Check
```typescript
// Source: @upstash/redis — existing usage pattern in lib/rate-limiter.ts
import { redis } from '@/lib/redis'

async function checkRedis(): Promise<{ healthy: boolean; latency?: number; error?: string }> {
  if (!redis) {
    return { healthy: false, error: 'Redis not configured' }
  }
  const start = Date.now()
  try {
    await redis.ping()
    return { healthy: true, latency: Date.now() - start }
  } catch (error) {
    return {
      healthy: false,
      latency: Date.now() - start,
      error: error instanceof Error ? error.message : 'Unknown Redis error',
    }
  }
}
```

### Axiom Logger Setup (full SDK path)
```typescript
// Source: https://axiom.co/docs/send-data/nextjs
// lib/axiom/server.ts
import { Axiom } from '@axiomhq/js'
import { Logger, AxiomJSTransport } from '@axiomhq/logging'
import { createAxiomRouteHandler, nextJsFormatters } from '@axiomhq/nextjs'

const axiomClient = new Axiom({ token: process.env.AXIOM_TOKEN! })

export const logger = new Logger({
  transports: [
    new AxiomJSTransport({
      axiom: axiomClient,
      dataset: process.env.NEXT_PUBLIC_AXIOM_DATASET!,
    }),
  ],
  formatters: nextJsFormatters,
})

export const withAxiom = createAxiomRouteHandler(logger)
```

### Structured Cache Log Fields
```typescript
// Enables Axiom query: where event == "cache_hit"
log('Cache hit', {
  event: 'cache_hit',
  cacheKey: normalizedKey,
  cacheLayer: 'memory',
})
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `next-axiom` | `@axiomhq/nextjs` + `@axiomhq/logging` | Late 2024 (maintenance-only announcement) | `next-axiom` still works but receives no new features; `@axiomhq/nextjs` adds `createAxiomRouteHandler` and `instrumentation.ts` hook support |
| Manual `fetch` to Axiom API | `AxiomJSTransport` | 2024 with new modular packages | Transport handles batching, flush, retries — manual fetch has none |
| `setupFilesAfterSetup` (typo) | `setupFilesAfterEnv` (correct key) | Always was wrong — never worked | All `jest-dom` matchers broken until fixed |
| `coverageProvider: 'babel'` (default) | `coverageProvider: 'v8'` | Node 18+ | V8 is faster and does not require Babel instrumentation |

**Deprecated/outdated:**
- `next-axiom`: Maintenance-only. Still installable but do not add to new projects.
- `NEXT_PUBLIC_SENTRY_DSN` check in `logError()`: The SDK import is commented out; this branch has been dead since it was written. Remove it.

## Open Questions

1. **Full Axiom SDK upgrade vs. minimal `logError` fix**
   - What we know: The minimal fix (Option A) satisfies all four OBSV success criteria without installing new packages. The full SDK (Option B) provides better long-term maintainability.
   - What's unclear: Whether the planner wants to bundle the package install with Phase 1 or defer to a later phase.
   - Recommendation: Do Option B in Phase 1 since the Sentry stub is being removed anyway — the cleanup and proper wiring are the same scope.

2. **`jest.setup.ts` duplicate mock cleanup**
   - What we know: The setup file has two identical `jest.mock('next-auth/react', ...)` blocks. This has been invisible because the file never loaded.
   - What's unclear: Whether fixing the typo will produce Jest warnings or actual test failures from the duplicate.
   - Recommendation: Remove the duplicate blocks in the same commit as the `setupFilesAfterEnv` fix. It is a low-risk cleanup.

3. **`checkDatabase()` accuracy (re: CONCERNS.md)**
   - What we know: CONCERNS.md claims `checkDatabase()` is a stub returning `{ healthy: true, latency: 10 }`. Direct reading of `lib/monitoring.ts` (lines 135–152) shows it actually runs `prisma.$queryRawUnsafe('SELECT 1')` and measures real latency. CONCERNS.md is outdated on this point.
   - What's unclear: Whether the `prisma.$queryRawUnsafe` call works correctly in the serverless edge context or if there are connection-pool issues.
   - Recommendation: The database check is real and working. Do not rewrite it. Verify by testing `/api/health` locally with a connected DB.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Jest 29.7.0 |
| Config file | `jest.config.js` (wraps `next/jest`) |
| Quick run command | `npm test -- --testPathPattern="__tests__/lib/monitoring"` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| TEST-01 | `toBeInTheDocument()` does not throw | integration | `npm test -- --testPathPattern="ride-comparison-form"` | ✅ (existing) |
| TEST-01 | `setupFilesAfterEnv` appears in Jest config | smoke | `npx jest --showConfig \| grep setupFilesAfterEnv` | N/A (CLI check) |
| TEST-02 | Coverage includes `components/**` and `lib/**` | smoke | `npm test -- --coverage --collectCoverageFrom "components/**"` | N/A (config check) |
| OBSV-01 | `/api/health` returns `database.latency` as a number | integration | `npm test -- --testPathPattern="health"` | ❌ Wave 0 |
| OBSV-02 | `/api/health` returns `redis.healthy` and `redis.latency` | integration | `npm test -- --testPathPattern="health"` | ❌ Wave 0 |
| OBSV-03 | `logError` calls `log()` with `level: "error"` (no Sentry branch) | unit | `npm test -- --testPathPattern="monitoring"` | ❌ Wave 0 |
| OBSV-04 | Cache log calls include `event: "cache_hit"` or `event: "cache_miss"` field | unit | `npm test -- --testPathPattern="ride-comparison"` | ✅ (partial — extend) |

### Sampling Rate
- **Per task commit:** `npm test -- --testPathPattern="(monitoring|health)" --passWithNoTests`
- **Per wave merge:** `npm test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `__tests__/api/health-route.test.ts` — covers OBSV-01, OBSV-02: GET /api/health returns `database.latency` (number), `redis.healthy` (boolean), `redis.latency` (number)
- [ ] `__tests__/lib/monitoring.test.ts` — covers OBSV-03: `logError()` calls `log()` with `level: "error"`; no Sentry branch executed
- [ ] Duplicate mocks in `jest.setup.ts` — remove second `jest.mock('next-auth/react')` and second `jest.mock('@/auth')` blocks before TEST-01 can be confirmed clean

## Sources

### Primary (HIGH confidence)
- Next.js Jest docs (https://nextjs.org/docs/app/guides/testing/jest) — `setupFilesAfterEnv` correct key, `coverageProvider: 'v8'` recommendation
- Axiom Next.js docs (https://axiom.co/docs/send-data/nextjs) — `@axiomhq/nextjs` as active `next-axiom` replacement; `createAxiomRouteHandler`, `createOnRequestError`, `instrumentation.ts` hook
- Axiom new JS logging blog (https://axiom.co/blog/new-js-logging) — package structure, `Logger` + `AxiomJSTransport` setup
- Direct source code audit — `jest.config.js`, `jest.setup.ts`, `lib/monitoring.ts`, `app/api/health/route.ts`, `lib/redis.ts`

### Secondary (MEDIUM confidence)
- npm registry search — confirmed `@axiomhq/nextjs` version 0.1.4+ exists; `@axiomhq/js`, `@axiomhq/logging`, `@axiomhq/react` are published packages
- `.planning/research/STACK.md` — prior research confirmed `setupFilesAfterEnv` correction, Axiom package recommendation, coverage glob expansion approach

### Tertiary (LOW confidence)
- None — all critical claims verified with primary sources

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all packages are existing installs or verified npm packages; no speculative additions
- Architecture: HIGH — all changes are single-file edits with direct source evidence; patterns verified against official docs
- Pitfalls: HIGH — every pitfall confirmed by direct code reading (specific line references); not inferred

**Research date:** 2026-03-10
**Valid until:** 2026-04-10 (stable ecosystem — Jest 29 and Axiom package APIs are stable)
