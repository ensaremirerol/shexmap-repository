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
    const authHeader = request.headers['authorization'];
    if (!authHeader?.startsWith('Bearer ')) {
      return { userId: '', role: 'anonymous', authEnabled: config.authEnabled };
    }
    try {
      const payload = fastify.jwt.verify<{ sub: string; role: 'user' | 'admin' }>(
        authHeader.slice(7),
      );
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
