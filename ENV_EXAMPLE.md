# Environment Variables Reference

Copy this file to `.env.local` and fill in the values for local development.

## Database

```bash
DATABASE_URL="postgresql://..."         # Prisma connection string (pooled)
DIRECT_URL="postgresql://..."           # Direct database connection (for migrations)
```

## Authentication

```bash
AUTH_SECRET="..."                       # NextAuth.js JWT signing secret (generate with: openssl rand -base64 32)
NEXTAUTH_URL="http://localhost:3000"    # Auth callback URL (set to production URL in production)
```

## OpenAI

```bash
OPENAI_API_KEY="sk-..."                 # OpenAI API key for AI insight generation
AI_DAILY_QUOTA="500"                    # Max AI API calls per day (default: 500)
```

## Rate Limiting (Upstash Redis)

```bash
UPSTASH_REDIS_REST_URL="https://..."   # Upstash Redis REST URL
UPSTASH_REDIS_REST_TOKEN="..."         # Upstash Redis REST token
```

## reCAPTCHA

```bash
NEXT_PUBLIC_RECAPTCHA_SITE_KEY="..."   # reCAPTCHA v3 site key (public)
RECAPTCHA_SECRET_KEY="..."             # reCAPTCHA v3 secret key (server-side only)
RECAPTCHA_API_KEY="..."                # reCAPTCHA API key (for Enterprise)
RECAPTCHA_PROJECT_ID="..."             # reCAPTCHA project ID (for Enterprise)
```

## Vercel / Deployment

```bash
CRON_SECRET="your-cron-secret"        # Required for Vercel cron job authentication (all /api/cron/* endpoints)
```

## Optional

```bash
OPENAI_RATE_LIMIT="5"                  # Per-IP rate limit for OpenAI proxy (default: 5)
OPENAI_DAILY_CAP="200"                 # Daily cap for OpenAI proxy requests (default: 200)
```

## Notes

- All variables marked `NEXT_PUBLIC_*` are exposed to the browser — do not put secrets in them
- `DATABASE_URL` vs `DIRECT_URL`: use pooled URL for app connections, direct URL for Prisma migrations
- Upstash Redis is required for rate limiting and cache quota tracking; app degrades gracefully without it
- reCAPTCHA verification is skipped on precomputed routes and logs a warning on failure rather than blocking requests
