import { createSparqlClient, buildPrefixes } from '@shexmap/shared';
import { config } from './config.js';

export const sparqlClient = createSparqlClient(
  config.qleverSparqlUrl,
  config.qleverUpdateUrl,
  config.qleverAccessToken,
);

export const prefixes = buildPrefixes(config.baseNamespace);
