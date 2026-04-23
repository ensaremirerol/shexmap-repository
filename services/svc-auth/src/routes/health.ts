import type { FastifyPluginAsync } from 'fastify';

const healthRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/health', async () => ({ status: 'ok', service: 'svc-auth' }));
};

export default healthRoutes;
