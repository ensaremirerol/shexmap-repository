import type { FastifyPluginAsync } from 'fastify';
import { validateClient } from '../grpc/clients.js';
import { buildAuthMeta } from '../grpc/meta.js';
import { grpcCall, snakeToCamel } from '../grpc/call.js';
import { grpcErrorToHttp } from '../plugins/grpcError.js';

const validateRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post('/api/v1/validate', async (request, reply) => {
    const ctx = fastify.extractAuth(request);
    const body = request.body as Record<string, string> ?? {};
    const meta = buildAuthMeta(ctx);

    try {
      const result = await grpcCall(validateClient, 'Validate', {
        source_shex: body['sourceShEx'] ?? body['source_shex'] ?? '',
        source_rdf:  body['sourceRdf']  ?? body['source_rdf']  ?? '',
        source_node: body['sourceNode'] ?? body['source_node'] ?? '',
        target_shex: body['targetShEx'] ?? body['target_shex'] ?? '',
        target_node: body['targetNode'] ?? body['target_node'] ?? '',
      }, meta);
      return reply.send(snakeToCamel(result));
    } catch (err) {
      return grpcErrorToHttp(reply, err);
    }
  });
};

export default validateRoutes;
