// ── Auth ─────────────────────────────────────────────────────────────────────

export interface AuthContext {
  userId: string;
  role: 'anonymous' | 'user' | 'admin';
  authEnabled: boolean;
}

// gRPC metadata key names for AuthContext
export const AUTH_META = {
  USER_ID:      'x-auth-user-id',
  ROLE:         'x-auth-role',
  AUTH_ENABLED: 'x-auth-enabled',
} as const;

// ── ShExMap ───────────────────────────────────────────────────────────────────

export interface ShExMap {
  id: string;
  title: string;
  description?: string;
  content?: string;
  sampleTurtleData?: string;
  fileName?: string;
  fileFormat: string;
  sourceUrl?: string;
  schemaUrl?: string;
  tags: string[];
  version: string;
  authorId: string;
  authorName: string;
  createdAt: string;
  modifiedAt: string;
  stars: number;
  hasMapAnnotations?: boolean;
  mapVariables?: string[];
}

export interface ShExMapVersion {
  id: string;
  mapId: string;
  versionNumber: number;
  commitMessage?: string;
  authorId: string;
  authorName: string;
  createdAt: string;
}

export interface ShExMapVersionWithContent extends ShExMapVersion {
  content: string;
}

// ── ShExMapPairing ────────────────────────────────────────────────────────────

export interface ShExMapPairing {
  id: string;
  title: string;
  description?: string;
  sourceMap: ShExMap;
  targetMap: ShExMap;
  sourceFocusIri?: string;
  targetFocusIri?: string;
  tags: string[];
  license?: string;
  version: string;
  authorId: string;
  authorName: string;
  createdAt: string;
  modifiedAt: string;
  stars: number;
}

export interface ShExMapPairingVersion {
  id: string;
  pairingId: string;
  versionNumber: number;
  commitMessage?: string;
  sourceMapId: string;
  sourceVersionNumber?: number;
  targetMapId: string;
  targetVersionNumber?: number;
  authorId: string;
  authorName: string;
  createdAt: string;
}

// ── Validation ────────────────────────────────────────────────────────────────

export interface BindingEntry {
  variable: string;
  value: string;
  datatype?: string;
}

export interface BindingNode {
  shape: string;
  focus: string;
  bindings: BindingEntry[];
  children: BindingNode[];
}

export interface ValidationResult {
  shexValid: boolean;
  shexErrors: string[];
  rdfValid?: boolean;
  rdfErrors?: string[];
  valid: boolean;
  bindingTree: BindingNode[];
  bindings: Record<string, string>;
  targetRdf?: string;
  errors: string[];
}

// ── Coverage ──────────────────────────────────────────────────────────────────

export interface CoverageReport {
  schemaUrl: string;
  schemaTitle: string;
  totalShapes: number;
  mappedShapes: number;
  coveragePercent: number;
  computedAt: string;
}

export interface ShapeGap {
  schemaUrl: string;
  shapeUrl: string;
  shapeLabel: string;
  hasMappings: boolean;
  mappingCount: number;
}

export interface CoverageOverview {
  totalSchemas: number;
  totalShexMaps: number;
  totalShapes: number;
  totalMappedShapes: number;
  overallCoveragePercent: number;
  bySchema: CoverageReport[];
  computedAt: string;
}

// ── User ──────────────────────────────────────────────────────────────────────

export interface User {
  id: string;
  name: string;
  email?: string;
  avatarUrl?: string;
  provider: string;
  providerId: string;
  createdAt: string;
  apiKeys: ApiKey[];
}

export interface ApiKey {
  id: string;
  label: string;
  prefix: string;
  createdAt: string;
  lastUsedAt?: string;
}

// ── Schema ────────────────────────────────────────────────────────────────────

export interface Schema {
  id: string;
  url: string;
  title: string;
  description?: string;
  sourceUrl?: string;
  shexMapIds: string[];
}
