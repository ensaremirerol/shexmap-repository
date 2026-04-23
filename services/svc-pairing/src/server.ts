import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { config } from './config.js';
import { sparqlClient, prefixes } from './sparql.js';
import {
  listShExMapPairings,
  getShExMapPairing,
  createShExMapPairing,
  updateShExMapPairing,
  deleteShExMapPairing,
} from './services/pairing.service.js';
import {
  listPairingVersions,
  getPairingVersion,
  savePairingVersion,
} from './services/pairing-version.service.js';
import type { AuthContext } from '@shexmap/shared';
import { AUTH_META } from '@shexmap/shared';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROTO_PATH         = join(__dirname, '..', 'proto', 'pairing.proto');
const SHEXMAP_PROTO_PATH = join(__dirname, '..', 'proto', 'shexmap.proto');

const packageDef = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
  includeDirs: [join(__dirname, '..', 'proto')],
});

const proto = grpc.loadPackageDefinition(packageDef) as any;

// ── Optional svc-shexmap existence check client ───────────────────────────────

let shexmapProto: any = null;
let shexmapClient: any = null;

function getShexmapClient(): any {
  if (shexmapClient) return shexmapClient;
  if (!shexmapProto) {
    const def = protoLoader.loadSync(SHEXMAP_PROTO_PATH, {
      keepCase: true, longs: String, enums: String, defaults: true, oneofs: true,
    });
    shexmapProto = grpc.loadPackageDefinition(def) as any;
  }
  shexmapClient = new shexmapProto.shexmap.map.ShexMapService(
    config.svcShexmapUrl,
    grpc.credentials.createInsecure(),
  );
  return shexmapClient;
}

async function assertMapExists(mapId: string, label: string): Promise<void> {
  return new Promise((resolve, reject) => {
    getShexmapClient().GetShexMap({ id: mapId }, (err: any, res: any) => {
      if (err) return reject(new Error(`${label} check failed: ${err.message}`));
      if (!res.found) return reject(Object.assign(new Error(`${label} not found`), { grpcCode: grpc.status.NOT_FOUND }));
      resolve();
    });
  });
}

// ── Auth helpers ──────────────────────────────────────────────────────────────

function readAuthContext(metadata: grpc.Metadata): AuthContext {
  const get = (k: string) => (metadata.get(k)[0] as string | undefined) ?? '';
  return {
    userId:      get(AUTH_META.USER_ID),
    role:        (get(AUTH_META.ROLE) || 'anonymous') as AuthContext['role'],
    authEnabled: get(AUTH_META.AUTH_ENABLED) === 'true',
  };
}

// ── Proto message converters ──────────────────────────────────────────────────

function mapToProto(m: any) {
  return {
    id:           m.id,
    title:        m.title,
    description:  m.description ?? '',
    content:      m.content ?? '',
    sample_turtle_data: m.sampleTurtleData ?? '',
    file_name:    m.fileName ?? '',
    file_format:  m.fileFormat ?? '',
    source_url:   m.sourceUrl ?? '',
    schema_url:   m.schemaUrl ?? '',
    tags:         m.tags ?? [],
    version:      m.version ?? '',
    author_id:    m.authorId ?? '',
    author_name:  m.authorName ?? '',
    created_at:   m.createdAt ?? '',
    modified_at:  m.modifiedAt ?? '',
    stars:        m.stars ?? 0,
  };
}

function pairingToProto(p: any) {
  return {
    id:               p.id,
    title:            p.title,
    description:      p.description ?? '',
    source_map:       p.sourceMap ? mapToProto(p.sourceMap) : null,
    target_map:       p.targetMap ? mapToProto(p.targetMap) : null,
    source_focus_iri: p.sourceFocusIri ?? '',
    target_focus_iri: p.targetFocusIri ?? '',
    tags:             p.tags ?? [],
    license:          p.license ?? '',
    version:          p.version ?? '',
    author_id:        p.authorId ?? '',
    author_name:      p.authorName ?? '',
    created_at:       p.createdAt ?? '',
    modified_at:      p.modifiedAt ?? '',
    stars:            p.stars ?? 0,
  };
}

