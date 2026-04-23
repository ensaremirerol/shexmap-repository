import fp from 'fastify-plugin';
import oauth2 from '@fastify/oauth2';
import type { FastifyInstance } from 'fastify';
import { config } from '../config.js';

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
        tokenHost:    'https://github.com',
        tokenPath:    '/login/oauth/access_token',
        authorizePath: '/login/oauth/authorize',
      },
    },
    startRedirectPath: '/auth/login/github',
    callbackUri: `${config.callbackBaseUrl}/api/v1/auth/callback?provider=github`,
    scope: ['read:user', 'user:email'],
  });
});
