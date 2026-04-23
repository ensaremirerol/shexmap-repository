import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { useAuthStore } from '../../store/authStore';
import ProtectedRoute from './ProtectedRoute';

beforeEach(() => {
  useAuthStore.setState({ token: null, user: null, isAuthenticated: false });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function renderProtected(children: React.ReactNode = <div>protected content</div>) {
  return render(
    <MemoryRouter initialEntries={['/protected']}>
      <Routes>
        <Route
          path="/protected"
          element={<ProtectedRoute>{children}</ProtectedRoute>}
        />
        <Route path="/" element={<div>home page</div>} />
      </Routes>
    </MemoryRouter>
  );
}

describe('ProtectedRoute', () => {
  it('renders children when auth is disabled, regardless of auth state', () => {
    vi.stubEnv('VITE_AUTH_ENABLED', 'false');

    renderProtected();

    expect(screen.getByText('protected content')).toBeInTheDocument();
  });

  it('renders children when auth is enabled and user is authenticated', () => {
    vi.stubEnv('VITE_AUTH_ENABLED', 'true');
    useAuthStore.setState({
      token: 'tok',
      user: { sub: 'u1', name: 'Alice' },
      isAuthenticated: true,
    });

    renderProtected();

    expect(screen.getByText('protected content')).toBeInTheDocument();
  });

  it('redirects to / when auth is enabled and user is unauthenticated', () => {
    vi.stubEnv('VITE_AUTH_ENABLED', 'true');
    // isAuthenticated is false (initial state set in beforeEach)

    renderProtected();

    // Children should NOT be rendered; the home route should show instead
    expect(screen.queryByText('protected content')).toBeNull();
    expect(screen.getByText('home page')).toBeInTheDocument();
  });
});
