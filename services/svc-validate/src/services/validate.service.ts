import { DataFactory, Parser as N3Parser, Store, Writer as N3Writer } from 'n3';
import type { Quad as N3Quad, NamedNode as N3NamedNode, BlankNode as N3BlankNode } from 'n3';
import { parseShEx } from './shex.service.js';
import type { ValidationResult, BindingNode, BindingEntry } from '../types.js';

const MAP_EXT = 'http://shex.io/extensions/Map/#';

function resolveVar(name: string, prefixes: Record<string, string>): string {
  const i = name.indexOf(':');
  if (i > 0) {
    const pfx = name.slice(0, i);
    const ns = prefixes[pfx] ?? prefixes[pfx + ':'];
    if (ns) return ns + name.slice(i + 1);
  }
  return name;
}

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

function getMapInfo(semActs: { name: string; code?: string }[] | undefined, prefixes: Record<string, string>) {
  if (!semActs) return null;
  const act = semActs.find((a) => a.name === MAP_EXT);
  if (!act?.code) return null;
  const code = act.code.trim();
  if (code.startsWith('regex(')) {
    const m = code.match(/^regex\(\/(.*?)\/([gimsuy]*)\)$/s);
    if (!m || !m[1]) return null;
    return { type: 'regex' as const, body: m[1] };
  }
  return { type: 'var' as const, variable: resolveVar(code, prefixes) };
}

