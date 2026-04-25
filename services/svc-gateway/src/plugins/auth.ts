import fp from 'fastify-plugin';
import fjwt from '@fastify/jwt';
import type { FastifyRequest } from 'fastify';
import { config } from '../config.js';
import type { AuthContext } from '@shexmap/shared';

declare module 'fastify' {
  interface FastifyInstance {
    extractAuth(request: FastifyRequest): AuthContext;
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: string; role: 'user' | 'admin' };
    user: { sub: string; role: 'user' | 'admin' };
  }
}

export default fp(async (fastify) => {
  await fastify.register(fjwt, {
    secret: config.jwt.secret,
  });

  fastify.decorate('extractAuth', (request: FastifyRequest): AuthContext => {
    // Prefer Authorization header; fall back to auth_token cookie
    const authHeader = request.headers['authorization'];
    let rawToken: string | undefined;
    if (authHeader?.startsWith('Bearer ')) {
      rawToken = authHeader.slice(7);
    } else {
      const cookieHeader = (request.headers['cookie'] as string) ?? '';
      const match = cookieHeader.match(/(?:^|;\s*)auth_token=([^;]+)/);
      rawToken = match?.[1];
    }
    if (!rawToken) {
      return { userId: '', role: 'anonymous', authEnabled: config.authEnabled };
    }
    try {
      const payload = fastify.jwt.verify<{ sub: string; role: 'user' | 'admin' }>(rawToken);
      return {
        userId: payload.sub,
        role: payload.role ?? 'user',
        authEnabled: config.authEnabled,
      };
    } catch {
      return { userId: '', role: 'anonymous', authEnabled: config.authEnabled };
    }
  });
});
