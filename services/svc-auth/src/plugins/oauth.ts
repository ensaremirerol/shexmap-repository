import fp from 'fastify-plugin';
import oauth2 from '@fastify/oauth2';
import type { FastifyInstance } from 'fastify';
import { config } from '../config.js';

export default fp(async (fastify: FastifyInstance) => {
  if (!config.authEnabled) return;

  if (config.oauth.github.clientId) {
    await fastify.register(oauth2, {
      name: 'githubOAuth2',
      credentials: {
        client: {
          id:     config.oauth.github.clientId,
          secret: config.oauth.github.clientSecret,
        },
        auth: oauth2.GITHUB_CONFIGURATION,
      },
      startRedirectPath: '/auth/login/github',
      callbackUri: `${config.callbackBaseUrl}/auth/callback?provider=github`,
      scope: ['read:user', 'user:email'],
    });
  }

  if (config.oauth.google.clientId) {
    await fastify.register(oauth2, {
      name: 'googleOAuth2',
      credentials: {
        client: {
          id:     config.oauth.google.clientId,
          secret: config.oauth.google.clientSecret,
        },
        auth: oauth2.GOOGLE_CONFIGURATION,
      },
      startRedirectPath: '/auth/login/google',
      callbackUri: `${config.callbackBaseUrl}/auth/callback?provider=google`,
      scope: ['profile', 'email'],
    });
  }

  if (config.oauth.orcid.clientId) {
    await fastify.register(oauth2, {
      name: 'orcidOAuth2',
      credentials: {
        client: {
          id:     config.oauth.orcid.clientId,
          secret: config.oauth.orcid.clientSecret,
        },
        auth: {
          authorizeHost: 'https://orcid.org',
          authorizePath: '/oauth/authorize',
          tokenHost:     'https://orcid.org',
          tokenPath:     '/oauth/token',
        },
      },
      startRedirectPath: '/auth/login/orcid',
      callbackUri: `${config.callbackBaseUrl}/auth/callback?provider=orcid`,
      scope: ['/authenticate'],
    });
  }
});
