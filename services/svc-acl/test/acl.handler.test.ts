import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/services/acl.service.js', () => ({
  ACL_GRAPH:        'https://w3id.org/shexmap/acl',
  SUPPORTED_MODES:  ['Write'],
  hasMode:            vi.fn(),
  grantMode:          vi.fn(),
  revokeMode:         vi.fn(),
  listAuthorizations: vi.fn(),
  purgeResource:      vi.fn(),
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
      acl: {
        AclService: { service: mockService },
      },
    },
  };
  const Metadata = vi.fn().mockImplementation(() => ({
    get: vi.fn().mockReturnValue([]),
  }));
  return {
    default: {
      Server: vi.fn().mockImplementation(() => ({
        addService: vi.fn(),
        bindAsync:  vi.fn(),
      })),
      ServerCredentials: { createInsecure: vi.fn().mockReturnValue({}) },
      loadPackageDefinition: vi.fn().mockReturnValue(mockProto),
      Metadata,
      status: { INTERNAL: 13, INVALID_ARGUMENT: 3 },
    },
    Server: vi.fn().mockImplementation(() => ({
      addService: vi.fn(),
      bindAsync:  vi.fn(),
    })),
    ServerCredentials: { createInsecure: vi.fn().mockReturnValue({}) },
    loadPackageDefinition: vi.fn().mockReturnValue(mockProto),
    Metadata,
    status: { INTERNAL: 13, INVALID_ARGUMENT: 3 },
  };
});

import {
  hasMode,
  grantMode,
  revokeMode,
  listAuthorizations,
  purgeResource,
} from '../src/services/acl.service.js';
import { createServer } from '../src/server.js';

const RESOURCE = 'https://w3id.org/shexmap/resource/map/r1';
const AGENT    = 'https://w3id.org/shexmap/resource/user/u1';

const fakeMetadata = () => ({ get: () => [] });

async function captureImpl(): Promise<Record<string, Function>> {
  const grpcModule = await import('@grpc/grpc-js');
  let captured: Record<string, Function> = {};
  vi.mocked(grpcModule.Server).mockImplementation(() => ({
    addService: vi.fn((_svc, impl) => { captured = impl; }),
    bindAsync:  vi.fn(),
  }) as any);
  createServer();
  return captured;
}

beforeEach(() => {
  vi.mocked(hasMode).mockReset();
  vi.mocked(grantMode).mockReset();
  vi.mocked(revokeMode).mockReset();
  vi.mocked(listAuthorizations).mockReset();
  vi.mocked(purgeResource).mockReset();
});

describe('createServer', () => {
  it('returns a gRPC server instance', async () => {
    const grpc = await import('@grpc/grpc-js');
    const server = createServer();
    expect(grpc.Server).toHaveBeenCalled();
    expect(server).toBeDefined();
  });
});

describe('HasMode handler', () => {
  it('returns { allowed: true } when service says yes', async () => {
    vi.mocked(hasMode).mockResolvedValue(true);
    const impl = await captureImpl();

    const callback = vi.fn();
    await impl['HasMode'](
      { request: { resource_iri: RESOURCE, agent_iri: AGENT, mode: 'Write' }, metadata: fakeMetadata() },
      callback,
    );

    expect(hasMode).toHaveBeenCalledWith(expect.anything(), expect.anything(), RESOURCE, AGENT, 'Write');
    expect(callback).toHaveBeenCalledWith(null, { allowed: true });
  });

  it('returns INVALID_ARGUMENT for unsupported mode', async () => {
    const impl = await captureImpl();
    const callback = vi.fn();
    await impl['HasMode'](
      { request: { resource_iri: RESOURCE, agent_iri: AGENT, mode: 'Read' }, metadata: fakeMetadata() },
      callback,
    );
    expect(hasMode).not.toHaveBeenCalled();
    expect(callback).toHaveBeenCalledWith(expect.objectContaining({ code: 3 }));
  });

  it('returns INTERNAL on exception', async () => {
    vi.mocked(hasMode).mockRejectedValue(new Error('boom'));
    const impl = await captureImpl();
    const callback = vi.fn();
    await impl['HasMode'](
      { request: { resource_iri: RESOURCE, agent_iri: AGENT, mode: 'Write' }, metadata: fakeMetadata() },
      callback,
    );
    expect(callback).toHaveBeenCalledWith(expect.objectContaining({ code: 13, message: 'boom' }));
  });
});