function labelOf(shapeId: string, shapeBase: string): string {
  if (shapeId.startsWith(shapeBase)) return shapeId.slice(shapeBase.length);
  return shapeId.split(/[/#]/).pop() ?? shapeId;
}

function applyReverseRegex(body: string, prefixes: Record<string, string>, bindings: Record<string, string>): string {
  const parts: string[] = [];
  let i = 0;
  while (i < body.length) {
    if (body.startsWith('(?<', i)) {
      const nameEnd = body.indexOf('>', i + 3);
      if (nameEnd < 0) { parts.push(body[i]!); i++; continue; }
      const groupName = body.slice(i + 3, nameEnd);
      let depth = 1, j = nameEnd + 1;
      while (j < body.length && depth > 0) {
        if (body[j] === '(') depth++;
        else if (body[j] === ')') depth--;
        j++;
      }
      parts.push(bindings[resolveVar(groupName, prefixes)] ?? '');
      i = j;
    } else { parts.push(body[i]!); i++; }
  }
  return parts.join('');
}

function focusTerm(focus: string) {
  return focus.startsWith('_:') ? DataFactory.blankNode(focus.slice(2)) : DataFactory.namedNode(focus);
}

function walkShape(shapeId: string, focusNode: string, schema: any, store: Store, prefixes: Record<string, string>, visited: Set<string>, shapeBase: string): BindingNode {
  const node: BindingNode = { shape: labelOf(shapeId, shapeBase), focus: focusNode, bindings: [], children: [] };
  const key = `${shapeId}::${focusNode}`;
  if (visited.has(key)) return node;
  visited.add(key);
  const decl = (schema.shapes as any[] ?? []).find((s: any) => s.id === shapeId);
  if (!decl) return node;
  walkExpr(decl.shapeExpr ?? decl, focusNode, schema, store, prefixes, node, visited, new Set(), shapeBase);
  return node;
}

function walkExpr(expr: any, focus: string, schema: any, store: Store, prefixes: Record<string, string>, node: BindingNode, visited: Set<string>, claimed: Set<string>, shapeBase: string): void {
  if (!expr) return;
  switch (expr.type) {
    case 'ShapeDecl': walkExpr(expr.shapeExpr, focus, schema, store, prefixes, node, visited, claimed, shapeBase); break;
    case 'Shape': walkExpr(expr.expression, focus, schema, store, prefixes, node, visited, new Set(), shapeBase); break;
    case 'EachOf': case 'OneOf':
      for (const e of expr.expressions ?? []) walkExpr(e, focus, schema, store, prefixes, node, visited, claimed, shapeBase);
      break;
    case 'TripleConstraint': walkTriple(expr, focus, schema, store, prefixes, node, visited, claimed, shapeBase); break;
    default:
      if (expr.expression) walkExpr(expr.expression, focus, schema, store, prefixes, node, visited, claimed, shapeBase);
      for (const e of (expr.expressions ?? []) as any[]) walkExpr(e, focus, schema, store, prefixes, node, visited, claimed, shapeBase);
  }
}

function walkTriple(tc: any, focus: string, schema: any, store: Store, prefixes: Record<string, string>, node: BindingNode, visited: Set<string>, claimed: Set<string>, shapeBase: string): void {
  const quads = store.getQuads(focusTerm(focus), DataFactory.namedNode(tc.predicate), null, null);
  const mapInfo = getMapInfo(tc.semActs, prefixes);
  const refId = shapeRefId(tc.valueExpr);
  const ve = tc.valueExpr as any;
  const isInlineShape = ve && typeof ve === 'object' && ['Shape', 'EachOf', 'OneOf'].includes(ve.type);

  for (const quad of quads) {
    const obj = quad.object;
    const childFocus = obj.termType === 'BlankNode' ? `_:${obj.value}` : obj.value;
    if ((refId || isInlineShape) && obj.termType === 'BlankNode' && claimed.has(childFocus)) continue;
    if (mapInfo?.type === 'var') {
      node.bindings.push({ variable: mapInfo.variable, value: obj.value, datatype: obj.termType === 'Literal' ? (obj as any).datatype?.value : undefined });
    } else if (mapInfo?.type === 'regex' && obj.termType === 'Literal') {
      try {
        const nameMap = new Map<string, string>();
        const sanitizedBody = mapInfo.body.replace(/\(\?<([^>]+)>/g, (_: string, name: string) => {
          const safe = name.replace(/[^a-zA-Z0-9_]/g, '_');
          nameMap.set(safe, name);
          return `(?<${safe}>`;
        });
        const m = new RegExp(sanitizedBody).exec(obj.value);
        if (m?.groups) {
          for (const [safeName, value] of Object.entries(m.groups)) {
            if (value !== undefined) node.bindings.push({ variable: resolveVar(nameMap.get(safeName) ?? safeName, prefixes), value });
          }
        }
      } catch { /* malformed regex */ }
    }
    if (obj.termType === 'Literal') continue;
    if (refId) {
      if (obj.termType === 'BlankNode') claimed.add(childFocus);
      const child = walkShape(refId, childFocus, schema, store, prefixes, visited, shapeBase);
      if (child.bindings.length > 0 || child.children.length > 0) node.children.push(child);
      break;
    }
    if (isInlineShape) {
      if (obj.termType === 'BlankNode') claimed.add(childFocus);
      const predLocal = (tc.predicate as string).split(/[/#]/).pop() ?? tc.predicate;
      const inner: BindingNode = { shape: `(@ ${predLocal})`, focus: childFocus, bindings: [], children: [] };
      walkExpr(ve, childFocus, schema, store, prefixes, inner, visited, new Set(), shapeBase);
      if (inner.bindings.length > 0 || inner.children.length > 0) node.children.push(inner);
      break;
    }
  }
}

function materializeShape(shapeId: string, subject: N3NamedNode | N3BlankNode, schema: any, prefixes: Record<string, string>, bindings: Record<string, string>, quads: N3Quad[], counter: { n: number }): void {
  const decl = (schema.shapes as any[] ?? []).find((s: any) => s.id === shapeId);
  if (!decl) return;
  materializeExpr(decl.shapeExpr ?? decl, subject, schema, prefixes, bindings, quads, counter);
}

function materializeExpr(expr: any, subject: N3NamedNode | N3BlankNode, schema: any, prefixes: Record<string, string>, bindings: Record<string, string>, quads: N3Quad[], counter: { n: number }): void {
  if (!expr) return;
  switch (expr.type) {
    case 'ShapeDecl': materializeExpr(expr.shapeExpr, subject, schema, prefixes, bindings, quads, counter); break;
    case 'Shape': materializeExpr(expr.expression, subject, schema, prefixes, bindings, quads, counter); break;
    case 'EachOf': case 'OneOf':
      for (const e of expr.expressions ?? []) materializeExpr(e, subject, schema, prefixes, bindings, quads, counter);
      break;
    case 'TripleConstraint': materializeTriple(expr, subject, schema, prefixes, bindings, quads, counter); break;
  }
}

function materializeTriple(tc: any, subject: N3NamedNode | N3BlankNode, schema: any, prefixes: Record<string, string>, bindings: Record<string, string>, quads: N3Quad[], counter: { n: number }): void {
  const pred = DataFactory.namedNode(tc.predicate as string);
  const mapInfo = getMapInfo(tc.semActs, prefixes);
  if (mapInfo) {
    let value: string | undefined;
    if (mapInfo.type === 'var') value = bindings[mapInfo.variable];
    else { const raw = applyReverseRegex(mapInfo.body, prefixes, bindings); if (raw) value = raw; }
    if (value !== undefined) {
      const dt = (tc.valueExpr as any)?.datatype as string | undefined;
      const obj = dt ? DataFactory.literal(value, DataFactory.namedNode(dt)) : DataFactory.literal(value);
      quads.push(DataFactory.quad(subject, pred, obj) as unknown as N3Quad);
    }
    return;
  }
  const ve = tc.valueExpr as any;
  const refId = shapeRefId(ve);
  if (refId) {
    const bn = DataFactory.blankNode(`b${counter.n++}`) as N3BlankNode;
    const nested: N3Quad[] = [];
    materializeShape(refId, bn, schema, prefixes, bindings, nested, counter);
    if (nested.length > 0) { quads.push(DataFactory.quad(subject, pred, bn) as unknown as N3Quad); quads.push(...nested); }
    return;
  }
  if (!ve || typeof ve !== 'object') return;
  if (['Shape', 'EachOf', 'OneOf'].includes(ve.type as string)) {
    const bn = DataFactory.blankNode(`b${counter.n++}`) as N3BlankNode;
    const nested: N3Quad[] = [];
    materializeExpr(ve, bn, schema, prefixes, bindings, nested, counter);
    if (nested.length > 0) { quads.push(DataFactory.quad(subject, pred, bn) as unknown as N3Quad); quads.push(...nested); }
    return;
  }
  if (ve.type === 'NodeConstraint' && Array.isArray(ve.values) && ve.values.length === 1) {
    const val = ve.values[0];
    if (typeof val === 'string') quads.push(DataFactory.quad(subject, pred, DataFactory.namedNode(val)) as unknown as N3Quad);
    else if (val && typeof val === 'object' && 'value' in val) {
      const obj = val.datatype ? DataFactory.literal(val.value as string, DataFactory.namedNode(val.datatype as string)) : DataFactory.literal(val.value as string);
      quads.push(DataFactory.quad(subject, pred, obj) as unknown as N3Quad);
    }
  }
}

function normalizeFocusNode(raw: string): string {
  let s = raw.trim();
  const atIdx = s.lastIndexOf('@');
  if (atIdx > 0) s = s.slice(0, atIdx).trim();
  if (s.startsWith('<') && s.endsWith('>')) s = s.slice(1, -1);
  return s;
}

export async function validate(
  sourceShEx: string,
  shapeBase: string,
  sourceRdf?: string,
  sourceNode?: string,
  targetShEx?: string,
  targetNode?: string,
): Promise<ValidationResult> {
  const parsed = parseShEx(sourceShEx, shapeBase);
  if (!parsed.valid || !parsed.schema) {
    const msg = `ShEx parse error: ${parsed.error}`;
    return { shexValid: false, shexErrors: [msg], valid: false, bindingTree: [], bindings: {}, errors: [msg] };
  }
  const schema = parsed.schema;

  if (!sourceRdf || sourceRdf.trim() === '') {
    return { shexValid: true, shexErrors: [], valid: true, bindingTree: [], bindings: {}, errors: [] };
  }

  const store = new Store();
  try {
    store.addQuads(new N3Parser({ baseIRI: 'http://example.org/' }).parse(sourceRdf));
  } catch (e: any) {
    const msg = `RDF parse error: ${String(e.message)}`;
    return { shexValid: true, shexErrors: [], rdfValid: false, rdfErrors: [msg], valid: false, bindingTree: [], bindings: {}, errors: [msg] };
  }

  if (!sourceNode || sourceNode.trim() === '') {
    return { shexValid: true, shexErrors: [], rdfValid: true, rdfErrors: [], valid: false, bindingTree: [], bindings: {}, errors: [] };
  }

  sourceNode = normalizeFocusNode(sourceNode);
  if (targetNode) targetNode = normalizeFocusNode(targetNode);

  const prefixes = extractPrefixes(sourceShEx);
  const startId: string | undefined = schema.start;
  if (!startId) {
    return { shexValid: true, shexErrors: [], rdfValid: true, rdfErrors: [], valid: false, bindingTree: [], bindings: {}, errors: ['No start shape defined in ShEx schema'] };
  }

  const bindingTree = [walkShape(startId, sourceNode, schema, store, prefixes, new Set(), shapeBase)];
  const bindings: Record<string, string> = {};
  function flatten(n: BindingNode): void {
    for (const b of n.bindings) { if (!(b.variable in bindings)) bindings[b.variable] = b.value; }
    for (const c of n.children) flatten(c);
  }
  bindingTree.forEach(flatten);

  const errors: string[] = [];
  let targetRdf: string | undefined;
  if (targetShEx) {
    try {
      const tParsed = parseShEx(targetShEx, shapeBase);
      if (tParsed.valid && tParsed.schema) {
        const tPrefixes = extractPrefixes(targetShEx);
        const tStart: string | undefined = tParsed.schema.start;
        if (tStart) {
          const tNodeIri = targetNode ?? 'http://materialized.example/result';
          const matQuads: N3Quad[] = [];
          materializeShape(tStart, DataFactory.namedNode(tNodeIri) as N3NamedNode, tParsed.schema, tPrefixes, bindings, matQuads, { n: 0 });
          targetRdf = await new Promise<string>((resolve, reject) => {
            const writer = new N3Writer({ prefixes: tPrefixes });
            for (const q of matQuads) writer.addQuad(q);
            writer.end((err: Error | null, result: string) => (err ? reject(err) : resolve(result)));
          });
        }
      }
    } catch (e: any) {
      errors.push(`Materialization error: ${String(e.message)}`);
    }
  }

  return { shexValid: true, shexErrors: [], rdfValid: true, rdfErrors: [], valid: Object.keys(bindings).length > 0, bindingTree, bindings, targetRdf, errors };
}
