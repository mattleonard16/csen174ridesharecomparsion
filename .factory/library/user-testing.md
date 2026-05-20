# User Testing

Testing surface, required testing skills/tools, resource cost classification per surface.

**What belongs here:** Validation surface findings, testing tools, resource cost classification, runtime gotchas.
**What does NOT belong here:** Service ports/commands (use `.factory/services.yaml`).

---

## Validation Surface

### Browser Surface (Primary)

- **Pages to test**: `/` (home/comparison), `/dashboard`, `/history`, `/trends`
- **Auth flows**: Login via NextAuth credentials provider, auth-gated redirects
- **Interactive elements**: Charts (Recharts — tooltips, zoom, service toggles), inline fare editing, delete confirmation, "I took this ride" button, route/service selectors
- **Theme switching**: Light/dark mode via `next-themes` — must test both for all charts
- **Responsive design**: Test at 320px, 375px, 768px, and desktop widths
- **Tool**: `agent-browser` (required for all browser validation)

### API Surface

- **Endpoints**: `/api/price-trends`, `/api/price-trends/summary`, `/api/ride-history` (GET/POST), `/api/ride-history/[id]` (PATCH/DELETE), `/api/dashboard`
- **Auth**: Session cookie required — use authenticated test user
- **Validation**: Zod schemas on all endpoints — test boundary conditions
- **IDOR**: Ownership verification on user-scoped resources
- **Tool**: `curl` with session cookie

## Validation Concurrency

### Resource Assessment

- **Machine**: 10 CPU cores, 16 GB RAM
- **Baseline usage**: ~6 GB RAM
- **Available headroom**: 10 GB × 0.7 = **7 GB usable**
- **Dev server**: ~200 MB
- **agent-browser per instance**: ~300 MB
- **Max concurrent validators**: **5** (5 × 300 MB + 200 MB = 1.7 GB, well within 7 GB budget)

### Per-Surface Classification

| Surface | Tool          | Resource Cost        | Max Concurrent |
| ------- | ------------- | -------------------- | -------------- |
| Browser | agent-browser | ~300 MB per instance | 5              |
| API     | curl          | Negligible           | Unlimited      |

## Runtime Gotchas

- **Recharts SSR**: Chart components MUST use `next/dynamic` with `ssr: false` — Recharts uses DOM APIs that crash during SSR
- **Hydration errors**: If charts are server-rendered, React hydration mismatches will occur — check console for these
- **Dark mode chart rendering**: Charts may need explicit theme prop — CSS variables alone may not propagate to SVG elements
- **Service worker caching**: The PWA service worker can cache stale API responses — may need to clear cache between tests
- **Database availability**: Tests should handle `isDatabaseAvailable() === false` gracefully — the app returns empty data, not errors
- **Test user**: Auth requires credentials — use test user created via `tsx scripts/create-test-user.ts`
- **Price data availability**: Trend charts need PriceSnapshot data — may need to seed data for validation
