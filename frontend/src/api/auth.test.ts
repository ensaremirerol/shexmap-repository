import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../__tests__/mocks/server';
import { fetchAuthStatus } from './auth';

describe('fetchAuthStatus', () => {
  it('returns the auth status response on success', async () => {
    const result = await fetchAuthStatus();

    expect(result.enabled).toBe(true);
    expect(result.authenticated).toBe(true);
    expect(result.user).toMatchObject({
      sub: 'user-1',
      name: 'Test User',
      email: 'test@example.com',
    });
  });

  it('returns authenticated: false when the server indicates unauthenticated', async () => {
    server.use(
      http.get('/api/v1/auth/status', () =>
        HttpResponse.json({
          enabled: true,
          authenticated: false,
          user: null,
        })
      )
    );

    const result = await fetchAuthStatus();
    expect(result.authenticated).toBe(false);
    expect(result.user).toBeNull();
  });

  it('throws when the server returns 401', async () => {
    server.use(
      http.get('/api/v1/auth/status', () => new HttpResponse(null, { status: 401 }))
    );

    await expect(fetchAuthStatus()).rejects.toThrow();
  });

  it('sends Authorization header when tokenOverride is provided', async () => {
    let capturedAuthHeader: string | null = null;

    server.use(
      http.get('/api/v1/auth/status', ({ request }) => {
        capturedAuthHeader = request.headers.get('Authorization');
        return HttpResponse.json({
          enabled: true,
          authenticated: true,
          user: { sub: 'user-1', role: 'user', name: 'Test User' },
        });
      })
    );

    await fetchAuthStatus('my-override-token');
    expect(capturedAuthHeader).toBe('Bearer my-override-token');
  });
});
