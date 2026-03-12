import { test, expect } from '@playwright/test'

test.setTimeout(30000)

test.describe('Comparison Flow', () => {
  test('enter addresses, submit, see ride results with prices', async ({ page }) => {
    await page.route('**/nominatim.openstreetmap.org/**', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: '[]',
      })
    })

    await page.route('**/router.project-osrm.org/**', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: '{"routes":[],"code":"Ok"}',
      })
    })

    await page.route('**/api/compare-rides', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          routeId: 'test-route-1',
          comparisons: {
            uber: {
              price: '$21.50',
              waitTime: '4 min',
              driversNearby: 5,
              service: 'UberX',
            },
            lyft: {
              price: '$23.00',
              waitTime: '5 min',
              driversNearby: 4,
              service: 'Lyft Standard',
            },
            taxi: {
              price: '$29.00',
              waitTime: '7 min',
              driversNearby: 3,
              service: 'Yellow Cab',
            },
          },
          insights: 'Uber is cheapest.',
          pickupCoords: [-122.379, 37.6213],
          destinationCoords: [-122.4194, 37.7749],
          surgeInfo: {
            isActive: false,
            reason: '',
            multiplier: 1,
          },
          timeRecommendations: [],
          aiRecommendations: [],
          routeAccuracy: 'exact',
        }),
      })
    })

    await page.goto('/')
    await page.waitForLoadState('networkidle')

    const pickupInput = page.getByRole('combobox', { name: 'Pickup Location' })
    await pickupInput.fill('sfo')
    await pickupInput.press('ArrowDown')
    await pickupInput.press('Enter')
    await expect(pickupInput).toHaveValue(/San Francisco International Airport \(SFO\)/i)

    const destinationInput = page.getByRole('combobox', { name: 'Destination' })
    await destinationInput.fill('san francisco')
    await page
      .getByRole('listbox', { name: 'Destination suggestions' })
      .getByText('San Francisco, CA, USA', { exact: true })
      .click()
    await expect(destinationInput).toHaveValue('San Francisco, CA, USA')
    await destinationInput.press('Escape')

    await page.getByRole('button', { name: /compare rides/i }).click({ force: true })

    await expect(page.getByRole('heading', { name: /compare & choose/i })).toBeVisible({
      timeout: 10000,
    })
    await expect(page.getByText('$21.50').first()).toBeVisible()
    await expect(page.getByText('$23.00').first()).toBeVisible()
    await expect(page.getByText('$29.00').first()).toBeVisible()
  })
})
