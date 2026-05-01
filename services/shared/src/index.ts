export * from './types/index.js';
export * from './rdf/prefixes.js';
export * from './sparql/client.js';

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const _protoDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'proto');

/** Absolute path to the shared proto directory. Useful for `includeDirs` in protoLoader. */
export const PROTO_DIR: string = _protoDir;

/** Pre-resolved absolute paths for every proto file in @shexmap/shared. */
export const PROTO_FILES = {
  validate: join(_protoDir, 'validate.proto'),
  shexmap:  join(_protoDir, 'shexmap.proto'),
  pairing:  join(_protoDir, 'pairing.proto'),
  coverage: join(_protoDir, 'coverage.proto'),
  schema:   join(_protoDir, 'schema.proto'),
  acl:      join(_protoDir, 'acl.proto'),
} as const;
