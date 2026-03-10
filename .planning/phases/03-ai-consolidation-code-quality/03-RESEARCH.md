# Phase 3: AI Consolidation & Code Quality - Research

**Researched:** 2026-03-10
**Domain:** TypeScript cleanup, OpenAI migration, constant deduplication, API format enforcement
**Confidence:** HIGH

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| INFR-07 | AI insight generation uses OpenAI only (Anthropic SDK dependency removed) | OpenAI SDK already in package.json at `^6.25.0`; Anthropic SDK at `^0.74.0` must be removed; `ai-insights.ts` is the only consumer |
| QUAL-01 | TypeScript `any` types replaced with proper interfaces in database-logging, monitoring, and dashboard | Audit found two `any` sites: `logSearch` parameter, `logWeatherData.rawData`; `monitoring.ts` has index signature `[key: string]: ... \| undefined \| null` which TypeScript accepts cleanly |
| QUAL-02 | Duplicated COMMON_PLACES consolidated to single source in `lib/constants.ts` | `COMMON_PLACES` already lives exclusively in `lib/constants.ts`; no duplicates found; `DEFAULT_SERVICES` is the actual duplicate — defined in 3 locations |
| QUAL-03 | Hardcoded external API URLs centralized through API_CONFIG | Four hardcoded Nominatim URLs across `useLocationSuggestions.ts` and `useUserLocation.ts`; one hardcoded OSRM URL in `monitoring.ts:checkOSRM`; all must reference `API_CONFIG` |
| FEAT-02 | Compare-rides API accepts single unified request format (legacy string format removed) | `handlePost` in `compare-rides/route.ts` accepts both `LegacyComparisonRequest` and `CoordinateComparisonRequest`; legacy path at lines 361-398 must be removed; test in `compare-rides.route.test.ts` that asserts legacy path works must be updated to assert 400 rejection |
</phase_requirements>

---

## Summary

Phase 3 is a consolidation and cleanup phase with five discrete, well-scoped changes. All work is internal — no new user-facing functionality is introduced. The highest-risk change is FEAT-02 (removing the legacy request format) because it requires coordinating a handler change with a client-side change and updating an existing test. The lowest-risk changes are QUAL-01 and QUAL-02, which are mechanical type and constant cleanup.

The OpenAI SDK (`openai@^6.25.0`) is already installed in `package.json` alongside the Anthropic SDK (`@anthropic-ai/sdk@^0.74.0`). The migration is a contained swap inside `lib/services/ai-insights.ts` with no changes needed elsewhere in the production path. The existing test suite for `ai-insights.ts` mocks the SDK at the module boundary, so the mock target must be updated from `@anthropic-ai/sdk` to `openai`.

The `DEFAULT_SERVICES` constant — not `COMMON_PLACES` — is the real duplicate. It is defined independently in three files: `lib/services/ride-comparison.ts:152`, `lib/hooks/useRideComparison.ts:12`, and `app/api/compare-rides/route.ts:32`. `COMMON_PLACES` already has a single canonical home in `lib/constants.ts`.

**Primary recommendation:** Execute the five requirements as separate, sequentially tested commits. Start with QUAL-01 and QUAL-02/03 (pure refactors with no behaviour change) before INFR-07 (SDK swap) and FEAT-02 (breaking change). This ordering minimises blast radius at each step.

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| openai | ^6.25.0 | AI completions (replaces Anthropic) | Already in package.json; project decision to consolidate to one provider |
| typescript | ^5 | Type checking | Project standard; `npm run typecheck` enforces zero errors |
| zod | ^3.25.67 | Runtime schema validation | Already used throughout validation layer |

### No New Dependencies

This phase removes a dependency (`@anthropic-ai/sdk`) but adds none. All other changes are refactoring existing code.

**Removal:**
```bash
npm uninstall @anthropic-ai/sdk
```

---

## Architecture Patterns

### Pattern 1: OpenAI Chat Completions (replaces Anthropic Messages)

**What:** `ai-insights.ts` currently calls `client.messages.create()` on an Anthropic instance. The replacement uses `openai.chat.completions.create()` with equivalent parameters.

**Mapping:**

