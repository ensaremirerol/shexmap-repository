/**
 * ShEx language support for Monaco Editor.
 *
 * Registers the "shexc" language with:
 *  - Syntax tokenizer (highlighting)
 *  - Completion provider (keywords, common constructs)
 *  - Diagnostic markers via @shexjs/parser
 *  - Hover provider for common keywords
 */

import type * as Monaco from 'monaco-editor';

export const SHEXC_LANGUAGE_ID = 'shexc';

// ─── Tokenizer ────────────────────────────────────────────────────────────────

const SHEXC_LANGUAGE_DEF: Monaco.languages.IMonarchLanguage = {
  defaultToken: '',
  tokenPostfix: '.shexc',

  keywords: [
    'BASE', 'PREFIX', 'IMPORT', 'EXTERNAL', 'ABSTRACT', 'CLOSED', 'EXTRA',
    'LITERAL', 'IRI', 'BNODE', 'NONLITERAL', 'AND', 'OR', 'NOT', 'START',
    'VIRTUAL', 'EXTENDS', 'RESTRICTS',
  ],

  operators: ['@', '^', '~', '|', '&', '!', '?', '*', '+', '->', '=>'],

  tokenizer: {
    root: [
      // Blank lines / whitespace
      [/\s+/, ''],

      // Line comments
      [/#.*$/, 'comment'],

      // BASE / PREFIX / IMPORT directives
      [/\b(BASE|PREFIX|IMPORT)\b/, 'keyword'],

      // ShExMap variable annotations: %Map:{ varName %}
      [/%Map:\{[^%]*%\}/, 'annotation'],

      // Regex named-capture variables: (?<ns:name>...)
      [/\(\?<[^>]+:[^>]+>/, 'annotation'],

      // Regex plain named captures: (?<name>...)
      [/\(\?<[^>]+>/, 'variable'],

      // IRI references: <...>
      [/<[^>]*>/, 'string.iri'],

      // Prefixed names: ns:local
      [/[A-Za-z_][A-Za-z0-9_\-.]*:[A-Za-z0-9_\-.]*/, 'type'],

      // Blank nodes: _:local
      [/_:[A-Za-z0-9_\-.]+/, 'variable.predefined'],

      // String literals: double-quoted (triple first)
      [/"""/, { token: 'string.delim', next: '@tripleDouble' }],
      [/"/, { token: 'string.delim', next: '@double' }],
      // String literals: single-quoted (triple first)
      [/'''/, { token: 'string.delim', next: '@tripleSingle' }],
      [/'/, { token: 'string.delim', next: '@single' }],

      // Language tags
      [/@[A-Za-z][-A-Za-z0-9]*/, 'tag'],

      // Datatype ^ separator
      [/\^\^/, 'operator'],

      // Numbers
      [/[+-]?\d+\.\d*([eE][+-]?\d+)?/, 'number.float'],
      [/[+-]?\d+/, 'number'],

      // Keywords
      [/\b(CLOSED|EXTRA|ABSTRACT|EXTERNAL|LITERAL|IRI|BNODE|NONLITERAL|AND|OR|NOT|START|VIRTUAL|EXTENDS|RESTRICTS)\b/, 'keyword'],

      // Cardinality shorthand
      [/[?*+]/, 'operator'],

      // Delimiters
      [/[{}()[\],;.]/, 'delimiter'],
    ],

    tripleDouble: [
      [/[^"\\]+/, 'string'],
      [/\\./, 'string.escape'],
      [/"""/, { token: 'string.delim', next: '@pop' }],
    ],
    double: [
      [/[^"\\]+/, 'string'],
      [/\\./, 'string.escape'],
      [/"/, { token: 'string.delim', next: '@pop' }],
    ],
    tripleSingle: [
      [/[^'\\]+/, 'string'],
      [/\\./, 'string.escape'],
      [/'''/, { token: 'string.delim', next: '@pop' }],
    ],
    single: [
      [/[^'\\]+/, 'string'],
      [/\\./, 'string.escape'],
      [/'/, { token: 'string.delim', next: '@pop' }],
    ],
  },
};

// ─── Theme tokens ─────────────────────────────────────────────────────────────

const SHEXC_THEME_RULES: Monaco.editor.ITokenThemeRule[] = [
  { token: 'comment.shexc',            foreground: '6a9955' },
  { token: 'keyword.shexc',            foreground: '569cd6', fontStyle: 'bold' },
  { token: 'string.iri.shexc',         foreground: 'ce9178' },
  { token: 'string.shexc',             foreground: 'ce9178' },
  { token: 'string.delim.shexc',       foreground: 'ce9178' },
  { token: 'string.escape.shexc',      foreground: 'd7ba7d' },
  { token: 'type.shexc',               foreground: '4ec9b0' },
  { token: 'variable.predefined.shexc',foreground: '9cdcfe' },
  { token: 'annotation.shexc',         foreground: 'ffd700', fontStyle: 'bold' },
  { token: 'variable.shexc',           foreground: 'dcdcaa' },
  { token: 'tag.shexc',                foreground: 'b5cea8' },
  { token: 'number.shexc',             foreground: 'b5cea8' },
  { token: 'number.float.shexc',       foreground: 'b5cea8' },
  { token: 'operator.shexc',           foreground: 'd4d4d4' },
  { token: 'delimiter.shexc',          foreground: 'd4d4d4' },
];

// ─── Completion items ─────────────────────────────────────────────────────────

function makeCompletions(
  monaco: typeof Monaco,
  range: Monaco.IRange,
): Monaco.languages.CompletionItem[] {
  const kw = (label: string, detail: string): Monaco.languages.CompletionItem => ({
    label,
    kind: monaco.languages.CompletionItemKind.Keyword,
    insertText: label,
    detail,
    range,
  });
  const snip = (
    label: string,
    insertText: string,
    detail: string,
  ): Monaco.languages.CompletionItem => ({
    label,
    kind: monaco.languages.CompletionItemKind.Snippet,
    insertText,
    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
    detail,
    range,
  });

  return [
    kw('BASE', 'Set base IRI'),
    kw('PREFIX', 'Declare a namespace prefix'),
    kw('IMPORT', 'Import another schema'),
    kw('EXTERNAL', 'Declare external shape'),
    kw('ABSTRACT', 'Abstract shape modifier'),
    kw('CLOSED', 'Closed shape — no extra properties'),
    kw('EXTRA', 'Allow extra properties for listed predicates'),
    kw('LITERAL', 'Literal node constraint'),
    kw('IRI', 'IRI node constraint'),
    kw('BNODE', 'Blank-node constraint'),
    kw('NONLITERAL', 'Non-literal node constraint'),
    kw('AND', 'Shape AND combinator'),
    kw('OR', 'Shape OR combinator'),
    kw('NOT', 'Shape NOT combinator'),
    kw('START', 'Designate start shape'),
    kw('EXTENDS', 'Shape extension'),
    kw('RESTRICTS', 'Shape restriction'),
    snip(
      'PREFIX …',
      'PREFIX ${1:ns}: <${2:http://example.org/}>',
      'Prefix declaration',
    ),
    snip(
      'BASE …',
      'BASE <${1:http://example.org/}>',
      'Base IRI declaration',
    ),
    snip(
      'shape',
      '<${1:ShapeName}> {\n\t${2:predicate} ${3:.} ;\n}',
      'Shape expression scaffold',
    ),
    snip(
      'CLOSED shape',
      '<${1:ShapeName}> CLOSED {\n\t${2:predicate} ${3:.} ;\n}',
      'Closed shape scaffold',
    ),
    snip(
      '%Map:{ … %}',
      '%Map:{ ${1:ns}:${2:var} %}',
      'ShExMap variable annotation',
    ),
    snip(
      'AND shape',
      '<${1:Name}> @<${2:A}> AND @<${3:B}>',
      'Shape AND expression',
    ),
    snip(
      'OR shape',
      '<${1:Name}> @<${2:A}> OR @<${3:B}>',
      'Shape OR expression',
    ),
  ];
}

// ─── Hover docs ───────────────────────────────────────────────────────────────

const HOVER_DOCS: Record<string, string> = {
  BASE: '**BASE** — Sets the base IRI for the schema. Relative IRIs are resolved against this.',
  PREFIX: '**PREFIX** — Declares a namespace prefix mapping, e.g. `PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>`.',
  IMPORT: '**IMPORT** — Imports another ShEx schema by IRI.',
  EXTERNAL: '**EXTERNAL** — Declares a shape as defined externally (no expression in this schema).',
  ABSTRACT: '**ABSTRACT** — Abstract shapes cannot be used as focus-shape targets directly.',
  CLOSED: '**CLOSED** — A closed shape does not allow triples whose predicate is not listed.',
  EXTRA: '**EXTRA** — Lists predicates for which additional values (beyond those in the shape) are allowed.',
  LITERAL: '**LITERAL** — Node kind constraint: the value must be an RDF literal.',
  IRI: '**IRI** — Node kind constraint: the value must be an IRI.',
  BNODE: '**BNODE** — Node kind constraint: the value must be a blank node.',
  NONLITERAL: '**NONLITERAL** — Node kind constraint: the value must be an IRI or blank node.',
  AND: '**AND** — Shape conjunction: a node must satisfy all sub-expressions.',
  OR: '**OR** — Shape disjunction: a node must satisfy at least one sub-expression.',
  NOT: '**NOT** — Shape negation: a node must NOT satisfy the sub-expression.',
  START: '**START** — Designates the default start shape for validation.',
  EXTENDS: '**EXTENDS** — Inherits all triple constraints from the named shape.',
  RESTRICTS: '**RESTRICTS** — Adds additional restrictions on top of the named shape.',
};

// ─── Diagnostics via @shexjs/parser ──────────────────────────────────────────

let shexParser: { construct: (opts?: object) => { parse: (schema: string) => unknown } } | null = null;

async function getParser() {
  if (shexParser) return shexParser;
  try {
    // Dynamic import so it only loads when needed
    const mod = await import('@shexjs/parser');
    shexParser = mod as unknown as typeof shexParser;
  } catch {
    // parser unavailable in this env — silently skip diagnostics
  }
  return shexParser;
}

async function validateShex(
  monaco: typeof Monaco,
  model: Monaco.editor.ITextModel,
) {
  const parser = await getParser();
  if (!parser) return;
  const text = model.getValue();
  const markers: Monaco.editor.IMarkerData[] = [];
  try {
    parser.construct({ baseIRI: 'https://example.org/' }).parse(text);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    // Try to extract line/col from the error message (shexjs format: "line N col M")
    const lineMatch = /line[: ]+(\d+)/i.exec(msg);
    const colMatch = /col(?:umn)?[: ]+(\d+)/i.exec(msg);
    const line = lineMatch ? parseInt(lineMatch[1]!, 10) : 1;
    const col = colMatch ? parseInt(colMatch[1]!, 10) : 1;
    markers.push({
      severity: monaco.MarkerSeverity.Error,
      message: msg,
      startLineNumber: line,
      startColumn: col,
      endLineNumber: line,
      endColumn: col + 1,
    });
  }
  monaco.editor.setModelMarkers(model, 'shexc', markers);
}

// ─── Registration ─────────────────────────────────────────────────────────────

let registered = false;

export function registerShexLanguage(monaco: typeof Monaco) {
  if (registered) return;
  registered = true;

  monaco.languages.register({ id: SHEXC_LANGUAGE_ID, extensions: ['.shex', '.shexc'] });

  monaco.languages.setMonarchTokensProvider(SHEXC_LANGUAGE_ID, SHEXC_LANGUAGE_DEF);

  // Extend vs-dark theme with ShEx token colours
  monaco.editor.defineTheme('shex-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: SHEXC_THEME_RULES,
    colors: {},
  });

  monaco.languages.registerCompletionItemProvider(SHEXC_LANGUAGE_ID, {
    triggerCharacters: ['%', '<', '@', ':'],
    provideCompletionItems(model, position) {
      const word = model.getWordUntilPosition(position);
      const range: Monaco.IRange = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };
      return { suggestions: makeCompletions(monaco, range) };
    },
  });

  monaco.languages.registerHoverProvider(SHEXC_LANGUAGE_ID, {
    provideHover(model, position) {
      const word = model.getWordAtPosition(position);
      if (!word) return null;
      const doc = HOVER_DOCS[word.word.toUpperCase()];
      if (!doc) return null;
      return {
        range: new monaco.Range(
          position.lineNumber, word.startColumn,
          position.lineNumber, word.endColumn,
        ),
        contents: [{ value: doc }],
      };
    },
  });

  // Run diagnostics whenever a ShExC model changes (debounced)
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  monaco.editor.onDidCreateModel((model) => {
    if (model.getLanguageId() !== SHEXC_LANGUAGE_ID) return;
    const run = () => validateShex(monaco, model);
    run();
    model.onDidChangeContent(() => {
      const id = model.uri.toString();
      clearTimeout(timers.get(id));
      timers.set(id, setTimeout(run, 600));
    });
  });
}
