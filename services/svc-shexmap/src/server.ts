import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { config } from './config.js';
import { sparqlClient, prefixes } from './sparql.js';
import {
  listShExMaps,
  getShExMap,
  createShExMap,
  updateShExMap,
  deleteShExMap,
} from './services/shexmap.service.js';
import {
  listVersions,
  getVersion,
  getVersionContent,
  saveNewVersion,
} from './services/version.service.js';
import type { AuthContext } from '@shexmap/shared';
import { AUTH_META } from '@shexmap/shared';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROTO_PATH = join(__dirname, '..', 'proto', 'shexmap.proto');

const packageDef = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});

const proto = grpc.loadPackageDefinition(packageDef) as any;

// ── gRPC validate client for content validation on create ─────────────────────

let validateProto: any = null;
let validateClient: any = null;

function getValidateClient(): any {
  if (validateClient) return validateClient;
  if (!validateProto) {
    const VALIDATE_PROTO = join(__dirname, '..', 'proto', 'validate.proto');
    const vDef = protoLoader.loadSync(VALIDATE_PROTO, {
      keepCase: true, longs: String, enums: String, defaults: true, oneofs: true,
    });
    validateProto = grpc.loadPackageDefinition(vDef) as any;
  }
  validateClient = new validateProto.shexmap.validate.ValidateService(
    config.svcValidateUrl,
    grpc.credentials.createInsecure(),
  );
  return validateClient;
}

