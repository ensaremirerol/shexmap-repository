import type { FastifyPluginAsync } from 'fastify';
import { config } from '../config.js';

const sparqlRoutes: FastifyPluginAsync = async (fastify) => {

  fastify.get('/sparql', async (request, reply) => {
    const queryString = new URLSearchParams(request.query as Record<string, string>).toString();
    const headers: Record<string, string> = {
      Accept: (request.headers['accept'] as string) ?? 'application/sparql-results+json',
    };
    if (config.qlever.accessToken) {
      headers['access-token'] = config.qlever.accessToken;
    }
    const res = await fetch(`${config.qlever.sparqlUrl}?${queryString}`, { headers });
    reply.code(res.status);
    reply.header('Content-Type', res.headers.get('content-type') ?? 'application/json');
    return reply.send(await res.text());
  });

  fastify.post('/sparql', async (request, reply) => {
    if (config.authEnabled && !request.headers['x-auth-user-id']) {
      return reply.unauthorized('Authentication required for SPARQL updates');
    }
    const headers: Record<string, string> = {
      'Content-Type': (request.headers['content-type'] as string) ?? 'application/sparql-update',
    };
    if (config.qlever.accessToken) {
      headers['access-token'] = config.qlever.accessToken;
    }
    const res = await fetch(config.qlever.updateUrl, {
      method: 'POST',
      headers,
      body: request.body as string,
    });
    reply.code(res.status);
    return reply.send(await res.text());
  });

};

export default sparqlRoutes;
