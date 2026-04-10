import { test, expect, type Page } from '@playwright/test'

test.setTimeout(30000)

const MOCK_SESSION = {
  user: { id: 'test-user-1', name: 'Test User', email: 'test@example.com' },
  expires: new Date(Date.now() + 86400000).toISOString(),
}

const MOCK_COMPARISON = {
  routeId: 'route-test-1',
  comparisons: {
    uber: {
      price: '$21.50',
      waitTime: '4 min',
      driversNearby: 5,
      service: 'UberX',
      surgeMultiplier: '1.2x',
    },
    lyft: {
      price: '$23.00',
      waitTime: '5 min',
      driversNearby: 4,
      service: 'Lyft Standard',
    },
  },
  insights: 'Uber is cheapest.',
  pickupCoords: [-122.379, 37.6213],
  destinationCoords: [-122.4194, 37.7749],
  surgeInfo: { isActive: false, reason: '', multiplier: 1 },
  timeRecommendations: [],
  aiRecommendations: [],
  routeAccuracy: 'exact',
}

const MOCK_HISTORY_ENTRY = {
  id: 'history-entry-1',
  routeId: 'route-test-1',
  service: 'uber',
  estimatedFare: 21.5,
  finalFare: null,
  waitTimeMinutes: 4,
  surgeMultiplier: 1.2,
  comparisonSnapshot: MOCK_COMPARISON.comparisons,
  requestedAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  pickupAddress: 'San Francisco Airport (SFO)',
  destinationAddress: 'San Francisco, CA, USA',
}

const MOCK_STATS = {
  totalSpent: 21.5,
  rideCount: 1,
  avgFare: 21.5,
  byService: { uber: { count: 1, totalSpent: 21.5, avgFare: 21.5 } },
  totalSavings: 1.5,
}

async function setupAuthenticatedSession(page: Page) {
  await page.route('**/api/auth/session', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_SESSION),
    })
  })

  // Also handle CSRF token requests
  await page.route('**/api/auth/csrf', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ csrfToken: 'test-csrf-token' }),
    })
  })

  await page.route('**/api/auth/providers', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({}),
    })
  })
}

async function setupComparisonMocks(page: Page) {
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
      body: JSON.stringify(MOCK_COMPARISON),
    })
  })
}

test.describe('Ride History Flow', () => {
  test('log ride from comparison, view in history, edit fare, delete', async ({ page }) => {
    await setupAuthenticatedSession(page)
    await setupComparisonMocks(page)

    // Mock the ride-history POST (log a ride)
    await page.route('**/api/ride-history', async route => {
      if (route.request().method() === 'POST') {
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, id: MOCK_HISTORY_ENTRY.id }),
        })
      } else if (route.request().method() === 'GET') {
        const url = route.request().url()
        if (url.includes('analytics=true')) {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(MOCK_STATS),
          })
        } else {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              history: [MOCK_HISTORY_ENTRY],
              nextCursor: null,
              total: 1,
            }),
          })
        }
      } else {
        await route.continue()
      }
    })

    // Mock PATCH and DELETE for the ride entry
    await page.route(`**/api/ride-history/${MOCK_HISTORY_ENTRY.id}`, async route => {
      if (route.request().method() === 'PATCH') {
        const body = route.request().postDataJSON()
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ...MOCK_HISTORY_ENTRY, finalFare: body.finalFare }),
        })
      } else if (route.request().method() === 'DELETE') {
        await route.fulfill({ status: 204 })
      } else {
        await route.continue()
      }
    })

    // --- Step 1: Navigate to home, do a comparison ---
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

    // Wait for comparison results
    await expect(page.getByRole('heading', { name: /compare & choose/i })).toBeVisible({
      timeout: 10000,
    })
    await expect(page.getByText('$21.50').first()).toBeVisible()

    // --- Step 2: Click "I took this ride" on Uber ---
    const uberLogButton = page.getByRole('button', { name: 'I took this ride' }).first()
    await uberLogButton.click()

    // Verify the button changes to "Logged"
    await expect(page.getByRole('button', { name: 'Logged' }).first()).toBeVisible()

    // --- Step 3: Navigate to /history and verify ride appears ---
    await page.goto('/history')
    await page.waitForLoadState('networkidle')

    // Verify stats are shown
    await expect(page.getByText('$21.50')).toBeVisible({ timeout: 10000 })
    await expect(page.getByText('Rides Taken')).toBeVisible()

    // Verify the ride card is shown with service name and estimated fare
    await expect(page.getByText('uber').first()).toBeVisible()

    // --- Step 4: Add fare via inline edit ---
    const addFareButton = page.getByRole('button', { name: '+ Add fare' })
    await addFareButton.click()

    const fareInput = page.locator('input[type="number"]')
    await fareInput.fill('19.99')
    await fareInput.press('Enter')

    // Verify the fare is shown after update
    await expect(page.getByText('$19.99')).toBeVisible({ timeout: 5000 })

    // --- Step 5: Delete the ride ---
    const deleteButton = page.getByRole('button', { name: 'Delete ride' })
    await deleteButton.click()

    // Confirm deletion
    const confirmButton = page.getByRole('button', { name: 'Confirm' })
    await confirmButton.click()

    // Verify toast (optimistic removal — no server re-fetch needed)
    await expect(page.getByText('Ride removed from history.')).toBeVisible({ timeout: 5000 })
  })
})