function pvToProto(v: any) {
  return {
    id:                    v.id,
    pairing_id:            v.pairingId,
    version_number:        v.versionNumber,
    commit_message:        v.commitMessage ?? '',
    source_map_id:         v.sourceMapId ?? '',
    source_version_number: v.sourceVersionNumber ?? 0,
    target_map_id:         v.targetMapId ?? '',
    target_version_number: v.targetVersionNumber ?? 0,
    author_id:             v.authorId ?? '',
    author_name:           v.authorName ?? '',
    created_at:            v.createdAt ?? '',
  };
}

// ── Handlers ──────────────────────────────────────────────────────────────────

const listPairingsHandler: grpc.handleUnaryCall<any, any> = async (call, callback) => {
  try {
    const req = call.request;
    const result = await listShExMapPairings(sparqlClient, prefixes, {
      q:           req.q || undefined,
      tag:         req.tag || undefined,
      author:      req.author || undefined,
      sourceMapId: req.source_map_id || undefined,
      targetMapId: req.target_map_id || undefined,
      page:        req.page || 1,
      limit:       req.limit || 20,
      sort:        req.sort || 'createdAt',
      order:       req.order || 'desc',
    });
    callback(null, { items: result.items.map(pairingToProto), total: result.total });
  } catch (err: any) {
    callback({ code: grpc.status.INTERNAL, message: err.message });
  }
};

const getPairingHandler: grpc.handleUnaryCall<any, any> = async (call, callback) => {
  try {
    const pairing = await getShExMapPairing(sparqlClient, prefixes, call.request.id);
    if (!pairing) return callback(null, { found: false, pairing: null });
    callback(null, { found: true, pairing: pairingToProto(pairing) });
  } catch (err: any) {
    callback({ code: grpc.status.INTERNAL, message: err.message });
  }
};

const createPairingHandler: grpc.handleUnaryCall<any, any> = async (call, callback) => {
  const ctx = readAuthContext(call.metadata);
  if (ctx.authEnabled && !ctx.userId) {
    return callback({ code: grpc.status.UNAUTHENTICATED, message: 'Authentication required' });
  }
  try {
    const req = call.request;

    if (config.strictMapExistsCheck) {
      await assertMapExists(req.source_map_id, 'Source ShExMap');
      await assertMapExists(req.target_map_id, 'Target ShExMap');
    }

    const authorId = ctx.userId || 'anonymous';
    const pairing = await createShExMapPairing(sparqlClient, prefixes, {
      title:          req.title,
      description:    req.description || undefined,
      sourceMapId:    req.source_map_id,
      targetMapId:    req.target_map_id,
      sourceFocusIri: req.source_focus_iri || undefined,
      targetFocusIri: req.target_focus_iri || undefined,
      tags:           req.tags ?? [],
      license:        req.license || undefined,
      version:        req.version || '1.0.0',
    }, authorId);

    callback(null, { found: true, pairing: pairingToProto(pairing) });
  } catch (err: any) {
    const code = (err as any).grpcCode ?? grpc.status.INTERNAL;
    callback({ code, message: err.message });
  }
};

const updatePairingHandler: grpc.handleUnaryCall<any, any> = async (call, callback) => {
  const ctx = readAuthContext(call.metadata);
  try {
    const existing = await getShExMapPairing(sparqlClient, prefixes, call.request.id);
    if (!existing) return callback(null, { found: false, pairing: null });

    if (ctx.authEnabled) {
      if (!ctx.userId) return callback({ code: grpc.status.UNAUTHENTICATED, message: 'Authentication required' });
      if (existing.authorId !== ctx.userId && ctx.role !== 'admin') {
        return callback({ code: grpc.status.PERMISSION_DENIED, message: 'Not the owner' });
      }
    }

    const req = call.request;
    const updated = await updateShExMapPairing(sparqlClient, prefixes, req.id, {
      title:          req.title || undefined,
      description:    req.description || undefined,
      sourceMapId:    req.source_map_id || undefined,
      targetMapId:    req.target_map_id || undefined,
      sourceFocusIri: req.source_focus_iri || undefined,
      targetFocusIri: req.target_focus_iri || undefined,
      tags:           req.tags,
      license:        req.license || undefined,
      version:        req.version || undefined,
    });
    if (!updated) return callback(null, { found: false, pairing: null });
    callback(null, { found: true, pairing: pairingToProto(updated) });
  } catch (err: any) {
    callback({ code: grpc.status.INTERNAL, message: err.message });
  }
};

