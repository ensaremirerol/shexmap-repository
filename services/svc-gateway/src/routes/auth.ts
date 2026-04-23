import type { FastifyPluginAsync } from 'fastify';
import { config } from '../config.js';

const authRoutes: FastifyPluginAsync = async (fastify) => {

  const proxyTo = async (
    request: import('fastify').FastifyRequest,
    reply: import('fastify').FastifyReply,
    targetPath: string,
  ) => {
    const url = new URL(targetPath, config.svcAuthUrl);
    if (request.url.includes('?')) {
      const qs = request.url.split('?')[1];
      url.search = qs ?? '';
    }

    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(request.headers)) {
      if (typeof v === 'string') headers[k] = v;
    }
    headers['x-forwarded-host'] = request.hostname;

    const res = await fetch(url.toString(), {
      method: request.method,
      headers,
      body: ['GET', 'HEAD'].includes(request.method) ? undefined : JSON.stringify(request.body),
    });

    reply.code(res.status);
    for (const [k, v] of res.headers.entries()) {
      if (k.toLowerCase() !== 'transfer-encoding') reply.header(k, v);
    }
    const text = await res.text();
    return reply.send(text);
  };

  fastify.all('/api/v1/auth/*', async (request, reply) => {
    const sub = (request.params as Record<string, string>)['*'] ?? '';
    return proxyTo(request, reply, `/auth/${sub}`);
  });

  fastify.all('/api/v1/users/*', async (request, reply) => {
    const sub = (request.params as Record<string, string>)['*'] ?? '';
    return proxyTo(request, reply, `/users/${sub}`);
  });

};

export default authRoutes;
