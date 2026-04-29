import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/sparql.js', () => ({
  sparqlClient: {},
  prefixes: {
    shexmap:      'https://w3id.org/shexmap/ontology#',
    shexrmap:     'https://w3id.org/shexmap/resource/map/',
    shexrpair:    'https://w3id.org/shexmap/resource/pairing/',
    shexruser:    'https://w3id.org/shexmap/resource/user/',
    shexrversion: 'https://w3id.org/shexmap/resource/version/',
  },
}));

vi.mock('../src/services/pairing.service.js', () => ({
  listShExMapPairings:  vi.fn(),
  getShExMapPairing:    vi.fn(),
  createShExMapPairing: vi.fn(),
  updateShExMapPairing: vi.fn(),
  deleteShExMapPairing: vi.fn(),
}));

vi.mock('../src/services/pairing-version.service.js', () => ({
  listPairingVersions: vi.fn(),
  getPairingVersion:   vi.fn(),
  savePairingVersion:  vi.fn(),
}));

vi.mock('../src/config.js', () => ({
  config: {
    port: 50000,
    svcShexmapUrl: 'svc-shexmap:50052',
    svcAclUrl: 'svc-acl:50000',
    strictMapExistsCheck: false,
  },
}));

// ── ACL gRPC client capture ───────────────────────────────────────────────────

const aclClientMock = {
  HasMode:            vi.fn(),
  GrantMode:          vi.fn(),
  RevokeMode:         vi.fn(),
  ListAuthorizations: vi.fn(),
  PurgeResource:      vi.fn(),
};

// Mock @grpc/grpc-js: real Metadata + status, but Server is captured and
// loadPackageDefinition returns proto factories that build our aclClientMock
// when the AclService constructor is invoked.
vi.mock('@grpc/grpc-js', async () => {
  const actual = await vi.importActual<typeof import('@grpc/grpc-js')>('@grpc/grpc-js');

  const PairingServiceCtor = vi.fn();
  PairingServiceCtor.prototype = {};
  (PairingServiceCtor as any).service = { somePairingMethod: {} };

  const ShexMapServiceCtor = vi.fn();
  ShexMapServiceCtor.prototype = {};
  (ShexMapServiceCtor as any).service = { someShexmapMethod: {} };

  const AclServiceCtor: any = vi.fn().mockImplementation(() => aclClientMock);

  const mockProto = {
    shexmap: {
      pairing: { PairingService: PairingServiceCtor },
      map:     { ShexMapService:  ShexMapServiceCtor },
      acl:     { AclService:      AclServiceCtor },
    },
  };

  return {
    ...actual,
    loadPackageDefinition: vi.fn().mockReturnValue(mockProto),
    Server: vi.fn().mockImplementation(() => ({
      addService: vi.fn(),
      bindAsync:  vi.fn(),
    })),
    credentials: { ...actual.credentials, createInsecure: vi.fn().mockReturnValue({}) },
    ServerCredentials: { ...actual.ServerCredentials, createInsecure: vi.fn().mockReturnValue({}) },
  };
});

vi.mock('@grpc/proto-loader', () => ({
  loadSync: vi.fn().mockReturnValue({}),
  default:  { loadSync: vi.fn().mockReturnValue({}) },
}));

import * as grpc from '@grpc/grpc-js';
import { getShExMapPairing, deleteShExMapPairing } from '../src/services/pairing.service.js';
import { createServer } from '../src/server.js';

const RESOURCE_IRI = 'https://w3id.org/shexmap/resource/pairing/p1';
const AGENT_IRI    = 'https://w3id.org/shexmap/resource/user/u2';

function fakeMetadata(entries: Record<string, string> = {}): grpc.Metadata {
  const md = new grpc.Metadata();
  for (const [k, v] of Object.entries(entries)) md.set(k, v);
  return md;
}

async function captureImpl(): Promise<Record<string, Function>> {
  const grpcModule = await import('@grpc/grpc-js');
  let captured: Record<string, Function> = {};
  vi.mocked(grpcModule.Server).mockImplementation(() => ({
    addService: vi.fn((_svc, impl: Record<string, Function>) => { captured = impl; }),
    bindAsync:  vi.fn(),
  }) as any);
  createServer();
  return captured;
}

beforeEach(() => {
  vi.mocked(getShExMapPairing).mockReset();
  vi.mocked(deleteShExMapPairing).mockReset();
  for (const fn of Object.values(aclClientMock)) (fn as any).mockReset();
});

// ── Update handler: ACL write check ──────────────────────────────────────────

