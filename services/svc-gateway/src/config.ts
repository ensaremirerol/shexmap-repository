import 'dotenv/config';

const opt = (name: string, fallback: string) => process.env[name] ?? fallback;

export const config = {
  port: parseInt(opt('PORT', '50000'), 10),
  logLevel: opt('LOG_LEVEL', 'info'),
  authEnabled: opt('AUTH_ENABLED', 'false') === 'true',

  jwt: {
    secret: opt('JWT_SECRET', 'dev-secret-change-in-production'),
  },

  svcValidateAddr:    opt('SVC_VALIDATE_ADDR',    'svc-validate:50000'),
  svcShexmapAddr:     opt('SVC_SHEXMAP_ADDR',     'svc-shexmap:50000'),
  svcPairingAddr:     opt('SVC_PAIRING_ADDR',     'svc-pairing:50000'),
  svcCoverageAddr:    opt('SVC_COVERAGE_ADDR',    'svc-coverage:50000'),
  svcSchemaAddr:      opt('SVC_SCHEMA_ADDR',      'svc-schema:50000'),
  svcAuthUrl:         opt('SVC_AUTH_URL',         'http://svc-auth:50000'),
  svcSparqlProxyUrl:  opt('SVC_SPARQL_PROXY_URL', 'http://svc-sparql-proxy:50000'),
} as const;
