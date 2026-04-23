import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';

vi.mock('../src/grpc/clients.js', () => ({
  validateClient: {},
  shexmapClient:  {},
  pairingClient:  {},
  coverageClient: {},
  schemaClient:   {},
}));

vi.mock('../src/grpc/call.js', async (importOriginal) => {
  const mod = await importOriginal() as Record<string, unknown>;
  return { ...mod, grpcCall: vi.fn() };
});

describe('auth plugin — JWT verification', () => {
  let app: FastifyInstance;
  const JWT_SECRET = 'test-secret-at-least-32-characters-long!!';

  beforeAll(async () => {
    process.env['JWT_SECRET'] = JWT_SECRET;
    process.env['AUTH_ENABLED'] = 'false';
    const { buildServer } = await import('../src/server.js');
    app = await buildServer();
  });

  afterAll(() => app.close());

  it('health endpoint is reachable without a token', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok' });
  });

  it('extractAuth returns anonymous context when no Authorization header', async () => {
    const ctx = app.extractAuth({ headers: {} } as any);
    expect(ctx.userId).toBe('');
    expect(ctx.role).toBe('anonymous');
  });

  it('extractAuth returns anonymous context for non-Bearer header', async () => {
    const ctx = app.extractAuth({
      headers: { authorization: 'Basic sometoken' },
    } as any);
    expect(ctx.userId).toBe('');
    expect(ctx.role).toBe('anonymous');
  });

  it('extractAuth returns anonymous context for invalid JWT', async () => {
    const ctx = app.extractAuth({
      headers: { authorization: 'Bearer invalid.jwt.token' },
    } as any);
    expect(ctx.userId).toBe('');
    expect(ctx.role).toBe('anonymous');
  });

  it('extractAuth returns valid AuthContext for a legitimate JWT', async () => {
    const token = app.jwt.sign({ sub: 'user-abc', role: 'user' });
    const ctx = app.extractAuth({
      headers: { authorization: `Bearer ${token}` },
    } as any);
    expect(ctx.userId).toBe('user-abc');
    expect(ctx.role).toBe('user');
    expect(ctx.authEnabled).toBe(false);
  });

  it('extractAuth handles admin role correctly', async () => {
    const token = app.jwt.sign({ sub: 'admin-xyz', role: 'admin' });
    const ctx = app.extractAuth({
      headers: { authorization: `Bearer ${token}` },
    } as any);
    expect(ctx.userId).toBe('admin-xyz');
    expect(ctx.role).toBe('admin');
  });
});
