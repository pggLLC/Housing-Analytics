#!/usr/bin/env node
/**
 * F124 — inline-heading-typography
 *
 * Forbid typography overrides (font-size, font-weight, font-family,
 * line-height, letter-spacing, color, text-wrap) on inline styles of
 * h1-h4 tags. The global headings live in css/site-theme.css with the
 * `!important` flag, so any inline override either (a) was always
 * silently overridden visually (noise), or (b) created cross-page
 * drift that the design system should own.
 *
 * Standard pattern:
 *   <h2>Heading</h2>                        ← ✓ uses global token
 *   <h2 style="margin-top:var(--sp4);">…</h2>  ← ✓ non-typography props OK
 *   <h2 style="font-size:1.2rem;">…</h2>    ← ✗ fails — drift risk
 *
 * Escape hatches in css/site-theme.css if you genuinely need a
 * different size: `.h-as-h2`, `.h-as-h3`. Use a class, not inline.
 *
 * Sister gate to scripts/audit/inline-contrast-check.mjs (F122).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const TYPO_PROPS = new Set([
  'font-size', 'font-weight', 'font-family',
  'line-height', 'letter-spacing', 'color', 'text-wrap'
]);

const TAG_PATTERN = /<h[1-4]\b[^>]*?\bstyle="([^"]*)"/gi;
let failures = [];

for (const file of readdirSync(ROOT).filter(f => f.endsWith('.html'))) {
  const src = readFileSync(join(ROOT, file), 'utf8');
  const lines = src.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let m;
    TAG_PATTERN.lastIndex = 0;
    while ((m = TAG_PATTERN.exec(line)) !== null) {
      const style = m[1];
      const decls = style.split(';').map(d => d.trim()).filter(Boolean);
      const offending = decls.filter(d => {
        const colon = d.indexOf(':');
        if (colon < 0) return false;
        return TYPO_PROPS.has(d.slice(0, colon).trim().toLowerCase());
      });
      if (offending.length) {
        failures.push({ file, line: i + 1, props: offending });
      }
    }
  }
}

if (!failures.length) {
  console.log('✓ No inline typography overrides on h1–h4 headings. Heading style stays centralized in css/site-theme.css.');
  process.exit(0);
}

console.error(`✗ Found ${failures.length} h1–h4 tag(s) with inline typography overrides (would drift from global heading style):\n`);
for (const f of failures) {
  console.error(`  ${f.file}:${f.line} — ${f.props.join('; ')}`);
}
console.error('\nFix: remove the typography declarations from the inline style — the global h1–h4 rules in css/site-theme.css (with !important) already enforce the canonical size/weight/color. For an intentional one-off, use class `.h-as-h2` / `.h-as-h3` instead of inline.');
process.exit(1);
