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

export async function fetchAuthStatus(tokenOverride?: string): Promise<AuthStatusResponse> {
  const headers: Record<string, string> = {};
  if (tokenOverride) {
    headers['Authorization'] = `Bearer ${tokenOverride}`;
  }
  const res = await apiClient.get<AuthStatusResponse>('/auth/status', { headers });
  return res.data;
}
