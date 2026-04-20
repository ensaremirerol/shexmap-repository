import { describe, it, expect } from 'vitest';
import { validate } from '../src/services/validate.service.js';

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
    expect(result.bindings['http://shex.io/extensions/Map/#BPDAM->given']).toBe('Alice');
    expect(result.bindings['http://shex.io/extensions/Map/#BPDAM->family']).toBe('Walker');
  });
});
