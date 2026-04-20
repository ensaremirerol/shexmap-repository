import { createRequire } from 'module';

const _require = createRequire(import.meta.url);
const shexParser = _require('@shexjs/parser') as {
  construct: (base?: string, opts?: Record<string, unknown>) => { parse: (s: string) => any };
};

export function parseShEx(content: string, shapeBase: string): { valid: boolean; schema?: any; error?: string } {
  try {
    const parser = shexParser.construct(shapeBase, {});
    const schema = parser.parse(content);
    return { valid: true, schema };
  } catch (err) {
    return { valid: false, error: err instanceof Error ? err.message : String(err) };
  }
}
