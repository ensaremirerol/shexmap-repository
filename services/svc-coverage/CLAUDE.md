# svc-coverage — Coverage Analytics

**Protocol:** gRPC (port 50054)
**Dependencies:** QLever (read-only SPARQL SELECT)

## Responsibility

Compute coverage statistics (how many shapes in each ShExSchema have at least one ShExMap) and gap analysis (shapes with zero coverage). Pure read-only aggregation — no writes, no auth required.

## Proto contract

`services/shared/proto/coverage.proto` → service `shexmap.coverage.CoverageService`

```
rpc GetOverview (CoverageOverviewRequest) returns (CoverageOverviewResponse)
rpc GetGaps     (GapAnalysisRequest)      returns (GapAnalysisResponse)
```

`GapAnalysisRequest.schema_url` is optional (empty string = all schemas).

## AuthContext

No auth enforcement. This service exposes read-only aggregated data over public RDF.

## Directory layout to create

```
src/
  index.ts
  config.ts              PORT=50054, QLEVER_SPARQL_URL, QLEVER_ACCESS_TOKEN, BASE_NAMESPACE
  server.ts
  sparql.ts
  services/
    coverage.service.ts  getCoverageOverview, getGapAnalysis
test/
  coverage.service.test.ts
  coverage.handler.test.ts
```

## Source to migrate

`api/src/services/coverage.service.ts` → `src/services/coverage.service.ts`

Replace `FastifyInstance` with `SimpleClient`. Replace `sparqlSelect(fastify, ...)` with `sparqlSelect(client, prefixes, ...)`.

## TDD

```ts
// coverage.service.test.ts
vi.mock('@shexmap/shared', ...);
vi.mocked(sparqlSelect).mockResolvedValue([
  { schema: { value: 'https://ex.org/schema1' }, totalShapes: { value: '10' }, mappingCount: { value: '3' } }
]);

const result = await getCoverageOverview(mockClient, prefixes);
expect(result.bySchema[0].coveragePercent).toBe(30);
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

If you need a new type, helper, or proto field in `services/shared/`, do **not** edit it directly. Instead create a proposal file at `services/shared/proposals/svc-coverage-<description>.md` and wait for the shared agent to review it. See `services/shared/CLAUDE.md` for the proposal format.
