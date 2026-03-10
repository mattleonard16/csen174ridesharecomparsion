import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'html',
  use: {
    baseURL: 'http://localhost:3100',
    trace: 'on-first-retry',
  },
  projects: process.env.CI
    ? [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }]
    : [
        { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
        {
          name: 'demo',
          use: {
            ...devices['Desktop Chrome'],
            viewport: { width: 1280, height: 720 },
            video: 'on',
            launchOptions: { slowMo: 600 },
          },
        },
      ],
  webServer: {
    command: 'npm run dev -- --port 3100',
    url: 'http://localhost:3100',
    reuseExistingServer: false,
    env: {
      ...process.env,
      NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET ?? 'test-secret',
      NEXTAUTH_URL: process.env.NEXTAUTH_URL ?? 'http://localhost:3100',
    },
  },
})
