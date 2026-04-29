import { test, expect } from '@playwright/test';
import { mockApi } from './fixtures/api-mocks.js';

test.describe('Home page', () => {
  test('renders hero and sign-in when anonymous', async ({ page }) => {
    await mockApi(page, { user: null });
    await page.goto('/');

    await expect(page.getByRole('heading', { name: /ShExMap Repository/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /Sign in with GitHub/i })).toBeVisible();
  });

  test('shows user name in nav once authenticated', async ({ page }) => {
    await mockApi(page);
    await page.goto('/');

    // Target the dashboard link in the nav, since "Alice Tester" also appears
    // on home page cards (mock pairing/map authored by her).
    await expect(page.getByRole('link', { name: 'Alice Tester', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: /Sign in with GitHub/i })).toHaveCount(0);
  });
});
