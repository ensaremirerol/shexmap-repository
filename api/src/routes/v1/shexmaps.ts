import type { FastifyPluginAsync } from 'fastify';
import {
  ShExMapCreateSchema,
  ShExMapUpdateSchema,
  ShExMapQuerySchema,
  ShExMapIdSchema,
  SaveVersionSchema,
} from '../../models/shexmap.model.js';
import {
  listShExMaps,
  getShExMap,
  createShExMap,
  updateShExMap,
  deleteShExMap,
} from '../../services/shexmap.service.js';
import {
  listVersions,
  getVersion,
  getVersionContent,
  saveNewVersion,
} from '../../services/version.service.js';
import { config } from '../../config.js';

// ── Example content (used in OpenAPI body examples) ───────────────────────────

const EXAMPLE_SHEX = `PREFIX fhir: <http://hl7.org/fhir-rdf/>
PREFIX sct: <http://snomed.info/sct/>
PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
PREFIX bp: <http://shex.io/extensions/Map/#BPDAM->
PREFIX Map: <http://shex.io/extensions/Map/#>

start = @<BPfhir>

<Patient> {
  fhir:givenName xsd:string %Map:{ bp:given %};
  fhir:familyName xsd:string %Map:{ bp:family %}
}

<BPfhir> {
  a [fhir:Observation]?;
  fhir:subject @<Patient>;
  fhir:coding { fhir:code [sct:Blood_Pressure] };
  fhir:component @<sysBP>;
  fhir:component @<diaBP>
}
<sysBP> {
  a [fhir:Observation]?;
  fhir:coding { fhir:code [sct:Systolic_Blood_Pressure] };
  fhir:valueQuantity {
    a [fhir:Quantity]?;
    fhir:value xsd:float %Map:{ bp:sysVal %};
    fhir:units xsd:string %Map:{ bp:sysUnits %}
  }
}
<diaBP> {
  a [fhir:Observation]?;
  fhir:coding { fhir:code [sct:Diastolic_Blood_Pressure] };
  fhir:valueQuantity {
    a [fhir:Quantity]?;
    fhir:value xsd:float %Map:{ bp:diaVal %};
    fhir:units xsd:string %Map:{ bp:diaUnits %}
  }
}`;

const EXAMPLE_TURTLE = `PREFIX fhir: <http://hl7.org/fhir-rdf/>
PREFIX sct: <http://snomed.info/sct/>
PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>

<tag:BPfhir123> a fhir:Observation;
  fhir:subject [
    fhir:givenName "Alice";
    fhir:familyName "Walker"
  ];
  fhir:coding [ fhir:code sct:Blood_Pressure ];
  fhir:component [
    a fhir:Observation;
    fhir:coding [ fhir:code sct:Systolic_Blood_Pressure ];
    fhir:valueQuantity [
      a fhir:Quantity;
      fhir:value "110"^^xsd:float;
      fhir:units "mmHg"
    ]
  ], [
    a fhir:Observation;
    fhir:coding [ fhir:code sct:Diastolic_Blood_Pressure ];
    fhir:valueQuantity [
      a fhir:Quantity;
      fhir:value "70"^^xsd:float;
      fhir:units "mmHg"
    ]
  ].`;

// ── Reusable response shapes ───────────────────────────────────────────────────

const shexMapProperties = {
  id:             { type: 'string', description: 'UUID of the ShExMap.' },
  title:          { type: 'string', description: 'Human-readable title.' },
  description:    { type: 'string', description: 'Optional longer description.' },
  content:        { type: 'string', description: 'ShEx source text (ShExC by default).' },
  sampleTurtleData: { type: 'string', description: 'Sample Turtle RDF for testing this map.' },
  fileName:       { type: 'string', description: 'Original file name, if uploaded from a file.' },
  fileFormat:     { type: 'string', enum: ['shexc', 'shexj'], description: 'ShEx serialisation format.' },
  sourceUrl:      { type: 'string', description: 'URL of the original .shex source file (dct:source).' },
  schemaUrl:      { type: 'string', description: 'IRI of the ShExSchema this map annotates.' },
  tags:           { type: 'array', items: { type: 'string' }, description: 'Free-form tags.' },
  version:        { type: 'string', description: 'Semantic version string (e.g. "1.0.0").' },
  authorId:       { type: 'string', description: 'Identifier of the author.' },
  authorName:     { type: 'string', description: 'Display name of the author.' },
  createdAt:      { type: 'string', format: 'date-time' },
  modifiedAt:     { type: 'string', format: 'date-time' },
  stars:          { type: 'integer', description: 'Star count.' },
} as const;

