import { test, expect } from '@playwright/test'

test.setTimeout(30000)

const navSelector = 'div.fixed nav'

test.describe('Navigation Bar Smoke Tests', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForSelector(navSelector, { timeout: 10000 })
  })

  test('PillBase renders after dynamic import', async ({ page }) => {
    await expect(page.locator(navSelector)).toBeVisible()
  })

  test('collapsed state exposes a keyboard-accessible toggle', async ({ page }) => {
    const nav = page.locator(navSelector)
    const toggle = nav.getByRole('button', { name: 'Open section navigation' })

    await expect(toggle).toBeVisible()
    await expect(toggle).toContainText('Home')

    await toggle.focus()
    await page.keyboard.press('Enter')

    await expect(nav.getByRole('button', { name: 'Routes' })).toBeVisible({ timeout: 3000 })
  })

  test('expands on hover to show all nav items', async ({ page }) => {
    const nav = page.locator(navSelector)

    await nav.hover()

    await expect(nav.getByRole('button', { name: 'Home' })).toBeVisible({ timeout: 3000 })
    await expect(nav.getByRole('button', { name: 'Routes' })).toBeVisible()
    await expect(nav.getByRole('button', { name: 'Features' })).toBeVisible()
    await expect(nav.getByRole('button', { name: 'Compare' })).toBeVisible()
  })

  test('updates the active label after section scrolling', async ({ page }) => {
    const nav = page.locator(navSelector)
    const toggle = nav.getByRole('button', { name: 'Open section navigation' })

    await page
      .locator('#features')
      .evaluate(element => element.scrollIntoView({ behavior: 'auto', block: 'center' }))

    await expect(toggle).toContainText('Features')
  })

  test('collapses when dismissed outside the nav', async ({ page }) => {
    const nav = page.locator(navSelector)

    await nav.hover()
    await expect(nav.getByRole('button', { name: 'Routes' })).toBeVisible({ timeout: 3000 })

    await page.locator('body').click({ position: { x: 8, y: 320 } })

    await expect(nav.getByRole('button', { name: 'Routes' })).toBeHidden({ timeout: 5000 })
    await expect(nav.getByRole('button', { name: 'Open section navigation' })).toContainText('Home')
  })

  test('expanded nav stays within the mobile viewport', async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
    })
    const page = await context.newPage()

    await page.goto('/')
    await page.waitForSelector(navSelector, { timeout: 10000 })

    await page.getByRole('button', { name: 'Open section navigation' }).click()

    const bounds = await page.locator(navSelector).boundingBox()
    expect(bounds).not.toBeNull()
    expect(bounds!.x).toBeGreaterThanOrEqual(0)
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390)

    await context.close()
  })
})
