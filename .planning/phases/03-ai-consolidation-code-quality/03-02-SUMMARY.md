---
phase: 03-ai-consolidation-code-quality
plan: 02
subsystem: infra
tags: [openai, anthropic, ai-insights, sdk-migration, environment]

# Dependency graph
requires:
  - phase: 03-01
    provides: Type safety and constants consolidation that stabilized the codebase before this SDK swap

provides:
  - OpenAI-backed AI insight generation via gpt-4o-mini in lib/services/ai-insights.ts
  - @anthropic-ai/sdk removed from package.json (dead dependency eliminated)
  - ENV_EXAMPLE.md documenting all required environment variables with OPENAI_API_KEY

affects: [04-price-alerts, any phase that touches ai-insights or environment variable docs]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "SDK swap: Anthropic client.messages.create -> OpenAI client.chat.completions.create"
    - "Response extraction: response.choices[0]?.message?.content ?? '' instead of content[0].text"
    - "Env var: OPENAI_API_KEY replaces ANTHROPIC_API_KEY for AI feature gating"

key-files:
  created:
    - ENV_EXAMPLE.md
  modified:
    - lib/services/ai-insights.ts
    - __tests__/services/ai-insights.test.ts
    - package.json
    - package-lock.json

key-decisions:
  - "OpenAI gpt-4o-mini replaces claude-haiku-4-5-20251001 — single AI vendor going forward"
  - "ENV_EXAMPLE.md created (did not exist before) — satisfies CLAUDE.md reference to this file"

patterns-established:
  - "Jest mock keyed on 'openai' module string — must match production import specifier exactly"
  - "Template fallback path unchanged — no API key or quota exceeded both route to generateTemplateMessages()"

requirements-completed: [INFR-07]

# Metrics
duration: 3min
completed: 2026-03-10
---

# Phase 3 Plan 02: AI SDK Consolidation Summary

**Replaced @anthropic-ai/sdk with openai SDK in ai-insights.ts: gpt-4o-mini via client.chat.completions.create, test mock updated, dead SDK uninstalled**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-10T21:15:55Z
- **Completed:** 2026-03-10T21:19:00Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- Swapped Anthropic SDK for OpenAI SDK in lib/services/ai-insights.ts — single AI vendor now
- Updated Jest mock from `jest.mock('@anthropic-ai/sdk')` to `jest.mock('openai')` with correct `choices[]` response shape
- Uninstalled `@anthropic-ai/sdk` from package.json and lock file
- Created ENV_EXAMPLE.md documenting all env vars with `OPENAI_API_KEY` (ANTHROPIC_API_KEY removed)

## Task Commits

Each task was committed atomically:

1. **Task 1: Swap Anthropic SDK for OpenAI in ai-insights.ts and update test mock** - `0d5a984` (feat)
2. **Task 2: Remove @anthropic-ai/sdk from package.json and update ENV_EXAMPLE.md** - `c484089` (chore)

**Plan metadata:** (see final docs commit)

## Files Created/Modified

- `lib/services/ai-insights.ts` - Replaced Anthropic import/client/API call/response extraction with OpenAI equivalents
- `__tests__/services/ai-insights.test.ts` - Updated mock from `@anthropic-ai/sdk` to `openai` with `choices[0].message.content` shape
- `package.json` - Removed `@anthropic-ai/sdk` dependency
- `package-lock.json` - Updated after npm uninstall
- `ENV_EXAMPLE.md` - Created with all env vars, OPENAI_API_KEY documented

## Decisions Made

- OpenAI gpt-4o-mini replaces claude-haiku-4-5-20251001 — consolidates to single AI vendor after Phase 2 migrated quota tracking to Redis
- ENV_EXAMPLE.md created fresh (file did not previously exist) — satisfies the CLAUDE.md reference `See ENV_EXAMPLE.md for complete reference`

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] ENV_EXAMPLE.md created instead of updated (file didn't exist)**
- **Found during:** Task 2 (update ENV_EXAMPLE.md)
- **Issue:** Plan said "update ENV_EXAMPLE.md" but file did not exist in the repo
- **Fix:** Created ENV_EXAMPLE.md with all current env vars, OPENAI_API_KEY documented, no ANTHROPIC_API_KEY
- **Files modified:** ENV_EXAMPLE.md (created)
- **Verification:** CLAUDE.md references ENV_EXAMPLE.md — file now exists and is accurate
- **Committed in:** c484089 (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 missing file created)
**Impact on plan:** Non-functional deviation — ENV_EXAMPLE.md content is identical to what update would have produced. No scope creep.

## Issues Encountered

None - plan executed cleanly. All 11 ai-insights tests pass. TypeScript typecheck exits 0.

## User Setup Required

None - no external service configuration required. OPENAI_API_KEY was already in .env.local from prior phases.

## Next Phase Readiness

- AI insight service is now using OpenAI exclusively — ready for Phase 3 remaining plans
- @anthropic-ai/sdk removed — no dead dependencies
- All tests green, typecheck clean

---
*Phase: 03-ai-consolidation-code-quality*
*Completed: 2026-03-10*
