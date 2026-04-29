import { describe, it, expect, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import { server } from '../../__tests__/mocks/server';
import { useAuthStore } from '../../store/authStore';
import AppShell from './AppShell';

beforeEach(() => {
  useAuthStore.setState({ user: null, isAuthenticated: false });
});

function renderAppShell(children: React.ReactNode = <div>test</div>) {
  return render(
    <MemoryRouter>
      <AppShell>{children}</AppShell>
    </MemoryRouter>
  );
}

describe('AppShell', () => {
  it('calls fetchAuthStatus on mount and sets user when authenticated', async () => {
    renderAppShell();

    await waitFor(() => {
      expect(useAuthStore.getState().user?.name).toBe('Test User');
    });
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
  });

  it('clears auth when fetchAuthStatus returns unauthenticated', async () => {
    server.use(
      http.get('/api/v1/auth/status', () =>
        HttpResponse.json({ enabled: true, authenticated: false, user: null })
      )
    );

    useAuthStore.setState({ user: { sub: 'u1', name: 'Old User' }, isAuthenticated: true });

    renderAppShell();

    await waitFor(() => {
      expect(useAuthStore.getState().isAuthenticated).toBe(false);
    });
    expect(useAuthStore.getState().user).toBeNull();
  });

  it('clears auth when fetchAuthStatus returns 401', async () => {
    server.use(
      http.get('/api/v1/auth/status', () => new HttpResponse(null, { status: 401 }))
    );

    useAuthStore.setState({ user: { sub: 'u1', name: 'Old User' }, isAuthenticated: true });

    renderAppShell();

    await waitFor(() => {
      expect(useAuthStore.getState().isAuthenticated).toBe(false);
    });
  });
});
