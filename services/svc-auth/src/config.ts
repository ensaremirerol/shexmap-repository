import 'dotenv/config';

const opt = (name: string, fallback: string) => process.env[name] ?? fallback;

export const config = {
  port: parseInt(opt('PORT', '50000'), 10),
  logLevel: opt('LOG_LEVEL', 'info'),
  authEnabled: opt('AUTH_ENABLED', 'false') === 'true',
  baseNamespace: opt('BASE_NAMESPACE', 'https://w3id.org/shexmap/'),

  jwt: {
    secret: opt('JWT_SECRET', 'dev-secret-change-in-production'),
    expiry: parseInt(opt('JWT_EXPIRY', '86400'), 10),
  },

  callbackBaseUrl: opt('OAUTH_CALLBACK_BASE_URL', 'http://localhost'),

  oauth: {
    github: {
      clientId: opt('OAUTH_GITHUB_CLIENT_ID', ''),
      clientSecret: opt('OAUTH_GITHUB_CLIENT_SECRET', ''),
    },
    orcid: {
      clientId: opt('OAUTH_ORCID_CLIENT_ID', ''),
      clientSecret: opt('OAUTH_ORCID_CLIENT_SECRET', ''),
    },
    google: {
      clientId: opt('OAUTH_GOOGLE_CLIENT_ID', ''),
      clientSecret: opt('OAUTH_GOOGLE_CLIENT_SECRET', ''),
    },
  },

  sqlitePath: opt('SQLITE_PATH', './data/auth.db'),

  qlever: {
    sparqlUrl: opt('QLEVER_SPARQL_URL', 'http://qlever:7001/sparql'),
    updateUrl: opt('QLEVER_UPDATE_URL', 'http://qlever:7001/update'),
    accessToken: opt('QLEVER_ACCESS_TOKEN', ''),
  },
} as const;
