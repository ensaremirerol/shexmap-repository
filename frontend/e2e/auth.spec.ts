import { test, expect } from '@playwright/test';
import { mockApi } from './fixtures/api-mocks.js';
import { mockUser } from './fixtures/mock-data.js';

test.describe('Auth flow', () => {
  test('logout clears nav state and shows Sign in again', async ({ page }) => {
    let signedIn = true;

    await mockApi(page, {
      overrides: {
        '**/api/v1/auth/status': async (route) => {
          await route.fulfill({
            json: signedIn
              ? { enabled: true, authenticated: true, user: mockUser }
              : { enabled: true, authenticated: false },
          });
        },
        '**/api/v1/auth/logout': async (route) => {
          signedIn = false;
          await route.fulfill({ json: { ok: true } });
        },
      },
    });

    await page.goto('/');
    const navLink = page.getByRole('link', { name: mockUser.name, exact: true });
    await expect(navLink).toBeVisible();

    await page.getByRole('button', { name: /Sign out/i }).click();

    await expect(page.getByRole('link', { name: /Sign in with GitHub/i })).toBeVisible();
    await expect(navLink).toHaveCount(0);
  });
});
