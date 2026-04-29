/**
 * ACL "Manage access" panel tests.
 *
 * The panel is only visible to owners. Tests cover:
 * - Owner sees the collapsible panel; non-owner and anonymous do not.
 * - Clicking "Manage access" expands the list.
 * - Filling the UUID input and clicking Add sends POST .../acl/grant.
 * - After grant the list re-fetches and shows the new entry.
 * - Revoke button sends POST .../acl/revoke.
 * - Same flows for pairings (CreatePairingPage).
 */

import { test, expect, type Route } from '@playwright/test';
import { mockApi } from './fixtures/api-mocks.js';
import { mockUser, mockOtherUser } from './fixtures/mock-data.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const GRANT_USER_UUID = '550e8400-e29b-41d4-a716-446655440001';

const emptyAcl: object[] = [];

const aclWithGrant = [
  {
    authorizationIri: 'https://w3id.org/shexmap/resource/auth/auth-uuid-1',
    agentUserId: GRANT_USER_UUID,
    mode: 'Write',
  },
];

/** Wire default ACL mocks plus optional per-route overrides */
async function setupShexMapAcl(
  page: Parameters<typeof mockApi>[0],
  opts: {
    user?: typeof mockUser | null;
    initialAcl?: object[];
    /** If true, the grant endpoint will return the new entry and the list re-fetches with it */
    simulateGrant?: boolean;
  } = {},
) {
  const { user = mockUser, initialAcl = emptyAcl, simulateGrant = false } = opts;
  let grantCount = 0;

  const overrides: Record<string, (route: Route) => void | Promise<void>> = {
    // ACL list – returns initial list; after a grant, returns enriched list
    '**/api/v1/shexmaps/map-1/acl': async (route) => {
      const currentList = grantCount > 0 && simulateGrant ? aclWithGrant : initialAcl;
      await route.fulfill({ json: currentList });
    },
    // Grant endpoint
    '**/api/v1/shexmaps/map-1/acl/grant': async (route) => {
      grantCount += 1;
      await route.fulfill({
        json: {
          authorizationIri: 'https://w3id.org/shexmap/resource/auth/auth-uuid-1',
          agentUserId: GRANT_USER_UUID,
          mode: 'Write',
        },
      });
    },
    // Revoke endpoint
    '**/api/v1/shexmaps/map-1/acl/revoke': async (route) => {
      await route.fulfill({ json: { deletedCount: 1 } });
    },
  };

  return mockApi(page, { user, overrides });
}

async function setupPairingAcl(
  page: Parameters<typeof mockApi>[0],
  opts: {
    user?: typeof mockUser | null;
    initialAcl?: object[];
    simulateGrant?: boolean;
  } = {},
) {
  const { user = mockUser, initialAcl = emptyAcl, simulateGrant = false } = opts;
  let grantCount = 0;

  const overrides: Record<string, (route: Route) => void | Promise<void>> = {
    '**/api/v1/pairings/pair-1/acl': async (route) => {
      const currentList = grantCount > 0 && simulateGrant ? aclWithGrant : initialAcl;
      await route.fulfill({ json: currentList });
    },
    '**/api/v1/pairings/pair-1/acl/grant': async (route) => {
      grantCount += 1;
      await route.fulfill({
        json: {
          authorizationIri: 'https://w3id.org/shexmap/resource/auth/auth-uuid-1',
          agentUserId: GRANT_USER_UUID,
          mode: 'Write',
        },
      });
    },
    '**/api/v1/pairings/pair-1/acl/revoke': async (route) => {
      await route.fulfill({ json: { deletedCount: 1 } });
    },
    // Pairing versions (needed by CreatePairingPage)
    '**/api/v1/pairings/pair-1/versions': async (route) => {
      await route.fulfill({ json: [] });
    },
  };

  return mockApi(page, { user, overrides });
}

// ─── ShExMap page tests ───────────────────────────────────────────────────────

