// test/chart-id-coherence.test.js
//
// Regression test for chart-canvas ID drift.
//
// Pre-fix bug discovered during 2026-05-10 audit:
//   - js/hna/hna-renderers.js renderIncomeDistribution() looked up
//     'chartIncomeDistrib' (truncated) but the HTML canvas has
//     'chartIncomeDistribution' (full name).  Result: chart never
//     rendered.
//   - Same drift on _renderScenarioSection — looked up
//     'chartScenarioComp' but HTML has 'chartScenarioComparison'.
//
// This test does an automated coherence check: every getElementById(...)
// call in the JS that targets a chart/map ID must correspond to a real
// canvas/element ID in some HTML file. Catches truncation/typo bugs.
//
// Allow-listed exceptions:
//   - 'chartChasGapProxyNote' — created dynamically by the renderer
//   - 'bmComparisonChart'      — injected by benchmark-ui.js itself
//   - 'map-error-notification' — created dynamically by error handler
//
// Run: node test/chart-id-coherence.test.js

'use strict';

const fs   = require('fs');
const path = require('path');

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) { console.log('  ✅ PASS: ' + msg); passed++; }
  else { console.error('  ❌ FAIL: ' + msg); failed++; }
}

const REPO_ROOT = path.join(__dirname, '..');

function listFiles(dir, pattern) {
  const out = [];
  function walk(d) {
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); }
    catch (_) { return; }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        if (e.name === 'node_modules' || e.name === 'archive') continue;
        walk(p);
      } else if (e.isFile() && pattern.test(e.name)) {
        out.push(p);
      }
    }
  }
  walk(dir);
  return out;
}

// 1) Collect chart/map IDs from getElementById in all JS
const idPattern = /getElementById\(\s*['"](chart[A-Za-z0-9_-]+|map[A-Za-z0-9_-]+|[a-zA-Z]+Chart|[a-zA-Z]+Map)['"]\s*\)/g;
const jsFiles = listFiles(path.join(REPO_ROOT, 'js'), /\.js$/);
const jsIds = new Map();
for (const f of jsFiles) {
  const text = fs.readFileSync(f, 'utf8');
  let m;
  while ((m = idPattern.exec(text)) !== null) {
    const id = m[1];
    if (!jsIds.has(id)) jsIds.set(id, []);
    jsIds.get(id).push(path.relative(REPO_ROOT, f));
  }
}

// 2) Collect ALL element IDs from HTML
const htmlIds = new Set();
const htmlFiles = listFiles(REPO_ROOT, /\.html$/);
const idAttr = /id="([a-zA-Z][a-zA-Z0-9_-]+)"/g;
for (const f of htmlFiles) {
  const rel = path.relative(REPO_ROOT, f);
  if (rel.includes('archive/') || rel.includes('docs/') || rel.includes('assets/')) continue;
  const text = fs.readFileSync(f, 'utf8');
  let m;
  while ((m = idAttr.exec(text)) !== null) {
    htmlIds.add(m[1]);
  }
}

// 3) Allow-list known dynamic IDs
const ALLOWLIST = new Set([
  'chartChasGapProxyNote',   // dynamically created by renderer
  'bmComparisonChart',       // injected by benchmark-ui.js
  'map-error-notification',  // dynamically created by error handler
]);

console.log('\n[test] All JS-referenced chart/map IDs exist in some HTML page');
console.log('  Discovered ' + jsIds.size + ' chart/map IDs in JS, ' + htmlIds.size + ' total IDs in HTML');

let mismatches = 0;
for (const [id, refs] of jsIds) {
  if (ALLOWLIST.has(id)) continue;
  if (!htmlIds.has(id)) {
    console.error('  ❌ FAIL: JS getElementById("' + id + '") but no HTML has id="' + id + '"');
    console.error('         referenced from: ' + refs.join(', '));
    failed++;
    mismatches++;
  }
}
if (mismatches === 0) {
  console.log('  ✅ PASS: every JS-referenced chart/map ID resolves to an HTML element');
  passed++;
}

// 4) Spot-check the two specific bugs fixed in this PR
console.log('\n[test] Specific drift-bug regression guards');
const renderersSrc = fs.readFileSync(path.join(REPO_ROOT, 'js/hna/hna-renderers.js'), 'utf8');
assert(/getElementById\(\s*['"]chartIncomeDistribution['"]/.test(renderersSrc),
  "renderIncomeDistribution looks up 'chartIncomeDistribution' (full name)");
assert(!/getElementById\(\s*['"]chartIncomeDistrib['"]/.test(renderersSrc),
  "no remaining lookup for truncated 'chartIncomeDistrib'");
assert(/getElementById\(\s*['"]chartScenarioComparison['"]/.test(renderersSrc),
  "_renderScenarioSection looks up 'chartScenarioComparison' (full name)");
assert(!/getElementById\(\s*['"]chartScenarioComp['"][\s,)]/.test(renderersSrc),
  "no remaining lookup for truncated 'chartScenarioComp'");

console.log('\n=========================================');
console.log('Results: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed === 0 ? 0 : 1);
