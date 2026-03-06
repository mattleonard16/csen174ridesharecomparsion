import { test } from '@playwright/test'

test.setTimeout(60000)

test('SFO to Downtown SF demo showcase', async ({ page }) => {
  // 1. Open homepage and let Hero animate in
  await page.goto('/', { waitUntil: 'networkidle' })
  await page.waitForTimeout(2000)

  // 2. Scroll to routes section and show the 4 route cards
  await page.locator('#routes').scrollIntoViewIfNeeded()
  await page.waitForTimeout(1500)

  // 3. Click the SFO card — triggers auto-submit via precomputed route (no CAPTCHA)
  await page.locator('#routes button', { hasText: 'SFO → Downtown SF' }).first().click()

  // 4. Scroll to the compare section so results become visible
  await page.locator('#compare').scrollIntoViewIfNeeded()

  // 5. Wait for comparison results to appear (precomputed route is instant; bump timeout for slowMo)
  await page.waitForSelector('h2:has-text("Compare & Choose")', { timeout: 30000 })
  await page.waitForTimeout(3000)

  // 6. Scroll map into view
  const mapContainer = page
    .locator('[id^="map"], .maplibregl-map, [class*="map-container"]')
    .first()
  const mapExists = await mapContainer.count()
  if (mapExists > 0) {
    await mapContainer.scrollIntoViewIfNeeded()
    await page.waitForTimeout(2000)
  }
})
