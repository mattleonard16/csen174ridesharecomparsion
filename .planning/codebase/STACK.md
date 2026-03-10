# Technology Stack

**Analysis Date:** 2026-03-10

## Languages

**Primary:**
- TypeScript 5.x - All application code (server, client, config)
- JavaScript - Legacy config files (`jest.config.js`, `postcss.config.mjs`)

**Secondary:**
- SQL (PostgreSQL dialect) - Via Prisma schema migrations

## Runtime

**Environment:**
- Node.js 20.18.0 (pinned via `.nvmrc`)

**Package Manager:**
- npm (no version pin)
- Lockfile: `package-lock.json` present

## Frameworks

**Core:**
- Next.js 14.2.35 - App Router, SSR/SSG, API routes, standalone output for Docker
- React 18.x - UI layer
- next-auth 5.0.0-beta.30 (v5 beta) - Authentication with JWT strategy

**Styling:**
- Tailwind CSS 3.4.1 - Utility classes
- `tailwind-merge` 3.x + `class-variance-authority` - Dynamic class merging
- `tailwindcss-animate` - Animation utilities
- Framer Motion 12.x - Complex animation (used in `components/ui/3d-adaptive-navigation-bar.tsx`)
- `next-themes` - Light/dark mode

**Build/Dev:**
- PostCSS 8.x - CSS pipeline (`postcss.config.mjs`)
- `tsx` 4.x - TypeScript script execution (`scripts/seed.ts`, `scripts/fetch-quotes.ts`)
- `https-localhost` - Dev HTTPS support (`npm run dev:https`)

**Testing:**
- Jest 29.7.0 with `jest-environment-jsdom` - Unit/integration tests
- `@testing-library/react` 16.x + `@testing-library/user-event` 14.x - Component testing
- `@testing-library/jest-dom` 6.x - Extended matchers
- Playwright 1.57.0 - E2E tests (Chromium only, runs on port 3100)

## Key Dependencies

**Critical:**
- `@prisma/client` 6.16.2 - Database ORM (custom output: `lib/generated/prisma`)
- `prisma` 6.16.2 (devDep) - Schema/migration CLI
- `next-auth` + `@auth/prisma-adapter` - Auth session management
- `zod` 3.25.x - Schema validation throughout API and auth layers
- `bcryptjs` 3.x - Password hashing for credentials auth
- `ngeohash` 0.6.3 - Geohash encoding for spatial clustering (transpiled via `transpilePackages`)

**Infrastructure:**
- `@upstash/ratelimit` 2.x + `@upstash/redis` 1.35.x - Distributed rate limiting (falls back to in-memory if unconfigured)
- `@anthropic-ai/sdk` 0.74.x - Claude Haiku for AI-enhanced recommendations (`lib/services/ai-insights.ts`)
- `@vercel/analytics` 1.5.x - Production usage analytics
- `maplibre-gl` 5.15.x - Interactive map rendering with CARTO basemap tiles
- `p-retry` 5.x - Retry logic for upstream HTTP calls
- `sonner` 2.x - Toast notifications
- `lucide-react` 0.507.x - Icon library

**UI Primitives:**
- `@radix-ui/react-label`, `@radix-ui/react-slot`, `@radix-ui/react-switch` - Accessible headless UI primitives

## Configuration

**TypeScript:**
- Config: `tsconfig.json`
- Strict mode enabled
- Path alias: `@/*` maps to project root
- Module resolution: `bundler`

**ESLint:**
- Config: `eslint.config.mjs` (flat config format, ESLint 9.x)
- `eslint-config-next` 16.1.2

**Prettier:**
- Config: checked via `npm run format:check`, written via `npm run format`

**Tailwind:**
- Config: `tailwind.config.ts`

**Next.js:**
- Config: `next.config.mjs`
- Output: `standalone` (Docker-compatible)
- PWA: `next-pwa` enabled in production only (disabled in dev to avoid Babel conflicts)
- Security headers applied to all routes (CSP, HSTS, X-Frame-Options, etc.)

**Jest:**
- Config: `jest.config.js`
- Setup: `jest.setup.ts` (loads `@testing-library/jest-dom`)
- Path alias: `@/` → root
- Excludes: `e2e/`, `.next/`, Playwright reports
- Transforms: `next-auth` and `@auth` packages excluded from `transformIgnorePatterns`

**Playwright:**
- Config: `playwright.config.ts`
- Base URL: `http://localhost:3100`
- Browser: Chromium (Desktop Chrome) only
- Spins up `npm run dev -- --port 3100` as web server

## Platform Requirements

**Development:**
- Node.js 20.18.0
- Docker + Docker Compose (optional, for local Postgres via `docker compose up -d db`)
- Upstash Redis optional (rate limiting falls back to in-memory without it)
- PostgreSQL 16 (via Docker or managed provider like Neon)

**Production:**
- Deployed to Vercel (`output: 'standalone'` for build)
- Vercel cron job: `GET /api/cron/cleanup` daily at 03:00 UTC (configured in `vercel.json`)
- Prisma generate runs automatically on `postinstall` and before `build`
- TypeScript and ESLint checks enforced at build time (no `ignoreBuildErrors`)

---

*Stack analysis: 2026-03-10*
