import { test, expect } from '@playwright/test'

test.setTimeout(30000)

test.describe('Navigation Bar Smoke Tests', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    // Wait for the dynamically-imported PillBase nav to render
    // It's inside: <div class="fixed top-6 left-1/2 ..."><nav>...</nav></div>
    await page.waitForSelector('div.fixed nav', { timeout: 10000 })
  })

  test('PillBase renders after dynamic import', async ({ page }) => {
    const nav = page.locator('div.fixed nav')
    await expect(nav).toBeVisible()
  })

  test('collapsed state shows active section label', async ({ page }) => {
    const nav = page.locator('div.fixed nav')
    // In collapsed state, the active section label "Home" should be visible
    await expect(nav.locator('text=Home')).toBeVisible()
  })

  test('expands on hover to show all nav items', async ({ page }) => {
    const nav = page.locator('div.fixed nav')
    // Hover over the nav to trigger expansion
    await nav.hover()
    // All 4 nav items should appear as buttons
    await expect(nav.locator('button', { hasText: 'Home' })).toBeVisible({ timeout: 3000 })
    await expect(nav.locator('button', { hasText: 'Routes' })).toBeVisible()
    await expect(nav.locator('button', { hasText: 'Features' })).toBeVisible()
    await expect(nav.locator('button', { hasText: 'Compare' })).toBeVisible()
  })

  test('collapses on mouse leave', async ({ page }) => {
    const nav = page.locator('div.fixed nav')
    // First expand by hovering
    await nav.hover()
    await expect(nav.locator('button', { hasText: 'Routes' })).toBeVisible({ timeout: 3000 })
    // Move mouse well away from nav
    await page.mouse.move(0, 300)
    // After 600ms timeout + framer-motion exit animation, buttons should disappear
    await expect(nav.locator('button', { hasText: 'Routes' })).toBeHidden({ timeout: 5000 })
    // "Home" text should still be visible in collapsed state
    await expect(nav.locator('text=Home')).toBeVisible()
  })
})
