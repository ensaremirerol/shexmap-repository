import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/services/coverage.service.js', () => ({
  getCoverageOverview: vi.fn(),
  getGapAnalysis:      vi.fn(),
}));

vi.mock('../src/sparql.js', () => ({
  sparqlClient: {},
  prefixes:     {},
}));

vi.mock('../src/config.js', () => ({
  config: { port: 50000 },
}));

vi.mock('@grpc/proto-loader', () => ({
  default: { loadSync: vi.fn().mockReturnValue({}) },
  loadSync: vi.fn().mockReturnValue({}),
}));

vi.mock('@grpc/grpc-js', () => {
  const mockService = {};
  const mockProto = {
    shexmap: {
      coverage: {
        CoverageService: { service: mockService },
      },
    },
  };
  return {
    default: {
      Server: vi.fn().mockImplementation(() => ({
        addService: vi.fn(),
        bindAsync:  vi.fn(),
      })),
      ServerCredentials: { createInsecure: vi.fn().mockReturnValue({}) },
      loadPackageDefinition: vi.fn().mockReturnValue(mockProto),
      status: { INTERNAL: 13 },
    },
    Server: vi.fn().mockImplementation(() => ({
      addService: vi.fn(),
      bindAsync:  vi.fn(),
    })),
    ServerCredentials: { createInsecure: vi.fn().mockReturnValue({}) },
    loadPackageDefinition: vi.fn().mockReturnValue(mockProto),
    status: { INTERNAL: 13 },
  };
});

import { getCoverageOverview, getGapAnalysis } from '../src/services/coverage.service.js';
import { createServer } from '../src/server.js';

beforeEach(() => {
  vi.mocked(getCoverageOverview).mockReset();
  vi.mocked(getGapAnalysis).mockReset();
});

describe('createServer', () => {
  it('returns a gRPC server instance', async () => {
    const grpc = await import('@grpc/grpc-js');
    const server = createServer();
    expect(grpc.Server).toHaveBeenCalled();
    expect(server).toBeDefined();
  });
});

describe('GetOverview handler', () => {
  it('calls getCoverageOverview and returns mapped response', async () => {
    const mockOverview = {
      totalSchemas:            2,
      totalShexMaps:           5,
      totalShapes:             10,
      totalMappedShapes:       4,
      overallCoveragePercent:  40,
      computedAt:              '2024-01-01T00:00:00.000Z',
      bySchema: [
        {
          schemaUrl:       'https://ex.org/schema1',
          schemaTitle:     'Schema A',
          totalShapes:     10,
          mappedShapes:    4,
          coveragePercent: 40,
          computedAt:      '2024-01-01T00:00:00.000Z',
        },
      ],
    };

    vi.mocked(getCoverageOverview).mockResolvedValue(mockOverview);

    const grpcModule = await import('@grpc/grpc-js');
    let capturedImpl: Record<string, Function> = {};

    vi.mocked(grpcModule.Server).mockImplementation(() => ({
      addService: vi.fn((_svc, impl) => { capturedImpl = impl; }),
      bindAsync:  vi.fn(),
    }) as any);

    createServer();

    const call = { request: {} };
    const callback = vi.fn();
    await capturedImpl['GetOverview'](call, callback);

    expect(getCoverageOverview).toHaveBeenCalled();
    expect(callback).toHaveBeenCalledWith(null, expect.objectContaining({
      total_schemas:            2,
      total_shex_maps:          5,
      total_shapes:             10,
      total_mapped_shapes:      4,
      overall_coverage_percent: 40,
    }));
  });

  it('calls callback with INTERNAL error on exception', async () => {
    vi.mocked(getCoverageOverview).mockRejectedValue(new Error('SPARQL down'));

    const grpcModule = await import('@grpc/grpc-js');
    let capturedImpl: Record<string, Function> = {};

    vi.mocked(grpcModule.Server).mockImplementation(() => ({
      addService: vi.fn((_svc, impl) => { capturedImpl = impl; }),
      bindAsync:  vi.fn(),
    }) as any);

    createServer();

    const call = { request: {} };
    const callback = vi.fn();
    await capturedImpl['GetOverview'](call, callback);

    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({ code: 13, message: 'SPARQL down' }),
    );
  });
});

describe('GetGaps handler', () => {
  it('calls getGapAnalysis with empty schema_url as undefined', async () => {
    vi.mocked(getGapAnalysis).mockResolvedValue([]);

    const grpcModule = await import('@grpc/grpc-js');
    let capturedImpl: Record<string, Function> = {};

    vi.mocked(grpcModule.Server).mockImplementation(() => ({
      addService: vi.fn((_svc, impl) => { capturedImpl = impl; }),
      bindAsync:  vi.fn(),
    }) as any);

    createServer();

    const call = { request: { schema_url: '' } };
    const callback = vi.fn();
    await capturedImpl['GetGaps'](call, callback);

    expect(getGapAnalysis).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      undefined,
    );
    expect(callback).toHaveBeenCalledWith(null, { gaps: [] });
  });

  it('passes schema_url to getGapAnalysis when provided', async () => {
    vi.mocked(getGapAnalysis).mockResolvedValue([
      {
        schemaUrl:    'https://ex.org/schema1',
        shapeUrl:     'https://ex.org/shape1',
        shapeLabel:   'Patient',
        hasMappings:  false,
        mappingCount: 0,
      },
    ]);

    const grpcModule = await import('@grpc/grpc-js');
    let capturedImpl: Record<string, Function> = {};

    vi.mocked(grpcModule.Server).mockImplementation(() => ({
      addService: vi.fn((_svc, impl) => { capturedImpl = impl; }),
      bindAsync:  vi.fn(),
    }) as any);

    createServer();

    const call = { request: { schema_url: 'https://ex.org/schema1' } };
    const callback = vi.fn();
    await capturedImpl['GetGaps'](call, callback);

    expect(getGapAnalysis).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'https://ex.org/schema1',
    );
    expect(callback).toHaveBeenCalledWith(null, {
      gaps: [{
        schema_url:    'https://ex.org/schema1',
        shape_url:     'https://ex.org/shape1',
        shape_label:   'Patient',
        has_mappings:  false,
        mapping_count: 0,
      }],
    });
  });

  it('calls callback with INTERNAL error on exception', async () => {
    vi.mocked(getGapAnalysis).mockRejectedValue(new Error('timeout'));

    const grpcModule = await import('@grpc/grpc-js');
    let capturedImpl: Record<string, Function> = {};

    vi.mocked(grpcModule.Server).mockImplementation(() => ({
      addService: vi.fn((_svc, impl) => { capturedImpl = impl; }),
      bindAsync:  vi.fn(),
    }) as any);

    createServer();

    const call = { request: { schema_url: '' } };
    const callback = vi.fn();
    await capturedImpl['GetGaps'](call, callback);

    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({ code: 13, message: 'timeout' }),
    );
  });
});
