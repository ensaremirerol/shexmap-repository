import type { FastifyPluginAsync } from 'fastify';
import { validate } from '../../services/shexmap-validate.service.js';

const EXAMPLE_SOURCE_SHEX = `PREFIX fhir: <http://hl7.org/fhir-rdf/>
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

const EXAMPLE_SOURCE_RDF = `PREFIX fhir: <http://hl7.org/fhir-rdf/>
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

const EXAMPLE_TARGET_SHEX = `PREFIX : <http://dam.example/med#>
PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
PREFIX bp: <http://shex.io/extensions/Map/#BPDAM->
PREFIX Map: <http://shex.io/extensions/Map/#>

start = @<BPunitsDAM>

<BPunitsDAM> {
  :name . %Map:{ regex(/(?<bp:family>[a-zA-Z]+), (?<bp:given>[a-zA-Z]+)/) %};
  :systolic {
    :value xsd:float %Map:{ bp:sysVal %};
    :units xsd:string %Map:{ bp:sysUnits %}
  };
  :diastolic {
    :value xsd:float %Map:{ bp:diaVal %};
    :units xsd:string %Map:{ bp:diaUnits %}
  }
}`;

const validateRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post<{
    Body: {
      sourceShEx: string;
      sourceRdf: string;
      sourceNode: string;
      targetShEx?: string;
      targetNode?: string;
    };
  }>(
    '/',
    {
      schema: {
        tags: ['validate'],
        summary: 'Validate and optionally materialise a ShExMap mapping',
        description:
          'Validates source RDF against a source ShEx schema, extracts `%Map:{ variable %}` bindings, ' +
          'and — when `targetShEx` and `targetNode` are supplied — materialises target RDF by substituting ' +
          'those bindings into the target shape.',
        body: {
          type: 'object',
          required: ['sourceShEx', 'sourceRdf', 'sourceNode'],
          properties: {
            sourceShEx: {
              type: 'string',
              description: 'ShEx schema for the source shape (may contain `%Map:{ varName %}` annotations).',
            },
            sourceRdf: {
              type: 'string',
              description: 'Turtle-serialised RDF graph containing the source node to validate.',
            },
            sourceNode: {
              type: 'string',
              description: 'IRI (or `IRI@ShapeLabel`) of the focus node in `sourceRdf`.',
            },
            targetShEx: {
              type: 'string',
              description:
                '(Optional) ShEx schema for the target shape. Required for materialisation.',
            },
            targetNode: {
              type: 'string',
              description:
                '(Optional) IRI (or `IRI@ShapeLabel`) for the materialised target node. Required for materialisation.',
            },
          },
          examples: [
            {
              sourceShEx: EXAMPLE_SOURCE_SHEX,
              sourceRdf: EXAMPLE_SOURCE_RDF,
              sourceNode: '<tag:BPfhir123>@<BPfhir>',
              targetShEx: EXAMPLE_TARGET_SHEX,
              targetNode: '<tag:b0>@<BPunitsDAM>',
            },
          ],
        },
        response: {
          200: {
            description: 'Validation result, extracted bindings, and (if requested) materialised target RDF.',
            type: 'object',
            properties: {
              valid: { type: 'boolean', description: 'Whether source RDF validated against `sourceShEx`.' },
              bindings: {
                type: 'object',
                description: 'Flat map of `%Map:{ variable %}` names to their extracted values.',
                additionalProperties: { type: 'string' },
              },
              bindingTree: {
                type: 'object',
                description: 'Hierarchical binding tree mirroring the shape structure.',
              },
              targetRdf: {
                type: 'string',
                description: 'Materialised target RDF in Turtle format (only present when `targetShEx` was supplied).',
              },
              errors: {
                type: 'array',
                items: { type: 'string' },
                description: 'Validation error messages (empty when `valid` is true).',
              },
            },
          },
          400: {
            description: 'Missing required fields.',
            type: 'object',
            properties: { error: { type: 'string' } },
          },
        },
      },
    },
    async (request, reply) => {
      const { sourceShEx, sourceRdf, sourceNode, targetShEx, targetNode } = request.body;
      const result = await validate(sourceShEx, sourceRdf, sourceNode, targetShEx, targetNode);
      return reply.send(result);
    },
  );
};

export default validateRoutes;
