import { v4 as uuidv4 } from 'uuid';
import { sparqlAsk, sparqlSelect, sparqlUpdate } from '@shexmap/shared';
import type { Prefixes, SimpleClient } from '@shexmap/shared';

// ── constants ────────────────────────────────────────────────────────────────

export const ACL_GRAPH = 'https://w3id.org/shexmap/acl';
export const SUPPORTED_MODES = ['Write'] as const;
export type AclMode = typeof SUPPORTED_MODES[number];

export interface Authorization {
  authorizationIri: string;
  resourceIri:      string;
  agentIri:         string;
  mode:             string;
}

// ── helpers ──────────────────────────────────────────────────────────────────

function assertSupportedMode(mode: string): asserts mode is AclMode {
  if (!SUPPORTED_MODES.includes(mode as AclMode)) {
    throw new Error(
      `Unsupported ACL mode: ${mode}. Supported: ${SUPPORTED_MODES.join(', ')}`,
    );
  }
}

// ── operations ───────────────────────────────────────────────────────────────

export async function hasMode(
  client: SimpleClient,
  prefixes: Prefixes,
  resourceIri: string,
  agentIri: string,
  mode: AclMode,
): Promise<boolean> {
  assertSupportedMode(mode);
  const query = `
    ASK {
      GRAPH <${ACL_GRAPH}> {
        ?auth a acl:Authorization ;
              acl:accessTo <${resourceIri}> ;
              acl:agent    <${agentIri}> ;
              acl:mode     acl:${mode} .
      }
    }
  `;
  return sparqlAsk(client, prefixes, query);
}

export async function grantMode(
  client: SimpleClient,
  prefixes: Prefixes,
  resourceIri: string,
  agentIri: string,
  mode: AclMode,
): Promise<{ authorizationIri: string }> {
  assertSupportedMode(mode);

  // Idempotency: if an authorization with this exact (resource, agent, mode)
  // already exists, return its IRI without inserting a duplicate node.
  const existing = await listAuthorizations(client, prefixes, resourceIri);
  const match = existing.find(
    (a) => a.agentIri === agentIri && a.mode === mode,
  );
  if (match) {
    return { authorizationIri: match.authorizationIri };
  }

  const authorizationIri = `${prefixes.shexrauth}${uuidv4()}`;
  const update = `
    INSERT DATA {
      GRAPH <${ACL_GRAPH}> {
        <${authorizationIri}> a acl:Authorization ;
                              acl:accessTo <${resourceIri}> ;
                              acl:agent    <${agentIri}> ;
                              acl:mode     acl:${mode} .
      }
    }
  `;
  await sparqlUpdate(client, prefixes, update);
  return { authorizationIri };
}

export async function revokeMode(
  client: SimpleClient,
  prefixes: Prefixes,
  resourceIri: string,
  agentIri: string,
  mode: AclMode,
): Promise<{ deletedCount: number }> {
  assertSupportedMode(mode);

  // Count what will be deleted (best-effort — nothing here is transactional).
  const existing = await listAuthorizations(client, prefixes, resourceIri);
  const matchingAuths = existing.filter(
    (a) => a.agentIri === agentIri && a.mode === mode,
  );

  const update = `
    DELETE { GRAPH <${ACL_GRAPH}> { ?auth ?p ?o } }
    WHERE  { GRAPH <${ACL_GRAPH}> {
      ?auth a acl:Authorization ;
            acl:accessTo <${resourceIri}> ;
            acl:agent    <${agentIri}> ;
            acl:mode     acl:${mode} ;
            ?p ?o .
    } }
  `;
  await sparqlUpdate(client, prefixes, update);
  return { deletedCount: matchingAuths.length };
}

export async function listAuthorizations(
  client: SimpleClient,
  prefixes: Prefixes,
  resourceIri: string,
): Promise<Authorization[]> {
  const query = `
    SELECT ?auth ?agent ?mode WHERE {
      GRAPH <${ACL_GRAPH}> {
        ?auth a acl:Authorization ;
              acl:accessTo <${resourceIri}> ;
              acl:agent    ?agent ;
              acl:mode     ?mode .
      }
    }
  `;
  const rows = await sparqlSelect(client, prefixes, query);
  return rows.map((row) => {
    const modeIri = row['mode']?.value ?? '';
    // strip the acl: prefix to return a bare mode token (e.g. "Write")
    const aclPrefix = prefixes.acl;
    const mode = modeIri.startsWith(aclPrefix)
      ? modeIri.slice(aclPrefix.length)
      : modeIri;
    return {
      authorizationIri: row['auth']?.value ?? '',
      resourceIri,
      agentIri:         row['agent']?.value ?? '',
      mode,
    };
  });
}

export async function purgeResource(
  client: SimpleClient,
  prefixes: Prefixes,
  resourceIri: string,
): Promise<{ deletedCount: number }> {
  // Count authorization nodes about to be removed.
  const existing = await listAuthorizations(client, prefixes, resourceIri);

  const update = `
    DELETE { GRAPH <${ACL_GRAPH}> { ?auth ?p ?o } }
    WHERE  { GRAPH <${ACL_GRAPH}> {
      ?auth a acl:Authorization ;
            acl:accessTo <${resourceIri}> ;
            ?p ?o .
    } }
  `;
  await sparqlUpdate(client, prefixes, update);
  return { deletedCount: existing.length };
}