| Anthropic | OpenAI |
|-----------|--------|
| `new Anthropic({ apiKey })` | `new OpenAI({ apiKey })` |
| `client.messages.create({ model, max_tokens, temperature, messages })` | `client.chat.completions.create({ model, max_tokens, temperature, messages })` |
| `response.content[0].type === 'text' ? response.content[0].text : ''` | `response.choices[0]?.message?.content ?? ''` |
| Model: `'claude-haiku-4-5-20251001'` | Model: `'gpt-4o-mini'` (or `'gpt-3.5-turbo'`) |
| Env var: `ANTHROPIC_API_KEY` | Env var: `OPENAI_API_KEY` |

**When to use:** All AI text generation calls in this codebase route through `enhanceWithAI` in `ai-insights.ts`. No other file imports from `@anthropic-ai/sdk`.

**Example (replacement client factory):**
```typescript
// Source: OpenAI SDK v4+ standard pattern
import OpenAI from 'openai'

function getOpenAIClient(): OpenAI | null {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return null
  return new OpenAI({ apiKey })
}
```

**Example (completion call):**
```typescript
// Source: openai npm package README
const response = await client.chat.completions.create({
  model: 'gpt-4o-mini',
  max_tokens: 150 * recommendations.length,
  temperature: 0.3,
  messages: [{ role: 'user', content: prompt }],
})
const text = response.choices[0]?.message?.content ?? ''
```

### Pattern 2: Replacing `any` with Typed Interfaces

**What:** Two `any` occurrences in `lib/database-logging.ts` need explicit types.

**Site 1 — `logSearch` parameter `results: any` (line 148):**

The `results` parameter is passed directly to `prisma.searchLog.create({ data: { results_shown: results } })`. The Prisma schema defines `results_shown` as `Json?`. The correct TypeScript type for Prisma JSON fields is `Prisma.InputJsonValue` (from the generated client).

```typescript
// Before
export async function logSearch(
  routeId: string | null,
  userId: string | null,
  results: any,
  sessionId?: string
): Promise<void>

// After — ComparisonResults is already in @/types and matches the actual shape
import type { ComparisonResults } from '@/types'

export async function logSearch(
  routeId: string | null,
  userId: string | null,
  results: ComparisonResults,
  sessionId?: string
): Promise<void>
```

`ComparisonResults` is `Partial<Record<ServiceType, RideResult>>` — a concrete, serialisable object that satisfies Prisma's `Json` field requirement.

**Site 2 — `logWeatherData` parameter `rawData?: any` (line 181):**

`rawData` is passed to `prisma.weatherLog.create({ data: { raw_data: weatherData.rawData } })`. The Prisma field is also `Json?`. Use `Prisma.InputJsonValue | null` or simply `unknown` since the field is fire-and-forget and not read back.

```typescript
// After
rawData?: unknown
```

Using `unknown` instead of `Prisma.InputJsonValue` is safer (no import needed, no coupling to Prisma internals) and still passes `tsc` because `unknown` is assignable to Prisma's JSON column type through the ORM.

**`monitoring.ts` assessment:** The `ErrorContext` interface already uses `[key: string]: unknown` on line 26. The `LogContext` interface uses `[key: string]: string | number | boolean | undefined | null` on line 18. Neither constitutes an `any` escape. Monitoring passes `tsc` cleanly today. QUAL-01's scope for monitoring is **zero changes needed** — confirm with `tsc --noEmit` before proceeding.

**Dashboard API handler (`app/api/dashboard/route.ts`) assessment:** No `any` types found in this file. The Prisma result at line 117 (`insights.surgeProbabilityByHour as Record<string, number>`) is a type assertion, not `any`. This is acceptable. QUAL-01 scope for dashboard is also **zero changes needed**.

### Pattern 3: Centralising `DEFAULT_SERVICES` Constant

**What:** `DEFAULT_SERVICES` is currently defined inline in three files. Add a single export in `lib/constants.ts` and import it everywhere.

**Current state:**
- `lib/services/ride-comparison.ts:152` — `const DEFAULT_SERVICES: ServiceType[] = ['uber', 'lyft', 'taxi', 'waymo']`
- `lib/hooks/useRideComparison.ts:12` — `const DEFAULT_SERVICES: ServiceType[] = ['uber', 'lyft', 'taxi', 'waymo']`
- `app/api/compare-rides/route.ts:32` — `const DEFAULT_SERVICES: ServiceType[] = ['uber', 'lyft', 'taxi', 'waymo']`

