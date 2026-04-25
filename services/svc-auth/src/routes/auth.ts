import type { FastifyPluginAsync } from 'fastify';
import { config } from '../config.js';
import { sparqlClient, prefixes } from '../sparql.js';
import { upsertUser } from '../services/user.service.js';

const authRoutes: FastifyPluginAsync = async (fastify) => {

  fastify.get('/status', async (request) => {
    if (!config.authEnabled) {
      return { enabled: false, authenticated: false, user: null };
    }
    try {
      await request.jwtVerify();
      return { enabled: true, authenticated: true, user: request.user };
    } catch {
      return { enabled: true, authenticated: false, user: null };
    }
  });

  // GitHub OAuth callback — exchanges code for token, upserts user, redirects to SPA
  fastify.get('/callback', async (request, reply) => {
    if (!config.authEnabled) return reply.badRequest('Auth is disabled');

    try {
      const oauthToken = await (fastify as any).githubOAuth2.getAccessTokenFromAuthorizationCodeFlow(request);
      const accessToken = oauthToken.token.access_token as string;

      const profileRes = await fetch('https://api.github.com/user', {
        headers: { Authorization: `Bearer ${accessToken}`, 'User-Agent': 'shexmap' },
      });
      const profile = await profileRes.json() as any;
      const externalId = `github:${profile.id}`;
      const name = profile.name ?? profile.login ?? '';

      // GitHub may return null email when user has private email setting
      let email = profile.email ?? '';
      if (!email) {
        const emailsRes = await fetch('https://api.github.com/user/emails', {
          headers: { Authorization: `Bearer ${accessToken}`, 'User-Agent': 'shexmap' },
        });
        const emails = await emailsRes.json() as Array<{ email: string; primary: boolean; verified: boolean }>;
        email = emails.find(e => e.primary && e.verified)?.email ?? emails[0]?.email ?? '';
      }

      const user = await upsertUser(sparqlClient, prefixes, externalId, name, email);
      const token = fastify.signToken({ sub: user.id, role: 'user' });

      reply.setCookie('auth_token', token, {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        maxAge: config.jwt.expiry,
      });
      return reply.redirect(`${config.callbackBaseUrl}/auth/callback`);
    } catch (err: any) {
      return reply.internalServerError(`OAuth callback failed: ${err.message}`);
    }
  });

  fastify.post('/logout', {
    preHandler: [fastify.requireAuth],
  }, async (_request, reply) => {
    reply.clearCookie('auth_token', { path: '/' });
    return { message: 'Logged out' };
  });
};

export default authRoutes;
