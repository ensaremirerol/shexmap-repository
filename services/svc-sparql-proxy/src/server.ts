import Fastify from 'fastify';
import cors from '@fastify/cors';
import sensible from '@fastify/sensible';
import { config } from './config.js';
import healthRoutes from './routes/health.js';
import sparqlRoutes from './routes/sparql.js';

export async function buildServer() {
  const fastify = Fastify({
    logger: {
      level: config.logLevel,
      ...(process.env['NODE_ENV'] === 'development' ? { transport: { target: 'pino-pretty' } } : {}),
    },
  });

  await fastify.register(cors);
  await fastify.register(sensible);

  fastify.addContentTypeParser('*', { parseAs: 'string' }, (_req, body, done) => {
    done(null, body);
  });

  await fastify.register(healthRoutes);
  await fastify.register(sparqlRoutes);

  return fastify;
}

export async function startServer() {
  const fastify = await buildServer();
  try {
    await fastify.listen({ port: config.port, host: '0.0.0.0' });
    fastify.log.info(`svc-sparql-proxy HTTP listening on :${config.port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}
