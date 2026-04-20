# svc-schema — Schema Catalogue

**Protocol:** gRPC (port 50055)
**Dependencies:** QLever (read-only SPARQL SELECT)

## Responsibility

List known ShExSchemas from the triplestore and expose their associated ShExMap IDs. Read-only, no auth, no writes.

## Proto contract

`services/shared/proto/schema.proto` → service `shexmap.schema.SchemaService`

```
rpc ListSchemas (ListSchemasRequest) returns (ListSchemasResponse)
```

## AuthContext

No auth enforcement — public read.

## Directory layout to create

```
src/
  index.ts
  config.ts              PORT=50055, QLEVER_SPARQL_URL, QLEVER_ACCESS_TOKEN, BASE_NAMESPACE
  server.ts
  sparql.ts
  services/
    schema.service.ts    listSchemas(client, prefixes) → Schema[]
test/
  schema.service.test.ts
  schema.handler.test.ts
```

## Source to migrate

`api/src/routes/v1/schemas.ts` contains the SPARQL query inline. Extract it into `src/services/schema.service.ts`:

```ts
export async function listSchemas(client: SimpleClient, prefixes: Prefixes): Promise<Schema[]> {
  const rows = await sparqlSelect(client, prefixes, `
    SELECT ?schema ?title ?description ?source ?mapId
    WHERE {
      ?schema a <${prefixes.shexmap}ShExSchema> .
      OPTIONAL { ?schema <${prefixes.dct}title> ?title }
      ...
    }
  `);
  // group by schema IRI, collect shexMapIds
}
```

## TDD

```ts
vi.mocked(sparqlSelect).mockResolvedValue([
  { schema: { value: 'https://ex.org/s1' }, title: { value: 'FHIR' }, mapId: { value: 'https://...map/abc' } }
]);
const schemas = await listSchemas(mockClient, prefixes);
expect(schemas[0].shexMapIds).toContain('abc');
```

## Dependencies

```json
{
  "@grpc/grpc-js": "^1.10.0",
  "@grpc/proto-loader": "^0.7.0",
  "@shexmap/shared": "*",
  "sparql-http-client": "^3.0.0",
  "dotenv": "^16.0.0"
}
```


---

## Changing shared/ package

If you need a new type, helper, or proto field in `services/shared/`, do **not** edit it directly. Instead create a proposal file at `services/shared/proposals/svc-schema-<description>.md` and wait for the shared agent to review it. See `services/shared/CLAUDE.md` for the proposal format.