**Target state in `lib/constants.ts`:**
```typescript
// Add after COMMON_PLACES export
export const DEFAULT_SERVICES: ServiceType[] = ['uber', 'lyft', 'taxi', 'waymo']
```

Note: `ServiceType` is defined in `@/types` — `lib/constants.ts` already imports from `@/types` (line 1: `import type { CommonPlaces } from '@/types'`), so adding `ServiceType` to that import is sufficient.

**Note on COMMON_PLACES:** QUAL-02's requirement text says "COMMON_PLACES consolidated to single source". The COMMON_PLACES constant is already exclusively in `lib/constants.ts`. The requirement is effectively already met for COMMON_PLACES. However, based on the success criterion — "appears in exactly one file" — `DEFAULT_SERVICES` is the outstanding duplicate that must be fixed to satisfy the spirit and the verification check. The planner should treat QUAL-02 as: consolidate `DEFAULT_SERVICES`, confirm `COMMON_PLACES` is already clean.

### Pattern 4: Centralising Hardcoded External API URLs

**What:** Four files contain hardcoded `nominatim.openstreetmap.org` or `router.project-osrm.org` URLs that bypass `API_CONFIG`.

**Files and lines:**

| File | Line | Current hardcoded string | Replacement |
|------|------|--------------------------|-------------|
| `lib/hooks/useLocationSuggestions.ts` | 113 | `` `https://nominatim.openstreetmap.org/search?q=...` `` | `\`${API_CONFIG.NOMINATIM_BASE_URL}?q=...\`` |
| `lib/hooks/useLocationSuggestions.ts` | 157 | `` `https://nominatim.openstreetmap.org/search?q=...` `` | same |
| `lib/hooks/useUserLocation.ts` | 46 | `` `https://nominatim.openstreetmap.org/reverse?lat=...` `` | Nominatim reverse endpoint needs a new `API_CONFIG.NOMINATIM_REVERSE_URL` key |
| `lib/monitoring.ts` | 179 | `'https://router.project-osrm.org/route/v1/driving/...'` | Use `API_CONFIG.OSRM_BASE_URL` as base |

**`API_CONFIG` additions needed:**

The reverse geocoding URL pattern differs from the search URL. Add a dedicated key rather than constructing from base:

```typescript
// In lib/constants.ts — additions to API_CONFIG
NOMINATIM_REVERSE_URL: 'https://nominatim.openstreetmap.org/reverse',
```

The OSRM health check in `monitoring.ts:179` uses a hardcoded full URL including coordinates. Replace the base domain with `API_CONFIG.OSRM_BASE_URL`:

```typescript
// Before
'https://router.project-osrm.org/route/v1/driving/-122.4194,37.7749;-122.2711,37.8044?overview=false'

// After
`${API_CONFIG.OSRM_BASE_URL}/-122.4194,37.7749;-122.2711,37.8044?overview=false`
```

Note on client-side hooks: `useLocationSuggestions.ts` and `useUserLocation.ts` are `'use client'` files. `API_CONFIG` is defined in `lib/constants.ts` with no server-only imports — it is safe to import in client components.

### Pattern 5: Removing Legacy Request Format (FEAT-02)

**What:** The `handlePost` function in `app/api/compare-rides/route.ts` currently accepts both legacy (`{ pickup, destination }`) and coordinate (`{ from, to }`) formats. The legacy path must be removed so the handler rejects legacy payloads with HTTP 400.

**Current flow (simplified):**
```
POST body received
→ isLegacyRequest(body)? → yes → compareRidesByAddresses() (legacy path, lines 361-398)
→ isCoordinateRequest(body)? → yes → compareRidesByCoordinates() (coordinate path, lines 284-358)
→ neither → 400
```

**Target flow:**
```
POST body received
→ isCoordinateRequest(body)? → yes → compareRidesByCoordinates()
→ not coordinate request → 400 "Invalid request format. Use coordinate format."
```

**Files to change:**

1. `app/api/compare-rides/route.ts` — remove lines 360-398 (legacy path including `sanitizedPickup`/`sanitizedDestination` block); update the rejection path to explicitly indicate the expected format.

2. `lib/hooks/useRideComparison.ts` — the `buildRequestBody` function at line 24 already sends the coordinate format when `pickupCoords` and `destinationCoords` are available, but falls back to the legacy format (`{ pickup, destination }`) at line 45-51. This fallback must be removed. After removal, if `pickupCoords` or `destinationCoords` are unavailable, the hook should surface an error rather than sending a legacy payload.

