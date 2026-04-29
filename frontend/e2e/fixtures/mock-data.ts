/**
 * Shared mock fixtures matching the gateway's camelCased response shapes
 * (see services/svc-gateway/src/grpc/call.ts → snakeToCamel).
 */

export const mockUser = {
  sub: 'user-1',
  role: 'user' as const,
  name: 'Alice Tester',
  email: 'alice@example.com',
};

export const mockOtherUser = {
  sub: 'user-2',
  role: 'user' as const,
  name: 'Bob Bystander',
  email: 'bob@example.com',
};

export const mockShExMap = {
  id: 'map-1',
  title: 'FHIR Patient ShExMap',
  description: 'Mapping FHIR Patient resources',
  content: 'PREFIX ex: <http://example.org/>\n<S> { ex:name xsd:string }',
  sampleTurtleData: '',
  fileName: '',
  fileFormat: 'shexc',
  sourceUrl: '',
  schemaUrl: 'http://hl7.org/fhir',
  tags: ['fhir', 'patient'],
  version: '1.0.0',
  authorId: mockUser.sub,
  authorName: mockUser.name,
  createdAt: '2026-01-01T00:00:00Z',
  modifiedAt: '2026-01-01T00:00:00Z',
  stars: 3,
  hasMapAnnotations: false,
  mapVariables: [],
};

export const mockShExMapByOther = {
  ...mockShExMap,
  id: 'map-2',
  title: "Bob's ShExMap",
  authorId: mockOtherUser.sub,
  authorName: mockOtherUser.name,
};

export const mockShExMapAnonymous = {
  ...mockShExMap,
  id: 'map-3',
  title: 'Pre-auth Legacy Map',
  authorId: 'anonymous',
  authorName: 'anonymous',
};

export const mockPairing = {
  id: 'pair-1',
  title: 'FHIR ↔ openEHR',
  description: 'Bidirectional Patient mapping',
  sourceMap: mockShExMap,
  targetMap: { ...mockShExMap, id: 'map-target', title: 'openEHR Demographic' },
  sourceFocusIri: '',
  targetFocusIri: '',
  tags: ['demographics'],
  license: 'MIT',
  version: '1.0.0',
  authorId: mockUser.sub,
  authorName: mockUser.name,
  createdAt: '2026-01-01T00:00:00Z',
  modifiedAt: '2026-01-01T00:00:00Z',
  stars: 1,
};
