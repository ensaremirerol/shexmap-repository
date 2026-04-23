import fp from 'fastify-plugin';
import oauth2 from '@fastify/oauth2';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { randomBytes } from 'node:crypto';
import { config } from '../config.js';

// Store state server-side so cookie forwarding through the gateway is not required.
// Keys expire after 10 minutes to avoid unbounded growth.
const pendingStates = new Map<string, number>();
const STATE_TTL_MS = 10 * 60 * 1000;

function pruneStates() {
  const cutoff = Date.now() - STATE_TTL_MS;
  for (const [k, ts] of pendingStates) {
    if (ts < cutoff) pendingStates.delete(k);
  }
}

export default fp(async (fastify: FastifyInstance) => {
  if (!config.authEnabled) return;

  await fastify.register(oauth2, {
    name: 'githubOAuth2',
    credentials: {
      client: {
        id:     config.githubClientId,
        secret: config.githubClientSecret,
      },
      auth: {
        tokenHost:     'https://github.com',
        tokenPath:     '/login/oauth/access_token',
        authorizePath: '/login/oauth/authorize',
      },
    },
    startRedirectPath: '/auth/login/github',
    callbackUri: `${config.callbackBaseUrl}/api/v1/auth/callback?provider=github`,
    scope: ['read:user', 'user:email'],
    generateStateFunction: (_request: FastifyRequest) => {
      pruneStates();
      const state = randomBytes(16).toString('hex');
      pendingStates.set(state, Date.now());
      return state;
    },
    checkStateFunction: (request: FastifyRequest, callback: (err?: Error) => void) => {
      const state = (request.query as Record<string, string>)['state'];
      if (state && pendingStates.has(state)) {
        pendingStates.delete(state);
        callback();
      } else {
        callback(new Error('Invalid or expired state'));
      }
    },
  });
});
