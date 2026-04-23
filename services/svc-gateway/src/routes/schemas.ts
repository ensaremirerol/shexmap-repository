import type { FastifyPluginAsync } from 'fastify';
import { schemaClient } from '../grpc/clients.js';
import { buildAuthMeta } from '../grpc/meta.js';
import { grpcCall, snakeToCamel } from '../grpc/call.js';
import { grpcErrorToHttp } from '../plugins/grpcError.js';

const schemasRoutes: FastifyPluginAsync = async (fastify) => {

  fastify.get('/api/v1/schemas', async (request, reply) => {
    const ctx = fastify.extractAuth(request);
    try {
      const result = await grpcCall(schemaClient, 'ListSchemas', {}, buildAuthMeta(ctx));
      const res = result as { schemas: unknown[] };
      return reply.send(snakeToCamel(res.schemas));
    } catch (err) {
      return grpcErrorToHttp(reply, err);
    }
  });

};

export default schemasRoutes;
