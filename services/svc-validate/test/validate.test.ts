import { describe, it, expect } from 'vitest';
import { validate } from '../src/services/validate.service.js';
import { parseShEx } from '../src/services/shex.service.js';

const SHAPE_BASE = 'https://w3id.org/shexmap/shapes/';

const SOURCE_SHEX = `PREFIX fhir: <http://hl7.org/fhir-rdf/>
PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
PREFIX bp: <http://shex.io/extensions/Map/#BPDAM->
PREFIX Map: <http://shex.io/extensions/Map/#>

start = @<BPfhir>

<BPfhir> {
  fhir:givenName xsd:string %Map:{ bp:given %};
  fhir:familyName xsd:string %Map:{ bp:family %}
}`;

const SOURCE_RDF = `PREFIX fhir: <http://hl7.org/fhir-rdf/>
PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>

<tag:node1> fhir:givenName "Alice" ; fhir:familyName "Walker" .`;

const TARGET_SHEX = `PREFIX fhir: <http://hl7.org/fhir-rdf/>
PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
PREFIX bp: <http://shex.io/extensions/Map/#BPDAM->
PREFIX Map: <http://shex.io/extensions/Map/#>

start = @<BPtarget>

<BPtarget> {
  fhir:givenName xsd:string %Map:{ bp:given %};
  fhir:familyName xsd:string %Map:{ bp:family %}
}`;

describe('parseShEx', () => {
  it('returns valid=true for a parseable ShEx', () => {
    const r = parseShEx(SOURCE_SHEX, SHAPE_BASE);
    expect(r.valid).toBe(true);
    expect(r.schema).toBeDefined();
  });

  it('returns valid=false for malformed ShEx', () => {
    const r = parseShEx('not shex !!!', SHAPE_BASE);
    expect(r.valid).toBe(false);
    expect(r.error).toBeDefined();
  });
});

