import 'dotenv/config';

function required(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required environment variable: ${name}`);
  return val;
}

function optional(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

export const config = {
  env: optional('NODE_ENV', 'development'),
  port: parseInt(optional('PORT', '3000'), 10),
  logLevel: optional('LOG_LEVEL', 'info'),

  auth: {
    enabled: optional('AUTH_ENABLED', 'false') === 'true',
    jwtSecret: optional('JWT_SECRET', 'dev-secret-change-in-production'),
    jwtExpiry: parseInt(optional('JWT_EXPIRY', '86400'), 10),
    callbackBaseUrl: optional('OAUTH_CALLBACK_BASE_URL', 'http://localhost'),
    github: {
      clientId: process.env['OAUTH_GITHUB_CLIENT_ID'] ?? '',
      clientSecret: process.env['OAUTH_GITHUB_CLIENT_SECRET'] ?? '',
    },
    orcid: {
      clientId: process.env['OAUTH_ORCID_CLIENT_ID'] ?? '',
      clientSecret: process.env['OAUTH_ORCID_CLIENT_SECRET'] ?? '',
    },
    google: {
      clientId: process.env['OAUTH_GOOGLE_CLIENT_ID'] ?? '',
      clientSecret: process.env['OAUTH_GOOGLE_CLIENT_SECRET'] ?? '',
    },
  },

  qlever: {
    sparqlUrl: optional('QLEVER_SPARQL_URL', 'http://qlever:7001/sparql'),
    updateUrl: optional('QLEVER_UPDATE_URL', 'http://qlever:7001/update'),
    accessToken: optional('QLEVER_ACCESS_TOKEN', ''),
  },

  rateLimit: {
    max: parseInt(optional('RATE_LIMIT_MAX', '200'), 10),
    timeWindow: optional('RATE_LIMIT_WINDOW', '1 minute'),
  },

  rdf: {
    /** Base namespace for all project IRIs, e.g. https://w3id.org/shexmap/ */
    baseNamespace: optional('BASE_NAMESPACE', 'https://w3id.org/shexmap/'),
  },

} as const;
