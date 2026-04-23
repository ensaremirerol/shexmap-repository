import { sparqlSelect, createSparqlClient } from '@shexmap/shared';
import type { Prefixes, Schema } from '@shexmap/shared';

type SparqlClient = ReturnType<typeof createSparqlClient>;

export async function listSchemas(client: SparqlClient, prefixes: Prefixes): Promise<Schema[]> {
  const rows = await sparqlSelect(client, prefixes, `
    SELECT ?schema ?title ?description ?source ?mapId
    WHERE {
      ?schema a <${prefixes.shexmap}ShExSchema> .
      OPTIONAL { ?schema <${prefixes.dct}title> ?title }
      OPTIONAL { ?schema <${prefixes.dct}description> ?description }
      OPTIONAL { ?schema <${prefixes.dct}source> ?source }
      OPTIONAL { ?mapId <${prefixes.shexmap}hasSchema> ?schema }
    }
    ORDER BY ?title
  `);

  const bySchema = new Map<string, Schema>();

  for (const row of rows) {
    const url = row['schema']?.value ?? '';
    const id = url.split('/').pop() ?? url;

    if (!bySchema.has(url)) {
      bySchema.set(url, {
        id,
        url,
        title: row['title']?.value ?? id,
        description: row['description']?.value,
        sourceUrl: row['source']?.value,
        shexMapIds: [],
      });
    }

    const mapIri = row['mapId']?.value;
    if (mapIri) {
      const mapId = mapIri.split('/').pop() ?? mapIri;
      const entry = bySchema.get(url)!;
      if (!entry.shexMapIds.includes(mapId)) {
        entry.shexMapIds.push(mapId);
      }
    }
  }

  return [...bySchema.values()];
}
