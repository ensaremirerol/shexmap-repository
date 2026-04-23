import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { config } from './config.js';
import { sparqlClient, prefixes } from './sparql.js';
import { listSchemas } from './services/schema.service.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROTO_PATH = join(__dirname, '..', 'proto', 'schema.proto');

const packageDef = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});

const proto = grpc.loadPackageDefinition(packageDef) as any;

const listSchemasHandler: grpc.handleUnaryCall<any, any> = async (_call, callback) => {
  try {
    const schemas = await listSchemas(sparqlClient, prefixes);
    callback(null, {
      schemas: schemas.map(s => ({
        id:          s.id,
        url:         s.url,
        title:       s.title,
        description: s.description ?? '',
        source_url:  s.sourceUrl ?? '',
        shex_map_ids: s.shexMapIds,
      })),
    });
  } catch (err: any) {
    callback({ code: grpc.status.INTERNAL, message: err.message });
  }
};

export function createServer(): grpc.Server {
  const server = new grpc.Server();
  server.addService(proto.shexmap.schema.SchemaService.service, {
    ListSchemas: listSchemasHandler,
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
      console.log(`svc-schema gRPC listening on :${port}`);
    },
  );
}
