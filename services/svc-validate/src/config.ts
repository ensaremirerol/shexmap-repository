import 'dotenv/config';

const opt = (name: string, fallback: string) => process.env[name] ?? fallback;

export const config = {
  port:         parseInt(opt('PORT', '50051'), 10),
  logLevel:     opt('LOG_LEVEL', 'info'),
  baseNamespace: opt('BASE_NAMESPACE', 'https://w3id.org/shexmap/'),
} as const;