describe('UpdatePairing — ACL write check', () => {
  it('allows update when svc-acl HasMode returns allowed=true', async () => {
    vi.mocked(getShExMapPairing).mockResolvedValueOnce({
      id: 'p1', authorId: 'owner-other', title: 'T', tags: [], version: '1.0.0',
    } as any);
    // Second getShExMapPairing inside updateShExMapPairing — return same to drive update path
    vi.mocked(getShExMapPairing).mockResolvedValueOnce(null);
    aclClientMock.HasMode.mockImplementation((_req: any, _meta: any, cb: Function) => {
      cb(null, { allowed: true });
    });

    const impl = await captureImpl();
    const callback = vi.fn();
    await impl['UpdatePairing']!(
      {
        request: { id: 'p1', title: 'New' },
        metadata: fakeMetadata({ 'x-auth-user-id': 'u2', 'x-auth-role': 'user', 'x-auth-enabled': 'true' }),
      },
      callback,
    );

    // Should NOT have been called with PERMISSION_DENIED (7)
    const [errArg] = callback.mock.calls[0] ?? [];
    expect(errArg?.code).not.toBe(7);
    expect(aclClientMock.HasMode).toHaveBeenCalled();
    const [reqArg] = aclClientMock.HasMode.mock.calls[0]!;
    expect(reqArg.resource_iri).toBe(RESOURCE_IRI);
    expect(reqArg.agent_iri).toBe(AGENT_IRI);
    expect(reqArg.mode).toBe('Write');
  });

  it('denies update with PERMISSION_DENIED when ACL HasMode says false and not owner', async () => {
    vi.mocked(getShExMapPairing).mockResolvedValueOnce({
      id: 'p1', authorId: 'owner-other', title: 'T', tags: [], version: '1.0.0',
    } as any);
    aclClientMock.HasMode.mockImplementation((_req: any, _meta: any, cb: Function) => {
      cb(null, { allowed: false });
    });

    const impl = await captureImpl();
    const callback = vi.fn();
    await impl['UpdatePairing']!(
      {
        request: { id: 'p1', title: 'New' },
        metadata: fakeMetadata({ 'x-auth-user-id': 'u2', 'x-auth-role': 'user', 'x-auth-enabled': 'true' }),
      },
      callback,
    );

    expect(callback).toHaveBeenCalledWith(expect.objectContaining({ code: 7 }));
  });
});

// ── Delete handler: purgeResource is best-effort ─────────────────────────────

describe('DeletePairing — best-effort ACL purge', () => {
  it('still succeeds when PurgeResource throws', async () => {
    vi.mocked(getShExMapPairing).mockResolvedValueOnce({
      id: 'p1', authorId: 'u1', title: 'T', tags: [], version: '1.0.0',
    } as any);
    vi.mocked(deleteShExMapPairing).mockResolvedValueOnce(undefined);
    aclClientMock.PurgeResource.mockImplementation((_req: any, _meta: any, cb: Function) => {
      cb(new Error('boom'));
    });

    const impl = await captureImpl();
    const callback = vi.fn();
    await impl['DeletePairing']!(
      {
        request: { id: 'p1' },
        metadata: fakeMetadata({ 'x-auth-user-id': 'u1', 'x-auth-role': 'user', 'x-auth-enabled': 'true' }),
      },
      callback,
    );

    expect(callback).toHaveBeenCalledWith(null, { success: true });
    // Wait microtask so the .catch handler has run
    await new Promise((r) => setImmediate(r));
    expect(aclClientMock.PurgeResource).toHaveBeenCalled();
  });
});

// ── GrantWriteAccess ──────────────────────────────────────────────────────────

describe('GrantWriteAccess handler', () => {
  it('returns 403 (PERMISSION_DENIED) for non-owner', async () => {
    vi.mocked(getShExMapPairing).mockResolvedValueOnce({
      id: 'p1', authorId: 'someone-else', title: 'T', tags: [], version: '1.0.0',
    } as any);

    const impl = await captureImpl();
    const callback = vi.fn();
    await impl['GrantWriteAccess']!(
      {
        request: { pairing_id: 'p1', agent_user_id: 'u2' },
        metadata: fakeMetadata({ 'x-auth-user-id': 'u-not-owner', 'x-auth-role': 'user', 'x-auth-enabled': 'true' }),
      },
      callback,
    );

    expect(callback).toHaveBeenCalledWith(expect.objectContaining({ code: 7 }));
    expect(aclClientMock.GrantMode).not.toHaveBeenCalled();
  });

  it('owner: forwards to svc-acl GrantMode and returns authorization_iri', async () => {
    vi.mocked(getShExMapPairing).mockResolvedValueOnce({
      id: 'p1', authorId: 'u1', title: 'T', tags: [], version: '1.0.0',
    } as any);
    aclClientMock.GrantMode.mockImplementation((_req: any, _meta: any, cb: Function) => {
      cb(null, { authorization_iri: 'https://w3id.org/shexmap/resource/auth/abc' });
    });

    const impl = await captureImpl();
    const callback = vi.fn();
    await impl['GrantWriteAccess']!(
      {
        request: { pairing_id: 'p1', agent_user_id: 'u2' },
        metadata: fakeMetadata({ 'x-auth-user-id': 'u1', 'x-auth-role': 'user', 'x-auth-enabled': 'true' }),
      },
      callback,
    );

    const [reqArg] = aclClientMock.GrantMode.mock.calls[0]!;
    expect(reqArg.resource_iri).toBe(RESOURCE_IRI);
    expect(reqArg.agent_iri).toBe(AGENT_IRI);
    expect(reqArg.mode).toBe('Write');
    expect(callback).toHaveBeenCalledWith(null, { authorization_iri: 'https://w3id.org/shexmap/resource/auth/abc' });
  });

  it('returns NOT_FOUND when pairing does not exist', async () => {
    vi.mocked(getShExMapPairing).mockResolvedValueOnce(null);

    const impl = await captureImpl();
    const callback = vi.fn();
    await impl['GrantWriteAccess']!(
      {
        request: { pairing_id: 'missing', agent_user_id: 'u2' },
        metadata: fakeMetadata({ 'x-auth-user-id': 'u1', 'x-auth-role': 'user', 'x-auth-enabled': 'true' }),
      },
      callback,
    );

    expect(callback).toHaveBeenCalledWith(expect.objectContaining({ code: 5 }));
  });
});