3. `__tests__/app/api/compare-rides.route.test.ts` — the test `'uses the address comparison path for legacy payloads'` (line 318-343) currently asserts a 200 response and that `compareRidesByAddresses` was called. It must be updated to assert a 400 response and that neither comparison function was called.

**Downstream type cleanup:** After removing the legacy path from the handler, `LegacyComparisonRequest` in `types/index.ts` (line 59-64) and `isLegacyRequest` in `route.ts` (line 107-114) become dead code. The planner should include their removal for completeness, though this is optional for the success criterion.

### Anti-Patterns to Avoid

- **Swapping `any` for `object`:** `object` is not assignable to Prisma JSON fields in all cases. Use `ComparisonResults` for `logSearch` and `unknown` for `rawData`.
- **Removing `LegacyComparisonRequest` from types before fixing the hook:** The hook still references the type through `ComparisonRequestBody`. Remove type references only after the hook no longer produces legacy payloads.
- **Searching for COMMON_PLACES duplicates and not finding any:** This is correct. The duplicate issue is `DEFAULT_SERVICES`. The QUAL-02 requirement is satisfied by consolidating `DEFAULT_SERVICES`.
- **Using `API_CONFIG.NOMINATIM_BASE_URL` for reverse geocoding:** The search and reverse endpoints are different paths (`/search` vs `/reverse`). The base URL in `API_CONFIG` already includes `/search`. A separate `NOMINATIM_REVERSE_URL` key prevents confusion.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| OpenAI API client | Custom fetch wrapper | `openai` npm package (already installed) | SDK handles auth, retries, streaming, type safety |
| JSON type for Prisma | Manual `JsonValue` definition | `ComparisonResults` (for known shape) or `unknown` (for opaque data) | Prisma accepts `unknown` for Json columns; avoids Prisma internals coupling |
| URL construction | String concatenation | `API_CONFIG` constants + template literals | Avoids duplication; keeps URLs testable |

---

## Common Pitfalls

### Pitfall 1: Test mock target mismatch after SDK swap

**What goes wrong:** `ai-insights.test.ts` mocks `@anthropic-ai/sdk` at line 20. After replacing the import in `ai-insights.ts` with `openai`, the existing mock target `'@anthropic-ai/sdk'` no longer intercepts the module. Tests that rely on the mock (quota exceeded test, AI call test) will either pass vacuously or fail with wrong assertions.

**Why it happens:** Jest module mocking is keyed on the import specifier string. Changing the import changes the key.

**How to avoid:** Update `jest.mock('@anthropic-ai/sdk', ...)` to `jest.mock('openai', ...)` in `ai-insights.test.ts` at the same time as changing the production code import. Verify that the mock shape matches OpenAI's response structure (`choices[0].message.content`) not Anthropic's (`content[0].text`).

**Warning signs:** Tests pass but `mockIncrementQuotaCounter` is never called — the mock isn't intercepting anything.

### Pitfall 2: `OPENAI_API_KEY` environment variable not set locally

**What goes wrong:** After removing `ANTHROPIC_API_KEY`, local dev and CI may lack `OPENAI_API_KEY`. The client factory returns `null` and all AI calls fall back to templates silently.

**Why it happens:** The project's `.env.local` documents only `ANTHROPIC_API_KEY`. The new key must be documented.

**How to avoid:** Update `ENV_EXAMPLE.md` to replace `ANTHROPIC_API_KEY` with `OPENAI_API_KEY`. The existing fallback-to-template behaviour means missing the key is not a hard failure — but observability requires the key to actually be set.

### Pitfall 3: `DEFAULT_SERVICES` import in client components

**What goes wrong:** `lib/hooks/useRideComparison.ts` is a `'use client'` file. If `lib/constants.ts` is updated to import server-only modules in the future, this import path becomes unsafe.

**Why it happens:** `lib/constants.ts` currently has no server-only imports. But it imports from `@/types` — keep monitoring.

**How to avoid:** `lib/constants.ts` is already clean of server-only imports. The import is safe as-is. Confirm at the time of change with `npm run build` which will catch server/client boundary violations.

### Pitfall 4: Legacy hook fallback breaks the UI after FEAT-02

