# Comparative Rideshares — Reliability Milestone

## What This Is

A Next.js 14 ride comparison app for the Bay Area that compares prices and wait times across Uber, Lyft, Taxi, and Waymo. Features real-time surge pricing, interactive MapLibre route mapping, price alerts, AI-powered recommendations, and a user dashboard. Deployed on Vercel with PostgreSQL (Prisma) and Upstash Redis.

The app has a solid feature set but several core features are broken or misleading. This milestone focuses on making the app reliable, observable, and demo-safe — both as a live walkthrough and a portfolio piece.

## Core Value

Every feature that exists in the app must actually work — no stubs, no fake data, no dead code paths. A recruiter or colleague clicking around should see a polished, production-quality application.

## Requirements

### Validated

<!-- Shipped and confirmed valuable. -->

- ✓ User can compare ride prices across Uber, Lyft, Taxi, and Waymo — existing
- ✓ Pricing engine calculates fares with surge, traffic, airport fees — existing
- ✓ User can view rides on an interactive map with route visualization — existing
- ✓ User can sign up, log in, and maintain sessions (NextAuth JWT) — existing
- ✓ User can save routes and create price alerts — existing (save/create only, no delivery)
- ✓ Popular Bay Area routes return instant results via precomputed data — existing
- ✓ Rate limiting protects API endpoints (Upstash Redis) — existing
- ✓ reCAPTCHA v3 guards comparison requests — existing
- ✓ OSRM routing falls back to haversine estimation when unavailable — existing
- ✓ PWA enabled with offline tile caching — existing
- ✓ AI-powered ride recommendations generated per comparison — existing

### Active

<!-- Current scope. Building toward these. -->

- [ ] Price alerts actually deliver notifications in-app when prices drop below target
- [ ] Health check endpoint probes real database connectivity
- [ ] Error tracking captures and alerts on production errors (replace Sentry stub)
- [ ] Jest setup loads correctly and coverage config measures the full codebase
- [ ] E2E tests cover the full comparison flow (happy path + error states)
- [ ] Caches (geocode, route, recommendations, AI) persist across serverless instances via Redis
- [ ] AI quota tracking uses Redis atomic counters instead of module-level variables
- [ ] Duplicated constants consolidated to single source of truth
- [ ] Hardcoded external API URLs centralized through API_CONFIG
- [ ] AI insight generation consolidated to single provider (OpenAI)
- [ ] Large files refactored into focused modules (<800 lines each)
- [ ] Legacy/new dual request format unified in compare-rides API
- [ ] TypeScript `any` types replaced with proper interfaces

### Out of Scope

<!-- Explicit boundaries. Includes reasoning to prevent re-adding. -->

- Email/push notification delivery for alerts — in-app only is sufficient for demo; external delivery adds provider complexity (Resend/SendGrid/FCM)
- Multi-stop or round-trip comparison — new feature, not reliability work
- Scheduled rides / "what will this cost tomorrow" — new feature
- Price trend charts — nice-to-have but not reliability
- Social features (sharing, collaborative planning) — new feature category
- Expanding beyond Bay Area — requires new data sources and infrastructure
- CI/CD pipeline — Vercel handles deployment; no custom pipeline needed now
- Centralized auth middleware — per-handler auth works and is testable; middleware adds complexity without clear benefit for current route count

## Context

- **Deployment**: Vercel with standalone Next.js output; PostgreSQL via managed provider; Upstash Redis for rate limiting
- **External dependencies**: Public Nominatim (geocoding) and OSRM (routing) instances — no SLA, rate-limited; precomputed routes mitigate this for popular queries
- **Current test state**: Jest config has a typo (`setupFilesAfterSetup` instead of `setupFilesAfterSetup`), coverage only measures `app/api/`, `lib/services/`, `lib/monitoring.ts`; E2E tests only cover navigation smoke tests
- **AI providers**: Currently uses both Anthropic SDK (Claude Haiku) and OpenAI — consolidating to OpenAI only
- **Codebase audit** completed 2026-03-10 identifying 15 issues across critical/high/medium priority

## Constraints

- **Tech stack**: Next.js 14 App Router, TypeScript, Prisma, Upstash Redis — no framework changes
- **Error tracking**: Open to lightweight alternatives to Sentry (Axiom already integrated for logging)
- **AI provider**: Consolidate to OpenAI (remove Anthropic SDK)
- **Redis**: Reuse existing Upstash instance for caches and AI quota (single instance)
- **File size**: Keep all files under 800 lines

## Key Decisions

<!-- Decisions that constrain future work. Add throughout project lifecycle. -->

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| In-app alerts only (no email/push) | Simplicity for demo; avoids email provider setup | — Pending |
| Consolidate to OpenAI, remove Anthropic SDK | Reduce secrets, quota tracking, maintenance burden | — Pending |
| Reuse Upstash Redis instance for caches | Already provisioned; keeps infrastructure simple | — Pending |
| Lightweight error tracking over Sentry | Axiom already captures logs; need alerting, not full APM | — Pending |

---
*Last updated: 2026-03-10 after initialization*
