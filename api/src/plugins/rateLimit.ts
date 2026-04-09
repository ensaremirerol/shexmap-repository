import fp from 'fastify-plugin';
import rateLimit from '@fastify/rate-limit';
import { config } from '../config.js';

export default fp(async (fastify) => {
  await fastify.register(rateLimit, {
    max: config.rateLimit.max,
    timeWindow: config.rateLimit.timeWindow,
  });
});
