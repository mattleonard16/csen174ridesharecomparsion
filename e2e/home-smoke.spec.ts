import { test, expect } from '@playwright/test'

test.setTimeout(30000)

test.describe('Home Page Smoke Tests', () => {
  test('page loads without JS errors', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', err => errors.push(err.message))
    const response = await page.goto('/')
    expect(response?.status()).toBe(200)
    // Wait for page to settle
    await page.waitForLoadState('networkidle')
    expect(errors).toEqual([])
  })

  test('Hero section renders', async ({ page }) => {
    await page.goto('/')
    const hero = page.locator('#home')
    await expect(hero).toBeVisible()
    await expect(hero.locator('h1')).toContainText('Compare rides')
  })

  test('Routes section renders with route cards', async ({ page }) => {
    await page.goto('/')
    const routes = page.locator('#routes')
    // Scroll into view since the page uses snap scrolling
    await routes.scrollIntoViewIfNeeded()
    await expect(routes).toBeVisible()
    // Check that route cards are present
    await expect(routes.locator('h3', { hasText: 'SFO' }).first()).toBeVisible({ timeout: 5000 })
  })

  test('FeatureGrid section renders with all features', async ({ page }) => {
    await page.goto('/')
    const features = page.locator('#features')
    await features.scrollIntoViewIfNeeded()
    await expect(features).toBeVisible()
    // "Why RideCompare" label
    await expect(features.locator('text=Why RideCompare')).toBeVisible()
    // 3 primary features
    await expect(features.locator('text=Live Pricing')).toBeVisible()
    await expect(features.locator('text=Smart Picks')).toBeVisible()
    await expect(features.locator('text=Bay Area Focus')).toBeVisible()
    // 3 secondary features
    await expect(features.locator('text=Wait Time Estimates')).toBeVisible()
    await expect(features.locator('text=Price Alerts')).toBeVisible()
    await expect(features.locator('text=No Account Needed')).toBeVisible()
  })

  test('Compare section renders with form', async ({ page }) => {
    await page.goto('/')
    const compare = page.locator('#compare')
    await compare.scrollIntoViewIfNeeded()
    await expect(compare).toBeVisible()
    await expect(compare.locator('h2', { hasText: 'Compare Prices' })).toBeVisible()
  })
})
