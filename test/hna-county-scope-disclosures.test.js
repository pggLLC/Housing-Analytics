'use strict';
/**
 * test/hna-county-scope-disclosures.test.js
 *
 * Regression for 2026-05-16: when a user picks a place/cdp on HNA, the
 * Labor Market, Economic Indicators, and LEHD Commute sections all
 * showed county-derived data (because LEHD/DOLA/BLS-QCEW are county-only
 * datasets) with NO disclosure. The chart titles and axis labels read
 * as if the data were place-specific. User flagged this as misleading.
 *
 * Fix: a `_renderCountyScopeNote(sectionId, geoType, countyFips, kind)`
 * helper that injects an amber "County-level data" note inside the
 * section header when geoType is 'place' or 'cdp', and removes itself
 * for 'county' / 'state'.
 *
 * What this test asserts (source-grep):
 *   - The helper exists, is exported as renderCountyScopeNote
 *   - It hides itself on county / state selections (no false noise)
 *   - It targets specific sections in the controller (labor-market,
 *     economic-indicators, lehd commute card)
 *   - CSS provides the amber accent (matches chartChasGap proxy note)
 *   - The HTML has the IDs the controller wires up
 *
 * Run: node test/hna-county-scope-disclosures.test.js
 */

const fs   = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { console.log('  ✅ PASS:', msg); passed++; }
  else       { console.error('  ❌ FAIL:', msg); failed++; }
}

const root = path.join(__dirname, '..');
const rend = fs.readFileSync(path.join(root, 'js/hna/hna-renderers.js'),  'utf8');
const ctl  = fs.readFileSync(path.join(root, 'js/hna/hna-controller.js'),  'utf8');
const css  = fs.readFileSync(path.join(root, 'css/site-theme.css'),         'utf8');
const html = fs.readFileSync(path.join(root, 'housing-needs-assessment.html'), 'utf8');

console.log('\n[test] disclosure helper is exported');
assert(/function _renderCountyScopeNote\(sectionId, geoType, countyFips, dataKind\)/.test(rend),
  'helper signature accepts (sectionId, geoType, countyFips, dataKind)');
assert(/renderCountyScopeNote\s*:\s*_renderCountyScopeNote/.test(rend),
  'exported on the HNARenderers public surface');

console.log('\n[test] helper hides itself for county / state selections');
const helperBody = rend.match(
  /function _renderCountyScopeNote[\s\S]*?\n  \}/
);
assert(helperBody != null, 'helper body found');
if (helperBody) {
  const body = helperBody[0];
  assert(/geoType\s*!==\s*['"]place['"][\s\S]*geoType\s*!==\s*['"]cdp['"]/.test(body),
    'guards against geoType other than place/cdp (no false-positive disclosures)');
  assert(/existing\.remove\(\)/.test(body),
    'removes any previously-inserted note when guard trips');
}

console.log('\n[test] controller wires up the three county-scope sections');
['lehdCommuteCard',
 'labor-market-section',
 'economicIndicatorsContainer'].forEach(function (id) {
  const pattern = new RegExp(
    'renderCountyScopeNote\\(\\s*[\'"]' + id + '[\'"]'
  );
  assert(pattern.test(ctl),
    'controller calls disclosure for #' + id);
});

console.log('\n[test] HTML carries the IDs the disclosure targets');
['lehdCommuteCard',
 'labor-market-section',
 'economicIndicatorsContainer'].forEach(function (id) {
  const pattern = new RegExp('id="' + id + '"');
  assert(pattern.test(html),
    'housing-needs-assessment.html has #' + id);
});

console.log('\n[test] CSS for .hna-county-scope-note matches the chartChasGap proxy-note style');
const cssBlock = css.match(/\.hna-county-scope-note\s*\{([\s\S]*?)\}/);
assert(cssBlock != null, '.hna-county-scope-note CSS block exists');
if (cssBlock) {
  const block = cssBlock[1];
  assert(/border-left\s*:\s*\d+px\s+solid/.test(block),
    'has amber border-left accent');
  assert(/background\s*:/.test(block),
    'has a muted background fill');
  assert(/var\(--warn/.test(block) || /#d97706/.test(block),
    'uses the warn color token (or its hex)');
}

console.log('\n=========================================');
console.log('Results: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed === 0 ? 0 : 1);
