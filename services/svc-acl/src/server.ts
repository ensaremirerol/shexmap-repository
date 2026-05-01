import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { join } from 'path';
import { config } from './config.js';
import { sparqlClient, prefixes } from './sparql.js';
import {
  SUPPORTED_MODES,
  type AclMode,
  grantMode,
  hasMode,
  listAuthorizations,
  purgeResource,
  revokeMode,
} from './services/acl.service.js';
import type { AuthContext } from '@shexmap/shared';
import { AUTH_META, PROTO_DIR } from '@shexmap/shared';

const PROTO_PATH = join(PROTO_DIR, 'acl.proto');

const packageDef = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});

const proto = grpc.loadPackageDefinition(packageDef) as any;

// ── auth metadata (read-only; svc-acl trusts callers) ───────────────────────

function readAuthContext(metadata: grpc.Metadata): AuthContext {
  const get = (k: string) => String(metadata.get(k)[0] ?? '');
  return {
    userId:      get(AUTH_META.USER_ID),
    role:        (get(AUTH_META.ROLE) || 'anonymous') as AuthContext['role'],
    authEnabled: get(AUTH_META.AUTH_ENABLED) === 'true',
  };
}

function logCaller(rpc: string, ctx: AuthContext): void {
  if (ctx.authEnabled) {
    console.log(`[svc-acl] ${rpc} caller=${ctx.userId || 'anonymous'} role=${ctx.role}`);
  }
}

// ── mode validation ─────────────────────────────────────────────────────────

function validateMode(mode: string): AclMode | grpc.ServiceError {
  if (!SUPPORTED_MODES.includes(mode as AclMode)) {
    return {
      code: grpc.status.INVALID_ARGUMENT,
      message: `Unsupported ACL mode: ${mode}. Supported: ${SUPPORTED_MODES.join(', ')}`,
      name: 'ServiceError',
      details: '',
      metadata: new grpc.Metadata(),
    };
  }
  return mode as AclMode;
}

function isServiceError(x: AclMode | grpc.ServiceError): x is grpc.ServiceError {
  return typeof x === 'object' && x !== null && 'code' in x;
}

// ── handlers ────────────────────────────────────────────────────────────────

const hasModeHandler: grpc.handleUnaryCall<any, any> = async (call, callback) => {
  const ctx = readAuthContext(call.metadata);
  logCaller('HasMode', ctx);
  try {
    const mode = validateMode(call.request.mode);
    if (isServiceError(mode)) return callback(mode);
    const allowed = await hasMode(
      sparqlClient, prefixes,
      call.request.resource_iri,
      call.request.agent_iri,
      mode,
    );
    callback(null, { allowed });
  } catch (err: any) {
    callback({ code: grpc.status.INTERNAL, message: err.message });
  }
};

const grantModeHandler: grpc.handleUnaryCall<any, any> = async (call, callback) => {
  const ctx = readAuthContext(call.metadata);
  logCaller('GrantMode', ctx);
  try {
    const mode = validateMode(call.request.mode);
    if (isServiceError(mode)) return callback(mode);
    const { authorizationIri } = await grantMode(
      sparqlClient, prefixes,
      call.request.resource_iri,
      call.request.agent_iri,
      mode,
    );
    callback(null, { authorization_iri: authorizationIri });
  } catch (err: any) {
    callback({ code: grpc.status.INTERNAL, message: err.message });
  }
};

const revokeModeHandler: grpc.handleUnaryCall<any, any> = async (call, callback) => {
  const ctx = readAuthContext(call.metadata);
  logCaller('RevokeMode', ctx);
  try {
    const mode = validateMode(call.request.mode);
    if (isServiceError(mode)) return callback(mode);
    const { deletedCount } = await revokeMode(
      sparqlClient, prefixes,
      call.request.resource_iri,
      call.request.agent_iri,
      mode,
    );
    callback(null, { deleted_count: deletedCount });
  } catch (err: any) {
    callback({ code: grpc.status.INTERNAL, message: err.message });
  }
};

const listAuthorizationsHandler: grpc.handleUnaryCall<any, any> = async (call, callback) => {
  const ctx = readAuthContext(call.metadata);
  logCaller('ListAuthorizations', ctx);
  try {
    const items = await listAuthorizations(
      sparqlClient, prefixes,
      call.request.resource_iri,
    );
    callback(null, {
      items: items.map((a) => ({
        authorization_iri: a.authorizationIri,
        resource_iri:      a.resourceIri,
        agent_iri:         a.agentIri,
        mode:              a.mode,
      })),
    });
  } catch (err: any) {
    callback({ code: grpc.status.INTERNAL, message: err.message });
  }
};

const purgeResourceHandler: grpc.handleUnaryCall<any, any> = async (call, callback) => {
  const ctx = readAuthContext(call.metadata);
  logCaller('PurgeResource', ctx);
  try {
    const { deletedCount } = await purgeResource(
      sparqlClient, prefixes,
      call.request.resource_iri,
    );
    callback(null, { deleted_count: deletedCount });
  } catch (err: any) {
    callback({ code: grpc.status.INTERNAL, message: err.message });
  }
};

export function createServer(): grpc.Server {
  const server = new grpc.Server();
  server.addService(proto.shexmap.acl.AclService.service, {
    HasMode:            hasModeHandler,
    GrantMode:          grantModeHandler,
    RevokeMode:         revokeModeHandler,
    ListAuthorizations: listAuthorizationsHandler,
    PurgeResource:      purgeResourceHandler,
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
      console.log(`svc-acl gRPC listening on :${port}`);
    },
  );
}
