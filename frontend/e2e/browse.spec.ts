import { test, expect } from '@playwright/test';
import { mockApi } from './fixtures/api-mocks.js';

test.describe('Browse page', () => {
  test('pairings tab renders mocked pairing', async ({ page }) => {
    await mockApi(page);
    await page.goto('/browse');

    await expect(page.getByRole('heading', { name: 'Browse' })).toBeVisible();
    await expect(page.getByText('FHIR ↔ openEHR')).toBeVisible();
  });

  test('shexmaps tab renders mocked maps', async ({ page }) => {
    await mockApi(page);
    await page.goto('/browse?tab=shexmaps');

    await expect(page.getByText('FHIR Patient ShExMap').first()).toBeVisible();
    await expect(page.getByText("Bob's ShExMap")).toBeVisible();
  });

  test('schemas tab renders empty state without crashing the app', async ({ page }) => {
    // Regression test: previously the app white-screened on this route because
    // ShExMapPage called useState after an early return (Rules of Hooks violation),
    // and BrowsePage accessed pairing.sourceMap.schemaUrl without optional chaining.
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await mockApi(page);
    await page.goto('/browse?tab=schemas');

    await expect(page.getByText(/No schemas found/i)).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('schemas tab survives pairings with null sourceMap', async ({ page }) => {
    // BrowsePage.tsx line 39 used to crash when a pairing had a null sourceMap.
    await mockApi(page, {
      overrides: {
        '**/api/v1/pairings*': (route) =>
          route.fulfill({
            json: {
              items: [{
                id: 'pair-broken',
                title: 'Pairing with deleted source map',
                description: '',
                sourceMap: null,
                targetMap: null,
                sourceFocusIri: '',
                targetFocusIri: '',
                tags: [],
                license: '',
                version: '1.0.0',
                authorId: 'user-1',
                authorName: 'Alice',
                createdAt: '2026-01-01T00:00:00Z',
                modifiedAt: '2026-01-01T00:00:00Z',
                stars: 0,
              }],
              total: 1,
            },
          }),
      },
    });

    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await page.goto('/browse?tab=schemas');
    await expect(page.getByText(/No schemas found/i)).toBeVisible();
    expect(errors).toEqual([]);
  });
});
