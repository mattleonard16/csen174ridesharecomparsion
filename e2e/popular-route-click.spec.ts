import { test, expect } from '@playwright/test'

test.setTimeout(30000)

test.describe('Popular Route Click Navigation', () => {
  test('clicking a popular route pre-fills the compare form', async ({ page }) => {
    await page.route('**/api/compare-rides', async route => {
      await new Promise(resolve => setTimeout(resolve, 800))
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          routeId: 'route-1',
          comparisons: {
            uber: {
              price: '$21.00',
              waitTime: '4 min',
              driversNearby: 5,
              service: 'UberX',
            },
            lyft: {
              price: '$22.50',
              waitTime: '5 min',
              driversNearby: 4,
              service: 'Lyft Standard',
            },
            taxi: {
              price: '$28.00',
              waitTime: '7 min',
              driversNearby: 3,
              service: 'Yellow Cab',
            },
          },
          insights: 'Prefill works.',
          pickupCoords: [-122.3904, 37.6164],
          destinationCoords: [-122.4195, 37.7898],
          surgeInfo: null,
          timeRecommendations: [],
          aiRecommendations: [],
          routeAccuracy: 'exact',
        }),
      })
    })

    await page.goto('/')
    await page.waitForLoadState('networkidle')

    const compare = page.locator('#compare')
    await expect(compare).not.toBeInViewport()

    const routes = page.locator('#routes')
    await routes.scrollIntoViewIfNeeded()
    const firstRouteCard = routes.locator('button').first()
    await expect(firstRouteCard).toBeVisible({ timeout: 5000 })
    await firstRouteCard.click()

    await expect(compare).toBeInViewport({ timeout: 10000 })
    await expect(page.getByLabel('Pickup Location')).toHaveValue(
      'San Francisco International Airport (SFO), San Francisco, CA, USA'
    )
    await expect(page.getByLabel('Destination')).toHaveValue(
      'Downtown San Francisco, San Francisco, CA, USA'
    )

    const nav = page.locator('div.fixed nav')
    const compareHeading = page.getByRole('heading', { name: /compare prices/i })
    const navBox = await nav.boundingBox()
    const headingBox = await compareHeading.boundingBox()

    expect(navBox).not.toBeNull()
    expect(headingBox).not.toBeNull()
    expect(headingBox!.y).toBeGreaterThanOrEqual(navBox!.y + navBox!.height - 4)
  })

  test('compare failures show an honest error state with no fake prices', async ({ page }) => {
    await page.route('**/api/compare-rides', async route => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Server unavailable' }),
      })
    })

    await page.goto('/')
    await page.waitForLoadState('networkidle')

    await page.getByLabel('Pickup Location').fill('123 Main St')
    await page.getByLabel('Destination').fill('456 Market St')
    await page.getByRole('button', { name: /compare rides/i }).click()

    await expect(
      page.getByText(/failed to fetch ride comparisons\. please try again\./i)
    ).toBeVisible()
    await expect(page.getByRole('button', { name: /retry/i })).toBeVisible()
    await expect(page.getByText(/simulated data/i)).toHaveCount(0)
    await expect(page.getByText(/compare & choose/i)).toHaveCount(0)
  })

  test('compare succeeds with a degraded warning when estimated routing is returned', async ({
    page,
  }) => {
    await page.route('**/api/compare-rides', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          routeId: 'route-estimated',
          comparisons: {
            uber: {
              price: '$23.00',
              waitTime: '6 min',
              driversNearby: 4,
              service: 'UberX',
            },
            lyft: {
              price: '$24.50',
              waitTime: '6 min',
              driversNearby: 4,
              service: 'Lyft Standard',
            },
            taxi: {
              price: '$31.00',
              waitTime: '8 min',
              driversNearby: 3,
              service: 'Yellow Cab',
            },
          },
          insights: 'Comparison is available with estimated routing.',
          pickupCoords: [-122.3904, 37.6164],
          destinationCoords: [-122.4195, 37.7898],
          surgeInfo: null,
          timeRecommendations: [],
          aiRecommendations: [],
          routeAccuracy: 'estimated',
          routeWarning:
            'Prices are based on estimated route metrics because live routing is temporarily unavailable.',
        }),
      })
    })

    await page.goto('/')
    await page.waitForLoadState('networkidle')

    await page.getByLabel('Pickup Location').fill('123 Main St')
    await page.getByLabel('Destination').fill('456 Market St')
    await page.getByRole('button', { name: /compare rides/i }).click()

    await expect(page.getByText('$23.00').first()).toBeVisible()
    await expect(page.getByText('Estimated route metrics', { exact: true })).toBeVisible()
    await expect(page.getByText(/failed to fetch ride comparisons/i)).toHaveCount(0)
  })
})
