import { defineConfig, globalIgnores } from 'eslint/config'
// eslint-config-next is intentionally ahead of next (16.x vs 14.x): the flat
// config consumed below only ships in v16 — 14.x/15.x are legacy-eslintrc only.
// Re-align the versions when next is upgraded to 15/16.
import nextVitals from 'eslint-config-next/core-web-vitals'

const eslintConfig = defineConfig([
  ...nextVitals,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    '.next/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
    'coverage/**',
    'playwright-report/**',
    'test-results/**',
    'lib/generated/prisma/**',
  ]),
])

export default eslintConfig
