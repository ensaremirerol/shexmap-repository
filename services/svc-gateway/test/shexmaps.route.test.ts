import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';

vi.mock('../src/grpc/clients.js', () => ({
  validateClient: {},
  shexmapClient:  {},
  pairingClient:  {},
  coverageClient: {},
  schemaClient:   {},
}));

const mockGrpcCall = vi.fn();

vi.mock('../src/grpc/call.js', async (importOriginal) => {
  const mod = await importOriginal() as Record<string, unknown>;
  return { ...mod, grpcCall: mockGrpcCall };
});

const MOCK_MAP = {
  id:                 'map-uuid-1',
  title:              'Test Map',
  description:        'A test map',
  content:            'PREFIX ex: <http://example.org/>',
  sample_turtle_data: '',
  file_name:          '',
  file_format:        'shexc',
  source_url:         '',
  schema_url:         '',
  tags:               [],
  version:            '1.0.0',
  author_id:          'user-1',
  author_name:        'Alice',
  created_at:         '2024-01-01T00:00:00Z',
  modified_at:        '2024-01-01T00:00:00Z',
  stars:              0,
  has_map_annotations: false,
  map_variables:      [],
};

describe('GET /api/v1/shexmaps', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    vi.resetModules();
    process.env['AUTH_ENABLED'] = 'false';
    process.env['JWT_SECRET'] = 'test-secret-at-least-32-characters-long!!';

    vi.mock('../src/grpc/clients.js', () => ({
      validateClient: {},
      shexmapClient:  {},
      pairingClient:  {},
      coverageClient: {},
      schemaClient:   {},
    }));

    vi.mock('../src/grpc/call.js', async (importOriginal) => {
      const mod = await importOriginal() as Record<string, unknown>;
      return { ...mod, grpcCall: mockGrpcCall };
    });

    const { buildServer } = await import('../src/server.js');
    app = await buildServer();
  });

  afterAll(() => app.close());

  it('lists shexmaps and converts snake_case to camelCase', async () => {
    mockGrpcCall.mockResolvedValueOnce({
      items: [MOCK_MAP],
      total: 1,
    });

    const res = await app.inject({ method: 'GET', url: '/api/v1/shexmaps' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items).toHaveLength(1);
    expect(body.items[0].authorId).toBe('user-1');
    expect(body.items[0].authorName).toBe('Alice');
    expect(body.items[0].sampleTurtleData).toBeDefined();
    expect(body.total).toBe(1);
  });

  it('returns 404 when GET /api/v1/shexmaps/:id returns found=false', async () => {
    mockGrpcCall.mockResolvedValueOnce({ found: false, map: null });

    const res = await app.inject({ method: 'GET', url: '/api/v1/shexmaps/nonexistent' });
    expect(res.statusCode).toBe(404);
  });

  it('returns 200 with camelCase map when found=true', async () => {
    mockGrpcCall.mockResolvedValueOnce({ found: true, map: MOCK_MAP });

    const res = await app.inject({ method: 'GET', url: '/api/v1/shexmaps/map-uuid-1' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBe('map-uuid-1');
    expect(body.fileFormat).toBe('shexc');
    expect(body.hasMapAnnotations).toBe(false);
  });

  it('POST /api/v1/shexmaps creates a map and returns 201', async () => {
    mockGrpcCall.mockResolvedValueOnce({ found: true, map: MOCK_MAP });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/shexmaps',
      payload: { title: 'Test Map', content: 'PREFIX ex: <http://example.org/>' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().id).toBe('map-uuid-1');
  });

  it('DELETE /api/v1/shexmaps/:id returns 204 on success', async () => {
    mockGrpcCall.mockResolvedValueOnce({ success: true });

    const res = await app.inject({ method: 'DELETE', url: '/api/v1/shexmaps/map-uuid-1' });
    expect(res.statusCode).toBe(204);
  });

  it('DELETE /api/v1/shexmaps/:id returns 404 when not found', async () => {
    mockGrpcCall.mockResolvedValueOnce({ success: false });

    const res = await app.inject({ method: 'DELETE', url: '/api/v1/shexmaps/nonexistent' });
    expect(res.statusCode).toBe(404);
  });

  it('GET /api/v1/shexmaps/:id/versions lists versions', async () => {
    const MOCK_VERSION = {
      id: 'map-uuid-1-v1', map_id: 'map-uuid-1', version_number: 1,
      commit_message: 'Initial', author_id: 'user-1', author_name: 'Alice',
      created_at: '2024-01-01T00:00:00Z',
    };
    mockGrpcCall.mockResolvedValueOnce({ versions: [MOCK_VERSION] });

    const res = await app.inject({ method: 'GET', url: '/api/v1/shexmaps/map-uuid-1/versions' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveLength(1);
    expect(body[0].versionNumber).toBe(1);
  });

  it('GET /api/v1/shexmaps/:id/versions/:vn returns 400 for invalid version number', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/shexmaps/map-uuid-1/versions/abc' });
    expect(res.statusCode).toBe(400);
  });
});

describe('POST /api/v1/shexmaps — auth enabled', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    vi.resetModules();
    process.env['AUTH_ENABLED'] = 'true';
    process.env['JWT_SECRET'] = 'test-secret-at-least-32-characters-long!!';

    vi.mock('../src/grpc/clients.js', () => ({
      validateClient: {},
      shexmapClient:  {},
      pairingClient:  {},
      coverageClient: {},
      schemaClient:   {},
    }));

    vi.mock('../src/grpc/call.js', async (importOriginal) => {
      const mod = await importOriginal() as Record<string, unknown>;
      return { ...mod, grpcCall: mockGrpcCall };
    });

    const { buildServer } = await import('../src/server.js');
    app = await buildServer();
  });

  afterAll(async () => {
    await app.close();
    process.env['AUTH_ENABLED'] = 'false';
  });

  it('returns 401 when auth enabled and no JWT token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/shexmaps',
      payload: { title: 'Test Map' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 401 when auth enabled and PATCH without token', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/shexmaps/map-uuid-1',
      payload: { title: 'Updated' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 401 when auth enabled and DELETE without token', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/v1/shexmaps/map-uuid-1',
    });
    expect(res.statusCode).toBe(401);
  });

  it('GET is always allowed even when auth enabled', async () => {
    mockGrpcCall.mockResolvedValueOnce({ items: [], total: 0 });

    const res = await app.inject({ method: 'GET', url: '/api/v1/shexmaps' });
    expect(res.statusCode).toBe(200);
  });
});
