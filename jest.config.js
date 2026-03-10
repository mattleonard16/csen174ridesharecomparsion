const nextJest = require('next/jest')

const createJestConfig = nextJest({
  // Provide the path to your Next.js app to load next.config.js and .env files in your test environment
  dir: './',
})

// Add any custom config to be passed to Jest
const customJestConfig = {
  setupFilesAfterSetup: ['<rootDir>/jest.setup.ts'],
  testEnvironment: 'jest-environment-jsdom',
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
  },
  // Handle ESM modules from next-auth and related packages
  transformIgnorePatterns: ['/node_modules/(?!(next-auth|@auth|@panva)/)'],
  // Exclude Playwright e2e tests from Jest
  testPathIgnorePatterns: [
    '/node_modules/',
    '/e2e/',
    '/.next/',
    '/playwright-report/',
    '/test-results/',
  ],
  modulePathIgnorePatterns: [
    '<rootDir>/.next/',
    '<rootDir>/playwright-report/',
    '<rootDir>/test-results/',
  ],
  collectCoverageFrom: [
    'app/api/**/*.{ts,tsx}',
    'lib/services/**/*.{ts,tsx}',
    'lib/monitoring.ts',
    '!**/*.d.ts',
  ],
  coverageReporters: ['text', 'lcov'],
}

module.exports = createJestConfig(customJestConfig)
