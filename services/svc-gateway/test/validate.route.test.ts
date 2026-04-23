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

describe('POST /api/v1/validate', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env['JWT_SECRET'] = 'test-secret-at-least-32-characters-long!!';
    const { buildServer } = await import('../src/server.js');
    app = await buildServer();
  });

  afterAll(() => app.close());

  it('forwards request to svc-validate and converts snake_case to camelCase', async () => {
    mockGrpcCall.mockResolvedValueOnce({
      shex_valid:   true,
      shex_errors:  [],
      rdf_valid:    true,
      rdf_errors:   [],
      valid:        true,
      binding_tree: [],
      bindings:     { 'http://example.org/name': 'Alice' },
      target_rdf:   '',
      errors:       [],
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/validate',
      payload: {
        sourceShEx: 'PREFIX ex: <http://example.org/> start = @<S> <S> { ex:name . }',
        sourceRdf: '<tag:node1> <http://example.org/name> "Alice" .',
        sourceNode: '<tag:node1>',
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.shexValid).toBe(true);
    expect(body.rdfValid).toBe(true);
    expect(body.valid).toBe(true);
    expect(body.bindingTree).toBeDefined();
    expect(body.targetRdf).toBeDefined();
  });

  it('returns 500 when gRPC call throws INTERNAL error', async () => {
    const err = new Error('Service unavailable');
    (err as any).code = 13;
    mockGrpcCall.mockRejectedValueOnce(err);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/validate',
      payload: { sourceShEx: 'invalid' },
    });

    expect(res.statusCode).toBe(500);
  });

  it('returns 400 when gRPC call throws INVALID_ARGUMENT', async () => {
    const err = new Error('Missing required field');
    (err as any).code = 3;
    mockGrpcCall.mockRejectedValueOnce(err);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/validate',
      payload: { sourceShEx: 'invalid' },
    });

    expect(res.statusCode).toBe(400);
  });

  it('accepts snake_case field names from body', async () => {
    mockGrpcCall.mockResolvedValueOnce({
      shex_valid: true,
      shex_errors: [],
      valid: false,
      binding_tree: [],
      bindings: {},
      errors: [],
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/validate',
      payload: {
        source_shex: 'PREFIX ex: <http://example.org/> start = @<S> <S> { ex:name . }',
      },
    });

    expect(res.statusCode).toBe(200);
    expect(mockGrpcCall).toHaveBeenCalledWith(
      {},
      'Validate',
      expect.objectContaining({ source_shex: 'PREFIX ex: <http://example.org/> start = @<S> <S> { ex:name . }' }),
      expect.anything(),
    );
  });
});