const deletePairingHandler: grpc.handleUnaryCall<any, any> = async (call, callback) => {
  const ctx = readAuthContext(call.metadata);
  try {
    const existing = await getShExMapPairing(sparqlClient, prefixes, call.request.id);
    if (!existing) return callback(null, { success: false });

    if (ctx.authEnabled) {
      if (!ctx.userId) return callback({ code: grpc.status.UNAUTHENTICATED, message: 'Authentication required' });
      if (existing.authorId !== ctx.userId && ctx.role !== 'admin') {
        return callback({ code: grpc.status.PERMISSION_DENIED, message: 'Not the owner' });
      }
    }

    await deleteShExMapPairing(sparqlClient, prefixes, call.request.id);
    callback(null, { success: true });
  } catch (err: any) {
    callback({ code: grpc.status.INTERNAL, message: err.message });
  }
};

const listPairingVersionsHandler: grpc.handleUnaryCall<any, any> = async (call, callback) => {
  try {
    const versions = await listPairingVersions(sparqlClient, prefixes, call.request.pairing_id);
    callback(null, { versions: versions.map(pvToProto) });
  } catch (err: any) {
    callback({ code: grpc.status.INTERNAL, message: err.message });
  }
};

const getPairingVersionHandler: grpc.handleUnaryCall<any, any> = async (call, callback) => {
  try {
    const v = await getPairingVersion(sparqlClient, prefixes, call.request.pairing_id, call.request.version_number);
    if (!v) return callback(null, { found: false, version: null });
    callback(null, { found: true, version: pvToProto(v) });
  } catch (err: any) {
    callback({ code: grpc.status.INTERNAL, message: err.message });
  }
};

const savePairingVersionHandler: grpc.handleUnaryCall<any, any> = async (call, callback) => {
  const ctx = readAuthContext(call.metadata);
  try {
    const { pairing_id, commit_message, source_map_id, target_map_id,
            source_version_number, target_version_number,
            has_source_version, has_target_version } = call.request;

    const existing = await getShExMapPairing(sparqlClient, prefixes, pairing_id);
    if (!existing) return callback({ code: grpc.status.NOT_FOUND, message: 'Pairing not found' });

    if (ctx.authEnabled) {
      if (!ctx.userId) return callback({ code: grpc.status.UNAUTHENTICATED, message: 'Authentication required' });
      if (existing.authorId !== ctx.userId && ctx.role !== 'admin') {
        return callback({ code: grpc.status.PERMISSION_DENIED, message: 'Not the owner' });
      }
    }

    const authorId = ctx.userId || 'anonymous';
    const v = await savePairingVersion(sparqlClient, prefixes, pairing_id, authorId, {
      commitMessage:       commit_message || undefined,
      sourceMapId:         source_map_id,
      sourceVersionNumber: has_source_version ? source_version_number : undefined,
      targetMapId:         target_map_id,
      targetVersionNumber: has_target_version ? target_version_number : undefined,
    });
    callback(null, { found: true, version: pvToProto(v) });
  } catch (err: any) {
    callback({ code: grpc.status.INTERNAL, message: err.message });
  }
};

// ── Server setup ──────────────────────────────────────────────────────────────

export function createServer(): grpc.Server {
  const server = new grpc.Server();
  server.addService(proto.shexmap.pairing.PairingService.service, {
    ListPairings:        listPairingsHandler,
    GetPairing:          getPairingHandler,
    CreatePairing:       createPairingHandler,
    UpdatePairing:       updatePairingHandler,
    DeletePairing:       deletePairingHandler,
    ListPairingVersions: listPairingVersionsHandler,
    GetPairingVersion:   getPairingVersionHandler,
    SavePairingVersion:  savePairingVersionHandler,
  });
  return server;
}

export function startServer(): void {
  const server = createServer();
  server.bindAsync(
    `0.0.0.0:${config.port}`,
    grpc.ServerCredentials.createInsecure(),
    (err, port) => {
      if (err) { console.error('Failed to bind gRPC server:', err); process.exit(1); }
      console.log(`svc-pairing gRPC listening on :${port}`);
    },
  );
}
