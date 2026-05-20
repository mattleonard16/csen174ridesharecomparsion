# Environment

Environment variables, external dependencies, and setup notes.

**What belongs here:** Required env vars, external API keys/services, dependency quirks, platform-specific notes.
**What does NOT belong here:** Service ports/commands (use `.factory/services.yaml`).

---

## Required Environment Variables

All variables go in `.env.local` (local) or `.env` (Docker). Never commit secrets.

```bash
DATABASE_URL="postgresql://..."         # Prisma connection string
DIRECT_URL="postgresql://..."           # Direct database connection (for migrations)
UPSTASH_REDIS_REST_URL="https://..."   # Rate limiting (optional for local dev)
UPSTASH_REDIS_REST_TOKEN="..."         # Rate limiting (optional for local dev)
RECAPTCHA_SECRET_KEY="..."             # reCAPTCHA v3 (optional — degraded mode without it)
AUTH_SECRET="..."                      # NextAuth JWT signing (generate: openssl rand -base64 32)
NEXTAUTH_URL="http://localhost:3000"   # Auth callback URL
```

## External Dependencies

- **PostgreSQL**: Must be running on localhost:5432. Native install (not Docker for this mission).
- **Upstash Redis**: Optional for local dev — rate limiting gracefully degrades without it.
- **Nominatim API**: Used for geocoding. Free but rate-limited. Cached for 5 minutes.
- **OSRM API**: Used for route distance/duration. Free. Cached.
- **OpenAI API**: Used for AI-powered ride recommendations. Requires `OPENAI_API_KEY` env var (optional).

## Dependency Quirks

- **Node.js 20**: Specified in `.nvmrc`. Run `nvm use` before development.
- **Prisma custom output**: Client generated at `lib/generated/prisma`. Always import from `@/lib/prisma`.
- **Next.js 14**: App Router only. No Pages Router.
- **next-pwa**: Only active in production builds. Disabled in dev to avoid babel issues.
- **Recharts**: Must be dynamically imported with `ssr: false` in Next.js App Router.

## Platform Notes

- **macOS (Darwin)**: Development machine. PostgreSQL installed via Homebrew or Postgres.app.
- **Vercel**: Production deployment target. Serverless functions, edge middleware.
- **Docker**: Available but not currently running. Use native PostgreSQL for this mission.
