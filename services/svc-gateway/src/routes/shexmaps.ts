import type { FastifyPluginAsync } from 'fastify';
import { shexmapClient } from '../grpc/clients.js';
import { buildAuthMeta } from '../grpc/meta.js';
import { grpcCall, snakeToCamel } from '../grpc/call.js';
import { grpcErrorToHttp } from '../plugins/grpcError.js';
import { config } from '../config.js';

const WRITE_METHODS = new Set(['POST', 'PATCH', 'DELETE']);

function requiresAuth(method: string): boolean {
  return config.authEnabled && WRITE_METHODS.has(method);
}

const shexmapsRoutes: FastifyPluginAsync = async (fastify) => {

  fastify.get('/api/v1/shexmaps', async (request, reply) => {
    const ctx = fastify.extractAuth(request);
    const q = request.query as Record<string, string>;
    try {
      const result = await grpcCall(shexmapClient, 'ListShexMaps', {
        q:                   q['q']                   ?? '',
        tag:                 q['tag']                 ?? '',
        author:              q['author']              ?? '',
        schema_url:          q['schemaUrl']           ?? '',
        has_map_annotations: q['hasMapAnnotations']   ?? '',
        map_variable:        q['mapVariable']         ?? '',
        page:                parseInt(q['page']  ?? '1',  10),
        limit:               parseInt(q['limit'] ?? '20', 10),
        sort:                q['sort']  ?? 'createdAt',
        order:               q['order'] ?? 'desc',
      }, buildAuthMeta(ctx));
      return reply.send(snakeToCamel(result));
    } catch (err) {
      return grpcErrorToHttp(reply, err);
    }
  });

  fastify.get('/api/v1/shexmaps/:id', async (request, reply) => {
    const ctx = fastify.extractAuth(request);
    const { id } = request.params as { id: string };
    try {
      const result = await grpcCall(shexmapClient, 'GetShexMap', { id }, buildAuthMeta(ctx));
      const res = result as { found: boolean; map: unknown };
      if (!res.found) return reply.code(404).send({ error: 'ShExMap not found' });
      return reply.send(snakeToCamel(res.map));
    } catch (err) {
      return grpcErrorToHttp(reply, err);
    }
  });

  fastify.post('/api/v1/shexmaps', async (request, reply) => {
    const ctx = fastify.extractAuth(request);
    if (requiresAuth(request.method) && !ctx.userId) {
      return reply.code(401).send({ error: 'Authentication required' });
    }
    const body = request.body as Record<string, unknown> ?? {};
    try {
      const result = await grpcCall(shexmapClient, 'CreateShexMap', {
        title:              body['title']            ?? '',
        description:        body['description']      ?? '',
        content:            body['content']          ?? '',
        sample_turtle_data: body['sampleTurtleData'] ?? '',
        file_name:          body['fileName']         ?? '',
        file_format:        body['fileFormat']       ?? 'shexc',
        source_url:         body['sourceUrl']        ?? '',
        schema_url:         body['schemaUrl']        ?? '',
        tags:               body['tags']             ?? [],
        version:            body['version']          ?? '1.0.0',
      }, buildAuthMeta(ctx));
      const res = result as { found: boolean; map: unknown };
      return reply.code(201).send(snakeToCamel(res.map));
    } catch (err) {
      return grpcErrorToHttp(reply, err);
    }
  });

  fastify.patch('/api/v1/shexmaps/:id', async (request, reply) => {
    const ctx = fastify.extractAuth(request);
    if (requiresAuth(request.method) && !ctx.userId) {
      return reply.code(401).send({ error: 'Authentication required' });
    }
    const { id } = request.params as { id: string };
    const body = request.body as Record<string, unknown> ?? {};
    try {
      const req: Record<string, unknown> = { id };
      if ('title'           in body) { req['title']            = body['title'];           req['has_title']        = true; }
      if ('description'     in body) { req['description']      = body['description'];     req['has_description']  = true; }
      if ('sourceUrl'       in body) { req['source_url']       = body['sourceUrl'];       req['has_source_url']   = true; }
      if ('schemaUrl'       in body) { req['schema_url']       = body['schemaUrl'];       req['has_schema_url']   = true; }
      if ('sampleTurtleData'in body) { req['sample_turtle_data']=body['sampleTurtleData'];req['has_sample_turtle']= true; }
      if ('tags'            in body) { req['tags']             = body['tags'];            req['has_tags']         = true; }
      if ('version'         in body) { req['version']          = body['version'];         req['has_version']      = true; }
      const result = await grpcCall(shexmapClient, 'UpdateShexMap', req, buildAuthMeta(ctx));
      const res = result as { found: boolean; map: unknown };
      if (!res.found) return reply.code(404).send({ error: 'ShExMap not found' });
      return reply.send(snakeToCamel(res.map));
    } catch (err) {
      return grpcErrorToHttp(reply, err);
    }
  });

  fastify.delete('/api/v1/shexmaps/:id', async (request, reply) => {
    const ctx = fastify.extractAuth(request);
    if (requiresAuth(request.method) && !ctx.userId) {
      return reply.code(401).send({ error: 'Authentication required' });
    }
    const { id } = request.params as { id: string };
    try {
      const result = await grpcCall(shexmapClient, 'DeleteShexMap', { id }, buildAuthMeta(ctx));
      const res = result as { success: boolean };
      if (!res.success) return reply.code(404).send({ error: 'ShExMap not found' });
      return reply.code(204).send();
    } catch (err) {
      return grpcErrorToHttp(reply, err);
    }
  });

  fastify.get('/api/v1/shexmaps/:id/versions', async (request, reply) => {
    const ctx = fastify.extractAuth(request);
    const { id } = request.params as { id: string };
    try {
      const result = await grpcCall(shexmapClient, 'ListVersions', { map_id: id }, buildAuthMeta(ctx));
      const res = result as { versions: unknown[] };
      return reply.send(snakeToCamel(res.versions));
    } catch (err) {
      return grpcErrorToHttp(reply, err);
    }
  });

  fastify.post('/api/v1/shexmaps/:id/versions', async (request, reply) => {
    const ctx = fastify.extractAuth(request);
    if (requiresAuth(request.method) && !ctx.userId) {
      return reply.code(401).send({ error: 'Authentication required' });
    }
    const { id } = request.params as { id: string };
    const body = request.body as Record<string, unknown> ?? {};
    try {
      const result = await grpcCall(shexmapClient, 'SaveVersion', {
        map_id:         id,
        content:        body['content']       ?? '',
        commit_message: body['commitMessage'] ?? '',
      }, buildAuthMeta(ctx));
      const res = result as { found: boolean; version: unknown };
      if (!res.found) return reply.code(404).send({ error: 'ShExMap not found' });
      return reply.code(201).send(snakeToCamel(res.version));
    } catch (err) {
      return grpcErrorToHttp(reply, err);
    }
  });

  fastify.get('/api/v1/shexmaps/:id/versions/:vn', async (request, reply) => {
    const ctx = fastify.extractAuth(request);
    const { id, vn } = request.params as { id: string; vn: string };
    const vnNum = parseInt(vn, 10);
    if (isNaN(vnNum) || vnNum < 1) {
      return reply.code(400).send({ error: 'Version number must be a positive integer' });
    }
    try {
      const result = await grpcCall(shexmapClient, 'GetVersionContent', {
        map_id:         id,
        version_number: vnNum,
      }, buildAuthMeta(ctx));
      const res = result as { found?: boolean; meta: unknown; content: string };
      if (res.found === false) return reply.code(404).send({ error: 'Version not found' });
      const out = snakeToCamel(res.meta) as Record<string, unknown>;
      (out as Record<string, unknown>)['content'] = res.content;
      return reply.send(out);
    } catch (err) {
      return grpcErrorToHttp(reply, err);
    }
  });

  // ── ACL: Grant / Revoke / List write access ────────────────────────────────

  fastify.post('/api/v1/shexmaps/:id/acl/grant', async (request, reply) => {
    const ctx = fastify.extractAuth(request);
    if (requiresAuth(request.method) && !ctx.userId) {
      return reply.code(401).send({ error: 'Authentication required' });
    }
    const { id } = request.params as { id: string };
    const body = request.body as Record<string, unknown> ?? {};
    const agentUserId = (body['agentUserId'] as string | undefined) ?? '';
    if (!agentUserId) return reply.code(400).send({ error: 'agentUserId is required' });
    try {
      const result = await grpcCall(shexmapClient, 'GrantWriteAccess', {
        map_id:        id,
        agent_user_id: agentUserId,
      }, buildAuthMeta(ctx));
      return reply.send(snakeToCamel(result));
    } catch (err) {
      return grpcErrorToHttp(reply, err);
    }
  });

  fastify.post('/api/v1/shexmaps/:id/acl/revoke', async (request, reply) => {
    const ctx = fastify.extractAuth(request);
    if (requiresAuth(request.method) && !ctx.userId) {
      return reply.code(401).send({ error: 'Authentication required' });
    }
    const { id } = request.params as { id: string };
    const body = request.body as Record<string, unknown> ?? {};
    const agentUserId = (body['agentUserId'] as string | undefined) ?? '';
    if (!agentUserId) return reply.code(400).send({ error: 'agentUserId is required' });
    try {
      const result = await grpcCall(shexmapClient, 'RevokeWriteAccess', {
        map_id:        id,
        agent_user_id: agentUserId,
      }, buildAuthMeta(ctx));
      return reply.send(snakeToCamel(result));
    } catch (err) {
      return grpcErrorToHttp(reply, err);
    }
  });

  fastify.get('/api/v1/shexmaps/:id/acl', async (request, reply) => {
    const ctx = fastify.extractAuth(request);
    const { id } = request.params as { id: string };
    try {
      const result = await grpcCall(shexmapClient, 'ListWriteAccess', { map_id: id }, buildAuthMeta(ctx));
      const res = result as { items: unknown[] };
      return reply.send(snakeToCamel(res.items ?? []));
    } catch (err) {
      return grpcErrorToHttp(reply, err);
    }
  });

};

export default shexmapsRoutes;
