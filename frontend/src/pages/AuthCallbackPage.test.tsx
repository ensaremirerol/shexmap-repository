import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import { server } from '../__tests__/mocks/server';
import { useAuthStore } from '../store/authStore';
import AuthCallbackPage from './AuthCallbackPage';

function renderWithRouter(ui: React.ReactElement, { initialEntries = ['/'] } = {}) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <Routes>
        <Route path="*" element={ui} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  useAuthStore.setState({ token: null, user: null, isAuthenticated: false });
  window.location.hash = '';
});

describe('AuthCallbackPage', () => {
  it('sets isAuthenticated to true when a valid token is in the hash', async () => {
    window.location.hash = '#token=test-jwt';

    renderWithRouter(<AuthCallbackPage />);

    await waitFor(() => {
      expect(useAuthStore.getState().isAuthenticated).toBe(true);
    });
  });

  it('redirects to / when there is no token in the hash', async () => {
    window.location.hash = '';

    // Render inside a router that has a distinct home route so we can
    // detect when the component navigates away from /auth/callback.
    const { getByText } = render(
      <MemoryRouter initialEntries={['/auth/callback']}>
        <Routes>
          <Route path="/auth/callback" element={<AuthCallbackPage />} />
          <Route path="/" element={<div>home page</div>} />
        </Routes>
      </MemoryRouter>
    );

    // Without a token the component calls navigate('/') immediately.
    await waitFor(() => {
      expect(getByText('home page')).toBeInTheDocument();
    });
  });

  it('shows an error message when the status API returns 500', async () => {
    server.use(
      http.get('/api/v1/auth/status', () => new HttpResponse(null, { status: 500 }))
    );

    window.location.hash = '#token=test-jwt';

    renderWithRouter(<AuthCallbackPage />);

    await waitFor(() => {
      expect(
        screen.getByText(/An error occurred during sign-in/i)
      ).toBeInTheDocument();
    });

    expect(useAuthStore.getState().isAuthenticated).toBe(false);
  });

  it('shows the "Signing you in…" spinner immediately on render', () => {
    window.location.hash = '#token=test-jwt';

    renderWithRouter(<AuthCallbackPage />);

    expect(screen.getByText('Signing you in…')).toBeInTheDocument();
  });
});
