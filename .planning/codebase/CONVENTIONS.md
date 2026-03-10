# Coding Conventions

**Analysis Date:** 2026-03-10

## Naming Patterns

**Files:**
- React components: PascalCase — `RideComparisonForm.tsx`, `RouteMapClient.tsx`
- Hooks: camelCase with `use` prefix — `useUserLocation.ts`, `use-recaptcha.ts` (inconsistent: some kebab-case, some camelCase)
- Utilities and services: camelCase — `ride-comparison.ts`, `geo.ts`, `validation.ts`
- API routes: Next.js convention `route.ts` inside `app/api/[name]/` directories
- Test files: mirror source path under `__tests__/` — `__tests__/services/ride-comparison.test.ts`
- Types: `index.ts` at `types/index.ts`

**Functions:**
- camelCase: `compareRidesByAddresses`, `getTimeBasedMultiplier`, `validateInput`
- Boolean-returning functions prefixed with `is`/`has`/`detect`: `isAirportLocation`, `hasAirportSurcharge`, `detectSpamPatterns`
- Async functions descriptively named for what they return: `findOrCreateRoute`, `logPriceSnapshot`

**Variables:**
- camelCase: `mockFetch`, `pickupCoords`, `requestId`
- Constants: SCREAMING_SNAKE_CASE — `GEOCODE_CACHE`, `MAX_CACHE_SIZE`, `MOCK_NOMINATIM_RESPONSE`, `API_CONFIG`
- Type-discriminating error codes: string union in SCREAMING_SNAKE_CASE — `'ADDRESS_NOT_FOUND'`, `'GEOCODE_TIMEOUT'`

**Types and Interfaces:**
- Interfaces: PascalCase — `RideResult`, `SurgeInfo`, `LogContext`, `RouteMetrics`
- Type aliases: PascalCase — `ServiceType`, `Coordinates`, `RouteAccuracy`, `CompareServiceErrorCode`
- Union string literal types: SCREAMING_SNAKE_CASE members — `'ADDRESS_NOT_FOUND' | 'GEOCODE_TIMEOUT'`
- Generics: single letter or descriptive — `Brand<K, T>`, `Map<string, { value: T; expiresAt: number }>`

## Code Style

**Formatting (Prettier):**
- Config: `.prettierrc`
- No semicolons (`"semi": false`)
- Single quotes (`"singleQuote": true`)
- 2-space indent (`"tabWidth": 2`)
- Trailing commas in ES5 positions (`"trailingComma": "es5"`)
- 100 character print width (`"printWidth": 100`)
- Arrow parens omitted for single params (`"arrowParens": "avoid"`)
- Bracket spacing enabled (`"bracketSpacing": true`)

**Linting:**
- ESLint with `eslint-config-next/core-web-vitals` — config at `eslint.config.mjs`
- TypeScript strict mode enabled in `tsconfig.json` (`"strict": true`)
- No `noUncheckedIndexedAccess` — array index access not required to be null-checked

## Import Organization

**Order (no enforced grouping, but observed pattern):**
1. Next.js framework imports (`next/server`, `next/dynamic`)
2. External packages (`framer-motion`, `lucide-react`, `zod`)
3. Internal `@/lib/*` utilities (alphabetical within group)
4. Internal `@/components/*`
5. `type` imports last with `import type { ... }`

**Path Aliases:**
- `@/` maps to repository root (configured in `tsconfig.json` and `jest.config.js`)
- Never use relative paths crossing feature boundaries — always use `@/`

**Example from `lib/services/ride-comparison.ts`:**
```typescript
import { API_CONFIG } from '@/lib/constants'
import { findOrCreateRoute, logPriceSnapshot, logSearch } from '@/lib/database'
import { getAirportByCode, parseAirportCode } from '@/lib/airports'
import type {
  ComparisonResults,
  Coordinates,
  ServiceType,
} from '@/types'
```

## Error Handling

