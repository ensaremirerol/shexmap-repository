import Fastify from 'fastify';
import cors from '@fastify/cors';
import sensible from '@fastify/sensible';
import { config } from './config.js';
import jwtPlugin from './plugins/jwt.js';
import oauthPlugin from './plugins/oauth.js';
import healthRoutes from './routes/health.js';
import authRoutes from './routes/auth.js';
import usersRoutes from './routes/users.js';

export async function buildServer() {
  const fastify = Fastify({
    logger: {
      level: config.logLevel,
      ...(process.env['NODE_ENV'] === 'development' ? { transport: { target: 'pino-pretty' } } : {}),
    },
  });

  await fastify.register(cors);
  await fastify.register(sensible);
  await fastify.register(jwtPlugin);
  await fastify.register(oauthPlugin);

  await fastify.register(healthRoutes);
  await fastify.register(authRoutes, { prefix: '/auth' });
  await fastify.register(usersRoutes, { prefix: '/users' });

  return fastify;
}

export async function startServer() {
  const fastify = await buildServer();
  try {
    await fastify.listen({ port: config.port, host: '0.0.0.0' });
    fastify.log.info(`svc-auth HTTP listening on :${config.port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}