function validateShExContent(content: string): Promise<void> {
  return new Promise((resolve, reject) => {
    getValidateClient().Validate(
      { source_shex: content, source_rdf: '', source_node: '', target_shex: '', target_node: '' },
      (err: any, res: any) => {
        if (err) return reject(new Error(`Validation RPC failed: ${err.message}`));
        if (!res.shex_valid) return reject(new Error(`Invalid ShExMap: ${res.shex_errors.join('; ')}`));
        resolve();
      },
    );
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

// ── Map message helpers ───────────────────────────────────────────────────────

function mapToProto(m: any) {
  return {
    id:                 m.id,
    title:              m.title,
    description:        m.description ?? '',
    content:            m.content ?? '',
    sample_turtle_data: m.sampleTurtleData ?? '',
    file_name:          m.fileName ?? '',
    file_format:        m.fileFormat ?? '',
    source_url:         m.sourceUrl ?? '',
    schema_url:         m.schemaUrl ?? '',
    tags:               m.tags ?? [],
    version:            m.version ?? '',
    author_id:          m.authorId ?? '',
    author_name:        m.authorName ?? '',
    created_at:         m.createdAt ?? '',
    modified_at:        m.modifiedAt ?? '',
    stars:              m.stars ?? 0,
    has_map_annotations: m.hasMapAnnotations ?? false,
    map_variables:      m.mapVariables ?? [],
  };
}

function versionToProto(v: any) {
  return {
    id:             v.id,
    map_id:         v.mapId,
    version_number: v.versionNumber,
    commit_message: v.commitMessage ?? '',
    author_id:      v.authorId ?? '',
    author_name:    v.authorName ?? '',
    created_at:     v.createdAt ?? '',
  };
}

// ── Handlers ──────────────────────────────────────────────────────────────────

const listShexMapsHandler: grpc.handleUnaryCall<any, any> = async (call, callback) => {
  try {
    const req = call.request;
    const result = await listShExMaps(sparqlClient, prefixes, {
      q:                 req.q || undefined,
      tag:               req.tag || undefined,
      author:            req.author || undefined,
      schemaUrl:         req.schema_url || undefined,
      hasMapAnnotations: req.has_map_annotations ? req.has_map_annotations === 'true' : undefined,
      mapVariable:       req.map_variable || undefined,
      page:              req.page || 1,
      limit:             req.limit || 20,
      sort:              req.sort || 'createdAt',
      order:             req.order || 'desc',
    });
    callback(null, { items: result.items.map(mapToProto), total: result.total });
  } catch (err: any) {
    callback({ code: grpc.status.INTERNAL, message: err.message });
  }
};

const getShexMapHandler: grpc.handleUnaryCall<any, any> = async (call, callback) => {
  try {
    const map = await getShExMap(sparqlClient, prefixes, call.request.id);
    if (!map) return callback(null, { found: false, map: null });
    callback(null, { found: true, map: mapToProto(map) });
  } catch (err: any) {
    callback({ code: grpc.status.INTERNAL, message: err.message });
  }
};

const createShexMapHandler: grpc.handleUnaryCall<any, any> = async (call, callback) => {
  const ctx = readAuthContext(call.metadata);
  if (ctx.authEnabled && !ctx.userId) {
    return callback({ code: grpc.status.UNAUTHENTICATED, message: 'Authentication required' });
  }
  try {
    const req = call.request;
    if (req.content) {
      await validateShExContent(req.content);
    }
    const authorId = ctx.userId || 'anonymous';
    const map = await createShExMap(sparqlClient, prefixes, {
      title:           req.title,
      description:     req.description || undefined,
      content:         req.content || undefined,
      sampleTurtleData: req.sample_turtle_data || undefined,
      fileName:        req.file_name || undefined,
      fileFormat:      req.file_format || 'shexc',
      sourceUrl:       req.source_url || undefined,
      schemaUrl:       req.schema_url || undefined,
      tags:            req.tags ?? [],
      version:         req.version || '1.0.0',
    }, authorId);

    if (req.content) {
      await saveNewVersion(sparqlClient, prefixes, map.id, authorId, req.content, 'Initial version');
    }

    callback(null, { found: true, map: mapToProto(map) });
  } catch (err: any) {
    callback({ code: grpc.status.INTERNAL, message: err.message });
  }
};

const updateShexMapHandler: grpc.handleUnaryCall<any, any> = async (call, callback) => {
  const ctx = readAuthContext(call.metadata);
  try {
    const existing = await getShExMap(sparqlClient, prefixes, call.request.id);
    if (!existing) return callback(null, { found: false, map: null });

    if (ctx.authEnabled) {
      if (!ctx.userId) return callback({ code: grpc.status.UNAUTHENTICATED, message: 'Authentication required' });
      const unclaimed = !existing.authorId || existing.authorId === 'anonymous';
      if (!unclaimed && existing.authorId !== ctx.userId && ctx.role !== 'admin') {
        return callback({ code: grpc.status.PERMISSION_DENIED, message: 'Not the owner' });
      }
    }

    const req = call.request;
    const input: Record<string, any> = {};
    if (req.has_title)        input['title']           = req.title;
    if (req.has_description)  input['description']     = req.description;
    if (req.has_source_url)   input['sourceUrl']       = req.source_url;
    if (req.has_schema_url)   input['schemaUrl']       = req.schema_url;
    if (req.has_sample_turtle) input['sampleTurtleData'] = req.sample_turtle_data;
    if (req.has_tags)         input['tags']            = req.tags;
    if (req.has_version)      input['version']         = req.version;

    const updated = await updateShExMap(sparqlClient, prefixes, req.id, input);
    if (!updated) return callback(null, { found: false, map: null });
    callback(null, { found: true, map: mapToProto(updated) });
  } catch (err: any) {
    callback({ code: grpc.status.INTERNAL, message: err.message });
  }
};

const deleteShexMapHandler: grpc.handleUnaryCall<any, any> = async (call, callback) => {
  const ctx = readAuthContext(call.metadata);
  try {
    const existing = await getShExMap(sparqlClient, prefixes, call.request.id);
    if (!existing) return callback(null, { success: false });

    if (ctx.authEnabled) {
      if (!ctx.userId) return callback({ code: grpc.status.UNAUTHENTICATED, message: 'Authentication required' });
      const unclaimed = !existing.authorId || existing.authorId === 'anonymous';
      if (!unclaimed && existing.authorId !== ctx.userId && ctx.role !== 'admin') {
        return callback({ code: grpc.status.PERMISSION_DENIED, message: 'Not the owner' });
      }
    }

    await deleteShExMap(sparqlClient, prefixes, call.request.id);
    callback(null, { success: true });
  } catch (err: any) {
    callback({ code: grpc.status.INTERNAL, message: err.message });
  }
};

const listVersionsHandler: grpc.handleUnaryCall<any, any> = async (call, callback) => {
  try {
    const versions = await listVersions(sparqlClient, prefixes, call.request.map_id);
    callback(null, { versions: versions.map(versionToProto) });
  } catch (err: any) {
    callback({ code: grpc.status.INTERNAL, message: err.message });
  }
};

const getVersionHandler: grpc.handleUnaryCall<any, any> = async (call, callback) => {
  try {
    const v = await getVersion(sparqlClient, prefixes, call.request.map_id, call.request.version_number);
    if (!v) return callback(null, { found: false, version: null });
    callback(null, { found: true, version: versionToProto(v) });
  } catch (err: any) {
    callback({ code: grpc.status.INTERNAL, message: err.message });
  }
};

const getVersionContentHandler: grpc.handleUnaryCall<any, any> = async (call, callback) => {
  try {
    const v = await getVersion(sparqlClient, prefixes, call.request.map_id, call.request.version_number);
    if (!v) return callback(null, { found: false, meta: null, content: '' });
    const content = await getVersionContent(sparqlClient, prefixes, call.request.map_id, call.request.version_number);
    callback(null, { meta: versionToProto(v), content });
  } catch (err: any) {
    callback({ code: grpc.status.INTERNAL, message: err.message });
  }
};

const saveVersionHandler: grpc.handleUnaryCall<any, any> = async (call, callback) => {
  const ctx = readAuthContext(call.metadata);
  try {
    const { map_id, content, commit_message } = call.request;
    const existing = await getShExMap(sparqlClient, prefixes, map_id);
    if (!existing) return callback({ code: grpc.status.NOT_FOUND, message: 'Map not found' });

    if (ctx.authEnabled) {
      if (!ctx.userId) return callback({ code: grpc.status.UNAUTHENTICATED, message: 'Authentication required' });
      const unclaimed = !existing.authorId || existing.authorId === 'anonymous';
      if (!unclaimed && existing.authorId !== ctx.userId && ctx.role !== 'admin') {
        return callback({ code: grpc.status.PERMISSION_DENIED, message: 'Not the owner' });
      }
    }

    const authorId = ctx.userId || 'anonymous';
    const v = await saveNewVersion(sparqlClient, prefixes, map_id, authorId, content, commit_message || undefined);
    callback(null, { found: true, version: versionToProto(v) });
  } catch (err: any) {
    callback({ code: grpc.status.INTERNAL, message: err.message });
  }
};

// ── Server setup ──────────────────────────────────────────────────────────────

export function createServer(): grpc.Server {
  const server = new grpc.Server();
  server.addService(proto.shexmap.map.ShexMapService.service, {
    ListShexMaps:      listShexMapsHandler,
    GetShexMap:        getShexMapHandler,
    CreateShexMap:     createShexMapHandler,
    UpdateShexMap:     updateShexMapHandler,
    DeleteShexMap:     deleteShexMapHandler,
    ListVersions:      listVersionsHandler,
    GetVersion:        getVersionHandler,
    GetVersionContent: getVersionContentHandler,
    SaveVersion:       saveVersionHandler,
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
      console.log(`svc-shexmap gRPC listening on :${port}`);
    },
  );
}
