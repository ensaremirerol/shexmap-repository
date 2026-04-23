import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('sparql routes — auth disabled', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env['AUTH_ENABLED'] = 'false';
    const { buildServer } = await import('../src/server.js');
    app = await buildServer();
  });

  afterAll(() => app.close());

  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('GET /health returns ok', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok', service: 'svc-sparql-proxy' });
  });

  it('GET /sparql proxies to QLever and returns response', async () => {
    mockFetch.mockResolvedValueOnce({
      status: 200,
      headers: { get: () => 'application/sparql-results+json' },
      text: async () => '{"results":{"bindings":[]}}',
    });

    const res = await app.inject({
      method: 'GET',
      url: '/sparql?query=SELECT+*+WHERE+%7B%3Fs+%3Fp+%3Fo%7D+LIMIT+1',
    });

    expect(res.statusCode).toBe(200);
    expect(mockFetch).toHaveBeenCalledOnce();
    const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('query=');
  });

  it('GET /sparql forwards Accept header', async () => {
    mockFetch.mockResolvedValueOnce({
      status: 200,
      headers: { get: () => 'text/turtle' },
      text: async () => '<s> <p> <o> .',
    });

    await app.inject({
      method: 'GET',
      url: '/sparql?query=CONSTRUCT+%7B%7D+WHERE+%7B%7D',
      headers: { accept: 'text/turtle' },
    });

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['Accept']).toBe('text/turtle');
  });

  it('POST /sparql proxies UPDATE when auth disabled', async () => {
    mockFetch.mockResolvedValueOnce({
      status: 200,
      headers: { get: () => 'text/plain' },
      text: async () => 'Update successful',
    });

    const res = await app.inject({
      method: 'POST',
      url: '/sparql',
      headers: { 'content-type': 'application/sparql-update' },
      payload: 'INSERT DATA { <s> <p> <o> }',
    });

    expect(res.statusCode).toBe(200);
    expect(mockFetch).toHaveBeenCalledOnce();
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect((init as RequestInit).method).toBe('POST');
  });

  it('POST /sparql succeeds without x-auth-user-id when auth disabled', async () => {
    mockFetch.mockResolvedValueOnce({
      status: 200,
      headers: { get: () => 'text/plain' },
      text: async () => 'ok',
    });

    const res = await app.inject({
      method: 'POST',
      url: '/sparql',
      payload: 'INSERT DATA { <s> <p> <o> }',
    });

    expect(res.statusCode).toBe(200);
  });
});

describe('sparql routes — auth enabled', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    vi.resetModules();
    process.env['AUTH_ENABLED'] = 'true';
    const { buildServer } = await import('../src/server.js');
    app = await buildServer();
  });

  afterAll(async () => {
    await app.close();
    process.env['AUTH_ENABLED'] = 'false';
  });

  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('POST /sparql returns 401 when x-auth-user-id missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/sparql',
      payload: 'INSERT DATA { <s> <p> <o> }',
    });

    expect(res.statusCode).toBe(401);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('POST /sparql proxies UPDATE when x-auth-user-id is present', async () => {
    mockFetch.mockResolvedValueOnce({
      status: 200,
      headers: { get: () => 'text/plain' },
      text: async () => 'ok',
    });

    const res = await app.inject({
      method: 'POST',
      url: '/sparql',
      headers: { 'x-auth-user-id': 'user-123' },
      payload: 'INSERT DATA { <s> <p> <o> }',
    });

    expect(res.statusCode).toBe(200);
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it('GET /sparql is always public even when auth enabled', async () => {
    mockFetch.mockResolvedValueOnce({
      status: 200,
      headers: { get: () => 'application/sparql-results+json' },
      text: async () => '{"results":{"bindings":[]}}',
    });

    const res = await app.inject({
      method: 'GET',
      url: '/sparql?query=SELECT+*+WHERE+%7B%7D+LIMIT+1',
    });

    expect(res.statusCode).toBe(200);
  });
});
