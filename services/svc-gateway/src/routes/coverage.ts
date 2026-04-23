import type { FastifyPluginAsync } from 'fastify';
import { coverageClient } from '../grpc/clients.js';
import { buildAuthMeta } from '../grpc/meta.js';
import { grpcCall, snakeToCamel } from '../grpc/call.js';
import { grpcErrorToHttp } from '../plugins/grpcError.js';

const coverageRoutes: FastifyPluginAsync = async (fastify) => {

  fastify.get('/api/v1/coverage', async (request, reply) => {
    const ctx = fastify.extractAuth(request);
    try {
      const result = await grpcCall(coverageClient, 'GetOverview', {}, buildAuthMeta(ctx));
      return reply.send(snakeToCamel(result));
    } catch (err) {
      return grpcErrorToHttp(reply, err);
    }
  });

  fastify.get('/api/v1/coverage/gaps', async (request, reply) => {
    const ctx = fastify.extractAuth(request);
    const q = request.query as Record<string, string>;
    try {
      const result = await grpcCall(coverageClient, 'GetGaps', {
        schema_url: q['schemaUrl'] ?? '',
      }, buildAuthMeta(ctx));
      const res = result as { gaps: unknown[] };
      return reply.send(snakeToCamel(res.gaps));
    } catch (err) {
      return grpcErrorToHttp(reply, err);
    }
  });

};

export default coverageRoutes;
