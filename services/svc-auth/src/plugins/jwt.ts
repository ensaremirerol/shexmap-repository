import fp from 'fastify-plugin';
import fjwt from '@fastify/jwt';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { config } from '../config.js';

export interface JwtPayload {
  sub: string;
  role: 'user' | 'admin';
}

declare module 'fastify' {
  interface FastifyInstance {
    signToken(payload: JwtPayload): string;
    requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void>;
  }
  interface FastifyRequest {
    jwtUser?: JwtPayload;
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: JwtPayload;
    user: JwtPayload;
  }
}

export default fp(async (fastify) => {
  await fastify.register(fjwt, {
    secret: config.jwt.secret,
    sign: { expiresIn: config.jwt.expiry },
  });

  fastify.decorate('signToken', (payload: JwtPayload): string => {
    return fastify.jwt.sign(payload);
  });

  fastify.decorate('requireAuth', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!config.authEnabled) return;

    const authHeader = request.headers['authorization'];
    const apiKeyHeader = request.headers['x-api-key'];

    if (authHeader?.startsWith('Bearer ')) {
      try {
        await request.jwtVerify();
        request.jwtUser = request.user;
      } catch {
        return reply.unauthorized('Invalid or expired token');
      }
    } else if (typeof apiKeyHeader === 'string') {
      const { validateApiKey } = await import('../services/apikey.service.js');
      const userId = validateApiKey(apiKeyHeader);
      if (!userId) return reply.unauthorized('Invalid API key');
      request.jwtUser = { sub: userId, role: 'user' };
    } else {
      return reply.unauthorized('Authentication required');
    }
  });
});
