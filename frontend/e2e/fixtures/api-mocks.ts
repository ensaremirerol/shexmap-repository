import type { Page, Route } from '@playwright/test';
import {
  mockUser,
  mockShExMap,
  mockShExMapByOther,
  mockShExMapAnonymous,
  mockPairing,
} from './mock-data.js';

export interface MockApiOptions {
  /** Auth state. `null` = anonymous, `mockUser` = signed in as owner. */
  user?: typeof mockUser | null;
  /** Override individual route handlers. */
  overrides?: Record<string, (route: Route) => Promise<void> | void>;
}

/**
 * Install default API route mocks on a Playwright page. Returns a mutable record
 * of call counters keyed by route name so tests can assert which endpoints were hit.
 */
export async function mockApi(page: Page, opts: MockApiOptions = {}) {
  const user = opts.user === undefined ? mockUser : opts.user;
  const calls: Record<string, number> = {};
  const bump = (k: string) => { calls[k] = (calls[k] ?? 0) + 1; };

  // ── /api/v1/auth/status ────────────────────────────────────────────────────
  await page.route('**/api/v1/auth/status', async (route) => {
    bump('auth.status');
    await route.fulfill({
      json: user
        ? { enabled: true, authenticated: true, user }
        : { enabled: true, authenticated: false },
    });
  });

  // ── /api/v1/auth/logout ────────────────────────────────────────────────────
  await page.route('**/api/v1/auth/logout', async (route) => {
    bump('auth.logout');
    await route.fulfill({ json: { ok: true } });
  });

  // ── /api/v1/shexmaps?... ───────────────────────────────────────────────────
  await page.route(/\/api\/v1\/shexmaps(\?.*)?$/, async (route) => {
    if (route.request().method() === 'POST') {
      bump('shexmaps.create');
      const body = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({
        json: {
          ...mockShExMap,
          id: 'map-forked',
          title: (body['title'] as string) ?? 'Forked',
          authorId: user?.sub ?? 'anonymous',
          authorName: user?.name ?? 'anonymous',
        },
      });
      return;
    }
    bump('shexmaps.list');
    await route.fulfill({
      json: {
        items: [mockShExMap, mockShExMapByOther, mockShExMapAnonymous],
        total: 3,
      },
    });
  });

  // ── /api/v1/shexmaps/:id ───────────────────────────────────────────────────
  await page.route(/\/api\/v1\/shexmaps\/([^/?]+)$/, async (route) => {
    const url = new URL(route.request().url());
    const id = url.pathname.split('/').pop()!;
    bump(`shexmaps.get.${id}`);
    const map =
      id === mockShExMap.id          ? mockShExMap :
      id === mockShExMapByOther.id   ? mockShExMapByOther :
      id === mockShExMapAnonymous.id ? mockShExMapAnonymous :
      null;
    if (!map) return route.fulfill({ status: 404, json: { message: 'Not found' } });
    await route.fulfill({ json: map });
  });

  // ── /api/v1/shexmaps/:id/versions ──────────────────────────────────────────
  await page.route(/\/api\/v1\/shexmaps\/[^/]+\/versions(\/.+)?(\?.*)?$/, async (route) => {
    bump('shexmaps.versions');
    await route.fulfill({ json: [] });
  });

  // ── /api/v1/pairings?... ───────────────────────────────────────────────────
  await page.route(/\/api\/v1\/pairings(\?.*)?$/, async (route) => {
    bump('pairings.list');
    await route.fulfill({ json: { items: [mockPairing], total: 1 } });
  });

  // ── /api/v1/pairings/:id ───────────────────────────────────────────────────
  await page.route(/\/api\/v1\/pairings\/([^/?]+)$/, async (route) => {
    bump('pairings.get');
    await route.fulfill({ json: mockPairing });
  });

  // ── /api/v1/schemas ────────────────────────────────────────────────────────
  await page.route('**/api/v1/schemas', async (route) => {
    bump('schemas.list');
    await route.fulfill({ json: [] });
  });

  // ── /api/v1/shexmaps/:id/acl (List, Grant, Revoke) ────────────────────────
  await page.route(/\/api\/v1\/shexmaps\/[^/]+\/acl(\/\w+)?$/, async (route) => {
    const path = new URL(route.request().url()).pathname;
    const method = route.request().method();
    if (method === 'POST') {
      const sub = path.endsWith('/grant') ? 'grant' : 'revoke';
      bump(`shexmaps.acl.${sub}`);
      await route.fulfill({ json: { authorizationIri: '', agentUserId: '', mode: 'Write' } });
    } else {
      bump('shexmaps.acl.list');
      await route.fulfill({ json: [] });
    }
  });

  // ── /api/v1/pairings/:id/acl (List, Grant, Revoke) ────────────────────────
  await page.route(/\/api\/v1\/pairings\/[^/]+\/acl(\/\w+)?$/, async (route) => {
    const path = new URL(route.request().url()).pathname;
    const method = route.request().method();
    if (method === 'POST') {
      const sub = path.endsWith('/grant') ? 'grant' : 'revoke';
      bump(`pairings.acl.${sub}`);
      await route.fulfill({ json: { authorizationIri: '', agentUserId: '', mode: 'Write' } });
    } else {
      bump('pairings.acl.list');
      await route.fulfill({ json: [] });
    }
  });

  // ── /api/v1/pairings/:id/versions ─────────────────────────────────────────
  await page.route(/\/api\/v1\/pairings\/[^/]+\/versions(\/.+)?(\?.*)?$/, async (route) => {
    bump('pairings.versions');
    await route.fulfill({ json: [] });
  });

  // ── User-supplied overrides ────────────────────────────────────────────────
  for (const [pattern, handler] of Object.entries(opts.overrides ?? {})) {
    await page.route(pattern, handler);
  }

  return { calls };
}
