import type { FastifyPluginAsync } from 'fastify';
import { config } from '../config.js';

const sparqlRoutes: FastifyPluginAsync = async (fastify) => {

  const proxyToSparql = async (
    request: import('fastify').FastifyRequest,
    reply: import('fastify').FastifyReply,
  ) => {
    const ctx = fastify.extractAuth(request);
    const url = new URL('/sparql', config.svcSparqlProxyUrl);
    if (request.url.includes('?')) {
      const qs = request.url.split('?')[1];
      url.search = qs ?? '';
    }

    const headers: Record<string, string> = { 'x-auth-user-id': ctx.userId };
    for (const [k, v] of Object.entries(request.headers)) {
      if (typeof v === 'string') headers[k] = v;
    }

    const res = await fetch(url.toString(), {
      method: request.method,
      headers,
      body: ['GET', 'HEAD'].includes(request.method) ? undefined : (request.body as string),
    });

    reply.code(res.status);
    for (const [k, v] of res.headers.entries()) {
      if (k.toLowerCase() !== 'transfer-encoding') reply.header(k, v);
    }
    return reply.send(await res.text());
  };

  fastify.get('/sparql', async (request, reply) => proxyToSparql(request, reply));
  fastify.post('/sparql', async (request, reply) => proxyToSparql(request, reply));

};

export default sparqlRoutes;
