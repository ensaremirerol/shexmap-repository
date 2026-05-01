import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { config } from '../config.js';
import { PROTO_DIR, PROTO_FILES } from '@shexmap/shared';

const LOADER_OPTS: protoLoader.Options = {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
  includeDirs: [PROTO_DIR],
};

export function loadClient(protoPath: string, servicePath: string, address: string): grpc.Client {
  const packageDef = protoLoader.loadSync(protoPath, LOADER_OPTS);
  const proto = grpc.loadPackageDefinition(packageDef) as any;
  const parts = servicePath.split('.');
  let svc = proto;
  for (const p of parts) svc = svc[p];
  return new svc(address, grpc.credentials.createInsecure());
}

export const validateClient = loadClient(
  PROTO_FILES.validate,
  'shexmap.validate.ValidateService',
  config.svcValidateAddr,
);

export const shexmapClient = loadClient(
  PROTO_FILES.shexmap,
  'shexmap.map.ShexMapService',
  config.svcShexmapAddr,
);

export const pairingClient = loadClient(
  PROTO_FILES.pairing,
  'shexmap.pairing.PairingService',
  config.svcPairingAddr,
);

export const coverageClient = loadClient(
  PROTO_FILES.coverage,
  'shexmap.coverage.CoverageService',
  config.svcCoverageAddr,
);

export const schemaClient = loadClient(
  PROTO_FILES.schema,
  'shexmap.schema.SchemaService',
  config.svcSchemaAddr,
);
