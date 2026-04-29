import { test, expect } from '@playwright/test';
import { mockApi } from './fixtures/api-mocks.js';
import { mockUser } from './fixtures/mock-data.js';

test.describe('ShExMap page — ownership UI', () => {
  test('owner sees "Edit metadata" button', async ({ page }) => {
    await mockApi(page);
    await page.goto('/maps/map-1');

    await expect(page.getByRole('heading', { name: 'FHIR Patient ShExMap' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Edit metadata/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Fork$/i })).toHaveCount(0);
  });

  test('logged-in non-owner sees Fork button (not Edit)', async ({ page }) => {
    await mockApi(page);
    await page.goto('/maps/map-2'); // owned by Bob

    await expect(page.getByRole('heading', { name: "Bob's ShExMap" })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Fork$/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Edit metadata/i })).toHaveCount(0);
  });

  test('anonymous user sees neither Edit nor Fork', async ({ page }) => {
    await mockApi(page, { user: null });
    await page.goto('/maps/map-2');

    await expect(page.getByRole('heading', { name: "Bob's ShExMap" })).toBeVisible();
    await expect(page.getByRole('button', { name: /Edit metadata/i })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Fork$/i })).toHaveCount(0);
  });

  test('legacy anonymous-authored maps are claimable by any logged-in user', async ({ page }) => {
    // After auth was enabled, pre-existing maps still have authorId='anonymous'.
    // The frontend treats those as unclaimed → owner UI for any signed-in user.
    await mockApi(page);
    await page.goto('/maps/map-3');

    await expect(page.getByRole('heading', { name: 'Pre-auth Legacy Map' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Edit metadata/i })).toBeVisible();
  });

  test('clicking Fork creates a copy and navigates to it', async ({ page }) => {
    const { calls } = await mockApi(page);
    await page.goto('/maps/map-2');

    await page.getByRole('button', { name: /^Fork$/i }).click();
    await page.waitForURL('**/maps/map-forked');
    expect(calls['shexmaps.create']).toBe(1);
  });

  test('Fork failure surfaces inline error without crashing', async ({ page }) => {
    await mockApi(page, {
      overrides: {
        '**/api/v1/shexmaps': async (route) => {
          if (route.request().method() === 'POST') {
            await route.fulfill({ status: 500, json: { message: 'Quota exceeded' } });
          } else {
            await route.fulfill({ json: { items: [], total: 0 } });
          }
        },
      },
      user: mockUser,
    });

    await page.goto('/maps/map-2');
    await page.getByRole('button', { name: /^Fork$/i }).click();

    // The handler caught the rejection and surfaced it to the UI.
    // (We don't assert the page didn't log axios errors — React Query
    // logs unhandled rejection internals, but the page is still alive,
    // which is what we care about. The button is still visible afterwards.)
    await expect(page.getByText(/Quota exceeded/)).toBeVisible();
    await expect(page.getByRole('button', { name: /^Fork$/i })).toBeVisible();
  });
});
