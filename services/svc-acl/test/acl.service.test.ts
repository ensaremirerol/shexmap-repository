import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@shexmap/shared', async (importOriginal) => {
  const mod = await importOriginal() as object;
  return {
    ...mod,
    sparqlAsk:    vi.fn(),
    sparqlSelect: vi.fn(),
    sparqlUpdate: vi.fn(),
  };
});

import {
  buildPrefixes,
  sparqlAsk,
  sparqlSelect,
  sparqlUpdate,
  createSparqlClient,
} from '@shexmap/shared';
import {
  ACL_GRAPH,
  grantMode,
  hasMode,
  listAuthorizations,
  purgeResource,
  revokeMode,
} from '../src/services/acl.service.js';

const mockClient = {} as ReturnType<typeof createSparqlClient>;
const prefixes = buildPrefixes('https://w3id.org/shexmap/');

const RESOURCE = 'https://w3id.org/shexmap/resource/map/abc-123';
const AGENT    = 'https://w3id.org/shexmap/resource/user/u-456';

beforeEach(() => {
  vi.mocked(sparqlAsk).mockReset();
  vi.mocked(sparqlSelect).mockReset();
  vi.mocked(sparqlUpdate).mockReset();
});

describe('hasMode', () => {
  it('issues ASK against the ACL graph and returns its boolean', async () => {
    vi.mocked(sparqlAsk).mockResolvedValue(true);

    const result = await hasMode(mockClient, prefixes, RESOURCE, AGENT, 'Write');

    expect(result).toBe(true);
    expect(sparqlAsk).toHaveBeenCalledTimes(1);
    const [, , query] = vi.mocked(sparqlAsk).mock.calls[0];
    expect(query).toContain('ASK');
    expect(query).toContain(`GRAPH <${ACL_GRAPH}>`);
    expect(query).toContain(`acl:accessTo <${RESOURCE}>`);
    expect(query).toContain(`acl:agent    <${AGENT}>`);
    expect(query).toContain('acl:mode     acl:Write');
  });

  it('returns false when sparqlAsk says false', async () => {
    vi.mocked(sparqlAsk).mockResolvedValue(false);
    const result = await hasMode(mockClient, prefixes, RESOURCE, AGENT, 'Write');
    expect(result).toBe(false);
  });

  it('throws on unsupported mode', async () => {
    await expect(
      hasMode(mockClient, prefixes, RESOURCE, AGENT, 'Read' as any),
    ).rejects.toThrow(/Unsupported ACL mode/);
    expect(sparqlAsk).not.toHaveBeenCalled();
  });
});

describe('grantMode', () => {
  it('issues INSERT DATA with a UUID-shaped Authorization IRI when no duplicate exists', async () => {
    vi.mocked(sparqlSelect).mockResolvedValue([]);
    vi.mocked(sparqlUpdate).mockResolvedValue(undefined);

    const { authorizationIri } = await grantMode(
      mockClient, prefixes, RESOURCE, AGENT, 'Write',
    );

    expect(authorizationIri.startsWith(prefixes.shexrauth)).toBe(true);
    const uuid = authorizationIri.slice(prefixes.shexrauth.length);
    expect(uuid).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );

    expect(sparqlUpdate).toHaveBeenCalledTimes(1);
    const [, , update] = vi.mocked(sparqlUpdate).mock.calls[0];
    expect(update).toContain('INSERT DATA');
    expect(update).toContain(`GRAPH <${ACL_GRAPH}>`);
    expect(update).toContain(`<${authorizationIri}>`);
    expect(update).toContain('acl:Authorization');
    expect(update).toContain(`acl:accessTo <${RESOURCE}>`);
    expect(update).toContain(`acl:agent    <${AGENT}>`);
    expect(update).toContain('acl:mode     acl:Write');
  });

  it('returns existing IRI without inserting when a duplicate authorization exists', async () => {
    const existingAuthIri = `${prefixes.shexrauth}existing-uuid`;
    vi.mocked(sparqlSelect).mockResolvedValue([
      {
        auth:  { value: existingAuthIri,            type: 'uri' },
        agent: { value: AGENT,                      type: 'uri' },
        mode:  { value: `${prefixes.acl}Write`,     type: 'uri' },
      },
    ]);

    const { authorizationIri } = await grantMode(
      mockClient, prefixes, RESOURCE, AGENT, 'Write',
    );

    expect(authorizationIri).toBe(existingAuthIri);
    expect(sparqlUpdate).not.toHaveBeenCalled();
  });

  it('throws on unsupported mode', async () => {
    await expect(
      grantMode(mockClient, prefixes, RESOURCE, AGENT, 'Append' as any),
    ).rejects.toThrow(/Unsupported ACL mode/);
    expect(sparqlSelect).not.toHaveBeenCalled();
    expect(sparqlUpdate).not.toHaveBeenCalled();
  });
});