describe('GrantMode handler', () => {
  it('returns authorization_iri', async () => {
    vi.mocked(grantMode).mockResolvedValue({ authorizationIri: 'https://example/auth/abc' });
    const impl = await captureImpl();
    const callback = vi.fn();
    await impl['GrantMode'](
      { request: { resource_iri: RESOURCE, agent_iri: AGENT, mode: 'Write' }, metadata: fakeMetadata() },
      callback,
    );
    expect(callback).toHaveBeenCalledWith(null, { authorization_iri: 'https://example/auth/abc' });
  });

  it('rejects unsupported mode with INVALID_ARGUMENT', async () => {
    const impl = await captureImpl();
    const callback = vi.fn();
    await impl['GrantMode'](
      { request: { resource_iri: RESOURCE, agent_iri: AGENT, mode: 'Append' }, metadata: fakeMetadata() },
      callback,
    );
    expect(grantMode).not.toHaveBeenCalled();
    expect(callback).toHaveBeenCalledWith(expect.objectContaining({ code: 3 }));
  });
});

describe('RevokeMode handler', () => {
  it('returns deleted_count', async () => {
    vi.mocked(revokeMode).mockResolvedValue({ deletedCount: 2 });
    const impl = await captureImpl();
    const callback = vi.fn();
    await impl['RevokeMode'](
      { request: { resource_iri: RESOURCE, agent_iri: AGENT, mode: 'Write' }, metadata: fakeMetadata() },
      callback,
    );
    expect(callback).toHaveBeenCalledWith(null, { deleted_count: 2 });
  });

  it('rejects unsupported mode with INVALID_ARGUMENT', async () => {
    const impl = await captureImpl();
    const callback = vi.fn();
    await impl['RevokeMode'](
      { request: { resource_iri: RESOURCE, agent_iri: AGENT, mode: 'Bogus' }, metadata: fakeMetadata() },
      callback,
    );
    expect(revokeMode).not.toHaveBeenCalled();
    expect(callback).toHaveBeenCalledWith(expect.objectContaining({ code: 3 }));
  });
});

describe('ListAuthorizations handler', () => {
  it('maps Authorization items to wire format', async () => {
    vi.mocked(listAuthorizations).mockResolvedValue([
      {
        authorizationIri: 'https://example/auth/a1',
        resourceIri:      RESOURCE,
        agentIri:         AGENT,
        mode:             'Write',
      },
    ]);
    const impl = await captureImpl();
    const callback = vi.fn();
    await impl['ListAuthorizations'](
      { request: { resource_iri: RESOURCE }, metadata: fakeMetadata() },
      callback,
    );
    expect(callback).toHaveBeenCalledWith(null, {
      items: [{
        authorization_iri: 'https://example/auth/a1',
        resource_iri:      RESOURCE,
        agent_iri:         AGENT,
        mode:              'Write',
      }],
    });
  });

  it('returns INTERNAL on exception', async () => {
    vi.mocked(listAuthorizations).mockRejectedValue(new Error('SPARQL down'));
    const impl = await captureImpl();
    const callback = vi.fn();
    await impl['ListAuthorizations'](
      { request: { resource_iri: RESOURCE }, metadata: fakeMetadata() },
      callback,
    );
    expect(callback).toHaveBeenCalledWith(expect.objectContaining({ code: 13 }));
  });
});

describe('PurgeResource handler', () => {
  it('returns deleted_count', async () => {
    vi.mocked(purgeResource).mockResolvedValue({ deletedCount: 4 });
    const impl = await captureImpl();
    const callback = vi.fn();
    await impl['PurgeResource'](
      { request: { resource_iri: RESOURCE }, metadata: fakeMetadata() },
      callback,
    );
    expect(callback).toHaveBeenCalledWith(null, { deleted_count: 4 });
  });
});