const shexMapSchema = {
  type: 'object',
  properties: shexMapProperties,
};

const shexMapVersionProperties = {
  id:            { type: 'string', description: 'Version identifier ("{mapId}-v{n}").' },
  mapId:         { type: 'string', description: 'Parent ShExMap UUID.' },
  versionNumber: { type: 'integer', description: 'Monotonically increasing version number (1-based).' },
  commitMessage: { type: 'string', description: 'Optional change note.' },
  authorId:      { type: 'string' },
  authorName:    { type: 'string' },
  createdAt:     { type: 'string', format: 'date-time' },
} as const;

const shexMapVersionSchema = {
  type: 'object',
  properties: shexMapVersionProperties,
};

const notFoundSchema = {
  description: 'ShExMap not found.',
  type: 'object',
  properties: { error: { type: 'string' } },
};

const badRequestSchema = {
  description: 'Validation error.',
  type: 'object',
  properties: { error: { type: 'string' } },
};

// ── Routes ────────────────────────────────────────────────────────────────────

const shexmapsRoutes: FastifyPluginAsync = async (fastify) => {

  // GET /shexmaps — list with filters
  fastify.get('/', {
    schema: {
      tags: ['shexmaps'],
      summary: 'List ShExMaps',
      description: 'Returns a paginated list of ShExMaps. Supports full-text search, tag filtering, and sorting.',
      querystring: {
        type: 'object',
        properties: {
          q:         { type: 'string', description: 'Full-text search query.' },
          tag:       { type: 'string', description: 'Filter by tag.' },
          author:    { type: 'string', description: 'Filter by author ID.' },
          schemaUrl: { type: 'string', description: 'Filter by associated schema IRI.' },
          page:      { type: 'integer', minimum: 1, default: 1 },
          limit:     { type: 'integer', minimum: 1, maximum: 100, default: 20 },
          sort:      { type: 'string', enum: ['created', 'modified', 'title', 'stars'], default: 'modified' },
          order:     { type: 'string', enum: ['asc', 'desc'], default: 'desc' },
        },
      },
      response: {
        200: {
          description: 'Paginated list of ShExMaps.',
          type: 'object',
          properties: {
            items: { type: 'array', items: shexMapSchema },
            total: { type: 'integer' },
            page:  { type: 'integer' },
            limit: { type: 'integer' },
          },
        },
      },
    },
  }, async (request) => {
    const query = ShExMapQuerySchema.parse(request.query);
    return listShExMaps(fastify, query);
  });

  // GET /shexmaps/:id — get one
  fastify.get('/:id', {
    schema: {
      tags: ['shexmaps'],
      summary: 'Get a ShExMap by ID',
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string', description: 'ShExMap UUID.' } },
      },
      response: {
        200: { description: 'The requested ShExMap.', ...shexMapSchema },
        404: notFoundSchema,
      },
    },
  }, async (request, reply) => {
    const { id } = ShExMapIdSchema.parse(request.params);
    const map = await getShExMap(fastify, id);
    if (!map) return reply.notFound(`ShExMap ${id} not found`);
    return map;
  });

  // POST /shexmaps — create
  fastify.post('/', {
    schema: {
      tags: ['shexmaps'],
      summary: 'Create a new ShExMap',
      description:
        'Submits a new ShExMap to the repository. The `content` field holds the ShEx source text. ' +
        'A `sampleTurtleData` snippet can be stored alongside the map for use in the pairing UI. ' +
        'An initial version record is created automatically.',
      body: {
        type: 'object',
        required: ['title'],
        properties: {
          title: {
            type: 'string', minLength: 1, maxLength: 200,
            description: 'Human-readable title for this ShExMap.',
          },
          description: {
            type: 'string', maxLength: 2000,
            description: 'Optional longer description.',
          },
          content: {
            type: 'string',
            description: 'ShEx source text (ShExC format by default).',
          },
          sampleTurtleData: {
            type: 'string',
            description: 'Sample Turtle-serialised RDF for testing this shape.',
          },
          fileName: {
            type: 'string', maxLength: 200,
            description: 'Original file name (informational only).',
          },
          fileFormat: {
            type: 'string', enum: ['shexc', 'shexj'], default: 'shexc',
            description: 'ShEx serialisation format.',
          },
          sourceUrl: {
            type: 'string',
            description: 'URL of the upstream .shex source file (stored as dct:source).',
          },
          schemaUrl: {
            type: 'string',
            description: 'IRI of the ShExSchema this map annotates.',
          },
          tags: {
            type: 'array', items: { type: 'string', maxLength: 50 }, maxItems: 20, default: [],
            description: 'Free-form tags for discovery.',
          },
          version: {
            type: 'string', pattern: '^\\d+\\.\\d+\\.\\d+$', default: '1.0.0',
            description: 'Semantic version string (e.g. "1.0.0").',
          },
        },
        examples: [
          {
            title: 'FHIR Blood Pressure → DAM (source)',
            description: 'ShExMap for the FHIR representation of a blood pressure observation.',
            content: EXAMPLE_SHEX,
            sampleTurtleData: EXAMPLE_TURTLE,
            fileFormat: 'shexc',
            tags: ['fhir', 'blood-pressure', 'hl7'],
            version: '1.0.0',
          },
        ],
      },
      response: {
        201: { description: 'ShExMap created.', ...shexMapSchema },
        400: badRequestSchema,
      },
    },
    preHandler: [fastify.requireAuth],
  }, async (request, reply) => {
    const data = ShExMapCreateSchema.parse(request.body);
    const authorId = config.auth.enabled
      ? (request.user as { sub: string }).sub
      : 'anonymous';
    const map = await createShExMap(fastify, data, authorId);
    return reply.code(201).send(map);
  });

  // PATCH /shexmaps/:id — update metadata
  fastify.patch('/:id', {
    schema: {
      tags: ['shexmaps'],
      summary: 'Update ShExMap metadata',
      description:
        'Partially updates the metadata of an existing ShExMap. Only the supplied fields are changed. ' +
        'To save a new version of the ShEx *content*, use `POST /shexmaps/{id}/versions` instead.',
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string', description: 'ShExMap UUID.' } },
      },
      body: {
        type: 'object',
        properties: {
          title:           { type: 'string', minLength: 1, maxLength: 200 },
          description:     { type: 'string', maxLength: 2000 },
          content:         { type: 'string', description: 'Inline ShEx source text.' },
          sampleTurtleData:{ type: 'string', description: 'Sample Turtle RDF.' },
          fileName:        { type: 'string', maxLength: 200 },
          fileFormat:      { type: 'string', enum: ['shexc', 'shexj'] },
          sourceUrl:       { type: 'string' },
          schemaUrl:       { type: 'string' },
          tags:            { type: 'array', items: { type: 'string', maxLength: 50 }, maxItems: 20 },
          version:         { type: 'string', pattern: '^\\d+\\.\\d+\\.\\d+$' },
        },
        examples: [
          {
            title: 'FHIR Blood Pressure → DAM (source) — updated title',
            description: 'Updated description with more detail about the FHIR mapping.',
            tags: ['fhir', 'blood-pressure', 'hl7', 'observation'],
            version: '1.1.0',
          },
        ],
      },
      response: {
        200: { description: 'Updated ShExMap.', ...shexMapSchema },
        400: badRequestSchema,
        404: notFoundSchema,
      },
    },
    preHandler: [fastify.requireAuth],
  }, async (request, reply) => {
    const { id } = ShExMapIdSchema.parse(request.params);
    const existing = await getShExMap(fastify, id);
    if (!existing) return reply.notFound(`ShExMap ${id} not found`);
    // Strip empty-string URL fields — Zod's .url() rejects "" but the form sends it when cleared
    const raw = { ...request.body as Record<string, unknown> };
    if (raw['schemaUrl'] === '') delete raw['schemaUrl'];
    if (raw['sourceUrl'] === '') delete raw['sourceUrl'];
    const data = ShExMapUpdateSchema.parse(raw);
    const updated = await updateShExMap(fastify, id, data);
    return updated;
  });

  // DELETE /shexmaps/:id
  fastify.delete('/:id', {
    schema: {
      tags: ['shexmaps'],
      summary: 'Delete a ShExMap',
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string', description: 'ShExMap UUID.' } },
      },
      response: {
        204: { description: 'ShExMap deleted.' },
        404: notFoundSchema,
      },
    },
    preHandler: [fastify.requireAuth],
  }, async (request, reply) => {
    const { id } = ShExMapIdSchema.parse(request.params);
    const existing = await getShExMap(fastify, id);
    if (!existing) return reply.notFound(`ShExMap ${id} not found`);
    await deleteShExMap(fastify, id);
    return reply.code(204).send();
  });

  // ── Version routes ──────────────────────────────────────────────────────────

  // GET /shexmaps/:id/versions — list all versions (metadata only)
  fastify.get('/:id/versions', {
    schema: {
      tags: ['shexmaps'],
      summary: 'List versions of a ShExMap',
      description: 'Returns version metadata for all saved versions of a ShExMap. Content is not included; use `GET /shexmaps/{id}/versions/{vn}` to retrieve it.',
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string', description: 'ShExMap UUID.' } },
      },
      response: {
        200: {
          description: 'List of version records.',
          type: 'array',
          items: shexMapVersionSchema,
        },
        404: notFoundSchema,
      },
    },
  }, async (request, reply) => {
    const { id } = ShExMapIdSchema.parse(request.params);
    const existing = await getShExMap(fastify, id);
    if (!existing) return reply.notFound(`ShExMap ${id} not found`);
    return listVersions(fastify, id);
  });

  // POST /shexmaps/:id/versions — save a new version
  fastify.post('/:id/versions', {
    schema: {
      tags: ['shexmaps'],
      summary: 'Save a new version of a ShExMap',
      description:
        'Saves the supplied ShEx source text as a new immutable version of the ShExMap. ' +
        'Version numbers are assigned automatically (1, 2, 3, …). ' +
        'An optional `commitMessage` can describe what changed.',
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string', description: 'ShExMap UUID.' } },
      },
      body: {
        type: 'object',
        required: ['content'],
        properties: {
          content: {
            type: 'string', minLength: 1,
            description: 'Full ShEx source text to snapshot as this version.',
          },
          commitMessage: {
            type: 'string', maxLength: 500,
            description: 'Optional short description of what changed in this version.',
          },
        },
        examples: [
          {
            content: EXAMPLE_SHEX,
            commitMessage: 'Add Map annotations to sysBP and diaBP components',
          },
        ],
      },
      response: {
        201: { description: 'Version created.', ...shexMapVersionSchema },
        400: badRequestSchema,
        404: notFoundSchema,
      },
    },
    preHandler: [fastify.requireAuth],
  }, async (request, reply) => {
    const { id } = ShExMapIdSchema.parse(request.params);
    const existing = await getShExMap(fastify, id);
    if (!existing) return reply.notFound(`ShExMap ${id} not found`);
    const { content, commitMessage } = SaveVersionSchema.parse(request.body);
    const authorId = config.auth.enabled
      ? (request.user as { sub: string }).sub
      : 'anonymous';
    const version = await saveNewVersion(fastify, id, authorId, content, commitMessage);
    return reply.code(201).send(version);
  });

  // GET /shexmaps/:id/versions/:vn — get a specific version with content
  fastify.get('/:id/versions/:vn', {
    schema: {
      tags: ['shexmaps'],
      summary: 'Get a specific version of a ShExMap',
      description: 'Returns version metadata plus the full ShEx source text for the given version number.',
      params: {
        type: 'object',
        required: ['id', 'vn'],
        properties: {
          id: { type: 'string', description: 'ShExMap UUID.' },
          vn: { type: 'integer', minimum: 1, description: 'Version number (1-based).' },
        },
      },
      response: {
        200: {
          description: 'Version metadata with ShEx content.',
          type: 'object',
          properties: {
            ...shexMapVersionProperties,
            content: { type: 'string', description: 'ShEx source text for this version.' },
          },
        },
        400: badRequestSchema,
        404: notFoundSchema,
      },
    },
  }, async (request, reply) => {
    const { id } = ShExMapIdSchema.parse(request.params);
    const vn = parseInt((request.params as { vn: string }).vn, 10);
    if (isNaN(vn) || vn < 1) return reply.badRequest('Version number must be a positive integer');
    const version = await getVersion(fastify, id, vn);
    if (!version) return reply.notFound(`Version ${vn} of ShExMap ${id} not found`);
    const content = await getVersionContent(fastify, id, vn);
    return { ...version, content };
  });

};

export default shexmapsRoutes;
