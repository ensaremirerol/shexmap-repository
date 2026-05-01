import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { config } from './config.js';
import { sparqlClient, prefixes } from './sparql.js';
import { getCoverageOverview, getGapAnalysis } from './services/coverage.service.js';
import { PROTO_FILES } from '@shexmap/shared';

const packageDef = protoLoader.loadSync(PROTO_FILES.coverage, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});

const proto = grpc.loadPackageDefinition(packageDef) as any;

const getOverviewHandler: grpc.handleUnaryCall<any, any> = async (_call, callback) => {
  try {
    const overview = await getCoverageOverview(sparqlClient, prefixes);
    callback(null, {
      total_schemas:            overview.totalSchemas,
      total_shex_maps:          overview.totalShexMaps,
      total_shapes:             overview.totalShapes,
      total_mapped_shapes:      overview.totalMappedShapes,
      overall_coverage_percent: overview.overallCoveragePercent,
      by_schema: overview.bySchema.map(s => ({
        schema_url:       s.schemaUrl,
        schema_title:     s.schemaTitle,
        total_shapes:     s.totalShapes,
        mapped_shapes:    s.mappedShapes,
        coverage_percent: s.coveragePercent,
        computed_at:      s.computedAt,
      })),
      computed_at: overview.computedAt,
    });
  } catch (err: any) {
    callback({ code: grpc.status.INTERNAL, message: err.message });
  }
};

const getGapsHandler: grpc.handleUnaryCall<any, any> = async (call, callback) => {
  try {
    const schemaUrl = call.request.schema_url || undefined;
    const gaps = await getGapAnalysis(sparqlClient, prefixes, schemaUrl);
    callback(null, {
      gaps: gaps.map(g => ({
        schema_url:    g.schemaUrl,
        shape_url:     g.shapeUrl,
        shape_label:   g.shapeLabel,
        has_mappings:  g.hasMappings,
        mapping_count: g.mappingCount,
      })),
    });
  } catch (err: any) {
    callback({ code: grpc.status.INTERNAL, message: err.message });
  }
};

export function createServer(): grpc.Server {
  const server = new grpc.Server();
  server.addService(proto.shexmap.coverage.CoverageService.service, {
    GetOverview: getOverviewHandler,
    GetGaps:     getGapsHandler,
  });
  return server;
}

export function startServer(): void {
  const server = createServer();
  server.bindAsync(
    `0.0.0.0:${config.port}`,
    grpc.ServerCredentials.createInsecure(),
    (err, port) => {
      if (err) { console.error('Failed to bind gRPC server:', err); process.exit(1); }
      console.log(`svc-coverage gRPC listening on :${port}`);
    },
  );
}
