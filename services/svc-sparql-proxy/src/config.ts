import 'dotenv/config';

const opt = (name: string, fallback: string) => process.env[name] ?? fallback;

export const config = {
  port: parseInt(opt('PORT', '50000'), 10),
  logLevel: opt('LOG_LEVEL', 'info'),
  authEnabled: opt('AUTH_ENABLED', 'false') === 'true',

  qlever: {
    sparqlUrl: opt('QLEVER_SPARQL_URL', 'http://qlever:7001/sparql'),
    updateUrl: opt('QLEVER_UPDATE_URL', 'http://qlever:7001/update'),
    accessToken: opt('QLEVER_ACCESS_TOKEN', ''),
  },
} as const;
