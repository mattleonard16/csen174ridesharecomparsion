# Stack Research

**Domain:** Next.js reliability, observability, and test coverage
**Researched:** 2026-03-10
**Confidence:** HIGH (verified via official docs and npm registry)

---

## Context

This is a subsequent milestone for an existing Next.js 14 app on Vercel with Upstash Redis
already provisioned. The goal is to add error tracking, caching persistence, AI quota
management, and meaningful test coverage — not to replace the framework or infrastructure.

Existing stack is fixed: Next.js 14, TypeScript, Prisma, Upstash Redis, Vercel, Axiom (logs).

---

## Recommended Stack

### Error Tracking

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| `@axiomhq/nextjs` | 0.2.0 | Route handler error capture | Axiom is already integrated for structured logging. The new `@axiomhq/nextjs` package adds automatic exception capture via `withAxiom` wrapper — no second vendor needed. Wraps route handlers and calls `onError` for 5xx responses. |
| `@axiomhq/logging` | 0.2.0 | Core logger transport | Provides `AxiomJSTransport` and `LogLevel`. Required peer for `@axiomhq/nextjs`. |
| `@axiomhq/react` | 0.2.0 | Client-side error boundary logging | Provides React hooks for flushing logs before page unload. Needed to catch client-side unhandled errors in the map component. |

**Do NOT use Sentry.** The existing `monitoring.ts` has a TODO stub for Sentry DSN that was never
wired up. Sentry would add a second vendor ($), a heavy webpack plugin, and source-map upload
complexity — all for a use case Axiom already covers. Axiom's `@axiomhq/nextjs` captures
exceptions with the same signal at zero additional cost.

**Do NOT use `next-axiom`.** It is in maintenance-only mode (bug fixes, no new features).
`@axiomhq/nextjs` is the active replacement per official Axiom docs.

### Caching (Redis)

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| `@upstash/redis` | 1.36.4 | Distributed cache for geocode, route, AI results | Already provisioned. The existing in-memory Map caches evaporate between Vercel serverless invocations. Redis solves this without new infrastructure. HTTP-based client works in edge and serverless runtimes. |

**Pattern: `GET` then `SET EX`** for cache reads/writes. Use a consistent key namespace
(`cache:geocode:`, `cache:route:`, `cache:ai:`) to avoid collisions with the existing
rate-limit keys.

### AI Quota Tracking (Redis)

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| `@upstash/redis` | 1.36.4 | Atomic daily quota counters | `redis.multi()` (MULTI/EXEC transaction) wraps `INCR` + `EXPIRE` atomically. Unlike the current module-level variable, this survives process restarts and works across all serverless instances. |

**Pattern: `redis.multi()` not `redis.pipeline()`**. Pipeline commands can interleave; only
`multi()` provides true atomicity. For quota: `INCR quota:ai:daily` then `EXPIRE
quota:ai:daily 86400` if the returned count equals 1 (first call of the day — set expiry
once). Upstash docs confirm this is the canonical pattern.

### Jest (Unit / Integration Tests)

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| `jest` | 29.7.0 | Test runner | Already installed. Current stable is 30.x but upgrading mid-milestone risks churn. 29.x is fully supported and works with `next/jest`. |
| `jest-environment-jsdom` | 29.7.0 | DOM simulation for React components | Required for component tests. Already installed. |
| `@testing-library/react` | 16.3.2 | Component rendering and assertions | Standard for React 18+. Already installed. |
| `@testing-library/jest-dom` | 6.9.1 | DOM matchers (`.toBeInTheDocument()`) | Already installed. |
| `@testing-library/user-event` | 14.6.1 | Simulated user interactions | More accurate than `fireEvent`. Already installed. |

**Critical fix: rename `setupFilesAfterSetup` to `setupFilesAfterEnv`** in `jest.config.js`.
This is a typo in the existing config (confirmed by official Next.js docs). `setupFilesAfterSetup`
is not a valid Jest key — it silently does nothing, so `@testing-library/jest-dom` matchers are
never registered.

