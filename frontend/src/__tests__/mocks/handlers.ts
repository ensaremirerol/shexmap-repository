import { http, HttpResponse } from 'msw';

export const handlers = [
  http.get('/api/v1/auth/status', () => {
    return HttpResponse.json({
      enabled: true,
      authenticated: true,
      user: {
        sub: 'user-1',
        role: 'user',
        name: 'Test User',
        email: 'test@example.com',
      },
    });
  }),
];
