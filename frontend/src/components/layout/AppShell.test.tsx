import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import { server } from '../../__tests__/mocks/server';
import { useAuthStore } from '../../store/authStore';
import AppShell from './AppShell';

beforeEach(() => {
  useAuthStore.setState({ token: null, user: null, isAuthenticated: false });
});

function renderAppShell(children: React.ReactNode = <div>test</div>) {
  return render(
    <MemoryRouter>
      <AppShell>{children}</AppShell>
    </MemoryRouter>
  );
}

describe('AppShell', () => {
  it('does not call fetchAuthStatus when there is no persisted token', async () => {
    let authStatusCalled = false;

    server.use(
      http.get('/api/v1/auth/status', () => {
        authStatusCalled = true;
        return HttpResponse.json({
          enabled: true,
          authenticated: true,
          user: { sub: 'user-1', role: 'user', name: 'Test User' },
        });
      })
    );

    renderAppShell();

    // Wait a tick to let any async effects run
    await new Promise((r) => setTimeout(r, 50));

    expect(authStatusCalled).toBe(false);
  });

  it('rehydrates user from a valid persisted token via the status API', async () => {
    useAuthStore.setState({
      token: 'valid-token',
      user: null,
      isAuthenticated: false,
    });

    renderAppShell();

    await waitFor(() => {
      expect(useAuthStore.getState().user?.name).toBe('Test User');
    });
  });

  it('logs the user out when the status API returns 401', async () => {
    server.use(
      http.get('/api/v1/auth/status', () => new HttpResponse(null, { status: 401 }))
    );

    useAuthStore.setState({
      token: 'expired-token',
      user: { sub: 'u1', name: 'Old User' },
      isAuthenticated: true,
    });

    renderAppShell();

    await waitFor(() => {
      expect(useAuthStore.getState().isAuthenticated).toBe(false);
    });
  });
});
