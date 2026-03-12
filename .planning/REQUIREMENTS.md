# Requirements: Comparative Rideshares — Reliability Milestone

**Defined:** 2026-03-10
**Core Value:** Every feature that exists must actually work — no stubs, no fake data, no dead code paths

## v1 Requirements

Requirements for this milestone. Each maps to roadmap phases.

### Test Infrastructure

- [x] **TEST-01**: Jest setup file loads correctly (`setupFilesAfterEnv` typo fixed)
- [x] **TEST-02**: Coverage config measures full codebase (components, lib, hooks — not just app/api/ and lib/services/)
- [ ] **TEST-03**: E2E test covers happy path comparison flow (enter addresses → get results → see map route)

### Observability

- [x] **OBSV-01**: Health check endpoint probes real database connectivity with measured latency
- [x] **OBSV-02**: Health check endpoint probes Redis connectivity with measured latency
- [x] **OBSV-03**: Error tracking captures production errors via Axiom (Sentry stub replaced with @axiomhq/nextjs)
- [x] **OBSV-04**: Cache operations log hit/miss ratios observable in Axiom

### Infrastructure

- [x] **INFR-01**: Geocode cache persists across serverless instances via Redis with TTL
- [x] **INFR-02**: Route cache persists across serverless instances via Redis with TTL
- [x] **INFR-03**: Comparison cache persists across serverless instances via Redis with TTL
- [x] **INFR-04**: Recommendations cache persists across serverless instances via Redis with TTL
- [x] **INFR-05**: AI response cache persists across serverless instances via Redis with TTL
- [x] **INFR-06**: AI quota tracking uses Redis atomic counters (INCR + EXPIREAT) with daily TTL
- [x] **INFR-07**: AI insight generation uses OpenAI only (Anthropic SDK dependency removed)

### Core Features

- [ ] **FEAT-01**: User sees in-app notification when a saved price alert's target price is reached
- [x] **FEAT-02**: Compare-rides API accepts single unified request format (legacy string format removed)

### Code Quality

- [x] **QUAL-01**: TypeScript `any` types replaced with proper interfaces in database-logging, monitoring, and dashboard
- [x] **QUAL-02**: Duplicated COMMON_PLACES consolidated to single source in `lib/constants.ts`
- [x] **QUAL-03**: Hardcoded external API URLs centralized through API_CONFIG

## v2 Requirements

Deferred to future milestone. Tracked but not in current roadmap.

### Test Coverage Expansion

- **TEST-04**: E2E tests cover error states (geocode failure, OSRM timeout, bad address)
- **TEST-05**: Unit tests for database-logging.ts and database-routes.ts
- **TEST-06**: Unit tests for dashboard page (auth redirect, data loading, chart rendering)
- **TEST-07**: Unit tests for ride-comparison-results.tsx (surge display, recommendations, alert creation)

### Code Quality

- **QUAL-04**: Large files refactored into focused modules (<800 lines each)
- **QUAL-05**: Centralized auth middleware replacing per-handler auth() calls

### New Features

- **FEAT-03**: Price trend charts from collected price snapshot data
- **FEAT-04**: Multi-stop / round-trip comparison
- **FEAT-05**: Scheduled rides ("what will this cost at 8am tomorrow?")

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Email/push notification delivery | In-app only sufficient for demo; external provider adds complexity (Resend/SendGrid/FCM) |
| SSE / WebSocket real-time updates | Vercel 25s timeout makes SSE unreliable; polling is imperceptible for price alerts |
| Full Sentry APM integration | Axiom already integrated; @axiomhq/nextjs provides error capture without Sentry SDK overhead |
| Session replay / RUM | Heavy SDK, privacy implications; not relevant for portfolio demo |
| CI/CD pipeline | Vercel handles deployment; custom pipeline duplicates without adding value |
| Expanding beyond Bay Area | Requires new data sources and infrastructure; not reliability work |
| Social features | New feature category, not reliability work |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| TEST-01 | Phase 1 | Complete |
| TEST-02 | Phase 1 | Complete |
| TEST-03 | Phase 4 | Pending |
| OBSV-01 | Phase 1 | Complete |
| OBSV-02 | Phase 1 | Complete |
| OBSV-03 | Phase 1 | Complete |
| OBSV-04 | Phase 1 | Complete |
| INFR-01 | Phase 2 | Complete |
| INFR-02 | Phase 2 | Complete |
| INFR-03 | Phase 2 | Complete |
| INFR-04 | Phase 2 | Complete |
| INFR-05 | Phase 2 | Complete |
| INFR-06 | Phase 2 | Complete |
| INFR-07 | Phase 3 | Complete |
| FEAT-01 | Phase 4 | Pending |
| FEAT-02 | Phase 3 | Complete |
| QUAL-01 | Phase 3 | Complete |
| QUAL-02 | Phase 3 | Complete |
| QUAL-03 | Phase 3 | Complete |

**Coverage:**
- v1 requirements: 19 total
- Mapped to phases: 19
- Unmapped: 0

---
*Requirements defined: 2026-03-10*
*Last updated: 2026-03-10 — traceability populated after roadmap creation*