describe('validate service', () => {
  it('returns shexValid=true for a valid ShEx schema (no RDF)', async () => {
    const result = await validate(SOURCE_SHEX, SHAPE_BASE);
    expect(result.shexValid).toBe(true);
    expect(result.shexErrors).toHaveLength(0);
  });

  it('returns shexValid=false for malformed ShEx', async () => {
    const result = await validate('this is not shex !!!', SHAPE_BASE);
    expect(result.shexValid).toBe(false);
    expect(result.shexErrors.length).toBeGreaterThan(0);
  });

  it('extracts bindings from source RDF', async () => {
    const result = await validate(SOURCE_SHEX, SHAPE_BASE, SOURCE_RDF, '<tag:node1>');
    expect(result.shexValid).toBe(true);
    expect(result.rdfValid).toBe(true);
    expect(result.bindings['http://shex.io/extensions/Map/#BPDAM-given']).toBe('Alice');
    expect(result.bindings['http://shex.io/extensions/Map/#BPDAM-family']).toBe('Walker');
  });

  it('returns rdfValid=false for malformed Turtle', async () => {
    const result = await validate(SOURCE_SHEX, SHAPE_BASE, 'this is not turtle !!!');
    expect(result.shexValid).toBe(true);
    expect(result.rdfValid).toBe(false);
    expect(result.rdfErrors).toBeDefined();
    expect(result.rdfErrors!.length).toBeGreaterThan(0);
    expect(result.valid).toBe(false);
  });

  it('returns valid=false when RDF is provided but no focus node given', async () => {
    const result = await validate(SOURCE_SHEX, SHAPE_BASE, SOURCE_RDF);
    expect(result.shexValid).toBe(true);
    expect(result.rdfValid).toBe(true);
    expect(result.valid).toBe(false);
    expect(result.bindingTree).toHaveLength(0);
  });

  it('returns error when ShEx has no start shape', async () => {
    const noStartShEx = `PREFIX fhir: <http://hl7.org/fhir-rdf/>
PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
<BPfhir> { fhir:givenName xsd:string }`;
    const result = await validate(noStartShEx, SHAPE_BASE, SOURCE_RDF, '<tag:node1>');
    expect(result.shexValid).toBe(true);
    expect(result.rdfValid).toBe(true);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('No start shape defined in ShEx schema');
  });

  it('materialises target RDF given source bindings', async () => {
    const result = await validate(SOURCE_SHEX, SHAPE_BASE, SOURCE_RDF, '<tag:node1>', TARGET_SHEX, '<tag:result1>');
    expect(result.shexValid).toBe(true);
    expect(result.valid).toBe(true);
    expect(result.targetRdf).toBeDefined();
    expect(result.targetRdf).toContain('Alice');
    expect(result.targetRdf).toContain('Walker');
  });

  it('materialises using default IRI when targetNode is omitted', async () => {
    const result = await validate(SOURCE_SHEX, SHAPE_BASE, SOURCE_RDF, '<tag:node1>', TARGET_SHEX);
    expect(result.targetRdf).toBeDefined();
    expect(result.targetRdf).toContain('http://materialized.example/result');
  });

  it('handles blank-node focus IRI without crashing', async () => {
    // N3 renames blank node IDs internally, so external _:b0 won't match — but the
    // code path through focusTerm() must not throw; it returns empty bindings.
    const bNodeRDF = `PREFIX fhir: <http://hl7.org/fhir-rdf/>
_:b0 fhir:givenName "Bob" ; fhir:familyName "Smith" .`;
    const result = await validate(SOURCE_SHEX, SHAPE_BASE, bNodeRDF, '_:b0');
    expect(result.shexValid).toBe(true);
    expect(result.rdfValid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('normalises focus node with angle brackets', async () => {
    const result = await validate(SOURCE_SHEX, SHAPE_BASE, SOURCE_RDF, '<tag:node1>');
    expect(result.bindings['http://shex.io/extensions/Map/#BPDAM-given']).toBe('Alice');
  });

  it('normalises focus node with @ShapeLabel suffix', async () => {
    const result = await validate(SOURCE_SHEX, SHAPE_BASE, SOURCE_RDF, 'tag:node1@<BPfhir>');
    expect(result.bindings['http://shex.io/extensions/Map/#BPDAM-given']).toBe('Alice');
  });

  it('extracts bindings from nested shape via refId', async () => {
    const NESTED_SHEX = `PREFIX fhir: <http://hl7.org/fhir-rdf/>
PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
PREFIX bp: <http://shex.io/extensions/Map/#BPDAM->
PREFIX Map: <http://shex.io/extensions/Map/#>

start = @<Person>

<Person> {
  fhir:name @<Name>
}

<Name> {
  fhir:givenName xsd:string %Map:{ bp:given %};
  fhir:familyName xsd:string %Map:{ bp:family %}
}`;
    const NESTED_RDF = `PREFIX fhir: <http://hl7.org/fhir-rdf/>
<tag:person1> fhir:name _:name1 .
_:name1 fhir:givenName "Alice" ; fhir:familyName "Walker" .`;
    const result = await validate(NESTED_SHEX, SHAPE_BASE, NESTED_RDF, '<tag:person1>');
    expect(result.bindings['http://shex.io/extensions/Map/#BPDAM-given']).toBe('Alice');
    expect(result.bindings['http://shex.io/extensions/Map/#BPDAM-family']).toBe('Walker');
  });

  it('extracts bindings from inline shape', async () => {
    const INLINE_SHEX = `PREFIX fhir: <http://hl7.org/fhir-rdf/>
PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
PREFIX bp: <http://shex.io/extensions/Map/#BPDAM->
PREFIX Map: <http://shex.io/extensions/Map/#>

start = @<Person>

<Person> {
  fhir:name {
    fhir:givenName xsd:string %Map:{ bp:given %};
    fhir:familyName xsd:string %Map:{ bp:family %}
  }
}`;
    const INLINE_RDF = `PREFIX fhir: <http://hl7.org/fhir-rdf/>
<tag:person2> fhir:name _:n1 .
_:n1 fhir:givenName "Carol" ; fhir:familyName "Jones" .`;
    const result = await validate(INLINE_SHEX, SHAPE_BASE, INLINE_RDF, '<tag:person2>');
    expect(result.bindings['http://shex.io/extensions/Map/#BPDAM-given']).toBe('Carol');
  });

  it('extracts bindings via regex Map extension', async () => {
    const REGEX_SHEX = `PREFIX fhir: <http://hl7.org/fhir-rdf/>
PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
PREFIX bp: <http://shex.io/extensions/Map/#BPDAM->
PREFIX Map: <http://shex.io/extensions/Map/#>

start = @<Patient>

<Patient> {
  fhir:fullName xsd:string %Map:{ regex(/(?<bp:given>[^ ]+) (?<bp:family>.+)/) %}
}`;
    const REGEX_RDF = `PREFIX fhir: <http://hl7.org/fhir-rdf/>
<tag:p1> fhir:fullName "Alice Walker" .`;
    const result = await validate(REGEX_SHEX, SHAPE_BASE, REGEX_RDF, '<tag:p1>');
    expect(result.shexValid).toBe(true);
    expect(result.bindings['http://shex.io/extensions/Map/#BPDAM-given']).toBe('Alice');
    expect(result.bindings['http://shex.io/extensions/Map/#BPDAM-family']).toBe('Walker');
  });

  it('materialises target RDF using regex reverse mapping', async () => {
    const REGEX_SHEX = `PREFIX fhir: <http://hl7.org/fhir-rdf/>
PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
PREFIX bp: <http://shex.io/extensions/Map/#BPDAM->
PREFIX Map: <http://shex.io/extensions/Map/#>

start = @<Patient>

<Patient> {
  fhir:fullName xsd:string %Map:{ regex(/(?<bp:given>[^ ]+) (?<bp:family>.+)/) %}
}`;
    const REGEX_RDF = `PREFIX fhir: <http://hl7.org/fhir-rdf/>
<tag:p1> fhir:fullName "Alice Walker" .`;
    const result = await validate(REGEX_SHEX, SHAPE_BASE, REGEX_RDF, '<tag:p1>', REGEX_SHEX, '<tag:out1>');
    expect(result.targetRdf).toBeDefined();
    expect(result.targetRdf).toContain('Alice Walker');
  });

  it('materialises target RDF with NodeConstraint fixed IRI value', async () => {
    const TARGET_WITH_TYPE = `PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
PREFIX fhir: <http://hl7.org/fhir-rdf/>
PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
PREFIX bp: <http://shex.io/extensions/Map/#BPDAM->
PREFIX Map: <http://shex.io/extensions/Map/#>

start = @<BPtarget>

<BPtarget> {
  rdf:type [ <http://hl7.org/fhir-rdf/BloodPressure> ];
  fhir:givenName xsd:string %Map:{ bp:given %};
  fhir:familyName xsd:string %Map:{ bp:family %}
}`;
    const result = await validate(SOURCE_SHEX, SHAPE_BASE, SOURCE_RDF, '<tag:node1>', TARGET_WITH_TYPE, '<tag:result2>');
    expect(result.targetRdf).toBeDefined();
    expect(result.targetRdf).toContain('BloodPressure');
    expect(result.targetRdf).toContain('Alice');
  });

  it('materialises NodeConstraint with fixed literal value', async () => {
    const TARGET_WITH_LITERAL = `PREFIX fhir: <http://hl7.org/fhir-rdf/>
PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
PREFIX bp: <http://shex.io/extensions/Map/#BPDAM->
PREFIX Map: <http://shex.io/extensions/Map/#>

start = @<BPtarget>

<BPtarget> {
  fhir:version [ "2.0"^^xsd:string ];
  fhir:givenName xsd:string %Map:{ bp:given %};
  fhir:familyName xsd:string %Map:{ bp:family %}
}`;
    const result = await validate(SOURCE_SHEX, SHAPE_BASE, SOURCE_RDF, '<tag:node1>', TARGET_WITH_LITERAL, '<tag:result3>');
    expect(result.targetRdf).toBeDefined();
    expect(result.targetRdf).toContain('2.0');
    expect(result.targetRdf).toContain('Alice');
  });

  it('materialises target RDF with inline shape expression', async () => {
    const SRC_SHEX = `PREFIX fhir: <http://hl7.org/fhir-rdf/>
PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
PREFIX bp: <http://shex.io/extensions/Map/#BPDAM->
PREFIX Map: <http://shex.io/extensions/Map/#>
start = @<Person>
<Person> { fhir:name @<Name> }
<Name> {
  fhir:givenName xsd:string %Map:{ bp:given %};
  fhir:familyName xsd:string %Map:{ bp:family %}
}`;
    const SRC_RDF = `PREFIX fhir: <http://hl7.org/fhir-rdf/>
<tag:p1> fhir:name _:n1 .
_:n1 fhir:givenName "Alice" ; fhir:familyName "Walker" .`;
    const INLINE_TGT_SHEX = `PREFIX fhir: <http://hl7.org/fhir-rdf/>
PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
PREFIX bp: <http://shex.io/extensions/Map/#BPDAM->
PREFIX Map: <http://shex.io/extensions/Map/#>
start = @<PersonOut>
<PersonOut> {
  fhir:name {
    fhir:givenName xsd:string %Map:{ bp:given %};
    fhir:familyName xsd:string %Map:{ bp:family %}
  }
}`;
    const result = await validate(SRC_SHEX, SHAPE_BASE, SRC_RDF, '<tag:p1>', INLINE_TGT_SHEX, '<tag:out1>');
    expect(result.targetRdf).toBeDefined();
    expect(result.targetRdf).toContain('Alice');
    expect(result.targetRdf).toContain('Walker');
  });

  it('materialises nested target shapes via refId', async () => {
    const NESTED_SRC_SHEX = `PREFIX fhir: <http://hl7.org/fhir-rdf/>
PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
PREFIX bp: <http://shex.io/extensions/Map/#BPDAM->
PREFIX Map: <http://shex.io/extensions/Map/#>

start = @<Person>

<Person> { fhir:name @<Name> }

<Name> {
  fhir:givenName xsd:string %Map:{ bp:given %};
  fhir:familyName xsd:string %Map:{ bp:family %}
}`;
    const NESTED_SRC_RDF = `PREFIX fhir: <http://hl7.org/fhir-rdf/>
<tag:person1> fhir:name _:n1 .
_:n1 fhir:givenName "Alice" ; fhir:familyName "Walker" .`;

    const NESTED_TGT_SHEX = `PREFIX fhir: <http://hl7.org/fhir-rdf/>
PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
PREFIX bp: <http://shex.io/extensions/Map/#BPDAM->
PREFIX Map: <http://shex.io/extensions/Map/#>

start = @<PersonOut>

<PersonOut> { fhir:name @<NameOut> }

<NameOut> {
  fhir:givenName xsd:string %Map:{ bp:given %};
  fhir:familyName xsd:string %Map:{ bp:family %}
}`;
    const result = await validate(NESTED_SRC_SHEX, SHAPE_BASE, NESTED_SRC_RDF, '<tag:person1>', NESTED_TGT_SHEX, '<tag:out1>');
    expect(result.targetRdf).toBeDefined();
    expect(result.targetRdf).toContain('Alice');
    expect(result.targetRdf).toContain('Walker');
  });
});