// ── RevokeWriteAccess ─────────────────────────────────────────────────────────

describe('RevokeWriteAccess handler', () => {
  it('owner: forwards to svc-acl RevokeMode', async () => {
    vi.mocked(getShExMapPairing).mockResolvedValueOnce({
      id: 'p1', authorId: 'u1', title: 'T', tags: [], version: '1.0.0',
    } as any);
    aclClientMock.RevokeMode.mockImplementation((_req: any, _meta: any, cb: Function) => {
      cb(null, { deleted_count: 2 });
    });

    const impl = await captureImpl();
    const callback = vi.fn();
    await impl['RevokeWriteAccess']!(
      {
        request: { pairing_id: 'p1', agent_user_id: 'u2' },
        metadata: fakeMetadata({ 'x-auth-user-id': 'u1', 'x-auth-role': 'user', 'x-auth-enabled': 'true' }),
      },
      callback,
    );

    expect(aclClientMock.RevokeMode).toHaveBeenCalled();
    expect(callback).toHaveBeenCalledWith(null, { deleted_count: 2 });
  });

  it('non-owner gets PERMISSION_DENIED', async () => {
    vi.mocked(getShExMapPairing).mockResolvedValueOnce({
      id: 'p1', authorId: 'someone-else', title: 'T', tags: [], version: '1.0.0',
    } as any);

    const impl = await captureImpl();
    const callback = vi.fn();
    await impl['RevokeWriteAccess']!(
      {
        request: { pairing_id: 'p1', agent_user_id: 'u2' },
        metadata: fakeMetadata({ 'x-auth-user-id': 'not-owner', 'x-auth-role': 'user', 'x-auth-enabled': 'true' }),
      },
      callback,
    );

    expect(callback).toHaveBeenCalledWith(expect.objectContaining({ code: 7 }));
    expect(aclClientMock.RevokeMode).not.toHaveBeenCalled();
  });
});

// ── ListWriteAccess ───────────────────────────────────────────────────────────

describe('ListWriteAccess handler', () => {
  it('transforms agent_iri into agent_user_id by stripping prefix', async () => {
    vi.mocked(getShExMapPairing).mockResolvedValueOnce({
      id: 'p1', authorId: 'u1', title: 'T', tags: [], version: '1.0.0',
    } as any);
    aclClientMock.ListAuthorizations.mockImplementation((_req: any, _meta: any, cb: Function) => {
      cb(null, {
        items: [{
          authorization_iri: 'https://w3id.org/shexmap/resource/auth/auth-1',
          resource_iri:      RESOURCE_IRI,
          agent_iri:         AGENT_IRI,
          mode:              'Write',
        }],
      });
    });

    const impl = await captureImpl();
    const callback = vi.fn();
    await impl['ListWriteAccess']!(
      {
        request: { pairing_id: 'p1' },
        metadata: fakeMetadata({ 'x-auth-user-id': '', 'x-auth-role': 'anonymous', 'x-auth-enabled': 'false' }),
      },
      callback,
    );

    expect(callback).toHaveBeenCalledWith(null, {
      items: [{
        authorization_iri: 'https://w3id.org/shexmap/resource/auth/auth-1',
        agent_user_id:     'u2',
        mode:              'Write',
      }],
    });
  });

  it('returns NOT_FOUND when pairing does not exist', async () => {
    vi.mocked(getShExMapPairing).mockResolvedValueOnce(null);

    const impl = await captureImpl();
    const callback = vi.fn();
    await impl['ListWriteAccess']!(
      {
        request: { pairing_id: 'missing' },
        metadata: fakeMetadata(),
      },
      callback,
    );

    expect(callback).toHaveBeenCalledWith(expect.objectContaining({ code: 5 }));
  });
});
