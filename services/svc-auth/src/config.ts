import 'dotenv/config';

const opt = (name: string, fallback: string) => process.env[name] ?? fallback;

export const config = {
  port: parseInt(opt('PORT', '50000'), 10),
  logLevel: opt('LOG_LEVEL', 'info'),
  githubClientId:  opt('OAUTH_GITHUB_CLIENT_ID', ''),
  githubClientSecret: opt('OAUTH_GITHUB_CLIENT_SECRET', ''),
  // Auth is enabled when a GitHub client ID is present — no separate flag needed
  get authEnabled() { return !!this.githubClientId; },

  baseNamespace: opt('BASE_NAMESPACE', 'https://w3id.org/shexmap/'),

  jwt: {
    secret: opt('JWT_SECRET', 'dev-secret-change-in-production'),
    expiry: parseInt(opt('JWT_EXPIRY', '86400'), 10),
  },

  callbackBaseUrl: opt('OAUTH_CALLBACK_BASE_URL', 'http://localhost:8090'),

  sqlitePath: opt('SQLITE_PATH', './data/auth.db'),

  qlever: {
    sparqlUrl: opt('QLEVER_SPARQL_URL', 'http://qlever:7001/sparql'),
    updateUrl: opt('QLEVER_UPDATE_URL', 'http://qlever:7001/update'),
    accessToken: opt('QLEVER_ACCESS_TOKEN', ''),
  },
} as const;
