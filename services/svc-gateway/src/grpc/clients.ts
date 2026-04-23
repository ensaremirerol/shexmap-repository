import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { config } from '../config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROTO_DIR = join(__dirname, '..', '..', 'proto');

const LOADER_OPTS: protoLoader.Options = {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
  includeDirs: [PROTO_DIR],
};

export function loadClient(protoFile: string, servicePath: string, address: string): grpc.Client {
  const packageDef = protoLoader.loadSync(join(PROTO_DIR, protoFile), LOADER_OPTS);
  const proto = grpc.loadPackageDefinition(packageDef) as any;
  const parts = servicePath.split('.');
  let svc = proto;
  for (const p of parts) svc = svc[p];
  return new svc(address, grpc.credentials.createInsecure());
}

export const validateClient = loadClient(
  'validate.proto',
  'shexmap.validate.ValidateService',
  config.svcValidateAddr,
);

export const shexmapClient = loadClient(
  'shexmap.proto',
  'shexmap.map.ShexMapService',
  config.svcShexmapAddr,
);

export const pairingClient = loadClient(
  'pairing.proto',
  'shexmap.pairing.PairingService',
  config.svcPairingAddr,
);

export const coverageClient = loadClient(
  'coverage.proto',
  'shexmap.coverage.CoverageService',
  config.svcCoverageAddr,
);

export const schemaClient = loadClient(
  'schema.proto',
  'shexmap.schema.SchemaService',
  config.svcSchemaAddr,
);
