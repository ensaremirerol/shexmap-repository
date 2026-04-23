import { describe, it, expect, beforeEach } from 'vitest';
import { useAuthStore } from './authStore';

const initialState = { token: null, user: null, isAuthenticated: false };

beforeEach(() => {
  useAuthStore.setState(initialState);
});

describe('authStore', () => {
  it('has correct initial state', () => {
    const state = useAuthStore.getState();
    expect(state.token).toBeNull();
    expect(state.user).toBeNull();
    expect(state.isAuthenticated).toBe(false);
  });

  it('setToken updates token, user and isAuthenticated', () => {
    const user = { sub: 'u1', name: 'Alice', email: 'alice@example.com' };
    useAuthStore.getState().setToken('my-token', user);

    const state = useAuthStore.getState();
    expect(state.token).toBe('my-token');
    expect(state.user).toEqual(user);
    expect(state.isAuthenticated).toBe(true);
  });

  it('logout resets all fields to null/false', () => {
    // Set some state first
    useAuthStore.getState().setToken('tok', { sub: 'u1', name: 'Alice' });
    useAuthStore.getState().logout();

    const state = useAuthStore.getState();
    expect(state.token).toBeNull();
    expect(state.user).toBeNull();
    expect(state.isAuthenticated).toBe(false);
  });

  it('state returns to initial after setToken then logout', () => {
    useAuthStore.getState().setToken('tok', { sub: 'u1', name: 'Bob' });
    useAuthStore.getState().logout();

    const state = useAuthStore.getState();
    expect(state).toMatchObject(initialState);
  });
});