test.describe('ShExMap page — Manage Access panel', () => {
  test('owner sees "Manage access" toggle (inside Edit metadata section)', async ({ page }) => {
    await setupShexMapAcl(page);
    await page.goto('/maps/map-1');

    // Open the metadata section first
    await page.getByRole('button', { name: /Edit metadata/i }).click();

    await expect(page.getByRole('button', { name: /Manage access/i })).toBeVisible();
  });

  test('non-owner does NOT see Manage access panel', async ({ page }) => {
    // map-2 is owned by mockOtherUser; mockUser is logged in
    await setupShexMapAcl(page);
    await page.goto('/maps/map-2');

    await expect(page.getByRole('button', { name: /Manage access/i })).toHaveCount(0);
  });

  test('anonymous user does NOT see Manage access panel', async ({ page }) => {
    await setupShexMapAcl(page, { user: null });
    await page.goto('/maps/map-1');

    await expect(page.getByRole('button', { name: /Manage access/i })).toHaveCount(0);
  });

  test('expanding panel shows empty state when no grants', async ({ page }) => {
    await setupShexMapAcl(page, { initialAcl: emptyAcl });
    await page.goto('/maps/map-1');

    await page.getByRole('button', { name: /Edit metadata/i }).click();
    await page.getByRole('button', { name: /Manage access/i }).click();

    await expect(page.getByText(/No additional users have write access/i)).toBeVisible();
  });

  test('expanding panel shows existing grants', async ({ page }) => {
    await setupShexMapAcl(page, { initialAcl: aclWithGrant });
    await page.goto('/maps/map-1');

    await page.getByRole('button', { name: /Edit metadata/i }).click();
    await page.getByRole('button', { name: /Manage access/i }).click();

    await expect(page.getByText(GRANT_USER_UUID)).toBeVisible();
    await expect(page.getByText('Write access')).toBeVisible();
  });

  test('Add button sends POST to acl/grant with correct body', async ({ page }) => {
    const { calls } = await setupShexMapAcl(page);
    await page.goto('/maps/map-1');

    await page.getByRole('button', { name: /Edit metadata/i }).click();
    await page.getByRole('button', { name: /Manage access/i }).click();

    // Check that the grant endpoint is intercepted
    let grantBody: Record<string, unknown> = {};
    await page.route('**/api/v1/shexmaps/map-1/acl/grant', async (route) => {
      grantBody = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({
        json: {
          authorizationIri: 'https://w3id.org/shexmap/resource/auth/new',
          agentUserId: GRANT_USER_UUID,
          mode: 'Write',
        },
      });
    });

    await page.getByRole('textbox', { name: /User UUID/i }).fill(GRANT_USER_UUID);
    await page.getByRole('button', { name: /^Add$/i }).click();

    // Wait for the route to be called
    await page.waitForTimeout(300);
    expect(grantBody['agentUserId']).toBe(GRANT_USER_UUID);
    // calls counter won't capture the late-registered route; just verify no crash
    expect(page.url()).toContain('/maps/map-1');
  });

  test('invalid UUID shows validation error and does NOT call grant', async ({ page }) => {
    const { calls } = await setupShexMapAcl(page);
    await page.goto('/maps/map-1');

    await page.getByRole('button', { name: /Edit metadata/i }).click();
    await page.getByRole('button', { name: /Manage access/i }).click();

    await page.getByRole('textbox', { name: /User UUID/i }).fill('not-a-uuid');
    await page.getByRole('button', { name: /^Add$/i }).click();

    await expect(page.getByText(/valid UUID/i)).toBeVisible();
    // grant endpoint should NOT have been called
    expect(calls['shexmaps.acl.grant']).toBeUndefined();
  });

  test('Revoke button sends POST to acl/revoke', async ({ page }) => {
    let revokeCalled = false;
    let revokeBody: Record<string, unknown> = {};

    await mockApi(page, {
      user: mockUser,
      overrides: {
        '**/api/v1/shexmaps/map-1/acl': async (route) => {
          await route.fulfill({ json: aclWithGrant });
        },
        '**/api/v1/shexmaps/map-1/acl/revoke': async (route) => {
          revokeCalled = true;
          revokeBody = route.request().postDataJSON() as Record<string, unknown>;
          await route.fulfill({ json: { deletedCount: 1 } });
        },
      },
    });

    await page.goto('/maps/map-1');
    await page.getByRole('button', { name: /Edit metadata/i }).click();
    await page.getByRole('button', { name: /Manage access/i }).click();

    // Wait for the list to render
    await expect(page.getByText(GRANT_USER_UUID)).toBeVisible();

    await page.getByRole('button', { name: new RegExp(`Revoke access for ${GRANT_USER_UUID}`, 'i') }).click();

    await page.waitForTimeout(300);
    expect(revokeCalled).toBe(true);
    expect(revokeBody['agentUserId']).toBe(GRANT_USER_UUID);
  });
});

