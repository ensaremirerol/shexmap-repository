// Shared variable-color utilities used by PairingPage and ShExEditor

export const VAR_COLOR_PALETTE = [
  { bg: 'rgba(239,68,68,0.3)',   border: '#ef4444' },
  { bg: 'rgba(59,130,246,0.3)',  border: '#3b82f6' },
  { bg: 'rgba(34,197,94,0.3)',   border: '#22c55e' },
  { bg: 'rgba(249,115,22,0.3)',  border: '#f97316' },
  { bg: 'rgba(168,85,247,0.3)',  border: '#a855f7' },
  { bg: 'rgba(234,179,8,0.3)',   border: '#eab308' },
  { bg: 'rgba(6,182,212,0.3)',   border: '#06b6d4' },
  { bg: 'rgba(236,72,153,0.3)',  border: '#ec4899' },
];

let colorsInjected = false;
export function injectVarColors() {
  if (colorsInjected) return;
  colorsInjected = true;
  const style = document.createElement('style');
  // Legacy per-index palette classes (kept for any existing callers)
  const paletteRules = VAR_COLOR_PALETTE.map((c, i) =>
    `.shex-var-${i} { background: ${c.bg} !important; border-bottom: 2px solid ${c.border}; border-radius: 2px; }`
  ).join('\n');
  // Single purple class for matched variables in the editor
  const matchedRule = `.shex-var-matched { background: rgba(139,92,246,0.25) !important; border-bottom: 2px solid #7c3aed; border-radius: 2px; }`;
  style.textContent = paletteRules + '\n' + matchedRule;
  document.head.appendChild(style);
}

/** Extract all %Map:{ varName %} and (?<ns:name>...) variables from ShEx content */
export function extractVars(content: string): string[] {
  const vars = new Set<string>();
  for (const m of content.matchAll(/%Map:\{\s*([^\s%{}]+)\s*%\}/g)) {
    vars.add(m[1]!);
  }
  for (const m of content.matchAll(/\(\?<([^>]+:[^>]+)>/g)) {
    vars.add(m[1]!);
  }
  return [...vars];
}

/**
 * Compute the shared-variable → color-index map for a source+target pair.
 * Only variables present in BOTH sides are included.
 */
export function buildVarColorMap(srcContent: string, tgtContent: string): Map<string, number> {
  const srcVars = extractVars(srcContent);
  const tgtSet = new Set(extractVars(tgtContent));
  const shared = srcVars.filter((v) => tgtSet.has(v));
  return new Map(shared.map((v, i) => [v, i % VAR_COLOR_PALETTE.length]));
}
