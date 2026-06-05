#!/usr/bin/env node
/**
 * no-phantom-css-vars.mjs — F252
 *
 * Why this exists
 * ---------------
 * The pill-contrast bug kept coming back because the AI kept inventing
 * CSS variables that don't exist (`--surface-2` in F236/F237/F238/F250).
 * Each invented `var(--surface-2, #f7f7f9)` falls back to the hardcoded
 * grey hex — invisible on dark mode against `--muted` text.
 *
 * This script walks every HTML / JS / CSS file in the repo and finds
 * every `var(--xxx)` reference. It then walks every CSS file and finds
 * every `--xxx:` definition. References that aren't defined fail the
 * build.
 *
 * Exit code:
 *   0 — clean
 *   1 — at least one phantom reference (printed to stdout)
 *
 * Usage
 * -----
 *   node scripts/audit/no-phantom-css-vars.mjs
 *
 * Hooked into `npm run test:phantom-css-vars` → `npm run test:ci`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const SKIP_DIRS = new Set([
  '.git', '.claude', 'node_modules', 'archive', '.next', '.cache',
  'data', 'tests', 'logs', 'tmp', 'old_files', 'screenshots',
  'subagents', 'workflows', 'docs'
]);

// Token-name patterns that are illustrative placeholders in comments/
// docs (e.g. var(--X), var(--X-dim), var(--xxx)) — not real references.
const PLACEHOLDER_NAMES = new Set(['--X', '--X-dim', '--xxx', '--XXX', '--name', '--your-var']);

const SCAN_EXTS = new Set(['.html', '.js', '.mjs', '.css']);
const CSS_EXTS  = new Set(['.css']);

// Common third-party CSS vars defined externally (Leaflet, Chart.js, etc.)
// or browser-builtin custom-property-like values that don't need a definition
// in our CSS.
const EXEMPT_PREFIXES = [
  '--leaflet-',     // Leaflet
  '--chart-',       // chart.js
  '--mapbox-',      // mapbox-gl
  '--bs-',          // Bootstrap leftovers
  '--mcm-',         // MCM design tokens (defined in inline <style> in some pages)
];

function walk(dir, out = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch { return out; }
  for (const e of entries) {
    if (SKIP_DIRS.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (SCAN_EXTS.has(path.extname(e.name))) out.push(full);
  }
  return out;
}

const files = walk(ROOT);
const cssFiles = files.filter(f => CSS_EXTS.has(path.extname(f)));

// 1. Build the set of DEFINED tokens by scanning every CSS file.
const defined = new Set();
const DEF_RE = /(?:^|[{;\s])(--[a-zA-Z0-9_-]+)\s*:/g;
for (const f of cssFiles) {
  const src = fs.readFileSync(f, 'utf8');
  let m;
  while ((m = DEF_RE.exec(src)) !== null) defined.add(m[1]);
}

// Also scan inline <style> blocks in HTML for defined tokens.
const HTML_STYLE_RE = /<style[^>]*>([\s\S]*?)<\/style>/g;
for (const f of files.filter(f => path.extname(f) === '.html')) {
  const src = fs.readFileSync(f, 'utf8');
  let block;
  while ((block = HTML_STYLE_RE.exec(src)) !== null) {
    let m;
    DEF_RE.lastIndex = 0;
    while ((m = DEF_RE.exec(block[1])) !== null) defined.add(m[1]);
  }
}

// Also scan inline style="--xxx: ..." attributes anywhere in the repo.
// Components like .hp-binary-card / .ps-bar set their accent via
// `style="--hp-cat-color: #1a73e8"`. Those tokens never appear in a
// CSS file — they're caller-provided variables. As long as the caller
// supplies them at the same scope as the consumer, they're not phantoms.
const INLINE_STYLE_RE = /style\s*=\s*["'`]([^"'`]*)["'`]/g;
const INLINE_VAR_RE = /(--[a-zA-Z0-9_-]+)\s*:/g;
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  let attr;
  INLINE_STYLE_RE.lastIndex = 0;
  while ((attr = INLINE_STYLE_RE.exec(src)) !== null) {
    let m;
    INLINE_VAR_RE.lastIndex = 0;
    while ((m = INLINE_VAR_RE.exec(attr[1])) !== null) defined.add(m[1]);
  }
}

// Also scan JS template-string + concatenated style= patterns:
// `style="--hp-cat-color: ${color}"` or 'style="--foo: ' + x + '"'.
const JS_STYLE_RE = /style\s*[:=]\s*[`'"][^`'"]*?(--[a-zA-Z0-9_-]+)\s*:/g;
for (const f of files.filter(f => ['.js', '.mjs'].includes(path.extname(f)))) {
  const src = fs.readFileSync(f, 'utf8');
  let m;
  JS_STYLE_RE.lastIndex = 0;
  while ((m = JS_STYLE_RE.exec(src)) !== null) defined.add(m[1]);
}

// 2. Walk every file and find var(--xxx) references.
const REF_RE = /var\(\s*(--[a-zA-Z0-9_-]+)/g;
const phantoms = new Map(); // varName → [{file, line, snippet}, ...]

for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  const lines = src.split('\n');
  for (let i = 0; i < lines.length; i++) {
    let m;
    REF_RE.lastIndex = 0;
    while ((m = REF_RE.exec(lines[i])) !== null) {
      const name = m[1];
      if (defined.has(name)) continue;
      if (PLACEHOLDER_NAMES.has(name)) continue;
      if (EXEMPT_PREFIXES.some(p => name.startsWith(p))) continue;
      if (!phantoms.has(name)) phantoms.set(name, []);
      phantoms.get(name).push({
        file: path.relative(ROOT, f),
        line: i + 1,
        snippet: lines[i].trim().slice(0, 120)
      });
    }
  }
}

// 3. Report.
if (phantoms.size === 0) {
  console.log('✓ No phantom CSS variable references found (' + defined.size + ' defined tokens, ' + files.length + ' files scanned)');
  process.exit(0);
}

console.error('\n✗ Phantom CSS variable references (referenced but not defined):\n');
let totalRefs = 0;
const sorted = Array.from(phantoms.entries()).sort((a, b) => b[1].length - a[1].length);
for (const [name, callsites] of sorted) {
  console.error(`  ${name}   (${callsites.length} reference${callsites.length === 1 ? '' : 's'})`);
  for (const c of callsites.slice(0, 5)) {
    console.error(`    ${c.file}:${c.line}  →  ${c.snippet}`);
  }
  if (callsites.length > 5) {
    console.error(`    … and ${callsites.length - 5} more`);
  }
  totalRefs += callsites.length;
}
console.error('\nDefine the missing tokens in css/site-theme.css (both :root and html.dark-mode blocks)');
console.error('or use a defined token. See test/wcag-pill-contrast.test.js for the AA-verified token set.\n');
console.error(`Total: ${phantoms.size} phantom tokens across ${totalRefs} references.`);
process.exit(1);
