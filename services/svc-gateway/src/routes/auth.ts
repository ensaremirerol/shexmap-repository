import type { FastifyPluginAsync } from 'fastify';
import httpProxy from '@fastify/http-proxy';
import { config } from '../config.js';

const authRoutes: FastifyPluginAsync = async (fastify) => {

  // Proxy /api/v1/auth/* → svc-auth /auth/*
  // @fastify/http-proxy uses undici with maxRedirections:0, so 302s from
  // svc-auth (e.g. OAuth start redirects) are passed straight to the browser
  // rather than followed internally. Location headers with internal paths are
  // rewritten to go through the public /api/v1/ prefix so the browser can
  // follow them through nginx → gateway.
  await fastify.register(httpProxy, {
    upstream: config.svcAuthUrl,
    prefix: '/api/v1/auth',
    rewritePrefix: '/auth',
    replyOptions: {
      rewriteHeaders: (headers) => {
        const loc = headers['location'];
        if (typeof loc === 'string' && loc.startsWith('/auth/')) {
          return { ...headers, location: `/api/v1${loc}` };
        }
        return headers;
      },
    },
  });

  // Proxy /api/v1/users/* → svc-auth /users/*
  await fastify.register(httpProxy, {
    upstream: config.svcAuthUrl,
    prefix: '/api/v1/users',
    rewritePrefix: '/users',
  });

};

export default authRoutes;
