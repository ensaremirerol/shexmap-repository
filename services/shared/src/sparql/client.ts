import { SimpleClient } from 'sparql-http-client';
import type { Prefixes } from '../rdf/prefixes.js';
import { sparqlPrefixes } from '../rdf/prefixes.js';

export type { SimpleClient };
export type SparqlBinding = Record<string, { value: string; type: string; datatype?: string }>;

interface SparqlSelectResult {
  head: { vars: string[] };
  results: { bindings: SparqlBinding[] };
}

interface SparqlAskResult {
  boolean: boolean;
}

export function createSparqlClient(endpointUrl: string, updateUrl: string, accessToken: string): SimpleClient {
  return new SimpleClient({
    endpointUrl,
    updateUrl,
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

export async function sparqlSelect(
  client: SimpleClient,
  prefixes: Prefixes,
  query: string,
): Promise<SparqlBinding[]> {
  const fullQuery = `${sparqlPrefixes(prefixes)}\n${query}`;
  const res = await client.query.select(fullQuery, {
    headers: { Accept: 'application/sparql-results+json' },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`SPARQL SELECT failed (${res.status}): ${body}`);
  }
  const data = await res.json() as SparqlSelectResult;
  return data.results.bindings;
}

export async function sparqlUpdate(
  client: SimpleClient,
  prefixes: Prefixes,
  update: string,
): Promise<void> {
  const fullUpdate = `${sparqlPrefixes(prefixes)}\n${update}`;
  const res = await client.postUrlencoded(fullUpdate, { update: true });
  if (res && typeof (res as Response).ok !== 'undefined' && !(res as Response).ok) {
    const body = await (res as Response).text();
    throw new Error(`SPARQL UPDATE failed (${(res as Response).status}): ${body}`);
  }
}

export async function sparqlAsk(
  client: SimpleClient,
  prefixes: Prefixes,
  query: string,
): Promise<boolean> {
  const fullQuery = `${sparqlPrefixes(prefixes)}\n${query}`;
  const res = await client.query.ask(fullQuery, {
    headers: { Accept: 'application/sparql-results+json' },
  });
  if (!res.ok) throw new Error(`SPARQL ASK failed (${res.status})`);
  const data = await res.json() as SparqlAskResult;
  return data.boolean;
}
