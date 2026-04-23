import 'dotenv/config';

const opt = (name: string, fallback: string) => process.env[name] ?? fallback;

export const config = {
  port:                   parseInt(opt('PORT', '50000'), 10),
  logLevel:               opt('LOG_LEVEL', 'info'),
  baseNamespace:          opt('BASE_NAMESPACE', 'https://w3id.org/shexmap/'),
  qleverSparqlUrl:        opt('QLEVER_SPARQL_URL', 'http://qlever:7001/api/'),
  qleverUpdateUrl:        opt('QLEVER_UPDATE_URL', 'http://qlever:7001/api/'),
  qleverAccessToken:      opt('QLEVER_ACCESS_TOKEN', ''),
  svcShexmapUrl:          opt('SVC_SHEXMAP_URL', 'svc-shexmap:50052'),
  strictMapExistsCheck:   opt('STRICT_MAP_EXISTS_CHECK', 'false') === 'true',
} as const;
