#!/usr/bin/env node
// test/branded-404.test.js
//
// 404.html is served by GitHub Pages for ANY missing URL at any depth
// (/places/x.html, /data/y.json). A relative asset path would resolve under
// the missing URL's folder and 404 in turn, leaving an unstyled page with no
// navigation — the raw GitHub 404 that visitors saw until 2026-09-23. Every
// asset and link must be root-absolute, the page must not be indexed, and the
// missed address must be shown as text, never markup.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, '404.html'), 'utf8');

let failures = 0;
function run(name, fn) {
  try { fn(); console.log('  ✓ ' + name); }
  catch (err) { failures += 1; console.error('  ✗ ' + name + '\n    ' + err.message); }
}

console.log('branded-404');

run('every stylesheet, script and link is root-absolute', () => {
  const refs = [...html.matchAll(/\b(?:href|src)="([^"]+)"/g)].map((m) => m[1]).filter((u) => !/^(#|https?:|mailto:)/.test(u));
  assert.ok(refs.length >= 10, 'the page references its assets and routes');
  const relative = refs.filter((u) => !u.startsWith('/'));
  assert.deepEqual(relative, [], 'relative paths would break under a nested missing URL');
});

run('the assets it points at exist', () => {
  const refs = [...html.matchAll(/\b(?:href|src)="(\/[^"]+)"/g)].map((m) => m[1].split('?')[0]);
  const missing = refs.filter((u) => !fs.existsSync(path.join(ROOT, u.slice(1))));
  assert.deepEqual(missing, [], 'referenced files must exist in the repo');
});

run('it is not indexed and shows the missed address as text', () => {
  assert.match(html, /<meta name="robots" content="noindex">/);
  assert.match(html, /textContent = window\.location\.pathname \+ window\.location\.search/, 'the path is set as text');
  assert.ok(!/innerHTML\s*=/.test(html), 'never as markup');
});

if (failures) { console.error('branded-404: FAIL'); process.exitCode = 1; }
else console.log('branded-404: PASS');
