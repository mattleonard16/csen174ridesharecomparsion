import { defineConfig, devices } from '@playwright/test'

/**
 * Vercel demo recording config — targets the live production deployment.
 * Run with: npm run demo:vercel
 * Output video will be saved to playwright-report/
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/demo-showcase.spec.ts',
  fullyParallel: false,
  retries: 1,
  workers: 1,
  reporter: [['html', { open: 'never' }], ['list']],
  use: {
    baseURL: 'https://ridesharecomparsion.vercel.app',
    trace: 'on',
  },
  projects: [
    {
      name: 'vercel-demo',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 720 },
        video: 'on',
        launchOptions: {
          slowMo: 700,
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            // Enable software WebGL so MapLibre GL renders in headless Chrome
            '--use-gl=swiftshader',
            '--enable-webgl',
            '--ignore-gpu-blacklist',
          ],
        },
      },
    },
  ],
  // No webServer — we use the live Vercel deployment
})
