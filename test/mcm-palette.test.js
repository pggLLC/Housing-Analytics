'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
const read = (r) => fs.readFileSync(path.join(ROOT, r), 'utf8');

const theme = read('css/site-theme.css');
const TOKENS = ['graphite', 'slate', 'beige', 'mustard', 'teal', 'burnt-orange'];
for (const t of TOKENS) {
  assert(new RegExp(`--mcm-${t}\\s*:`).test(theme), `css/site-theme.css defines --mcm-${t}`);
}
// teal + burnt-orange are theme-adaptive (defined under a dark override too)
assert(/prefers-color-scheme: dark[\s\S]*--mcm-teal\s*:/.test(theme), '--mcm-teal has a dark-mode value');

// phantom-var allowlist no longer suppresses --mcm-
const allow = read('scripts/audit/no-phantom-css-vars.mjs');
assert(!/'--mcm-'/.test(allow), "no-phantom-css-vars allowlist no longer contains '--mcm-'");

// light chart-card beige lists fall back to --text (scoped rule present)
assert(/\.chart-card > (ul|ol|p)\[style\*="--mcm-beige"\][\s\S]*color: var\(--text\)/.test(theme),
  'chart-card beige lists fall back to var(--text)');

console.log('mcm-palette: PASS (6 tokens defined, allowlist cleared, chart-card fallback present)');
