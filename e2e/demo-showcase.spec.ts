import { test, expect } from '@playwright/test'

test.setTimeout(120000)

test('Bay Area Rideshare App — Walkthrough Demo', async ({ page }) => {
  // ── 1. Landing — Hero section ────────────────────────────────────────────
  await page.goto('/', { waitUntil: 'domcontentloaded' })

  // Wait for the hero headline to animate in
  await expect(page.locator('h1')).toBeVisible({ timeout: 15000 })
  await page.waitForTimeout(3000) // let headline animations complete

  // ── 2. Scroll to Popular Routes section ──────────────────────────────────
  await page.evaluate(() => {
    document.querySelector('#routes')?.scrollIntoView({ behavior: 'smooth' })
  })
  await page.waitForTimeout(2500) // pause on the 4 route cards

  // ── 3. Scroll to Compare section to begin entering a route ───────────────
  await page.evaluate(() => {
    document.querySelector('#compare')?.scrollIntoView({ behavior: 'smooth' })
  })
  await page.waitForTimeout(1500) // let the section come into view

  // ── 4. Type SFO in the pickup field — instant autocomplete ────────────────
  await page.click('#pickup')
  await page.type('#pickup', 'SFO', { delay: 120 })
  await page.waitForTimeout(600) // let autocomplete suggestion appear

  // Click the first autocomplete suggestion (SFO airport)
  const pickupSuggestion = page.locator('#pickup ~ * [class*="cursor-pointer"]').first()
  const hasSuggestion = (await pickupSuggestion.count()) > 0
  if (hasSuggestion) {
    await pickupSuggestion.click()
  } else {
    // Fallback: clear and type the full address
    await page.fill('#pickup', 'San Francisco International Airport (SFO), San Francisco, CA, USA')
  }
  await page.waitForTimeout(500)

  // ── 5. Type the destination ───────────────────────────────────────────────
  await page.click('#destination')
  await page.type('#destination', 'Downtown San Francisco', { delay: 100 })
  await page.waitForTimeout(1500) // let Nominatim return suggestions

  // Click the first autocomplete suggestion for downtown SF
  const destSuggestion = page.locator('#destination ~ * [class*="cursor-pointer"]').first()
  const hasDestSuggestion = (await destSuggestion.count()) > 0
  if (hasDestSuggestion) {
    await destSuggestion.click()
  } else {
    // Fallback: clear and type the full address
    await page.fill(
      '#destination',
      'Downtown San Francisco, San Francisco, CA, USA'
    )
  }
  await page.waitForTimeout(500)

  // ── 6. Submit the form ────────────────────────────────────────────────────
  // Start watching for the API response before clicking submit
  const apiResponsePromise = page.waitForResponse(
    resp => resp.url().includes('/api/compare-rides') && resp.request().method() === 'POST',
    { timeout: 40000 }
  )

  await page.locator('button[type="submit"]', { hasText: 'Compare Rides' }).click()
  await page.waitForTimeout(500) // brief pause after click

  // ── 7. Wait for the comparison API to return ──────────────────────────────
  await apiResponsePromise
  await page.waitForTimeout(800) // allow React to render results

  // ── 8. Wait for the "Compare & Choose" results heading ───────────────────
  await expect(page.locator('h2', { hasText: 'Compare & Choose' })).toBeVisible({
    timeout: 15000,
  })
  await page.waitForTimeout(1000)

  // ── 9. Scroll to top of results for a clear view of pricing cards ─────────
  await page.evaluate(() => {
    const heading = Array.from(document.querySelectorAll('h2')).find(el =>
      el.textContent?.includes('Compare & Choose')
    )
    heading?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  })
  await page.waitForTimeout(2500) // hold on the 4 service pricing cards

  // ── 10. Scroll down to reveal the route map ───────────────────────────────
  await page.evaluate(() => {
    const map =
      document.querySelector('.maplibregl-map') ??
      document.querySelector('[id^="map"]') ??
      document.querySelector('[class*="map-container"]')
    if (map) {
      map.scrollIntoView({ behavior: 'smooth', block: 'center' })
    } else {
      window.scrollBy({ top: 900, behavior: 'smooth' })
    }
  })
  await page.waitForTimeout(3000) // hold on the map for the finale

  // Soft assertion — map may not fully initialise in headless environments
  const mapEl = page
    .locator('.maplibregl-map, [id^="map"], [class*="map-container"]')
    .first()
  if ((await mapEl.count()) > 0) {
    await expect(mapEl).toBeVisible({ timeout: 5000 })
  }

  // Final pause so the recording captures the end state cleanly
  await page.waitForTimeout(2000)
})