**Typed error classes:**
- Custom error classes extend `Error` with discriminating code fields
- Pattern: `class CompareServiceError extends Error { code: CompareServiceErrorCode; ... }`
- Error codes are string union types in SCREAMING_SNAKE_CASE
- Type guards (`isCompareServiceError`) used to narrow `unknown` errors

**API error mapping:**
- Typed errors map to HTTP status codes via `switch` on error code
- `switch` with exhaustive-like default: `400` for bad input, `503`/`504` for upstream failures, `500` for unknown
- Error responses always include `{ error: string, code: string, requestId: string }`

**Non-critical async operations:**
- Database logging (non-blocking) uses `.catch()` or `void` to prevent failures from bubbling:
  ```typescript
  findOrCreateRoute(...).catch(err => log('DB write failed', { error: err.message }))
  ```

**Service layer:**
- Validate inputs with Zod before processing — `lib/validation.ts` exports `validateInput(schema, data)`
- `validateInput` returns `{ success: true, data }` or `{ success: false, errors: ValidationError[] }`
- Never throw raw Zod errors to callers — wrap in `ValidationError` with field path

## Validation

**Pattern — always use Zod schemas defined in `lib/validation.ts`:**
```typescript
import { z } from 'zod'
const schema = z.object({
  pickup: LocationNameSchema,
  destination: LocationNameSchema,
  services: z.array(ServiceTypeSchema).min(1, 'At least one service required'),
})
const result = validateInput(schema, input)
```

**Input sanitization:**
- `sanitizeString()` from `lib/validation.ts` strips HTML, quotes, shell metacharacters before validation
- Always sanitize before passing user strings to external APIs (Nominatim geocoding)

## Logging

**Framework:** Custom `log()` and `logError()` wrappers in `lib/monitoring.ts`

**Rules:**
- Use `log(message, context)` for structured info logging — NOT `console.log`
- Use `logError({ error, ...context })` for errors — NOT `console.error` in app code
- `console.debug` only in `lib/monitoring.ts`, `lib/pricing.ts`, `lib/redis.ts`, `lib/prisma.ts` — only for dev/debug branches
- `console.warn` in service layer for degraded-but-recoverable failures (insights aggregator, AI fallback)
- Raw `console.*` in application components and API routes is not acceptable

## Comments

**JSDoc usage:**
- Module-level JSDoc on utility functions: `/** Structured logging utility ... */`
- JSDoc on exported functions in shared libs: `/** Clean up expired entries from a cache */`
- Inline comments for non-obvious logic (cache eviction math, signal abort patterns)
- No JSDoc on internal component helper functions

**When to comment:**
- Non-obvious performance choices: `// Lazy-load RouteMap to defer loading the 300KB MapLibre library`
- Security decisions: `// reCAPTCHA verification skipped for precomputed routes`
- Cache size reasoning: `// Cache size limits to prevent memory leaks`

## Immutability

- New objects created via spread rather than mutation: `{ ...user, name }`
- `Map` cache entries never mutated — always replaced via `cache.set(key, { value, expiresAt })`
- Array operations use non-mutating patterns (`Array.from(cache.keys())`, `filter`, `map`)

## Function Design

**Size:** Functions generally stay under 40-50 lines; longer functions broken into named helpers
**Parameters:** Prefer named object parameters for 3+ args
**Return values:** Discriminated union results (`{ success: true, data } | { success: false, errors }`) for fallible operations
**Async:** All external I/O is async/await — no raw Promises in new code

## Module Design

**Exports:**
- Named exports preferred over default exports for utilities and services
- Default exports only for React components (Next.js/React convention)
- Re-export from barrel only where needed — no forced barrel files

**Server vs. Client separation:**
- `'use client'` directive at top of client components
- `/** @jest-environment node */` directive at top of API route tests
- API route handlers (`GET`, `POST`) always exported as named functions

---

*Convention analysis: 2026-03-10*
