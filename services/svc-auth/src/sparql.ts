import { createSparqlClient, buildPrefixes } from '@shexmap/shared';
import { config } from './config.js';

export const sparqlClient = createSparqlClient(
  config.qlever.sparqlUrl,
  config.qlever.updateUrl,
  config.qlever.accessToken,
);

export const prefixes = buildPrefixes(config.baseNamespace);
