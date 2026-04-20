import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { validate } from './services/validate.service.js';
import { config } from './config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROTO_PATH = join(__dirname, '../../../shared/proto/validate.proto');
const SHAPE_BASE = `${config.baseNamespace}shapes/`;

const packageDef = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});

const proto = grpc.loadPackageDefinition(packageDef) as any;

function bindingNodeToProto(node: any): any {
  return {
    shape: node.shape,
    focus: node.focus,
    bindings: node.bindings.map((b: any) => ({
      variable: b.variable,
      value: b.value,
      datatype: b.datatype ?? '',
    })),
    children: node.children.map(bindingNodeToProto),
  };
}

const validateHandler: grpc.handleUnaryCall<any, any> = async (call, callback) => {
  const { source_shex, source_rdf, source_node, target_shex, target_node } = call.request;
  try {
    const result = await validate(
      source_shex,
      SHAPE_BASE,
      source_rdf || undefined,
      source_node || undefined,
      target_shex || undefined,
      target_node || undefined,
    );
    callback(null, {
      shex_valid:    result.shexValid,
      shex_errors:   result.shexErrors,
      rdf_valid:     result.rdfValid ?? false,
      rdf_errors:    result.rdfErrors ?? [],
      valid:         result.valid,
      binding_tree:  result.bindingTree.map(bindingNodeToProto),
      bindings:      result.bindings,
      target_rdf:    result.targetRdf ?? '',
      errors:        result.errors,
    });
  } catch (err: any) {
    callback({ code: grpc.status.INTERNAL, message: err.message });
  }
};

export function createServer(): grpc.Server {
  const server = new grpc.Server();
  server.addService(proto.shexmap.validate.ValidateService.service, {
    validate: validateHandler,
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
      console.log(`svc-validate gRPC listening on :${port}`);
    },
  );
}
