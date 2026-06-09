---
title: 'fix: Tier 1 security & reliability hardening'
type: fix
status: active
date: 2026-06-09
---

# fix: Tier 1 Security & Reliability Hardening

## Overview

A focused hardening pass closing the highest-priority gaps found in the June 2026 project audit: fail-open quota/rate limiting when Redis is unavailable, unprotected and policy-less authentication, duplicated route-ownership checks, two cron jobs that are never scheduled, and an ESLint config version skew. Every item is small, independently shippable, and verified by tests.

**Audit corrections (for the record).** Three findings from the initial audit were revised after deeper research:

- `GET /api/ride-history` is **not** vulnerable to IDOR — it already filters by the authenticated `userId` and never trusts a client-supplied route ID for reads. No change needed.
- The CORS empty-string fallback in `lib/cors.ts:12` is **benign** — `.filter(Boolean)` removes it before matching. Downgraded to a cosmetic cleanup.
- The app has **no signup endpoint at all** (users are created only via `scripts/create-test-user.ts`), so the "weak password policy" applies to a flow that doesn't exist publicly. The real work is rate-limiting sign-in and defining the policy where passwords are actually created.

## Problem Statement / Motivation

- **Fail-open abuse controls**: `incrementQuotaCounter()` returns `0` on Redis failure (`lib/cache/redis-cache.ts:143-145`), which makes the AI daily quota check (`lib/services/ai-insights.ts:115-117`) always pass. Similarly, `checkRateLimit()` (`lib/rate-limiter.ts:255-265`) silently falls back to per-instance in-memory limits on Redis runtime errors — on Vercel, that means an attacker spread across serverless instances effectively resets their budget. The controls are weakest exactly when infrastructure is degraded.
- **Unprotected sign-in**: `app/api/auth/[...nextauth]/route.ts` exposes the credentials sign-in POST with no rate limiting — unlimited brute-force attempts. The credentials schema (`auth.ts:8-11`) accepts 1-character passwords.
- **Duplicated security code**: `verifyRouteOwnership()` is copy-pasted in `app/api/price-trends/route.ts:22-40` and `app/api/dashboard/route.ts:10-33`. Duplicate security helpers drift.
- **Dead crons**: `vercel.json` schedules only `/api/cron/cleanup`. The `aggregate-insights` and `weather` crons exist, are properly secured, and never run — so `RouteInsights` (which feeds recommendations and trends) silently goes stale.
- **Tooling skew**: `eslint-config-next@16.1.2` against `next@14.2.35`.

## Proposed Solution

Five independent work items, ordered by risk reduction per effort. Each lands as its own commit with tests.

---

### Item 1 — Fail-closed quota & rate limiting in production

**Policy** (applies to all three touch points):

| Condition | Development | Production |
| --- | --- | --- |
| Redis not configured (env vars missing) | In-memory fallback, debug log | In-memory fallback + loud startup warning (deploys without Upstash keep working, visibly) |
| Redis configured but **errors at runtime** | In-memory fallback | **Fail closed** (deny the request / treat quota as exceeded) + `logError` |

The distinction already exists in code: `lib/redis.ts:9-11` detects configuration (`isRedisConfigured`), and runtime errors surface as thrown exceptions in the existing `try/catch` blocks. The repo's established prod/dev pattern is `process.env.NODE_ENV === 'production'` (see `lib/monitoring.ts:16`, `lib/database-logging.ts:5`).

**Changes:**

1. **`lib/cache/redis-cache.ts` — `incrementQuotaCounter()` (lines 122-147)**
   - On runtime Redis error in production: return `Number.POSITIVE_INFINITY` instead of `0`, so every quota comparison (`count <= QUOTA`) fails and callers fall back to their non-AI template paths. Dev keeps returning `0` (fail-open) for local convenience.
   - When `redis` is `null` (unconfigured): keep returning `0` in dev; in production return `Number.POSITIVE_INFINITY` — `enhanceWithAI()` degrades gracefully to template recommendations, so users still get results.
