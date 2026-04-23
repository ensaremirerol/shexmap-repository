import type { FastifyPluginAsync } from 'fastify';
import { config } from '../config.js';
import { sparqlClient, prefixes } from '../sparql.js';
import { upsertUser, registerUser, findUserByUsername, verifyPassword } from '../services/user.service.js';

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

  fastify.post('/register', async (request, reply) => {
    if (!config.authEnabled) return reply.badRequest('Auth is disabled');
    const { username, password, email = '' } = request.body as {
      username?: string; password?: string; email?: string;
    };
    if (!username || !password) return reply.badRequest('username and password are required');
    if (password.length < 8) return reply.badRequest('password must be at least 8 characters');

    try {
      const user = await registerUser(sparqlClient, prefixes, username, password, email);
      const token = fastify.signToken({ sub: user.id, role: 'user' });
      return reply.code(201).send({ token, user: { id: user.id, username: user.username, email: user.email } });
    } catch (err: any) {
      if (err.code === 'USERNAME_TAKEN') return reply.conflict('Username already taken');
      throw err;
    }
  });

  fastify.post('/login', async (request, reply) => {
    if (!config.authEnabled) return reply.badRequest('Auth is disabled');
    const { username, password } = request.body as { username?: string; password?: string };
    if (!username || !password) return reply.badRequest('username and password are required');

    const user = await findUserByUsername(username);
    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      return reply.unauthorized('Invalid username or password');
    }

    const token = fastify.signToken({ sub: user.id, role: 'user' });
    return { token, user: { id: user.id, username: user.username, email: user.email } };
  });

  // Redirect to provider-specific OAuth start path (registered by @fastify/oauth2 on this server)
  fastify.get('/login', async (request, reply) => {
    if (!config.authEnabled) return reply.badRequest('Auth is disabled');
    const { provider } = request.query as { provider?: string };
    const startPaths: Record<string, string> = {
      github: '/auth/login/github',
      google: '/auth/login/google',
      orcid:  '/auth/login/orcid',
    };
    const path = provider && startPaths[provider];
    if (!path) return reply.badRequest(`Unknown provider: ${provider}`);
    return reply.redirect(path);
  });

  fastify.get('/callback', async (request, reply) => {
    if (!config.authEnabled) return reply.badRequest('Auth is disabled');

    const { provider } = request.query as { provider?: string };
    if (!provider) return reply.badRequest('Missing provider');

    // @fastify/oauth2 reads the code from the request automatically
    let accessToken: string;
    try {
      let oauthToken: any;
      if (provider === 'github' && 'githubOAuth2' in fastify) {
        oauthToken = await (fastify as any).githubOAuth2.getAccessTokenFromAuthorizationCodeFlow(request);
      } else if (provider === 'google' && 'googleOAuth2' in fastify) {
        oauthToken = await (fastify as any).googleOAuth2.getAccessTokenFromAuthorizationCodeFlow(request);
      } else if (provider === 'orcid' && 'orcidOAuth2' in fastify) {
        oauthToken = await (fastify as any).orcidOAuth2.getAccessTokenFromAuthorizationCodeFlow(request);
      } else {
        return reply.badRequest(`Provider not configured: ${provider}`);
      }
      accessToken = oauthToken.token.access_token as string;
    } catch (err: any) {
      return reply.internalServerError(`OAuth token exchange failed: ${err.message}`);
    }

    let externalId: string;
    let name: string;
    let email: string;

    if (provider === 'github') {
      const profileRes = await fetch('https://api.github.com/user', {
        headers: { Authorization: `Bearer ${accessToken}`, 'User-Agent': 'shexmap' },
      });
      const profile = await profileRes.json() as any;
      externalId = `github:${profile.id}`;
      name = profile.name ?? profile.login ?? '';

      // GitHub may return null email when user has private email setting
      if (profile.email) {
        email = profile.email;
      } else {
        const emailsRes = await fetch('https://api.github.com/user/emails', {
          headers: { Authorization: `Bearer ${accessToken}`, 'User-Agent': 'shexmap' },
        });
        const emails = await emailsRes.json() as Array<{ email: string; primary: boolean; verified: boolean }>;
        email = emails.find(e => e.primary && e.verified)?.email ?? emails[0]?.email ?? '';
      }
    } else if (provider === 'google') {
      const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const data = await res.json() as any;
      externalId = `google:${data.id}`;
      name  = data.name ?? '';
      email = data.email ?? '';
    } else {
      // ORCID
      const res = await fetch('https://pub.orcid.org/v3.0/me', {
        headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
      });
      const data = await res.json() as any;
      externalId = `orcid:${data['orcid-identifier']?.path ?? ''}`;
      name  = data.person?.name?.['given-names']?.value ?? '';
      email = '';
    }

    const user = await upsertUser(sparqlClient, prefixes, externalId, name, email);
    const token = fastify.signToken({ sub: user.id, role: 'user' });

    // Redirect to SPA with token in fragment so it never hits the server log
    return reply.redirect(`${config.callbackBaseUrl}/#token=${token}`);
  });

  fastify.post('/logout', {
    preHandler: [fastify.requireAuth],
  }, async () => {
    return { message: 'Logged out' };
  });
};

export default authRoutes;
