import { createRequire } from 'module';
import { DataFactory, Parser as N3Parser, Store, Writer as N3Writer } from 'n3';
import type { Quad as N3Quad, NamedNode as N3NamedNode, BlankNode as N3BlankNode } from 'n3';
import { config } from '../config.js';

const _require = createRequire(import.meta.url);
const shexParserLib = _require('@shexjs/parser') as {
  construct: (base?: string, opts?: Record<string, unknown>) => { parse: (s: string) => any };
};

const MAP_EXT = 'http://shex.io/extensions/Map/#';
const SHAPE_BASE = `${config.rdf.baseNamespace}shapes/`;

// ── Types ─────────────────────────────────────────────────────────────────────

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

// ── Helpers ───────────────────────────────────────────────────────────────────

function resolveVar(name: string, prefixes: Record<string, string>): string {
  const i = name.indexOf(':');
  if (i > 0) {
    const pfx = name.slice(0, i);
    const ns = prefixes[pfx] ?? prefixes[pfx + ':'];
    if (ns) return ns + name.slice(i + 1);
  }
  return name;
}

/** Extract PREFIX declarations directly from ShExC text (more reliable than schema.prefixes). */
function extractPrefixes(shexText: string): Record<string, string> {
  const prefixes: Record<string, string> = {};
  for (const m of shexText.matchAll(/^PREFIX\s+(\w*):\s*<([^>]+)>/gim)) {
    prefixes[m[1]!] = m[2]!;
  }
  return prefixes;
}

function shapeRefId(valueExpr: unknown): string | null {
  if (typeof valueExpr === 'string') return valueExpr;
  const ve = valueExpr as Record<string, unknown> | null | undefined;
  if (!ve) return null;
  if (ve['type'] === 'ShapeRef' && typeof ve['reference'] === 'string') return ve['reference'];
  return null;
}

function getMapInfo(
  semActs: { name: string; code?: string }[] | undefined,
  prefixes: Record<string, string>,
): { type: 'var'; variable: string } | { type: 'regex'; body: string } | null {
  if (!semActs) return null;
  const act = semActs.find((a) => a.name === MAP_EXT);
  if (!act?.code) return null;
  const code = act.code.trim();
  if (code.startsWith('regex(')) {
    const m = code.match(/^regex\(\/(.*?)\/([gimsuy]*)\)$/s);
    if (!m || !m[1]) return null;
    return { type: 'regex', body: m[1] };
  }
  return { type: 'var', variable: resolveVar(code, prefixes) };
}