**What goes wrong:** `useRideComparison.ts:buildRequestBody` falls back to the legacy format when coordinates are unavailable (lines 45-51). If the legacy server path is removed without removing this fallback, users without resolved coordinates will receive a 400 response with a confusing error message.

**Why it happens:** The hook has two code paths; only one is updated.

**How to avoid:** Check whether the UI ever calls `submitComparison` without coordinates. Review `app/page.tsx` to confirm. If coordinates are always available by the time submission happens (i.e. the user selected from autocomplete), the fallback is dead code and can be removed. If not, an early validation error should be surfaced before the fetch.

### Pitfall 5: `tsc` passes locally but fails with stricter settings

**What goes wrong:** Replacing `any` with `unknown` on `rawData` may surface downstream inference issues if any call site accesses properties on the value.

**Why it happens:** `any` suppresses all downstream checks; `unknown` does not.

**How to avoid:** Search for all call sites of `logWeatherData` before changing the parameter type. Confirm `rawData` is never read after being stored (it is only written to the DB). Only one call site exists — in `lib/etl/weather-cron.ts` — so downstream impact is contained.

---

## Code Examples

Verified patterns from OpenAI SDK:

### OpenAI Chat Completion
```typescript
// Source: openai npm package API (package.json: "openai": "^6.25.0")
import OpenAI from 'openai'

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

const response = await client.chat.completions.create({
  model: 'gpt-4o-mini',
  max_tokens: 450,
  temperature: 0.3,
  messages: [{ role: 'user', content: prompt }],
})

const text = response.choices[0]?.message?.content ?? ''
```

### Typed `logSearch` signature
```typescript
// Replaces: results: any
import type { ComparisonResults } from '@/types'

export async function logSearch(
  routeId: string | null,
  userId: string | null,
  results: ComparisonResults,
  sessionId?: string
): Promise<void>
```

### API_CONFIG additions
```typescript
// In lib/constants.ts — additions to existing API_CONFIG object
export const API_CONFIG = {
  NOMINATIM_BASE_URL: 'https://nominatim.openstreetmap.org/search',
  NOMINATIM_REVERSE_URL: 'https://nominatim.openstreetmap.org/reverse',  // NEW
  OSRM_BASE_URL: 'https://router.project-osrm.org/route/v1/driving',
  USER_AGENT: 'RideCompareApp/1.0',
  SEARCH_LIMIT: 5,
  CACHE_TTL: 300000,
  ROUTE_CACHE_TTL: 600000,
  REQUEST_TIMEOUT_MS: 8000,
  MAX_RETRIES: 2,
} as const
```

### DEFAULT_SERVICES export
```typescript
// In lib/constants.ts — add after COMMON_PLACES
import type { CommonPlaces, ServiceType } from '@/types'  // add ServiceType

export const DEFAULT_SERVICES: ServiceType[] = ['uber', 'lyft', 'taxi', 'waymo']
```

