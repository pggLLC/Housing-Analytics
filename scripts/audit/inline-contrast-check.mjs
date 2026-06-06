#!/usr/bin/env node
/**
 * F122 — inline-contrast-check
 *
 * Static scan for inline HTML styles that pair a `--accent`-backed background
 * with hardcoded white text. The dark-mode `--accent` is bright cyan, so any
 * such pair fails WCAG AA (1.7:1 contrast vs the 4.5:1 minimum). This used
 * to ship 24+ broken buttons across the site because:
 *   - htmlhint doesn't compute contrast
 *   - stylelint only sees CSS files, not inline HTML styles
 *   - test:pill-contrast only checks predefined `.pill` and `.tag` classes
 *   - js/contrast-guard.js fixes things at runtime but only if the page
 *     loads it AND only on the initial theme (pre-F122 patch)
 *
 * This gate runs at CI time. Failures listed with file:line. To pass:
 *   - Replace `color:#fff` with `color:var(--on-accent)` on accent surfaces
 *     (--on-accent is white in light mode, deep navy in dark mode; see
 *     css/site-theme.css)
 *   - OR convert to a real CSS class that the pill-contrast test covers
 *
 * Companion runtime guard: js/contrast-guard.js (now re-runs on theme change).
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const html_files = readdirSync(ROOT).filter(f => f.endsWith('.html'));

let failures = [];

// We look for inline style attributes (and JS-embedded CSS strings) that
// contain both `var(--accent` and `color:#fff` in the same span. That's
// the specific failure mode F122 fixed. Allowed: `color:var(--on-accent...)`.
const STYLE_ATTR = /style\s*=\s*("([^"]*)"|'([^']*)')/g;
const JS_CSS_LINE = /^\s*['"`].*var\(--accent.*color:\s*#fff/m;  // line-level JS template/string

function checkInlineStyle(style, file, lineNum) {
  if (!style.includes('var(--accent')) return;
  // Pass if accent+#fff but using --on-accent (the F122 fix)
  if (/color\s*:\s*var\(--on-accent/.test(style)) return;
  // Fail if accent + raw #fff (or rgb(255,255,255))
  if (/color\s*:\s*(#fff\b|#ffffff\b|white\b|rgb\(\s*255\s*,\s*255\s*,\s*255)/i.test(style)) {
    failures.push({ file, lineNum, snippet: style.slice(0, 140) });
  }
}

for (const file of html_files) {
  const src = readFileSync(join(ROOT, file), 'utf8');
  const lines = src.split('\n');

  // Scan inline style attributes
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let m;
    STYLE_ATTR.lastIndex = 0;
    while ((m = STYLE_ATTR.exec(line)) !== null) {
      const style = m[2] || m[3] || '';
      checkInlineStyle(style, file, i + 1);
    }
    // Also catch JS-embedded CSS strings ('.foo{background:var(--accent);color:#fff}')
    if (line.includes('var(--accent') && /color\s*:\s*#fff\b/i.test(line)
        && !/color\s*:\s*var\(--on-accent/i.test(line)) {
      // Skip if it's actually the pair-token definition itself
      if (line.includes('--on-accent:')) continue;
      failures.push({ file, lineNum: i + 1, snippet: line.trim().slice(0, 140) });
    }
  }
}

if (failures.length === 0) {
  console.log('✓ No inline color:#fff on var(--accent) backgrounds. Contrast safe in both light + dark mode.');
  process.exit(0);
}

console.error(`✗ Found ${failures.length} inline style(s) that fail dark-mode contrast (white text on bright cyan accent = 1.7:1, WCAG fails 4.5:1):\n`);
for (const f of failures) {
  console.error(`  ${f.file}:${f.lineNum}`);
  console.error(`    ${f.snippet}`);
}
console.error('\nFix: replace `color:#fff` with `color:var(--on-accent,#fff)` — the --on-accent token flips automatically between modes.');
console.error('See css/site-theme.css F122 comment for the rationale.');
process.exit(1);
