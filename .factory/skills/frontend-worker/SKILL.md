---
name: frontend-worker
description: Implements React components, pages, and UI features with charts and tests
---

# Frontend Worker

NOTE: Startup and cleanup are handled by `worker-base`. This skill defines the WORK PROCEDURE.

## When to Use This Skill

Features that involve:
- New or modified React components (components/*)
- New pages (app/*/page.tsx)
- Chart components using Recharts
- UI interactions, forms, navigation
- Client-side data fetching and state management

## Required Skills

- `agent-browser` — for verifying visual rendering and interactions in the browser

## Work Procedure

### 1. Read Context
- Read `mission.md` for the full mission scope
- Read `AGENTS.md` for coding conventions and boundaries
- Read `.factory/library/architecture.md` for system understanding
- Read `.factory/library/user-testing.md` for testing surface details
- Read the specific feature description carefully

### 2. Study Existing Patterns
Before writing code, study these reference files:
- **Page pattern**: `app/dashboard/page.tsx` — auth guard, data fetching, loading/error/empty states
- **Component pattern**: `components/history/ride-history-card.tsx` — reusable card with actions
- **Chart integration**: Dashboard currently renders text lists — you are replacing these with Recharts
- **Theme**: `next-themes` for dark mode — charts must support both themes

### 3. Write Tests First (TDD — Red Phase)
- Write failing component tests BEFORE implementation
- Tests go in `__tests__/` following existing patterns
- For chart components: test rendering, data binding, empty/loading/error states
- For pages: test auth redirect, data display, user interactions
- Use React Testing Library — mock fetch, test visual output
- Run `npm test -- <test-file>` to confirm tests FAIL (red)

### 4. Implement (Green Phase)

#### Chart Components (CRITICAL)
- ALL Recharts components MUST be loaded via `next/dynamic` with `ssr: false`:
  ```tsx
  const PriceChart = dynamic(() => import('./price-chart'), { ssr: false })
  ```
- Each chart should be a separate component file for tree-shaking
- Use `useTheme()` from `next-themes` to detect dark mode — pass theme-aware colors to Recharts
- Responsive: wrap charts in a container div, use Recharts' `ResponsiveContainer`
- Tooltips: customize with `content` prop for rich data display

#### Page Patterns
- `'use client'` directive at top
- Auth guard: `useAuth()` → redirect if unauthenticated
- Data fetching: `fetch()` in `useCallback`, triggered by `useEffect`
- Loading state: spinner/skeleton during data fetch
- Error state: error banner with Retry button
- Empty state: icon + message + CTA

#### Styling
- Tailwind CSS utilities — match existing dashboard style
- Use existing design tokens: `text-primary`, `bg-muted`, `card-elevated`, etc.
- Dark mode: test both themes explicitly
- Responsive: use `grid-cols-1 lg:grid-cols-2` patterns

- Run `npm test -- <test-file>` to confirm tests PASS (green)

### 5. Visual Verification with agent-browser
- Start dev server if not running: `npm run dev`
- Use `agent-browser` skill to verify:
  - Chart renders with data
  - Dark mode renders correctly
  - Responsive at mobile width
  - Tooltips appear on hover
  - Navigation between pages works
  - Empty/loading/error states display correctly
- Document each check as an `interactiveChecks` entry

### 6. Quality Gates
- Run `npm run typecheck` — must pass
- Run `npm run lint` — must pass
- Run `npm test` — ALL tests pass (not just new ones)
- Run `npm run format:check` — must pass
- No hydration errors in console (check agent-browser output)

### 7. Commit
- Stage only your files
- Concise commit message (e.g., `feat(ui): add price trends line chart to dashboard`)

## Example Handoff

```json
{
  "salientSummary": "Replaced dashboard text-based price trends with interactive Recharts LineChart supporting multi-service overlay. Added hourly averages BarChart with color-coded price bands. All charts support dark mode and are responsive. 5 new component tests pass.",
  "whatWasImplemented": "Created components/charts/price-trends-chart.tsx (dynamic import, SSR disabled), components/charts/hourly-averages-chart.tsx, components/charts/surge-chart.tsx. Modified app/dashboard/page.tsx to replace text lists with chart components. Added service multi-select toggle. All charts use next-themes for dark mode.",
  "whatWasLeftUndone": "",
  "verification": {
    "commandsRun": [
      { "command": "npm test -- __tests__/components/price-trends-chart.test.tsx", "exitCode": 0, "observation": "5 tests passed" },
      { "command": "npm run typecheck", "exitCode": 0, "observation": "No errors" },
      { "command": "npm run lint", "exitCode": 0, "observation": "No issues" },
      { "command": "npm test", "exitCode": 0, "observation": "All 429 tests pass" }
    ],
    "interactiveChecks": [
      { "action": "Navigate to /dashboard, select route, verify line chart renders", "observed": "LineChart visible with 7 days of price data, axes and legend present" },
      { "action": "Toggle dark mode, verify chart colors update", "observed": "Chart background darkens, text becomes light, data lines remain visible" },
      { "action": "Click 'All Services' toggle", "observed": "Four lines appear (Uber/Lyft/Taxi/Waymo) with distinct colors and legend" },
      { "action": "Resize to 320px viewport", "observed": "Chart resizes to fit, no horizontal scroll" },
      { "action": "Hover over data point", "observed": "Tooltip appears with price, time, service, surge info" }
    ]
  },
  "tests": {
    "added": [
      { "file": "__tests__/components/price-trends-chart.test.tsx", "cases": [
        { "name": "renders line chart with price data", "verifies": "VAL-DB-001" },
        { "name": "renders multi-service overlay", "verifies": "VAL-DB-002" },
        { "name": "shows empty state when no data", "verifies": "VAL-DB-011" },
        { "name": "renders in dark mode without errors", "verifies": "VAL-DB-009" },
        { "name": "renders with single data point", "verifies": "VAL-DB-017" }
      ] }
    ]
  },
  "discoveredIssues": []
}
```

## When to Return to Orchestrator

- Required API endpoint doesn't exist yet (depends on backend-worker)
- Charting library needs configuration beyond your scope
- Design decisions require user input (e.g., chart color scheme, layout)
- Existing component you depend on has bugs that block your work