**Expand `collectCoverageFrom`** to include `components/**/*.{ts,tsx}` and `lib/**/*.{ts,tsx}`.
The current config only measures `app/api/**`, `lib/services/**`, and `lib/monitoring.ts` — this
dramatically understates what is built and misses all utility functions.

**Use `coverageProvider: 'v8'`** instead of the default Babel-based provider. V8 is built into
Node, is faster, and is recommended by Next.js official docs for App Router projects.

### Playwright (E2E Tests)

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| `@playwright/test` | 1.58.2 | E2E test runner | Already installed (1.57.0 in devDeps; 1.58.2 is latest). App Router async Server Components cannot be meaningfully unit-tested with Jest — E2E is the only way to test full comparison flows. |

**Do NOT use MapGrab** for map testing. The project was archived July 2025 and is now
read-only. It will not receive fixes.

**Map testing pattern without MapGrab:**
- Block tile requests with `page.route()` to prevent flakiness from CDN latency
- Wait for the map canvas element to appear (`page.locator('canvas')`) rather than
  `waitForLoadState('networkidle')` — Playwright maintainers explicitly discourage `networkidle`
  for SPAs with continuous background requests
- Assert route markers via `page.locator('[data-testid="route-marker"]')` with proper
  `data-testid` attributes on `MapMarker` components
- Use `page.waitForResponse()` for API assertions rather than timing-based waits

---

## Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@upstash/ratelimit` | 2.0.7 | Rate limiting (already in use) | Already wired. Not changing. |
| `zod` | 3.25.x | Input validation | Already in use for API route schemas. Not changing. |
| `sonner` | 2.0.7 | In-app toast notifications | Already installed. Use for price alert delivery (in-app only, no email). |

---

## Development Tools (No New Installs)

| Tool | Purpose | Notes |
|------|---------|-------|
| TypeScript strict mode | Catch `any` types at build time | Already configured. Expanding type coverage is a code change, not a new tool. |
| ESLint + `eslint-config-next` | Lint and App Router rule enforcement | Already configured. |
| Prettier | Code formatting | Already configured. |

---

## Installation

No new packages are needed for core functionality. The Axiom packages upgrade the existing
observability setup:

```bash
# Replace next-axiom with the new Axiom modular packages
npm uninstall next-axiom
npm install @axiomhq/logging @axiomhq/nextjs @axiomhq/react
```

No installs needed for: Redis caching (existing `@upstash/redis`), quota tracking (same),
Jest (existing), Playwright (existing).

---

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| Axiom `@axiomhq/nextjs` for errors | Sentry `@sentry/nextjs` | When you need session replay, performance waterfall traces, or user context not already captured in logs. Overkill for a portfolio app with Axiom already integrated. |
| Axiom `@axiomhq/nextjs` for errors | Highlight.io | When you don't have an existing logging solution and want a unified error+replay tool at no cost on the free tier. |
| Axiom `@axiomhq/nextjs` for errors | Baselime | Baselime has deeper OpenTelemetry/trace support, but was acquired by Cloudflare in 2024 — future roadmap is uncertain for non-Cloudflare deployments. |
| Jest 29 | Vitest | Vitest is faster and native ESM. Prefer it for greenfield projects. Migrating mid-milestone from Jest to Vitest requires reconfiguring all existing tests — not worth it here. |
| Playwright `page.route()` tile blocking | MapGrab | MapGrab is archived (July 2025, read-only). Do not use. |
| `redis.multi()` for quota | `redis.pipeline()` | Pipeline is acceptable when atomicity is not required (fire-and-forget cache writes). For quota enforcement, use `multi()`. |

