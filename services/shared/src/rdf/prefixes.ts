export const DEFAULT_BASE = 'https://w3id.org/shexmap/';

export function buildPrefixes(base: string = DEFAULT_BASE) {
  return {
    shexmap:      `${base}ontology#`,
    shexr:        `${base}resource/`,
    shexrmap:     `${base}resource/map/`,
    shexrschema:  `${base}resource/schema/`,
    shexruser:    `${base}resource/user/`,
    shexrpair:    `${base}resource/pairing/`,
    shexrversion: `${base}resource/version/`,
    shexrauth:    `${base}resource/auth/`,
    acl:    'http://www.w3.org/ns/auth/acl#',
    shex:   'http://www.w3.org/ns/shex#',
    dcat:   'http://www.w3.org/ns/dcat#',
    dct:    'http://purl.org/dc/terms/',
    prov:   'http://www.w3.org/ns/prov#',
    schema: 'https://schema.org/',
    xsd:    'http://www.w3.org/2001/XMLSchema#',
    rdf:    'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
    rdfs:   'http://www.w3.org/2000/01/rdf-schema#',
  } as const;
}

export type Prefixes = ReturnType<typeof buildPrefixes>;
export type PrefixKey = keyof Prefixes;

export function expand(prefixed: string, prefixes: Prefixes): string {
  const [prefix, local] = prefixed.split(':');
  const base = prefixes[prefix as PrefixKey];
  if (!base) throw new Error(`Unknown prefix: ${prefix}`);
  return `${base}${local}`;
}

export function sparqlPrefixes(prefixes: Prefixes): string {
  return Object.entries(prefixes)
    .map(([k, v]) => `PREFIX ${k}: <${v}>`)
    .join('\n');
}
