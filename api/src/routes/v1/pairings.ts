import type { FastifyPluginAsync } from 'fastify';
import {
  ShExMapPairingCreateSchema,
  ShExMapPairingUpdateSchema,
  ShExMapPairingQuerySchema,
  ShExMapIdSchema,
  SavePairingVersionSchema,
} from '../../models/shexmap.model.js';
import {
  listShExMapPairings,
  getShExMapPairing,
  createShExMapPairing,
  updateShExMapPairing,
  deleteShExMapPairing,
} from '../../services/shexmap.service.js';
import {
  listPairingVersions,
  getPairingVersion,
  savePairingVersion,
} from '../../services/pairing-version.service.js';
import { config } from '../../config.js';

const pairingsRoutes: FastifyPluginAsync = async (fastify) => {

  fastify.get('/', {
    schema: { tags: ['pairings'], summary: 'List ShExMap Pairings' },
  }, async (request) => {
    const query = ShExMapPairingQuerySchema.parse(request.query);
    return listShExMapPairings(fastify, query);
  });

  fastify.get('/:id', {
    schema: { tags: ['pairings'], summary: 'Get a ShExMap Pairing by ID' },
  }, async (request, reply) => {
    const { id } = ShExMapIdSchema.parse(request.params);
    const pairing = await getShExMapPairing(fastify, id);
    if (!pairing) return reply.notFound(`ShExMapPairing ${id} not found`);
    return pairing;
  });

  fastify.post('/', {
    schema: { tags: ['pairings'], summary: 'Create a ShExMap Pairing' },
    preHandler: [fastify.requireAuth],
  }, async (request, reply) => {
    const data = ShExMapPairingCreateSchema.parse(request.body);
    const authorId = config.auth.enabled
      ? (request.user as { sub: string }).sub
      : 'anonymous';
    const pairing = await createShExMapPairing(fastify, data, authorId);
    return reply.code(201).send(pairing);
  });

  fastify.patch('/:id', {
    schema: { tags: ['pairings'], summary: 'Update a ShExMap Pairing' },
    preHandler: [fastify.requireAuth],
  }, async (request, reply) => {
    const { id } = ShExMapIdSchema.parse(request.params);
    const existing = await getShExMapPairing(fastify, id);
    if (!existing) return reply.notFound(`ShExMapPairing ${id} not found`);
    const data = ShExMapPairingUpdateSchema.parse(request.body);
    const updated = await updateShExMapPairing(fastify, id, data);
    return updated;
  });

  // GET /pairings/:id/versions — list all pairing versions
  fastify.get('/:id/versions', {
    schema: { tags: ['pairings'], summary: 'List versions of a ShExMap Pairing' },
  }, async (request, reply) => {
    const { id } = ShExMapIdSchema.parse(request.params);
    const existing = await getShExMapPairing(fastify, id);
    if (!existing) return reply.notFound(`ShExMapPairing ${id} not found`);
    return listPairingVersions(fastify, id);
  });

  // POST /pairings/:id/versions — save a new pairing version
  fastify.post('/:id/versions', {
    schema: { tags: ['pairings'], summary: 'Save a new version of a ShExMap Pairing' },
    preHandler: [fastify.requireAuth],
  }, async (request, reply) => {
    const { id } = ShExMapIdSchema.parse(request.params);
    const existing = await getShExMapPairing(fastify, id);
    if (!existing) return reply.notFound(`ShExMapPairing ${id} not found`);
    const body = SavePairingVersionSchema.parse(request.body);
    const authorId = config.auth.enabled
      ? (request.user as { sub: string }).sub
      : 'anonymous';
    const version = await savePairingVersion(fastify, id, authorId, {
      commitMessage: body.commitMessage,
      sourceMapId: existing.sourceMap.id,
      sourceVersionNumber: body.sourceMapVersionNumber,
      targetMapId: existing.targetMap.id,
      targetVersionNumber: body.targetMapVersionNumber,
    });
    return reply.code(201).send(version);
  });

  // GET /pairings/:id/versions/:vn — get a specific pairing version
  fastify.get('/:id/versions/:vn', {
    schema: { tags: ['pairings'], summary: 'Get a specific version of a ShExMap Pairing' },
  }, async (request, reply) => {
    const { id } = ShExMapIdSchema.parse(request.params);
    const vn = parseInt((request.params as { vn: string }).vn, 10);
    if (isNaN(vn) || vn < 1) return reply.badRequest('Version number must be a positive integer');
    const version = await getPairingVersion(fastify, id, vn);
    if (!version) return reply.notFound(`Version ${vn} of pairing ${id} not found`);
    return version;
  });

  fastify.delete('/:id', {
    schema: { tags: ['pairings'], summary: 'Delete a ShExMap Pairing' },
    preHandler: [fastify.requireAuth],
  }, async (request, reply) => {
    const { id } = ShExMapIdSchema.parse(request.params);
    const existing = await getShExMapPairing(fastify, id);
    if (!existing) return reply.notFound(`ShExMapPairing ${id} not found`);
    await deleteShExMapPairing(fastify, id);
    return reply.code(204).send();
  });

};

export default pairingsRoutes;
