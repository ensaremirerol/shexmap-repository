import type { FastifyPluginAsync } from 'fastify';
import { request as undiciRequest } from 'undici';
import { config } from '../config.js';

// undici.request() does NOT follow redirects (unlike fetch()), so 302s from
// svc-auth are passed straight to the browser with full access to status/headers.
const authRoutes: FastifyPluginAsync = async (fastify) => {

  const proxyTo = async (
    request: import('fastify').FastifyRequest,
    reply: import('fastify').FastifyReply,
    targetPath: string,
  ) => {
    const url = new URL(targetPath, config.svcAuthUrl);
    if (request.url.includes('?')) {
      url.search = request.url.split('?')[1] ?? '';
    }

    const headers: Record<string, string> = { 'x-forwarded-host': request.hostname };
    for (const [k, v] of Object.entries(request.headers)) {
      if (typeof v === 'string') headers[k] = v;
    }

    const body = ['GET', 'HEAD'].includes(request.method)
      ? undefined
      : JSON.stringify(request.body);

    const res = await undiciRequest(url.toString(), {
      method: request.method as any,
      headers,
      body,
      // undici.request() does not follow redirects by default (maxRedirections defaults to 0)
    });

    reply.code(res.statusCode);
    for (const [k, v] of Object.entries(res.headers)) {
      if (k === 'transfer-encoding') continue;
      const val = Array.isArray(v) ? v.join(', ') : v;
      if (!val) continue;
      // Rewrite internal svc-auth redirect paths to public gateway paths
      // e.g. Location: /auth/login/github → /api/v1/auth/login/github
      if (k === 'location' && val.startsWith('/auth/')) {
        reply.header(k, `/api/v1${val}`);
        continue;
      }
      reply.header(k, val);
    }

    return reply.send(await res.body.text());
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
