import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';

vi.mock('../src/sparql.js', () => ({
  sparqlClient: {},
  prefixes: {},
}));

const mockRegisterUser = vi.fn().mockResolvedValue({
  id: 'new-user-id',
  name: 'alice',
  email: 'alice@example.com',
  externalId: 'local:alice',
  username: 'alice',
  created: '2024-01-01T00:00:00Z',
});

const mockFindUserByUsername = vi.fn();
const mockVerifyPassword = vi.fn();

vi.mock('../src/db.js', () => ({ getDb: vi.fn(), setDb: vi.fn() }));

vi.mock('../src/services/user.service.js', () => ({
  upsertUser: vi.fn().mockResolvedValue({
    id: 'test-user-id',
    name: 'Test User',
    email: 'test@example.com',
    externalId: 'github:123',
    created: '2024-01-01T00:00:00Z',
  }),
  getUserById: vi.fn().mockResolvedValue(null),
  registerUser: mockRegisterUser,
  findUserByUsername: mockFindUserByUsername,
  verifyPassword: mockVerifyPassword,
}));

// ── auth disabled ───────────────────────────────────────────────────────────
describe('auth routes — auth disabled', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env['AUTH_ENABLED'] = 'false';
    const { buildServer } = await import('../src/server.js');
    app = await buildServer();
  });

  afterAll(() => app.close());

  it('GET /health returns ok', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok' });
  });

  it('GET /auth/status returns enabled:false', async () => {
    const res = await app.inject({ method: 'GET', url: '/auth/status' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ enabled: false, authenticated: false });
  });

  it('GET /auth/login returns 400 when auth disabled', async () => {
    const res = await app.inject({ method: 'GET', url: '/auth/login?provider=github' });
    expect(res.statusCode).toBe(400);
  });

  it('POST /auth/register returns 400 when auth disabled', async () => {
    const res = await app.inject({
      method: 'POST', url: '/auth/register',
      payload: { username: 'alice', password: 'secret123' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /auth/login returns 400 when auth disabled', async () => {
    const res = await app.inject({
      method: 'POST', url: '/auth/login',
      payload: { username: 'alice', password: 'secret123' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /auth/logout returns 200 when auth disabled (requireAuth is no-op)', async () => {
    const res = await app.inject({ method: 'POST', url: '/auth/logout' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ message: 'Logged out' });
  });
});

// ── auth enabled ────────────────────────────────────────────────────────────
describe('auth routes — auth enabled', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    vi.resetModules();
    process.env['AUTH_ENABLED'] = 'true';
    process.env['JWT_SECRET'] = 'test-secret-at-least-32-characters-long!!';

    vi.mock('../src/sparql.js', () => ({ sparqlClient: {}, prefixes: {} }));
    vi.mock('../src/db.js', () => ({ getDb: vi.fn(), setDb: vi.fn() }));
    vi.mock('../src/services/user.service.js', () => ({
      upsertUser: vi.fn(),
      getUserById: vi.fn(),
      registerUser: mockRegisterUser,
      findUserByUsername: mockFindUserByUsername,
      verifyPassword: mockVerifyPassword,
    }));

    const { buildServer } = await import('../src/server.js');
    app = await buildServer();
  });

  afterAll(async () => {
    await app.close();
    process.env['AUTH_ENABLED'] = 'false';
  });

  it('POST /auth/register — returns 400 when password too short', async () => {
    const res = await app.inject({
      method: 'POST', url: '/auth/register',
      payload: { username: 'alice', password: 'short' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /auth/register — returns 400 when fields missing', async () => {
    const res = await app.inject({
      method: 'POST', url: '/auth/register',
      payload: { username: 'alice' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /auth/register — creates user and returns token', async () => {
    mockRegisterUser.mockResolvedValueOnce({
      id: 'new-user-id', name: 'alice', email: '', externalId: 'local:alice',
      username: 'alice', created: '2024-01-01T00:00:00Z',
    });

    const res = await app.inject({
      method: 'POST', url: '/auth/register',
      payload: { username: 'alice', password: 'password123' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ user: { username: 'alice' } });
    expect(res.json().token).toBeTruthy();
  });

  it('POST /auth/register — returns 409 when username taken', async () => {
    mockRegisterUser.mockRejectedValueOnce(
      Object.assign(new Error('Username already taken'), { code: 'USERNAME_TAKEN' }),
    );
    const res = await app.inject({
      method: 'POST', url: '/auth/register',
      payload: { username: 'alice', password: 'password123' },
    });
    expect(res.statusCode).toBe(409);
  });

  it('POST /auth/login — returns 401 for wrong password', async () => {
    mockFindUserByUsername.mockResolvedValueOnce({
      id: 'uid', name: 'alice', email: '', externalId: 'local:alice',
      username: 'alice', created: '2024-01-01T00:00:00Z',
      passwordHash: '$2a$12$fakeHash',
    });
    mockVerifyPassword.mockResolvedValueOnce(false);

    const res = await app.inject({
      method: 'POST', url: '/auth/login',
      payload: { username: 'alice', password: 'wrongpass' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('POST /auth/login — returns 401 when user not found', async () => {
    mockFindUserByUsername.mockResolvedValueOnce(null);

    const res = await app.inject({
      method: 'POST', url: '/auth/login',
      payload: { username: 'nobody', password: 'password123' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('POST /auth/login — returns token on success', async () => {
    mockFindUserByUsername.mockResolvedValueOnce({
      id: 'uid', name: 'alice', email: 'alice@example.com', externalId: 'local:alice',
      username: 'alice', created: '2024-01-01T00:00:00Z',
      passwordHash: '$2a$12$validHash',
    });
    mockVerifyPassword.mockResolvedValueOnce(true);

    const res = await app.inject({
      method: 'POST', url: '/auth/login',
      payload: { username: 'alice', password: 'password123' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().token).toBeTruthy();
    expect(res.json().user).toMatchObject({ username: 'alice' });
  });

  it('GET /auth/login?provider=github — redirects to /auth/login/github', async () => {
    const res = await app.inject({ method: 'GET', url: '/auth/login?provider=github' });
    // @fastify/oauth2 registers /auth/login/github but without credentials it won't be active;
    // we just verify our handler issues a redirect to the right path
    expect([301, 302]).toContain(res.statusCode);
    expect(res.headers['location']).toBe('/auth/login/github');
  });

  it('GET /auth/login?provider=unknown — returns 400', async () => {
    const res = await app.inject({ method: 'GET', url: '/auth/login?provider=unknown' });
    expect(res.statusCode).toBe(400);
  });

  it('GET /auth/callback — returns 400 without provider', async () => {
    const res = await app.inject({ method: 'GET', url: '/auth/callback' });
    expect(res.statusCode).toBe(400);
  });

  it('GET /auth/callback — returns 400 for unconfigured provider', async () => {
    const res = await app.inject({ method: 'GET', url: '/auth/callback?provider=github' });
    // githubOAuth2 is not registered (no client id in test env), so should get badRequest
    expect(res.statusCode).toBe(400);
  });
});