function labelOf(shapeId: string): string {
  if (shapeId.startsWith(SHAPE_BASE)) return shapeId.slice(SHAPE_BASE.length);
  return shapeId.split(/[/#]/).pop() ?? shapeId;
}

/** Replace (?<name>...) groups in a regex body with binding values. */
function applyReverseRegex(
  body: string,
  prefixes: Record<string, string>,
  bindings: Record<string, string>,
): string {
  const parts: string[] = [];
  let i = 0;
  while (i < body.length) {
    if (body.startsWith('(?<', i)) {
      const nameEnd = body.indexOf('>', i + 3);
      if (nameEnd < 0) { parts.push(body[i]!); i++; continue; }
      const groupName = body.slice(i + 3, nameEnd);
      // Find the matching closing paren via bracket counting
      let depth = 1;
      let j = nameEnd + 1;
      while (j < body.length && depth > 0) {
        if (body[j] === '(') depth++;
        else if (body[j] === ')') depth--;
        j++;
      }
      parts.push(bindings[resolveVar(groupName, prefixes)] ?? '');
      i = j;
    } else {
      parts.push(body[i]!);
      i++;
    }
  }
  return parts.join('');
}

// ── Validation walker ─────────────────────────────────────────────────────────

/** Return the RDF term for a focus string. Blank nodes are encoded as "_:localId". */
function focusTerm(focus: string) {
  return focus.startsWith('_:')
    ? DataFactory.blankNode(focus.slice(2))
    : DataFactory.namedNode(focus);
}

function walkShape(
  shapeId: string,
  focusNode: string,
  schema: any,
  store: Store,
  prefixes: Record<string, string>,
  visited: Set<string>,
): BindingNode {
  const node: BindingNode = {
    shape: labelOf(shapeId),
    focus: focusNode,
    bindings: [],
    children: [],
  };
  const key = `${shapeId}::${focusNode}`;
  if (visited.has(key)) return node;
  visited.add(key);

  const decl = (schema.shapes as any[] ?? []).find((s: any) => s.id === shapeId);
  if (!decl) return node;

  // Each Shape scope gets a fresh claimed set so sibling triple constraints
  // don't steal each other's blank node objects (e.g. two fhir:component refs).
  walkExpr(decl.shapeExpr ?? decl, focusNode, schema, store, prefixes, node, visited, new Set());
  return node;
}

function walkExpr(
  expr: any,
  focus: string,
  schema: any,
  store: Store,
  prefixes: Record<string, string>,
  node: BindingNode,
  visited: Set<string>,
  claimed: Set<string>,   // blank-node childFocus values already taken by sibling constraints
): void {
  if (!expr) return;
  switch (expr.type) {
    case 'ShapeDecl':
      walkExpr(expr.shapeExpr, focus, schema, store, prefixes, node, visited, claimed);
      break;
    case 'Shape':
      // New Shape scope → fresh claimed set
      walkExpr(expr.expression, focus, schema, store, prefixes, node, visited, new Set());
      break;
    case 'EachOf':
    case 'OneOf':
      // Share the same claimed set across all sibling expressions
      for (const e of expr.expressions ?? []) {
        walkExpr(e, focus, schema, store, prefixes, node, visited, claimed);
      }
      break;
    case 'TripleConstraint':
      walkTriple(expr, focus, schema, store, prefixes, node, visited, claimed);
      break;
    default:
      if (expr.expression) walkExpr(expr.expression, focus, schema, store, prefixes, node, visited, claimed);
      for (const e of (expr.expressions ?? []) as any[]) {
        walkExpr(e, focus, schema, store, prefixes, node, visited, claimed);
      }
  }
}

function walkTriple(
  tc: any,
  focus: string,
  schema: any,
  store: Store,
  prefixes: Record<string, string>,
  node: BindingNode,
  visited: Set<string>,
  claimed: Set<string>,
): void {
  const quads = store.getQuads(focusTerm(focus), DataFactory.namedNode(tc.predicate), null, null);
  const mapInfo = getMapInfo(tc.semActs, prefixes);
  const refId = shapeRefId(tc.valueExpr);
  const ve = tc.valueExpr as any;
  const isInlineShape = ve && typeof ve === 'object' && ['Shape', 'EachOf', 'OneOf'].includes(ve.type);

  for (const quad of quads) {
    const obj = quad.object;
    const childFocus = obj.termType === 'BlankNode' ? `_:${obj.value}` : obj.value;

    // For shape references, skip blank nodes already claimed by a sibling constraint
    if ((refId || isInlineShape) && obj.termType === 'BlankNode' && claimed.has(childFocus)) continue;

    // Record binding(s) if there's a Map annotation on this triple constraint
    if (mapInfo?.type === 'var') {
      node.bindings.push({
        variable: mapInfo.variable,
        value: obj.value,
        datatype: obj.termType === 'Literal' ? (obj as any).datatype?.value : undefined,
      });
    } else if (mapInfo?.type === 'regex' && obj.termType === 'Literal') {
      // JS named capture groups don't allow ':' in names — sanitize and map back
      try {
        const nameMap = new Map<string, string>(); // sanitized → original
        const sanitizedBody = mapInfo.body.replace(
          /\(\?<([^>]+)>/g,
          (_: string, name: string) => {
            const safe = name.replace(/[^a-zA-Z0-9_]/g, '_');
            nameMap.set(safe, name);
            return `(?<${safe}>`;
          },
        );
        const rx = new RegExp(sanitizedBody);
        const m = rx.exec(obj.value);
        if (m?.groups) {
          for (const [safeName, value] of Object.entries(m.groups)) {
            if (value !== undefined) {
              const origName = nameMap.get(safeName) ?? safeName;
              node.bindings.push({ variable: resolveVar(origName, prefixes), value });
            }
          }
        }
      } catch { /* malformed regex — skip */ }
    }

    if (obj.termType === 'Literal') continue;

    // Shape reference → claim the first unclaimed blank node and stop.
    // Only one match per constraint is needed; claiming prevents sibling
    // constraints with the same predicate from stealing this node.
    if (refId) {
      if (obj.termType === 'BlankNode') claimed.add(childFocus);
      const child = walkShape(refId, childFocus, schema, store, prefixes, visited);
      if (child.bindings.length > 0 || child.children.length > 0) node.children.push(child);
      break; // one node per shape-reference constraint
    }

    // Inline shape expression — same single-match semantics
    if (isInlineShape) {
      if (obj.termType === 'BlankNode') claimed.add(childFocus);
      const predLocal = (tc.predicate as string).split(/[/#]/).pop() ?? tc.predicate;
      const inner: BindingNode = {
        shape: `(@ ${predLocal})`,
        focus: childFocus,
        bindings: [],
        children: [],
      };
      walkExpr(ve, childFocus, schema, store, prefixes, inner, visited, new Set());
      if (inner.bindings.length > 0 || inner.children.length > 0) node.children.push(inner);
      break; // one node per inline-shape constraint
    }
  }
}

// ── Materialization walker ────────────────────────────────────────────────────

function materializeShape(
  shapeId: string,
  subject: N3NamedNode | N3BlankNode,
  schema: any,
  prefixes: Record<string, string>,
  bindings: Record<string, string>,
  quads: N3Quad[],
  counter: { n: number },
): void {
  const decl = (schema.shapes as any[] ?? []).find((s: any) => s.id === shapeId);
  if (!decl) return;
  materializeExpr(decl.shapeExpr ?? decl, subject, schema, prefixes, bindings, quads, counter);
}

function materializeExpr(
  expr: any,
  subject: N3NamedNode | N3BlankNode,
  schema: any,
  prefixes: Record<string, string>,
  bindings: Record<string, string>,
  quads: N3Quad[],
  counter: { n: number },
): void {
  if (!expr) return;
  switch (expr.type) {
    case 'ShapeDecl':
      materializeExpr(expr.shapeExpr, subject, schema, prefixes, bindings, quads, counter);
      break;
    case 'Shape':
      materializeExpr(expr.expression, subject, schema, prefixes, bindings, quads, counter);
      break;
    case 'EachOf':
    case 'OneOf':
      for (const e of expr.expressions ?? []) {
        materializeExpr(e, subject, schema, prefixes, bindings, quads, counter);
      }
      break;
    case 'TripleConstraint':
      materializeTriple(expr, subject, schema, prefixes, bindings, quads, counter);
      break;
  }
}

function materializeTriple(
  tc: any,
  subject: N3NamedNode | N3BlankNode,
  schema: any,
  prefixes: Record<string, string>,
  bindings: Record<string, string>,
  quads: N3Quad[],
  counter: { n: number },
): void {
  const pred = DataFactory.namedNode(tc.predicate as string);
  const mapInfo = getMapInfo(tc.semActs, prefixes);

  if (mapInfo) {
    let value: string | undefined;
    if (mapInfo.type === 'var') {
      value = bindings[mapInfo.variable];
    } else {
      const raw = applyReverseRegex(mapInfo.body, prefixes, bindings);
      if (raw) value = raw;
    }
    if (value !== undefined) {
      const dt = (tc.valueExpr as any)?.datatype as string | undefined;
      const obj = dt
        ? DataFactory.literal(value, DataFactory.namedNode(dt))
        : DataFactory.literal(value);
      quads.push(DataFactory.quad(subject, pred, obj) as unknown as N3Quad);
    }
    return;
  }

  // No Map annotation — check for shape reference, inline shape, or constant value
  const ve = tc.valueExpr as any;

  // Shape reference (valueExpr is a plain IRI string, or {type:'ShapeRef',...})
  const refId = shapeRefId(ve);
  if (refId) {
    const bn = DataFactory.blankNode(`b${counter.n++}`) as N3BlankNode;
    const nestedQuads: N3Quad[] = [];
    materializeShape(refId, bn, schema, prefixes, bindings, nestedQuads, counter);
    if (nestedQuads.length > 0) {
      quads.push(DataFactory.quad(subject, pred, bn) as unknown as N3Quad);
      quads.push(...nestedQuads);
    }
    return;
  }

  if (!ve || typeof ve !== 'object') return;

  // Inline shape expression
  if (['Shape', 'EachOf', 'OneOf'].includes(ve.type as string)) {
    const bn = DataFactory.blankNode(`b${counter.n++}`) as N3BlankNode;
    const nestedQuads: N3Quad[] = [];
    materializeExpr(ve, bn, schema, prefixes, bindings, nestedQuads, counter);
    if (nestedQuads.length > 0) {
      quads.push(DataFactory.quad(subject, pred, bn) as unknown as N3Quad);
      quads.push(...nestedQuads);
    }
    return;
  }

  // NodeConstraint with a single constant value (e.g. [fhir:Observation], [sct:Blood_Pressure])
  if (ve.type === 'NodeConstraint' && Array.isArray(ve.values) && ve.values.length === 1) {
    const val = ve.values[0];
    if (typeof val === 'string') {
      // IRI constant
      quads.push(DataFactory.quad(subject, pred, DataFactory.namedNode(val)) as unknown as N3Quad);
    } else if (val && typeof val === 'object' && 'value' in val) {
      // Literal constant
      const obj = val.datatype
        ? DataFactory.literal(val.value as string, DataFactory.namedNode(val.datatype as string))
        : DataFactory.literal(val.value as string);
      quads.push(DataFactory.quad(subject, pred, obj) as unknown as N3Quad);
    }
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Normalise a focus-node value entered by the user.
 *
 * Accepts several common formats:
 *   <tag:BPfhir123>@START   → tag:BPfhir123
 *   <http://ex.org/node1>   → http://ex.org/node1
 *   http://ex.org/node1     → http://ex.org/node1
 *   tag:BPfhir123           → tag:BPfhir123
 *
 * The @ShapeName suffix (e.g. @START) is stripped because this validator
 * always validates against schema.start automatically.
 */
function normalizeFocusNode(raw: string): string {
  let s = raw.trim();
  // Strip @ShapeName or @START suffix (before stripping brackets)
  const atIdx = s.lastIndexOf('@');
  if (atIdx > 0) s = s.slice(0, atIdx).trim();
  // Strip surrounding angle brackets
  if (s.startsWith('<') && s.endsWith('>')) s = s.slice(1, -1);
  return s;
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function validate(
  sourceShEx: string,
  sourceRdf?: string,
  sourceNode?: string,
  targetShEx?: string,
  targetNode?: string,
): Promise<ValidationResult> {
  // 1. Parse source ShEx
  let schema: any;
  try {
    schema = shexParserLib.construct(SHAPE_BASE, {}).parse(sourceShEx);
  } catch (e: any) {
    const msg = `ShEx parse error: ${String(e.message)}`;
    return { shexValid: false, shexErrors: [msg], valid: false, bindingTree: [], bindings: {}, errors: [msg] };
  }

  // ShEx-only check — no RDF provided
  if (!sourceRdf || sourceRdf.trim() === '') {
    return { shexValid: true, shexErrors: [], valid: true, bindingTree: [], bindings: {}, errors: [] };
  }

  // 2. Parse source RDF
  const store = new Store();
  try {
    const rdfParser = new N3Parser({ baseIRI: 'http://example.org/' });
    store.addQuads(rdfParser.parse(sourceRdf));
  } catch (e: any) {
    const msg = `RDF parse error: ${String(e.message)}`;
    return { shexValid: true, shexErrors: [], rdfValid: false, rdfErrors: [msg], valid: false, bindingTree: [], bindings: {}, errors: [msg] };
  }

  // RDF provided but no focus node — return shex + rdf validation only
  if (!sourceNode || sourceNode.trim() === '') {
    return { shexValid: true, shexErrors: [], rdfValid: true, rdfErrors: [], valid: false, bindingTree: [], bindings: {}, errors: [] };
  }

  // Normalise focus node (strips angle brackets and @ShapeName suffix)
  sourceNode = normalizeFocusNode(sourceNode);
  if (targetNode) targetNode = normalizeFocusNode(targetNode);

  // 3. Build prefix map directly from ShExC text (parser's schema.prefixes is unreliable at alpha.28)
  const prefixes = extractPrefixes(sourceShEx);

  // 4. Find start shape and walk
  const startId: string | undefined = schema.start;
  if (!startId) {
    return { shexValid: true, shexErrors: [], rdfValid: true, rdfErrors: [], valid: false, bindingTree: [], bindings: {}, errors: ['No start shape defined in ShEx schema'] };
  }

  const bindingTree = [walkShape(startId, sourceNode, schema, store, prefixes, new Set())];

  // 5. Flatten bindings
  const bindings: Record<string, string> = {};
  function flatten(n: BindingNode): void {
    for (const b of n.bindings) {
      if (!(b.variable in bindings)) bindings[b.variable] = b.value;
    }
    for (const c of n.children) flatten(c);
  }
  bindingTree.forEach(flatten);

  // 6. Materialize target if requested
  const errors: string[] = [];
  let targetRdf: string | undefined;
  if (targetShEx) {
    try {
      const tSchema = shexParserLib.construct(SHAPE_BASE, {}).parse(targetShEx);
      const tPrefixes = extractPrefixes(targetShEx);

      const tStart: string | undefined = tSchema.start;
      if (tStart) {
        const tNodeIri = targetNode ?? 'http://materialized.example/result';
        const matQuads: N3Quad[] = [];
        materializeShape(tStart, DataFactory.namedNode(tNodeIri) as N3NamedNode, tSchema, tPrefixes, bindings, matQuads, { n: 0 });
        targetRdf = await new Promise<string>((resolve, reject) => {
          const writer = new N3Writer({ prefixes: tPrefixes });
          for (const q of matQuads) writer.addQuad(q);
          writer.end((err: Error | null, result: string) => (err ? reject(err) : resolve(result)));
        });
      }
    } catch (e: any) {
      errors.push(`Materialization error: ${String(e.message)}`);
    }
  }

  return {
    shexValid: true,
    shexErrors: [],
    rdfValid: true,
    rdfErrors: [],
    valid: Object.keys(bindings).length > 0,
    bindingTree,
    bindings,
    targetRdf,
    errors,
  };
}