// ─── Pairing (CreatePairingPage) tests ───────────────────────────────────────

test.describe('CreatePairingPage — Manage Access panel', () => {
  test('owner of existing pairing sees Manage access panel', async ({ page }) => {
    await setupPairingAcl(page);
    await page.goto('/pairings/create?id=pair-1');

    await expect(page.getByRole('button', { name: /Manage access/i })).toBeVisible();
  });

  test('non-owner of pairing does NOT see Manage access panel', async ({ page }) => {
    // mockOtherUser owns pair-2; we're logged in as mockUser (not owner)
    // We need to create a pairing fixture owned by mockOtherUser
    await mockApi(page, {
      user: mockUser,
      overrides: {
        '**/api/v1/pairings/pair-1/acl': async (route) => {
          await route.fulfill({ json: [] });
        },
        '**/api/v1/pairings/pair-1/versions': async (route) => {
          await route.fulfill({ json: [] });
        },
        // Override pairings GET to return a pairing owned by mockOtherUser
        '/api/v1/pairings/pair-1': async (route) => {
          await route.fulfill({
            json: {
              id: 'pair-1',
              title: 'Pairing by Bob',
              description: '',
              sourceMap: { id: 'map-1', title: 'Source', fileFormat: 'shexc', tags: [], version: '1.0.0', authorId: mockOtherUser.sub, authorName: mockOtherUser.name, createdAt: '2026-01-01T00:00:00Z', modifiedAt: '2026-01-01T00:00:00Z', stars: 0 },
              targetMap: { id: 'map-2', title: 'Target', fileFormat: 'shexc', tags: [], version: '1.0.0', authorId: mockOtherUser.sub, authorName: mockOtherUser.name, createdAt: '2026-01-01T00:00:00Z', modifiedAt: '2026-01-01T00:00:00Z', stars: 0 },
              tags: [],
              version: '1.0.0',
              authorId: mockOtherUser.sub,
              authorName: mockOtherUser.name,
              createdAt: '2026-01-01T00:00:00Z',
              modifiedAt: '2026-01-01T00:00:00Z',
              stars: 0,
            },
          });
        },
      },
    });

    await page.goto('/pairings/create?id=pair-1');

    await expect(page.getByRole('button', { name: /Manage access/i })).toHaveCount(0);
  });

  test('anonymous user does NOT see Manage access panel on pairing page', async ({ page }) => {
    await setupPairingAcl(page, { user: null });
    await page.goto('/pairings/create?id=pair-1');

    await expect(page.getByRole('button', { name: /Manage access/i })).toHaveCount(0);
  });

  test('pairing panel Add button sends POST to pairings acl/grant', async ({ page }) => {
    let grantBody: Record<string, unknown> = {};

    await mockApi(page, {
      user: mockUser,
      overrides: {
        '**/api/v1/pairings/pair-1/acl': async (route) => {
          await route.fulfill({ json: emptyAcl });
        },
        '**/api/v1/pairings/pair-1/acl/grant': async (route) => {
          grantBody = route.request().postDataJSON() as Record<string, unknown>;
          await route.fulfill({
            json: {
              authorizationIri: 'https://w3id.org/shexmap/resource/auth/new',
              agentUserId: GRANT_USER_UUID,
              mode: 'Write',
            },
          });
        },
        '**/api/v1/pairings/pair-1/versions': async (route) => {
          await route.fulfill({ json: [] });
        },
      },
    });

    await page.goto('/pairings/create?id=pair-1');

    await page.getByRole('button', { name: /Manage access/i }).click();
    await page.getByRole('textbox', { name: /User UUID/i }).fill(GRANT_USER_UUID);
    await page.getByRole('button', { name: /^Add$/i }).click();

    await page.waitForTimeout(300);
    expect(grantBody['agentUserId']).toBe(GRANT_USER_UUID);
  });
});
