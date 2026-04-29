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

// ── gRPC ACL client ───────────────────────────────────────────────────────────

let aclProto: any = null;
let aclClient: any = null;

export function getAclClient(): any {
  if (aclClient) return aclClient;
  if (!aclProto) {
    const ACL_PROTO = join(__dirname, '..', 'proto', 'acl.proto');
    const aDef = protoLoader.loadSync(ACL_PROTO, {
      keepCase: true, longs: String, enums: String, defaults: true, oneofs: true,
    });
    aclProto = grpc.loadPackageDefinition(aDef) as any;
  }
  aclClient = new aclProto.shexmap.acl.AclService(
    config.svcAclUrl,
    grpc.credentials.createInsecure(),
  );
  return aclClient;
}

function buildAclMeta(ctx: AuthContext): grpc.Metadata {
  const md = new grpc.Metadata();
  md.set(AUTH_META.USER_ID,      ctx.userId);
  md.set(AUTH_META.ROLE,         ctx.role);
  md.set(AUTH_META.AUTH_ENABLED, String(ctx.authEnabled));
  return md;
}

function aclHasMode(ctx: AuthContext, resourceIri: string, agentIri: string, mode: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    getAclClient().HasMode(
      { resource_iri: resourceIri, agent_iri: agentIri, mode },
      buildAclMeta(ctx),
      (err: any, res: any) => {
        if (err) return reject(err);
        resolve(Boolean(res?.allowed));
      },
    );
  });
}

function aclGrantMode(ctx: AuthContext, resourceIri: string, agentIri: string, mode: string): Promise<{ authorizationIri: string }> {
  return new Promise((resolve, reject) => {
    getAclClient().GrantMode(
      { resource_iri: resourceIri, agent_iri: agentIri, mode },
      buildAclMeta(ctx),
      (err: any, res: any) => {
        if (err) return reject(err);
        resolve({ authorizationIri: res?.authorization_iri ?? '' });
      },
    );
  });
}

function aclRevokeMode(ctx: AuthContext, resourceIri: string, agentIri: string, mode: string): Promise<{ deletedCount: number }> {
  return new Promise((resolve, reject) => {
    getAclClient().RevokeMode(
      { resource_iri: resourceIri, agent_iri: agentIri, mode },
      buildAclMeta(ctx),
      (err: any, res: any) => {
        if (err) return reject(err);
        resolve({ deletedCount: Number(res?.deleted_count ?? 0) });
      },
    );
  });
}

function aclListAuthorizations(ctx: AuthContext, resourceIri: string): Promise<Array<{ authorizationIri: string; agentIri: string; mode: string }>> {
  return new Promise((resolve, reject) => {
    getAclClient().ListAuthorizations(
      { resource_iri: resourceIri },
      buildAclMeta(ctx),
      (err: any, res: any) => {
        if (err) return reject(err);
        const items = (res?.items ?? []) as any[];
        resolve(items.map((it) => ({
          authorizationIri: it.authorization_iri ?? '',
          agentIri:         it.agent_iri ?? '',
          mode:             it.mode ?? '',
        })));
      },
    );
  });
}

