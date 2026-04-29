import { describe, it, expect, beforeEach } from 'vitest';
import { useAuthStore } from './authStore';

beforeEach(() => {
  useAuthStore.setState({ user: null, isAuthenticated: false });
});

describe('authStore', () => {
  it('has correct initial state', () => {
    const state = useAuthStore.getState();
    expect(state.user).toBeNull();
    expect(state.isAuthenticated).toBe(false);
  });

  it('setUser updates user and isAuthenticated', () => {
    const user = { sub: 'u1', name: 'Alice', email: 'alice@example.com' };
    useAuthStore.getState().setUser(user);

    const state = useAuthStore.getState();
    expect(state.user).toEqual(user);
    expect(state.isAuthenticated).toBe(true);
  });

  it('clearAuth resets all fields', () => {
    useAuthStore.getState().setUser({ sub: 'u1', name: 'Alice' });
    useAuthStore.getState().clearAuth();

    const state = useAuthStore.getState();
    expect(state.user).toBeNull();
    expect(state.isAuthenticated).toBe(false);
  });

  it('state returns to initial after setUser then clearAuth', () => {
    useAuthStore.getState().setUser({ sub: 'u1', name: 'Bob' });
    useAuthStore.getState().clearAuth();

    expect(useAuthStore.getState().user).toBeNull();
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
  });
});
