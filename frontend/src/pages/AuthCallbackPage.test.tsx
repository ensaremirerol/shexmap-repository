import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import { server } from '../__tests__/mocks/server';
import { useAuthStore } from '../store/authStore';
import AuthCallbackPage from './AuthCallbackPage';

function renderWithRouter(ui: React.ReactElement, { initialEntries = ['/auth/callback'] } = {}) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <Routes>
        <Route path="/auth/callback" element={ui} />
        <Route path="/dashboard" element={<div>dashboard page</div>} />
        <Route path="/" element={<div>home page</div>} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  useAuthStore.setState({ user: null, isAuthenticated: false });
});

describe('AuthCallbackPage', () => {
  it('sets isAuthenticated to true when fetchAuthStatus returns authenticated', async () => {
    renderWithRouter(<AuthCallbackPage />);

    await waitFor(() => {
      expect(useAuthStore.getState().isAuthenticated).toBe(true);
    });
  });

  it('redirects to /dashboard when fetchAuthStatus returns authenticated', async () => {
    const { getByText } = renderWithRouter(<AuthCallbackPage />);

    await waitFor(() => {
      expect(getByText('dashboard page')).toBeInTheDocument();
    });
  });

  it('shows an error message when fetchAuthStatus returns unauthenticated', async () => {
    server.use(
      http.get('/api/v1/auth/status', () =>
        HttpResponse.json({ enabled: true, authenticated: false, user: null })
      )
    );

    renderWithRouter(<AuthCallbackPage />);

    await waitFor(() => {
      expect(
        screen.getByText(/Authentication failed/i)
      ).toBeInTheDocument();
    });
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
  });

  it('shows an error message when the status API returns 500', async () => {
    server.use(
      http.get('/api/v1/auth/status', () => new HttpResponse(null, { status: 500 }))
    );

    renderWithRouter(<AuthCallbackPage />);

    await waitFor(() => {
      expect(
        screen.getByText(/An error occurred during sign-in/i)
      ).toBeInTheDocument();
    });
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
  });

  it('shows the "Signing you in…" spinner immediately on render', () => {
    renderWithRouter(<AuthCallbackPage />);

    expect(screen.getByText('Signing you in…')).toBeInTheDocument();
  });
});