---

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `next-axiom` | Maintenance-only mode, no new features, will lag behind Next.js App Router changes | `@axiomhq/nextjs` (same vendor, active) |
| `setupFilesAfterSetup` (the typo) | Not a valid Jest config key — silently ignored, `jest-dom` matchers never load | `setupFilesAfterEnv` (correct key per Jest docs) |
| `waitForLoadState('networkidle')` in Playwright | Discouraged by Playwright maintainers; SPAs with background polls never reach true idle | `page.waitForSelector()` or `page.waitForResponse()` |
| Module-level counters for AI quota | Evaporate between Vercel cold starts; race condition under concurrent requests | `redis.multi()` INCR + EXPIRE |
| In-memory Maps for geocode/route cache | Lost on every serverless function restart; defeats purpose of caching | `@upstash/redis` GET/SET with TTL |
| MapGrab | Archived July 2025, read-only, no bug fixes | `page.route()` + `page.locator('canvas')` native Playwright patterns |
| Sentry (the stub in monitoring.ts) | Never actually wired up; would add webpack plugin overhead and a second billing account | Axiom `@axiomhq/nextjs` — already integrated logging vendor |
| Baselime | Acquired by Cloudflare 2024; uncertain roadmap for non-Cloudflare Vercel deployments | Axiom or Highlight.io |

---

## Stack Patterns by Variant

**If error is caught in an API route handler:**
- Wrap the handler with `withAxiom` from `@axiomhq/nextjs`
- Call `req.log.error(message, { error, context })` — flushed automatically on response
- `onError` callback handles 5xx to set log level to `error`

**If error is caught in a client component:**
- Use React error boundary in `app/error.tsx` (App Router convention)
- Log via `@axiomhq/react` hook to flush before page transitions

**If cache key is a geocode result:**
- Key format: `cache:geocode:{normalizedAddress}` (lowercase, trimmed)
- TTL: 300 seconds (5 min — same as current in-memory TTL)
- On miss: call Nominatim, write result, return

**If quota tracking for AI:**
- Key format: `quota:ai:daily` (per app, not per user — simpler for a demo)
- `multi()` → `incr(key)` + conditional `expire(key, 86400)` if count === 1
- Read count before calling OpenAI; reject with 429 if over limit

---

## Version Compatibility

| Package | Compatible With | Notes |
|---------|-----------------|-------|
| `@axiomhq/nextjs@0.2.0` | Next.js 14.x | Tested against current Next.js App Router. Uses `instrumentation.ts` hook. |
| `@axiomhq/logging@0.2.0` | Node 18+ | Peer of `@axiomhq/nextjs`. |
| `jest@29.7.0` | `next@14.x`, `jest-environment-jsdom@29.x` | Major version must match between jest and jest-environment-jsdom. |
| `@playwright/test@1.58.2` | Next.js 14 dev server | `webServer.command` in playwright.config.ts must start the dev server. |
| `@upstash/redis@1.36.4` | Vercel Edge + Node runtime | HTTP-based; no persistent connection; compatible with both runtimes. |

---

## Sources

- [Axiom Next.js docs](https://axiom.co/docs/send-data/nextjs) — confirmed `@axiomhq/nextjs` as recommended replacement for `next-axiom`
- [Axiom new JS logging announcement](https://axiom.co/blog/new-js-logging) — package structure and `withAxiom` setup code (HIGH confidence)
- [Next.js Jest docs](https://nextjs.org/docs/app/guides/testing/jest) — confirmed `setupFilesAfterEnv` as correct key, `coverageProvider: 'v8'` recommendation (HIGH confidence, official)
- [Upstash quota blog](https://upstash.com/blog/quota-based-saas) — INCR + EXPIRE pattern (HIGH confidence, official Upstash)
- [Upstash pipeline/transaction docs](https://upstash.com/docs/redis/sdks/ts/pipelining/pipeline-transaction) — `redis.multi()` for atomicity (HIGH confidence, official)
- [Playwright network docs](https://playwright.dev/docs/network) — `page.route()` for mocking, `networkidle` discouraged (HIGH confidence, official)
- [MapGrab GitHub](https://github.com/MapGrab/map-grab-packages) — archived July 2025, read-only (HIGH confidence, verified)
- npm registry — verified versions: `@axiomhq/nextjs@0.2.0`, `@axiomhq/logging@0.2.0`, `@upstash/redis@1.36.4`, `@playwright/test@1.58.2`, `jest@30.3.0` (HIGH confidence)

---

*Stack research for: Next.js reliability, observability, and test coverage*
*Researched: 2026-03-10*