### Updated compare-rides handlePost rejection
```typescript
// Replace the dual-format check at top of handlePost
if (!isCoordinateRequest(body)) {
  return NextResponse.json(
    { error: 'Invalid request format. Use coordinate request format with from/to fields.' },
    { status: 400, headers: createResponseHeaders(requestId) }
  )
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Anthropic Claude Haiku for AI insights | OpenAI `gpt-4o-mini` | This phase | Removes one SDK, one secret; equivalent capability |
| `any` for unstructured Prisma JSON input | `unknown` or concrete type | This phase | Zero runtime change; compile-time safety gained |
| Legacy string format for ride comparison | Coordinate format only | This phase | Simplifies server handler; removes ambiguity |
| Scattered `DEFAULT_SERVICES` declarations | Single export from `lib/constants.ts` | This phase | Single source of truth; refactoring safety |

---

## Open Questions

1. **Does the UI ever submit without coordinates?**
   - What we know: `useRideComparison.ts:buildRequestBody` has a fallback to legacy format when `pickupCoords`/`destinationCoords` are null/undefined.
   - What's unclear: Whether this fallback is ever triggered in practice (e.g. when a user types a freeform address without selecting from autocomplete).
   - Recommendation: Read `app/page.tsx` during planning to verify the submission path always provides coordinates. If it does not, add a guard in `buildRequestBody` that throws a validation error before sending rather than falling back to legacy format.

2. **Should `LegacyComparisonRequest` type and `isLegacyRequest` function be removed?**
   - What we know: After removing the legacy handler path, both become dead code.
   - What's unclear: Whether any external consumers (scripts, tests, other hooks) depend on the `LegacyComparisonRequest` type export from `@/types`.
   - Recommendation: Search for all imports of `LegacyComparisonRequest` before removal. Currently only `app/api/compare-rides/route.ts` imports it. Safe to remove.

3. **Which OpenAI model to use?**
   - What we know: The project already has `openai@^6.25.0` and the AI task is generating short (25-word) advisory tips.
   - What's unclear: Whether `gpt-4o-mini` or `gpt-3.5-turbo` is preferred (cost vs capability).
   - Recommendation: Use `gpt-4o-mini`. It is the current cost-efficient frontier model for short-form text generation, has lower latency than `gpt-4o`, and is priced similarly to `gpt-3.5-turbo` while outperforming it. Confidence: MEDIUM (training knowledge; verify pricing at time of implementation).

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Jest 29.7.0 |
| Config file | `jest.config.js` |
| Quick run command | `npm test -- --testPathPattern=<file>` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| INFR-07 | `enhanceWithAI` calls OpenAI not Anthropic; Anthropic import removed | unit | `npm test -- --testPathPattern=ai-insights` | ✅ needs update |
| QUAL-01 | `logSearch` and `logWeatherData` compile with zero `any` | typecheck | `npm run typecheck` | ✅ existing check |
| QUAL-02 | `DEFAULT_SERVICES` in exactly one file | unit + lint | `npm test` + `grep -r "DEFAULT_SERVICES" lib app` | ✅ |
| QUAL-03 | No hardcoded Nominatim/OSRM strings outside `lib/constants.ts` | unit | `npm run typecheck` + manual grep | ✅ |
| FEAT-02 | POST with legacy `{ pickup, destination }` returns 400 | unit | `npm test -- --testPathPattern=compare-rides.route` | ✅ needs update |

### Sampling Rate

- **Per task commit:** `npm test -- --testPathPattern=<affected-file>`
- **Per wave merge:** `npm test`
- **Phase gate:** `npm run quality` (typecheck + lint + format + test + build) green before `/gsd:verify-work`

### Wave 0 Gaps

None — existing test infrastructure covers all phase requirements. The two test files that need updating (`ai-insights.test.ts`, `compare-rides.route.test.ts`) already exist. No new test files need to be created in Wave 0.

---

## Sources

### Primary (HIGH confidence)

- Codebase direct inspection — all file reads above are from the actual source tree
- `package.json` — confirms `openai@^6.25.0` installed, `@anthropic-ai/sdk@^0.74.0` to be removed
- `lib/constants.ts` — authoritative source; `NOMINATIM_BASE_URL` and `OSRM_BASE_URL` already defined
- `lib/database-logging.ts` — two `any` sites confirmed at lines 148 and 181
- `lib/monitoring.ts` — hardcoded OSRM URL at line 179; no `any` types
- `app/api/compare-rides/route.ts` — legacy path confirmed at lines 361-398; `DEFAULT_SERVICES` duplicate at line 32
- `lib/hooks/useRideComparison.ts` — `DEFAULT_SERVICES` duplicate at line 12; legacy fallback in `buildRequestBody`
- `lib/services/ride-comparison.ts` — `DEFAULT_SERVICES` duplicate at line 152
- `lib/hooks/useLocationSuggestions.ts` — hardcoded Nominatim URLs at lines 113 and 157
- `lib/hooks/useUserLocation.ts` — hardcoded Nominatim reverse URL at line 46

### Secondary (MEDIUM confidence)

- OpenAI SDK v4+ API shape — `choices[0].message.content` response structure; consistent with `openai` npm package documentation conventions

### Tertiary (LOW confidence)

- `gpt-4o-mini` model recommendation — based on knowledge as of August 2025 training cutoff; verify current model availability and pricing before implementation

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — package.json confirms exact versions; no new libraries needed
- Architecture: HIGH — all patterns derived from direct code inspection
- Pitfalls: HIGH — each pitfall is grounded in a specific observed code pattern
- Model recommendation (gpt-4o-mini): MEDIUM — verify at implementation time

**Research date:** 2026-03-10
**Valid until:** 2026-04-10 (30 days; only the model name recommendation is time-sensitive)
