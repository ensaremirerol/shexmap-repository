import type { FastifyPluginAsync } from 'fastify';
import { sparqlClient, prefixes } from '../sparql.js';
import { getUserById } from '../services/user.service.js';
import { createApiKey, listApiKeys, revokeApiKey } from '../services/apikey.service.js';

const usersRoutes: FastifyPluginAsync = async (fastify) => {

  fastify.get('/:userId/dashboard', {
    preHandler: [fastify.requireAuth],
  }, async (request, reply) => {
    const { userId } = request.params as { userId: string };
    const jwtUser = request.jwtUser;

    if (jwtUser && jwtUser.sub !== userId && jwtUser.role !== 'admin') {
      return reply.forbidden('Access denied');
    }

    const user = await getUserById(sparqlClient, prefixes, userId);
    if (!user) return reply.notFound('User not found');

    // TODO: enrich with contributions + starred from SPARQL
    return { user, contributions: [], starred: [] };
  });

  fastify.get('/:userId/shexmaps', async (request, reply) => {
    const { userId } = request.params as { userId: string };
    const user = await getUserById(sparqlClient, prefixes, userId);
    if (!user) return reply.notFound('User not found');
    // TODO: query ShExMaps authored by userId
    return { userId, shexmaps: [] };
  });

  fastify.post('/:userId/api-keys', {
    preHandler: [fastify.requireAuth],
  }, async (request, reply) => {
    const { userId } = request.params as { userId: string };
    const jwtUser = request.jwtUser;

    if (jwtUser && jwtUser.sub !== userId && jwtUser.role !== 'admin') {
      return reply.forbidden('Access denied');
    }

    const { name } = request.body as { name?: string };
    if (!name) return reply.badRequest('name is required');

    const { key, raw } = createApiKey(userId, name);
    return reply.code(201).send({ ...key, key: raw });
  });

  fastify.get('/:userId/api-keys', {
    preHandler: [fastify.requireAuth],
  }, async (request, reply) => {
    const { userId } = request.params as { userId: string };
    const jwtUser = request.jwtUser;

    if (jwtUser && jwtUser.sub !== userId && jwtUser.role !== 'admin') {
      return reply.forbidden('Access denied');
    }

    return listApiKeys(userId);
  });

  fastify.delete('/:userId/api-keys/:keyId', {
    preHandler: [fastify.requireAuth],
  }, async (request, reply) => {
    const { userId, keyId } = request.params as { userId: string; keyId: string };
    const jwtUser = request.jwtUser;

    if (jwtUser && jwtUser.sub !== userId && jwtUser.role !== 'admin') {
      return reply.forbidden('Access denied');
    }

    revokeApiKey(userId, keyId);
    return reply.code(204).send();
  });
};

export default usersRoutes;
