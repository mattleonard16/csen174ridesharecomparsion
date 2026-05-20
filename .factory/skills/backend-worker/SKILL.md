---
name: backend-worker
description: Implements database functions, API routes, and server-side logic with tests
---

# Backend Worker

NOTE: Startup and cleanup are handled by `worker-base`. This skill defines the WORK PROCEDURE.

## When to Use This Skill

Features that involve:

- New or modified API route handlers (app/api/\*)
- Database query functions (lib/database-\*.ts)
- Zod validation schemas
- Server-side business logic

## Required Skills

None beyond standard tools.

## Work Procedure

### 1. Read Context

- Read `mission.md` for the full mission scope
- Read `AGENTS.md` for coding conventions and boundaries
- Read `.factory/library/architecture.md` for system understanding
- Read `.factory/library/environment.md` for env requirements
- Read the specific feature description carefully

### 2. Write Tests First (TDD — Red Phase)

- Write failing tests BEFORE implementation
- Tests go in `__tests__/` following existing patterns
- For API routes: test auth (401), validation (400), IDOR, happy path, error handling
- For DB functions: test with mocked Prisma, cover success/failure/empty states
- Run `npm test -- <test-file>` to confirm tests FAIL (red)

### 3. Implement (Green Phase)

- Follow existing patterns in the codebase (check similar files first)
- API routes: follow patterns in `app/api/price-alerts/route.ts` and `app/api/dashboard/route.ts`
  - Auth check with `getServerSession(authOptions)`
  - Zod validation with `safeParse`
  - CORS via `withCors()`, rate limiting via `withRateLimit()`
  - `getRequestId()` + `createResponseHeaders()` on all responses
  - `logError()` in catch blocks
  - Export `OPTIONS` handler for CORS preflight
- DB functions: follow patterns in `lib/database-logging.ts`
  - Guard with `isDatabaseAvailable()`
  - Wrap in try/catch with `reportPersistenceError()`
  - Import `prisma` from `@/lib/prisma` (NEVER from generated folder)
  - Return fallback values on failure (null, [], false)
- Run `npm test -- <test-file>` to confirm tests PASS (green)

### 4. Verify

- Run `npm run typecheck` — must pass with zero errors
- Run `npm run lint` — must pass with zero errors
- Run `npm test` — all tests must pass (not just new ones)
- Run `npm run format:check` — must pass

### 5. Manual Verification

- Start dev server if not running: `npm run dev`
- Test new endpoints with curl (with proper auth cookie)
- Verify error handling with invalid inputs
- Check that existing endpoints are not broken

### 6. Commit

- Stage only the files you created/modified
- Write a concise commit message following existing style (e.g., `feat(api): add price trends endpoints`)

## Example Handoff

```json
{
  "salientSummary": "Implemented GET /api/price-trends and /api/price-trends/summary endpoints with auth, validation, rate limiting, and CORS. Added 5 new database query functions in lib/database-price-trends.ts with proper error handling. All 16 API tests pass.",
  "whatWasImplemented": "Created lib/database-price-trends.ts with getMultiServicePriceHistory(), getPriceTrendSummary(), and helper functions. Created app/api/price-trends/route.ts (GET) and app/api/price-trends/summary/route.ts (GET) with full auth, Zod validation, CORS, rate limiting. Added 16 unit tests in __tests__/api/price-trends.test.ts covering auth, validation, IDOR, empty data, and happy path.",
  "whatWasLeftUndone": "",
  "verification": {
    "commandsRun": [
      {
        "command": "npm test -- __tests__/api/price-trends.test.ts",
        "exitCode": 0,
        "observation": "16 tests passed"
      },
      { "command": "npm run typecheck", "exitCode": 0, "observation": "No errors" },
      { "command": "npm run lint", "exitCode": 0, "observation": "No issues" },
      { "command": "npm test", "exitCode": 0, "observation": "All 424 tests pass" }
    ],
    "interactiveChecks": [
      {
        "action": "curl GET /api/price-trends?routeId=abc with auth cookie",
        "observed": "200 with price snapshots array"
      },
      {
        "action": "curl GET /api/price-trends without routeId",
        "observed": "400 with validation error"
      },
      { "action": "curl GET /api/price-trends without auth", "observed": "401 Unauthorized" }
    ]
  },
  "tests": {
    "added": [
      {
        "file": "__tests__/api/price-trends.test.ts",
        "cases": [
          { "name": "returns 401 without auth", "verifies": "VAL-API-004" },
          { "name": "returns 400 for missing routeId", "verifies": "VAL-API-005" },
          { "name": "returns price history for valid route", "verifies": "VAL-API-001" },
          { "name": "returns all services when service not specified", "verifies": "VAL-API-002" },
          { "name": "respects daysBack parameter", "verifies": "VAL-API-003" },
          { "name": "returns empty array for route with no data", "verifies": "VAL-API-006" },
          { "name": "includes x-request-id header", "verifies": "VAL-API-011" },
          { "name": "handles db unavailability gracefully", "verifies": "VAL-API-012" },
          { "name": "includes CORS headers", "verifies": "VAL-API-013" },
          { "name": "rate limiting applied", "verifies": "VAL-API-014" },
          { "name": "filters by service when specified", "verifies": "VAL-API-015" },
          { "name": "returns 400 for invalid service", "verifies": "VAL-API-017" },
          { "name": "summary returns aggregated stats", "verifies": "VAL-API-007" },
          { "name": "summary includes per-service breakdown", "verifies": "VAL-API-008" },
          { "name": "summary includes surge probability by hour", "verifies": "VAL-API-009" },
          { "name": "summary respects daysBack", "verifies": "VAL-API-016" }
        ]
      }
    ]
  },
  "discoveredIssues": []
}
```

## When to Return to Orchestrator

- Feature depends on an API endpoint or data model that doesn't exist yet
- Prisma migration is needed but you cannot create it safely
- Requirements are ambiguous or contradictory
- Existing bugs in unrelated code block this feature
