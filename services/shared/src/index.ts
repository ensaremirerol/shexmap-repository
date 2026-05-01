export * from './types/index.js';
export * from './rdf/prefixes.js';
export * from './sparql/client.js';

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const _sharedDir = dirname(fileURLToPath(import.meta.url));
/** Absolute path to the shared proto directory. Use instead of hard-coded relative paths. */
export const PROTO_DIR: string = join(_sharedDir, '..', 'proto');
