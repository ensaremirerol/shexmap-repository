import Fastify from 'fastify';
import sensible from '@fastify/sensible';
import { config } from './config.js';
import corsPlugin from './plugins/cors.js';
import authPlugin from './plugins/auth.js';
import healthRoutes from './routes/health.js';
import validateRoutes from './routes/validate.js';
import shexmapsRoutes from './routes/shexmaps.js';
import pairingsRoutes from './routes/pairings.js';
import coverageRoutes from './routes/coverage.js';
import schemasRoutes from './routes/schemas.js';
import authRoutes from './routes/auth.js';
import sparqlRoutes from './routes/sparql.js';

export async function buildServer() {
  const fastify = Fastify({
    logger: {
      level: config.logLevel,
      ...(process.env['NODE_ENV'] === 'development' ? { transport: { target: 'pino-pretty' } } : {}),
    },
  });

  await fastify.register(corsPlugin);
  await fastify.register(sensible);
  await fastify.register(authPlugin);

  await fastify.register(healthRoutes);
  await fastify.register(validateRoutes);
  await fastify.register(shexmapsRoutes);
  await fastify.register(pairingsRoutes);
  await fastify.register(coverageRoutes);
  await fastify.register(schemasRoutes);
  await fastify.register(authRoutes);
  await fastify.register(sparqlRoutes);

  return fastify;
}

export async function startServer() {
  const fastify = await buildServer();
  try {
    await fastify.listen({ port: config.port, host: '0.0.0.0' });
    fastify.log.info(`svc-gateway HTTP listening on :${config.port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}
