#!/usr/bin/env node
// test/hna-live-region-and-load-order.test.js
//
// Two things seen on production 2026-09-23 after a homepage map click to a
// county HNA view:
//  1. "Data loaded for Adams County" was VISIBLE in the hero — the aria-live
//     region is .sr-only, but only accessibility.css defined that class and
//     the HNA pages do not load it. The global stylesheet must define it.
//  2. The panel said Adams while the stats said Mesa: two concurrent update()
//     runs, one for the select's default county, painted in arrival order.
//     Loads must be serialized, and the first-option fallback must not fire
//     when a geography was restored from the URL or a saved project.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let failures = 0;
function run(name, fn) {
  try { fn(); console.log('  ✓ ' + name); }
  catch (err) { failures += 1; console.error('  ✗ ' + name + '\n    ' + err.message); }
}

console.log('hna-live-region-and-load-order');

run('the HNA pages hide their live region with a class the global stylesheet defines', () => {
  const theme = read('css/site-theme.css');
  const rule = /\.sr-only\s*\{[^}]*\}/.exec(theme);
  assert.ok(rule, 'site-theme.css defines .sr-only');
  assert.match(rule[0], /position:\s*absolute/);
  assert.match(rule[0], /clip-path:\s*inset\(50%\)/);
  for (const page of ['housing-needs-assessment.html', ...fs.readdirSync(ROOT).filter((f) => /^hna-.*\.html$/.test(f))]) {
    const html = read(page);
    if (!html.includes('id="hnaLiveRegion"')) continue;
    assert.match(html, /id="hnaLiveRegion"[^>]*class="sr-only"/, page + ': live region is sr-only');
    assert.match(html, /href="css\/site-theme\.css"/, page + ': loads site-theme.css');
  }
  // With that stylesheet applied, the region is not laid out visibly.
  const dom = new JSDOM(`<!doctype html><html><head><style>${rule[0]}</style></head><body><div id="hnaLiveRegion" class="sr-only" aria-live="polite">Data loaded for Mesa County</div></body></html>`);
  const cs = dom.window.getComputedStyle(dom.window.document.getElementById('hnaLiveRegion'));
  assert.equal(cs.position, 'absolute');
  assert.equal(cs.width, '1px');
});

run('HNA loads are serialized: update() queues behind the run in flight', () => {
  const src = read('js/hna/hna-controller.js');
  assert.match(src, /let _updateChain = Promise\.resolve\(\);/, 'a chain promise exists');
  assert.match(src, /function update\(\)\{\s*const run = _updateChain\.then\(\(\) => _updateImpl\(\)\);\s*_updateChain = run\.catch\(\(\) => \{\}\);\s*return run;\s*\}/, 'update() chains onto it and returns the run');
  assert.match(src, /async function _updateImpl\(\)\{/, 'the real load is the implementation');
  assert.equal((src.match(/async function update\(\)/g) || []).length, 0, 'no second, unserialized update()');
});

run('the first-county fallback only fires when nothing was restored', () => {
  const src = read('js/hna/hna-controller.js');
  assert.match(src, /geoType\.value === 'county' && !window\.HNAState\.els\.geoSelect\.value && !restoredGeoId\)\{/,
    'fallback guarded by !restoredGeoId');
});

if (failures) { console.error('hna-live-region-and-load-order: FAIL'); process.exitCode = 1; }
else console.log('hna-live-region-and-load-order: PASS');
