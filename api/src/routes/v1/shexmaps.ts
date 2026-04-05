import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  ShExMapCreateSchema,
  ShExMapUpdateSchema,
  ShExMapQuerySchema,
  ShExMapIdSchema,
  SaveVersionSchema,
} from '../../models/shexmap.model.js';
import {
  listShExMaps,
  getShExMap,
  createShExMap,
  updateShExMap,
  deleteShExMap,
} from '../../services/shexmap.service.js';
import {
  listVersions,
  getVersion,
  getVersionContent,
  saveNewVersion,
} from '../../services/version.service.js';
import { config } from '../../config.js';

const shexmapsRoutes: FastifyPluginAsync = async (fastify) => {

  // GET /shexmaps — list with filters
  fastify.get('/', {
    schema: { tags: ['shexmaps'], summary: 'List ShExMaps' },
  }, async (request) => {
    const query = ShExMapQuerySchema.parse(request.query);
    return listShExMaps(fastify, query);
  });

  // GET /shexmaps/:id — get one
  fastify.get('/:id', {
    schema: { tags: ['shexmaps'], summary: 'Get a ShExMap by ID' },
  }, async (request, reply) => {
    const { id } = ShExMapIdSchema.parse(request.params);
    const map = await getShExMap(fastify, id);
    if (!map) return reply.notFound(`ShExMap ${id} not found`);
    return map;
  });

  // POST /shexmaps — create
  fastify.post('/', {
    schema: { tags: ['shexmaps'], summary: 'Submit a new ShExMap' },
    preHandler: [fastify.requireAuth],
  }, async (request, reply) => {
    const data = ShExMapCreateSchema.parse(request.body);
    // When auth is disabled use a placeholder author; when enabled use JWT subject
    const authorId = config.auth.enabled
      ? (request.user as { sub: string }).sub
      : 'anonymous';
    const map = await createShExMap(fastify, data, authorId);
    return reply.code(201).send(map);
  });

  // PATCH /shexmaps/:id — update metadata
  fastify.patch('/:id', {
    schema: { tags: ['shexmaps'], summary: 'Update ShExMap metadata' },
    preHandler: [fastify.requireAuth],
  }, async (request, reply) => {
    const { id } = ShExMapIdSchema.parse(request.params);
    const existing = await getShExMap(fastify, id);
    if (!existing) return reply.notFound(`ShExMap ${id} not found`);
    const data = ShExMapUpdateSchema.parse(request.body);
    const updated = await updateShExMap(fastify, id, data);
    return updated;
  });

  // DELETE /shexmaps/:id
  fastify.delete('/:id', {
    schema: { tags: ['shexmaps'], summary: 'Delete a ShExMap' },
    preHandler: [fastify.requireAuth],
  }, async (request, reply) => {
    const { id } = ShExMapIdSchema.parse(request.params);
    const existing = await getShExMap(fastify, id);
    if (!existing) return reply.notFound(`ShExMap ${id} not found`);
    await deleteShExMap(fastify, id);
    return reply.code(204).send();
  });

  // ── Version routes ──────────────────────────────────────────────────────────

  // GET /shexmaps/:id/versions — list all versions (metadata only)
  fastify.get('/:id/versions', {
    schema: { tags: ['shexmaps'], summary: 'List versions of a ShExMap' },
  }, async (request, reply) => {
    const { id } = ShExMapIdSchema.parse(request.params);
    const existing = await getShExMap(fastify, id);
    if (!existing) return reply.notFound(`ShExMap ${id} not found`);
    return listVersions(fastify, id);
  });

  // POST /shexmaps/:id/versions — save a new version
  fastify.post('/:id/versions', {
    schema: { tags: ['shexmaps'], summary: 'Save a new version of a ShExMap' },
    preHandler: [fastify.requireAuth],
  }, async (request, reply) => {
    const { id } = ShExMapIdSchema.parse(request.params);
    const existing = await getShExMap(fastify, id);
    if (!existing) return reply.notFound(`ShExMap ${id} not found`);
    const { content, commitMessage } = SaveVersionSchema.parse(request.body);
    const authorId = config.auth.enabled
      ? (request.user as { sub: string }).sub
      : 'anonymous';
    const version = await saveNewVersion(fastify, config.filesDir, id, authorId, content, commitMessage);
    return reply.code(201).send(version);
  });

  // GET /shexmaps/:id/versions/:vn — get a specific version with content
  fastify.get('/:id/versions/:vn', {
    schema: { tags: ['shexmaps'], summary: 'Get a specific version of a ShExMap' },
  }, async (request, reply) => {
    const { id } = ShExMapIdSchema.parse(request.params);
    const vn = parseInt((request.params as { vn: string }).vn, 10);
    if (isNaN(vn) || vn < 1) return reply.badRequest('Version number must be a positive integer');
    const version = await getVersion(fastify, id, vn);
    if (!version) return reply.notFound(`Version ${vn} of ShExMap ${id} not found`);
    const content = await getVersionContent(config.filesDir, id, vn);
    return { ...version, content };
  });

};

export default shexmapsRoutes;
