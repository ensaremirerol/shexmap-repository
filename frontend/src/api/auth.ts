import { apiClient } from './client.js';

export interface AuthStatusResponse {
  enabled: boolean;
  authenticated: boolean;
  user: {
    sub: string;
    role: string;
    name?: string;
    email?: string;
  } | null;
}

export async function fetchAuthStatus(): Promise<AuthStatusResponse> {
  const res = await apiClient.get<AuthStatusResponse>('/auth/status');
  return res.data;
}

export async function callLogout(): Promise<void> {
  await apiClient.post('/auth/logout');
}
