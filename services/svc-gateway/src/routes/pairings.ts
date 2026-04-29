import type { FastifyPluginAsync } from 'fastify';
import { pairingClient } from '../grpc/clients.js';
import { buildAuthMeta } from '../grpc/meta.js';
import { grpcCall, snakeToCamel } from '../grpc/call.js';
import { grpcErrorToHttp } from '../plugins/grpcError.js';
import { config } from '../config.js';

const WRITE_METHODS = new Set(['POST', 'PATCH', 'DELETE']);

function requiresAuth(method: string): boolean {
  return config.authEnabled && WRITE_METHODS.has(method);
}

const pairingsRoutes: FastifyPluginAsync = async (fastify) => {

  fastify.get('/api/v1/pairings', async (request, reply) => {
    const ctx = fastify.extractAuth(request);
    const q = request.query as Record<string, string>;
    try {
      const result = await grpcCall(pairingClient, 'ListPairings', {
        q:             q['q']            ?? '',
        tag:           q['tag']          ?? '',
        author:        q['author']       ?? '',
        source_map_id: q['sourceMapId']  ?? '',
        target_map_id: q['targetMapId']  ?? '',
        page:          parseInt(q['page']  ?? '1',  10),
        limit:         parseInt(q['limit'] ?? '20', 10),
        sort:          q['sort']  ?? 'createdAt',
        order:         q['order'] ?? 'desc',
      }, buildAuthMeta(ctx));
      return reply.send(snakeToCamel(result));
    } catch (err) {
      return grpcErrorToHttp(reply, err);
    }
  });

  fastify.get('/api/v1/pairings/:id', async (request, reply) => {
    const ctx = fastify.extractAuth(request);
    const { id } = request.params as { id: string };
    try {
      const result = await grpcCall(pairingClient, 'GetPairing', { id }, buildAuthMeta(ctx));
      const res = result as { found: boolean; pairing: unknown };
      if (!res.found) return reply.code(404).send({ error: 'Pairing not found' });
      return reply.send(snakeToCamel(res.pairing));
    } catch (err) {
      return grpcErrorToHttp(reply, err);
    }
  });

  fastify.post('/api/v1/pairings', async (request, reply) => {
    const ctx = fastify.extractAuth(request);
    if (requiresAuth(request.method) && !ctx.userId) {
      return reply.code(401).send({ error: 'Authentication required' });
    }
    const body = request.body as Record<string, unknown> ?? {};
    try {
      const result = await grpcCall(pairingClient, 'CreatePairing', {
        title:            body['title']          ?? '',
        description:      body['description']    ?? '',
        source_map_id:    body['sourceMapId']    ?? '',
        target_map_id:    body['targetMapId']    ?? '',
        source_focus_iri: body['sourceFocusIri'] ?? '',
        target_focus_iri: body['targetFocusIri'] ?? '',
        tags:             body['tags']           ?? [],
        license:          body['license']        ?? '',
        version:          body['version']        ?? '1.0.0',
      }, buildAuthMeta(ctx));
      const res = result as { found: boolean; pairing: unknown };
      return reply.code(201).send(snakeToCamel(res.pairing));
    } catch (err) {
      return grpcErrorToHttp(reply, err);
    }
  });

  fastify.patch('/api/v1/pairings/:id', async (request, reply) => {
    const ctx = fastify.extractAuth(request);
    if (requiresAuth(request.method) && !ctx.userId) {
      return reply.code(401).send({ error: 'Authentication required' });
    }
    const { id } = request.params as { id: string };
    const body = request.body as Record<string, unknown> ?? {};
    try {
      const result = await grpcCall(pairingClient, 'UpdatePairing', {
        id,
        title:            body['title']          ?? '',
        description:      body['description']    ?? '',
        source_map_id:    body['sourceMapId']    ?? '',
        target_map_id:    body['targetMapId']    ?? '',
        source_focus_iri: body['sourceFocusIri'] ?? '',
        target_focus_iri: body['targetFocusIri'] ?? '',
        tags:             body['tags']           ?? [],
        license:          body['license']        ?? '',
        version:          body['version']        ?? '',
      }, buildAuthMeta(ctx));
      const res = result as { found: boolean; pairing: unknown };
      if (!res.found) return reply.code(404).send({ error: 'Pairing not found' });
      return reply.send(snakeToCamel(res.pairing));
    } catch (err) {
      return grpcErrorToHttp(reply, err);
    }
  });

  fastify.delete('/api/v1/pairings/:id', async (request, reply) => {
    const ctx = fastify.extractAuth(request);
    if (requiresAuth(request.method) && !ctx.userId) {
      return reply.code(401).send({ error: 'Authentication required' });
    }
    const { id } = request.params as { id: string };
    try {
      const result = await grpcCall(pairingClient, 'DeletePairing', { id }, buildAuthMeta(ctx));
      const res = result as { success: boolean };
      if (!res.success) return reply.code(404).send({ error: 'Pairing not found' });
      return reply.code(204).send();
    } catch (err) {
      return grpcErrorToHttp(reply, err);
    }
  });

  fastify.get('/api/v1/pairings/:id/versions', async (request, reply) => {
    const ctx = fastify.extractAuth(request);
    const { id } = request.params as { id: string };
    try {
      const result = await grpcCall(pairingClient, 'ListPairingVersions', { pairing_id: id }, buildAuthMeta(ctx));
      const res = result as { versions: unknown[] };
      return reply.send(snakeToCamel(res.versions));
    } catch (err) {
      return grpcErrorToHttp(reply, err);
    }
  });

  fastify.post('/api/v1/pairings/:id/versions', async (request, reply) => {
    const ctx = fastify.extractAuth(request);
    if (requiresAuth(request.method) && !ctx.userId) {
      return reply.code(401).send({ error: 'Authentication required' });
    }
    const { id } = request.params as { id: string };
    const body = request.body as Record<string, unknown> ?? {};
    try {
      const result = await grpcCall(pairingClient, 'SavePairingVersion', {
        pairing_id:            id,
        commit_message:        body['commitMessage']        ?? '',
        source_map_id:         body['sourceMapId']         ?? '',
        source_version_number: body['sourceMapVersionNumber'] ?? 0,
        target_map_id:         body['targetMapId']         ?? '',
        target_version_number: body['targetMapVersionNumber'] ?? 0,
        has_source_version:    !!body['sourceMapVersionNumber'],
        has_target_version:    !!body['targetMapVersionNumber'],
      }, buildAuthMeta(ctx));
      const res = result as { found: boolean; version: unknown };
      if (!res.found) return reply.code(404).send({ error: 'Pairing not found' });
      return reply.code(201).send(snakeToCamel(res.version));
    } catch (err) {
      return grpcErrorToHttp(reply, err);
    }
  });

  // ── ACL: Grant / Revoke / List write access ────────────────────────────────

  fastify.post('/api/v1/pairings/:id/acl/grant', async (request, reply) => {
    const ctx = fastify.extractAuth(request);
    if (requiresAuth(request.method) && !ctx.userId) {
      return reply.code(401).send({ error: 'Authentication required' });
    }
    const { id } = request.params as { id: string };
    const body = request.body as Record<string, unknown> ?? {};
    const agentUserId = (body['agentUserId'] as string | undefined) ?? '';
    if (!agentUserId) return reply.code(400).send({ error: 'agentUserId is required' });
    try {
      const result = await grpcCall(pairingClient, 'GrantWriteAccess', {
        pairing_id:    id,
        agent_user_id: agentUserId,
      }, buildAuthMeta(ctx));
      return reply.send(snakeToCamel(result));
    } catch (err) {
      return grpcErrorToHttp(reply, err);
    }
  });

  fastify.post('/api/v1/pairings/:id/acl/revoke', async (request, reply) => {
    const ctx = fastify.extractAuth(request);
    if (requiresAuth(request.method) && !ctx.userId) {
      return reply.code(401).send({ error: 'Authentication required' });
    }
    const { id } = request.params as { id: string };
    const body = request.body as Record<string, unknown> ?? {};
    const agentUserId = (body['agentUserId'] as string | undefined) ?? '';
    if (!agentUserId) return reply.code(400).send({ error: 'agentUserId is required' });
    try {
      const result = await grpcCall(pairingClient, 'RevokeWriteAccess', {
        pairing_id:    id,
        agent_user_id: agentUserId,
      }, buildAuthMeta(ctx));
      return reply.send(snakeToCamel(result));
    } catch (err) {
      return grpcErrorToHttp(reply, err);
    }
  });

  fastify.get('/api/v1/pairings/:id/acl', async (request, reply) => {
    const ctx = fastify.extractAuth(request);
    const { id } = request.params as { id: string };
    try {
      const result = await grpcCall(pairingClient, 'ListWriteAccess', { pairing_id: id }, buildAuthMeta(ctx));
      const res = result as { items: unknown[] };
      return reply.send(snakeToCamel(res.items ?? []));
    } catch (err) {
      return grpcErrorToHttp(reply, err);
    }
  });

  fastify.get('/api/v1/pairings/:id/versions/:vn', async (request, reply) => {
    const ctx = fastify.extractAuth(request);
    const { id, vn } = request.params as { id: string; vn: string };
    const vnNum = parseInt(vn, 10);
    if (isNaN(vnNum) || vnNum < 1) {
      return reply.code(400).send({ error: 'Version number must be a positive integer' });
    }
    try {
      const result = await grpcCall(pairingClient, 'GetPairingVersion', {
        pairing_id:     id,
        version_number: vnNum,
      }, buildAuthMeta(ctx));
      const res = result as { found: boolean; version: unknown };
      if (!res.found) return reply.code(404).send({ error: 'Version not found' });
      return reply.send(snakeToCamel(res.version));
    } catch (err) {
      return grpcErrorToHttp(reply, err);
    }
  });

};

export default pairingsRoutes;