2. **`lib/rate-limiter.ts` — `checkRateLimit()` catch block (lines 255-265)**
   - In production, when the Redis limiter **throws**, return `{ allowed: false, remainingRequests: 0, resetTime: now + 60s }` and `logError` with context, instead of falling back to in-memory. Dev keeps the in-memory fallback.
   - Keep in-memory fallback for the unconfigured case in both envs (matches CLAUDE.md's "cannot run locally without credentials" stance), but emit a one-time `console.warn` in production.
3. **`app/api/ai-insights/route.ts` — per-IP limiter (lines 18-31, 150-162)**
   - Apply the same policy to its inline `checkLimits()`: Redis runtime error in production → deny with 429 rather than silently using the per-process maps.
4. **Hash hygiene (small, same commit):** replace the additive string hash in `getClientId()` (`lib/rate-limiter.ts:84-105`) with `crypto.createHash('sha256').update(identifier).digest('hex').slice(0, 16)`. Collision-prone client IDs let one client consume another's bucket.

**Tests** (extend existing files, follow their mocking patterns):

- `__tests__/lib/cache/redis-cache.test.ts` — already covers the fail-open return on error (lines 244-252); add: `NODE_ENV=production` + Redis error → `POSITIVE_INFINITY`; production + unconfigured → `POSITIVE_INFINITY`.
- `__tests__/lib/rate-limiter.test.ts` — currently only tests the unconfigured path (`redis: null` mock at lines 3-6); add a mock where `redis` exists but `limit()` rejects: dev → in-memory fallback allows; production → denied with reset time.
- `__tests__/services/ai-insights.test.ts` — add: `incrementQuotaCounter` resolving to `POSITIVE_INFINITY` → OpenAI client never called, template fallback returned (mirrors the existing over-quota test at lines 200-224).

**Acceptance criteria:**

1. With `NODE_ENV=production` and a Redis client that throws, `POST /api/compare-rides` returns 429 (not 200 via in-memory fallback).
2. With the same conditions, `enhanceWithAI()` returns template recommendations and `openai.chat.completions.create` is never invoked.
3. Dev behavior is unchanged (all existing tests pass without modification).

---

### Item 2 — Rate-limit authentication + define password policy

**Changes:**

1. **`app/api/auth/[...nextauth]/route.ts`** — wrap the POST handler:

   ```typescript
   import { handlers } from '@/auth'
   import { withRateLimit } from '@/lib/rate-limiter'

   export const GET = handlers.GET
   export const POST = withRateLimit(handlers.POST)
   ```

   This throttles credentials sign-in attempts at the existing burst (3/10s) + hourly (50/h) limits per client. GET (session reads, CSRF token, providers) stays unthrottled — it's called on every page load by `SessionProvider` and would exhaust the budget instantly. Verify `withRateLimit`'s handler signature matches NextAuth's exported handler (both are `(req: Request) => Promise<Response>`-compatible; confirm the wrapper preserves the second route-context argument if present).

2. **`auth.ts:8-11`** — leave the sign-in schema at `min(1)`. Raising it would lock out any existing user with a short password while adding no security (sign-in validation doesn't constrain what's stored). Instead, add a shared password policy where passwords are *created*:
   - New `lib/password-policy.ts`: exported Zod schema — `z.string().min(8).max(128)` plus a not-only-whitespace refinement. Deliberately no composition rules (NIST 800-63B discourages them); length + rate limiting is the defense.
   - Apply it in `scripts/create-test-user.ts` (currently the only place passwords are hashed, at line 9).
   - **Decision needed (flagged, not blocking):** public self-serve signup is a product decision. If/when wanted, it's a new `app/api/auth/register/route.ts` using `withCors(withRateLimit(handler))`, the shared policy schema, and `bcrypt.hash(password, 12)`. This plan ships the policy module and protects sign-in; it does not add public registration.

**Tests:**

- New `__tests__/api/auth-rate-limit.test.ts` — mock `@/auth` handlers; assert the 4th rapid POST to the auth route returns 429 (reuse the request-builder pattern from `__tests__/lib/rate-limiter.test.ts`).
- New `__tests__/lib/password-policy.test.ts` — accepts 8+ chars, rejects 7 chars / whitespace-only / >128 chars.

**Acceptance criteria:** burst of 4 sign-in POSTs from one client → 4th gets 429 with `Retry-After`; `npm test` green.

---

### Item 3 — Consolidate `verifyRouteOwnership` + price-alerts consistency

**Changes:**

1. New `lib/route-ownership.ts` exporting the existing helper verbatim (signature `verifyRouteOwnership(userId: string, routeId: string): Promise<boolean>`; `SavedRoute.findUnique` on the `userId_routeId` composite key; mock-mode passthrough when `DATABASE_URL` unset; `catch → false`).
2. Replace the duplicates in `app/api/price-trends/route.ts:22-40` and `app/api/dashboard/route.ts:10-33` with imports. Behavior identical.
3. **`POST /api/price-alerts`** (`app/api/price-alerts/route.ts:17-82` → `createPriceAlert` in `lib/database-logging.ts:327-394`): current behavior — any authenticated user can create an alert on any existing `routeId`, which auto-creates a `SavedRoute` for them. This matches `saved-routes` POST semantics (routes are shared, non-secret entities with cuid IDs), so **keep the auto-save behavior** — it is by design, not an IDOR. Two consistency fixes only:
   - Return **404** (not the current generic 400) when the route doesn't exist, so clients can distinguish "bad route" from validation failures.
   - Add the missing **DELETE handler** documented in CLAUDE.md (`DELETE /api/price-alerts?id=...`): verify the alert's `userId` matches the session user before deleting (follow the ownership pattern in `app/api/ride-history/[id]/route.ts`, which passes `(id, userId)` to the database layer). Without it, users can create alerts they can never remove.

**Tests:**

- New `__tests__/lib/route-ownership.test.ts` — owns / doesn't own / DB-error → false / mock-mode → true.
- Extend `__tests__/api/price-alerts-route.test.ts` (mocking pattern: `jest.mock('@/lib/database')`) — nonexistent route → 404; DELETE own alert → 200; DELETE another user's alert → 403/404; DELETE unauthenticated → 401.

**Acceptance criteria:** zero copies of `verifyRouteOwnership` outside `lib/route-ownership.ts` (`grep -r "async function verifyRouteOwnership" app/` is empty); price-trends and dashboard route tests pass unchanged.

---

### Item 4 — Schedule the orphaned crons

**Change to `vercel.json`:**

```json
{
  "crons": [
    { "path": "/api/cron/cleanup", "schedule": "0 3 * * *" },
    { "path": "/api/cron/aggregate-insights", "schedule": "0 2 * * *" },
    { "path": "/api/cron/weather", "schedule": "0 */6 * * *" }
  ]
}
```

- `aggregate-insights` daily at 2 AM UTC (before cleanup at 3 AM, so insights aggregate over data that's about to be pruned). Hourly would be nicer but wait for the pagination work (Tier 3) before increasing frequency — the job is O(routes × services) in a single invocation.
- `weather` every 6 hours — enough granularity for the pricing model's weather signal without burning function invocations.
- **Plan constraint:** Vercel Hobby allows limited cron jobs that trigger at most once per day. If this project deploys on Hobby, use `"0 1 * * *"` for weather and accept three daily crons — or drop weather and keep the two that matter. Confirm the plan tier before merging; the file change is trivial either way.
- `weather/route.ts` accepts GET only — Vercel crons invoke via GET, so no route change needed.

**Acceptance criteria:** after deploy, the Vercel dashboard shows three cron jobs; `RouteInsights.updatedAt` advances daily (observable in Prisma Studio or via the dashboard API).

---

### Item 5 — ESLint config version alignment

`eslint-config-next@16.1.2` with `next@14.2.35`. Complication: the repo uses **flat config** (`eslint.config.mjs` imports `eslint-config-next/core-web-vitals` directly), and `eslint-config-next@14` does not ship flat-config exports — pinning straight to 14 would break `npm run lint`.

**Change:** pin to `eslint-config-next@^15.x` — the earliest line with native flat-config exports, with rules far closer to Next 14 than the v16 line. Verify with `npm run lint` and fix any new findings (expected: none or trivial).

**Fallback** if 15.x's flat export shape differs: stay on 16.1.2 and instead record the real remediation — the Next 15/16 upgrade (already Tier 3) — as the closing action, with a comment in `eslint.config.mjs` explaining the deliberate skew.

**Cosmetic rider (same commit):** `lib/cors.ts:12` — drop the `|| ''` (dead weight; `.filter(Boolean)` already handles it) and add a one-time production `console.warn` when `NEXT_PUBLIC_APP_URL` is unset, since CORS then only allows localhost.

**Acceptance criteria:** `npm run lint` and `npm run typecheck` pass; `npm ls eslint-config-next` shows the pinned major.

## Implementation Order & Estimates

| # | Item | Risk closed | Size |
| --- | --- | --- | --- |
| 1 | Fail-closed quota & rate limiting | Abuse/cost control bypass under degraded Redis | M (~half day incl. tests) |
| 2 | Auth rate limiting + password policy module | Brute-force sign-in | S |
| 3 | Ownership helper consolidation + alert DELETE | Drift in security code; orphaned alerts | S |
| 4 | Cron schedules | Stale insights feeding recommendations | XS |
| 5 | ESLint pin + CORS cleanup | Tooling correctness | XS |

All items are independent; 4 and 5 can land immediately. Sequence 1 → 2 → 3 for the code changes since 2 and 3 build on patterns touched in 1 (`withRateLimit`, test mocks).

## Out of Scope (deliberately)

- Public signup/registration endpoint — product decision, flagged in Item 2.
- Token-based (vs call-based) AI cost accounting — worthwhile, but Tier 2; fail-closed quota removes the unbounded-cost failure mode first.
- Cron pagination, Next 15 / next-auth stable / next-pwa replacement — Tier 3.
- Account lockout / 2FA / email verification — needs the registration story first.

## Verification

Per item: unit tests above. Globally before merge: `npm run quality` (typecheck + lint + format + test) and `npm run test:e2e:smoke`.