describe('revokeMode', () => {
  it('issues DELETE-WHERE and returns count of matched authorizations', async () => {
    vi.mocked(sparqlSelect).mockResolvedValue([
      {
        auth:  { value: `${prefixes.shexrauth}a1`,  type: 'uri' },
        agent: { value: AGENT,                      type: 'uri' },
        mode:  { value: `${prefixes.acl}Write`,     type: 'uri' },
      },
      {
        // different agent — should NOT count
        auth:  { value: `${prefixes.shexrauth}a2`,  type: 'uri' },
        agent: { value: 'https://other/user',       type: 'uri' },
        mode:  { value: `${prefixes.acl}Write`,     type: 'uri' },
      },
    ]);
    vi.mocked(sparqlUpdate).mockResolvedValue(undefined);

    const { deletedCount } = await revokeMode(
      mockClient, prefixes, RESOURCE, AGENT, 'Write',
    );

    expect(deletedCount).toBe(1);
    expect(sparqlUpdate).toHaveBeenCalledTimes(1);
    const [, , update] = vi.mocked(sparqlUpdate).mock.calls[0];
    expect(update).toContain('DELETE');
    expect(update).toContain('WHERE');
    expect(update).toContain(`GRAPH <${ACL_GRAPH}>`);
    expect(update).toContain(`acl:accessTo <${RESOURCE}>`);
    expect(update).toContain(`acl:agent    <${AGENT}>`);
    expect(update).toContain('acl:mode     acl:Write');
  });

  it('throws on unsupported mode', async () => {
    await expect(
      revokeMode(mockClient, prefixes, RESOURCE, AGENT, 'Control' as any),
    ).rejects.toThrow(/Unsupported ACL mode/);
  });
});

describe('listAuthorizations', () => {
  it('parses bindings into Authorization records and strips acl: prefix from mode', async () => {
    vi.mocked(sparqlSelect).mockResolvedValue([
      {
        auth:  { value: `${prefixes.shexrauth}a1`, type: 'uri' },
        agent: { value: AGENT,                     type: 'uri' },
        mode:  { value: `${prefixes.acl}Write`,    type: 'uri' },
      },
    ]);

    const result = await listAuthorizations(mockClient, prefixes, RESOURCE);

    expect(result).toEqual([
      {
        authorizationIri: `${prefixes.shexrauth}a1`,
        resourceIri:      RESOURCE,
        agentIri:         AGENT,
        mode:             'Write',
      },
    ]);

    const [, , query] = vi.mocked(sparqlSelect).mock.calls[0];
    expect(query).toContain('SELECT ?auth ?agent ?mode');
    expect(query).toContain(`GRAPH <${ACL_GRAPH}>`);
    expect(query).toContain(`acl:accessTo <${RESOURCE}>`);
  });

  it('returns empty array when no rows', async () => {
    vi.mocked(sparqlSelect).mockResolvedValue([]);
    const result = await listAuthorizations(mockClient, prefixes, RESOURCE);
    expect(result).toEqual([]);
  });

  it('preserves mode IRI as-is when it does not match the acl prefix', async () => {
    vi.mocked(sparqlSelect).mockResolvedValue([
      {
        auth:  { value: `${prefixes.shexrauth}a1`, type: 'uri' },
        agent: { value: AGENT,                     type: 'uri' },
        mode:  { value: 'urn:other:Mode',          type: 'uri' },
      },
    ]);

    const result = await listAuthorizations(mockClient, prefixes, RESOURCE);
    expect(result[0].mode).toBe('urn:other:Mode');
  });
});

describe('purgeResource', () => {
  it('issues DELETE-WHERE without an agent filter and returns total deleted', async () => {
    vi.mocked(sparqlSelect).mockResolvedValue([
      {
        auth:  { value: `${prefixes.shexrauth}a1`, type: 'uri' },
        agent: { value: AGENT,                     type: 'uri' },
        mode:  { value: `${prefixes.acl}Write`,    type: 'uri' },
      },
      {
        auth:  { value: `${prefixes.shexrauth}a2`, type: 'uri' },
        agent: { value: 'https://other/user',      type: 'uri' },
        mode:  { value: `${prefixes.acl}Write`,    type: 'uri' },
      },
    ]);
    vi.mocked(sparqlUpdate).mockResolvedValue(undefined);

    const { deletedCount } = await purgeResource(mockClient, prefixes, RESOURCE);

    expect(deletedCount).toBe(2);
    const [, , update] = vi.mocked(sparqlUpdate).mock.calls[0];
    expect(update).toContain('DELETE');
    expect(update).toContain(`acl:accessTo <${RESOURCE}>`);
    expect(update).not.toContain('acl:agent');
  });
});
