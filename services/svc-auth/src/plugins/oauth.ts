import fp from 'fastify-plugin';
import oauth2 from '@fastify/oauth2';
import type { FastifyInstance } from 'fastify';
import type { ProviderConfiguration } from '@fastify/oauth2';

const GITHUB_CONFIGURATION: ProviderConfiguration = {
  tokenHost: 'https://github.com',
  tokenPath: '/login/oauth/access_token',
  authorizePath: '/login/oauth/authorize',
};

const GOOGLE_CONFIGURATION: ProviderConfiguration = {
  authorizeHost: 'https://accounts.google.com',
  authorizePath: '/o/oauth2/v2/auth',
  tokenHost: 'https://www.googleapis.com',
  tokenPath: '/oauth2/v4/token',
};
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
        auth: GITHUB_CONFIGURATION,
      },
      startRedirectPath: '/auth/login/github',
      callbackUri: `${config.callbackBaseUrl}/api/v1/auth/callback?provider=github`,
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
        auth: GOOGLE_CONFIGURATION,
      },
      startRedirectPath: '/auth/login/google',
      callbackUri: `${config.callbackBaseUrl}/api/v1/auth/callback?provider=google`,
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
      callbackUri: `${config.callbackBaseUrl}/api/v1/auth/callback?provider=orcid`,
      scope: ['/authenticate'],
    });
  }
});