function aclPurgeResource(ctx: AuthContext, resourceIri: string): Promise<{ deletedCount: number }> {
  return new Promise((resolve, reject) => {
    getAclClient().PurgeResource(
      { resource_iri: resourceIri },
      buildAclMeta(ctx),
      (err: any, res: any) => {
        if (err) return reject(err);
        resolve({ deletedCount: Number(res?.deleted_count ?? 0) });
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
      const isOwner   = existing.authorId === ctx.userId;
      const isAdmin   = ctx.role === 'admin';
      let hasAclWrite = false;
      if (!unclaimed && !isOwner && !isAdmin) {
        const resourceIri = `${prefixes.shexrmap}${existing.id}`;
        const agentIri    = `${prefixes.shexruser}${ctx.userId}`;
        try {
          hasAclWrite = await aclHasMode(ctx, resourceIri, agentIri, 'Write');
        } catch (err: any) {
          console.warn(`[svc-shexmap] ACL HasMode lookup failed: ${err?.message ?? err}`);
        }
      }
      if (!unclaimed && !isOwner && !hasAclWrite && !isAdmin) {
        return callback({ code: grpc.status.PERMISSION_DENIED, message: 'Not authorized to edit' });
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
      const isOwner   = existing.authorId === ctx.userId;
      const isAdmin   = ctx.role === 'admin';
      let hasAclWrite = false;
      if (!unclaimed && !isOwner && !isAdmin) {
        const resourceIri = `${prefixes.shexrmap}${existing.id}`;
        const agentIri    = `${prefixes.shexruser}${ctx.userId}`;
        try {
          hasAclWrite = await aclHasMode(ctx, resourceIri, agentIri, 'Write');
        } catch (err: any) {
          console.warn(`[svc-shexmap] ACL HasMode lookup failed: ${err?.message ?? err}`);
        }
      }
      if (!unclaimed && !isOwner && !hasAclWrite && !isAdmin) {
        return callback({ code: grpc.status.PERMISSION_DENIED, message: 'Not authorized to delete' });
      }
    }

    await deleteShExMap(sparqlClient, prefixes, call.request.id);
    // Best-effort cleanup of ACL entries; never roll back the delete on failure.
    const resourceIri = `${prefixes.shexrmap}${call.request.id}`;
    aclPurgeResource(ctx, resourceIri).catch((err: any) => {
      console.warn(`[svc-shexmap] ACL purgeResource failed for ${resourceIri}: ${err?.message ?? err}`);
    });
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
      const isOwner   = existing.authorId === ctx.userId;
      const isAdmin   = ctx.role === 'admin';
      let hasAclWrite = false;
      if (!unclaimed && !isOwner && !isAdmin) {
        const resourceIri = `${prefixes.shexrmap}${existing.id}`;
        const agentIri    = `${prefixes.shexruser}${ctx.userId}`;
        try {
          hasAclWrite = await aclHasMode(ctx, resourceIri, agentIri, 'Write');
        } catch (err: any) {
          console.warn(`[svc-shexmap] ACL HasMode lookup failed: ${err?.message ?? err}`);
        }
      }
      if (!unclaimed && !isOwner && !hasAclWrite && !isAdmin) {
        return callback({ code: grpc.status.PERMISSION_DENIED, message: 'Not authorized to edit' });
      }
    }

    const authorId = ctx.userId || 'anonymous';
    const v = await saveNewVersion(sparqlClient, prefixes, map_id, authorId, content, commit_message || undefined);
    callback(null, { found: true, version: versionToProto(v) });
  } catch (err: any) {
    callback({ code: grpc.status.INTERNAL, message: err.message });
  }
};

// ── ACL management handlers (owner-only) ──────────────────────────────────────

async function checkOwnerForAclManagement(
  ctx: AuthContext,
  existing: { authorId?: string },
): Promise<grpc.ServiceError | null> {
  if (!ctx.authEnabled) return null;
  if (!ctx.userId) {
    return { code: grpc.status.UNAUTHENTICATED, message: 'Authentication required' } as grpc.ServiceError;
  }
  const unclaimed = !existing.authorId || existing.authorId === 'anonymous';
  const isOwner   = existing.authorId === ctx.userId;
  const isAdmin   = ctx.role === 'admin';
  if (!unclaimed && !isOwner && !isAdmin) {
    return { code: grpc.status.PERMISSION_DENIED, message: 'Only the owner may manage access' } as grpc.ServiceError;
  }
  return null;
}

const grantWriteAccessHandler: grpc.handleUnaryCall<any, any> = async (call, callback) => {
  const ctx = readAuthContext(call.metadata);
  try {
    const { map_id, agent_user_id } = call.request;
    if (!map_id || !agent_user_id) {
      return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'map_id and agent_user_id are required' });
    }
    const existing = await getShExMap(sparqlClient, prefixes, map_id);
    if (!existing) return callback({ code: grpc.status.NOT_FOUND, message: 'Map not found' });
    const authzErr = await checkOwnerForAclManagement(ctx, existing);
    if (authzErr) return callback(authzErr);

    const resourceIri = `${prefixes.shexrmap}${existing.id}`;
    const agentIri    = `${prefixes.shexruser}${agent_user_id}`;
    const { authorizationIri } = await aclGrantMode(ctx, resourceIri, agentIri, 'Write');
    callback(null, { authorization_iri: authorizationIri });
  } catch (err: any) {
    callback({ code: err?.code ?? grpc.status.INTERNAL, message: err?.message ?? 'Grant failed' });
  }
};

const revokeWriteAccessHandler: grpc.handleUnaryCall<any, any> = async (call, callback) => {
  const ctx = readAuthContext(call.metadata);
  try {
    const { map_id, agent_user_id } = call.request;
    if (!map_id || !agent_user_id) {
      return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'map_id and agent_user_id are required' });
    }
    const existing = await getShExMap(sparqlClient, prefixes, map_id);
    if (!existing) return callback({ code: grpc.status.NOT_FOUND, message: 'Map not found' });
    const authzErr = await checkOwnerForAclManagement(ctx, existing);
    if (authzErr) return callback(authzErr);

    const resourceIri = `${prefixes.shexrmap}${existing.id}`;
    const agentIri    = `${prefixes.shexruser}${agent_user_id}`;
    const { deletedCount } = await aclRevokeMode(ctx, resourceIri, agentIri, 'Write');
    callback(null, { deleted_count: deletedCount });
  } catch (err: any) {
    callback({ code: err?.code ?? grpc.status.INTERNAL, message: err?.message ?? 'Revoke failed' });
  }
};

const listWriteAccessHandler: grpc.handleUnaryCall<any, any> = async (call, callback) => {
  const ctx = readAuthContext(call.metadata);
  try {
    const { map_id } = call.request;
    if (!map_id) {
      return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'map_id is required' });
    }
    const existing = await getShExMap(sparqlClient, prefixes, map_id);
    if (!existing) return callback({ code: grpc.status.NOT_FOUND, message: 'Map not found' });

    const resourceIri = `${prefixes.shexrmap}${existing.id}`;
    const items = await aclListAuthorizations(ctx, resourceIri);
    callback(null, {
      items: items.map((it) => ({
        authorization_iri: it.authorizationIri,
        agent_user_id:     it.agentIri.startsWith(prefixes.shexruser)
          ? it.agentIri.slice(prefixes.shexruser.length)
          : it.agentIri,
        mode:              it.mode,
      })),
    });
  } catch (err: any) {
    callback({ code: err?.code ?? grpc.status.INTERNAL, message: err?.message ?? 'List failed' });
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
    GrantWriteAccess:  grantWriteAccessHandler,
    RevokeWriteAccess: revokeWriteAccessHandler,
    ListWriteAccess:   listWriteAccessHandler,
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
