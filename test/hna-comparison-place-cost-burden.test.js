'use strict';
/**
 * test/hna-comparison-place-cost-burden.test.js
 *
 * Regression for 2026-05-17: the Renter Cost Burden by Income Tier
 * subsection on hna-comparative-analysis.html read
 * pct_burdened_lte30/31to50/51to80 straight off entry.metrics — which
 * build_ranking_index populates from CHAS county data. Every place
 * inherited its parent county's tier burden rates verbatim, so any
 * two places in the same county (Fruita + Clifton, both Mesa 08077)
 * showed identical 70.4 / 76.9 / 44.9.
 *
 * Fix: prefer place-CHAS (TIGER-apportioned, PR #803) via PlaceChas.
 * lookup; flag county-fallback explicitly.
 *
 * Also fixes the adjacent "% Owners Cost-Burdened" line in the
 * Homeownership Affordability section, which still summed legacy 2022
 * DP04_0145PE + 0146PE codes that don't exist in ACS 2023 (same
 * pattern as the chartOwnerCostBurden fix in PR #816).
 *
 * Run: node test/hna-comparison-place-cost-burden.test.js
 */

const fs   = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { console.log('  ✅ PASS:', msg); passed++; }
  else       { console.error('  ❌ FAIL:', msg); failed++; }
}

const root = path.join(__dirname, '..');
const comp = fs.readFileSync(path.join(root, 'js/hna/hna-comparison.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'hna-comparative-analysis.html'), 'utf8');

console.log('\n[test] place-CHAS deriver wired into renter cost-burden subsection');
assert(/function _deriveBurdenTiersForEntry\(entry\)/.test(comp),
  '_deriveBurdenTiersForEntry helper is defined');
assert(/window\.PlaceChas\s*&&\s*typeof window\.PlaceChas\.lookup === 'function'/.test(comp),
  'deriver delegates to PlaceChas.lookup when geoid is a place/cdp');
assert(/source:\s*['"]place['"]/.test(comp) && /source:\s*['"]county['"]/.test(comp),
  'deriver returns a source flag ("place" or "county") so the disclosure note can fire');
// The subsection must consume the deriver output, NOT the raw
// entry.metrics.pct_burdened_lte30 reads it used to do.
assert(/var burdenA = _deriveBurdenTiersForEntry\(entryA\)/.test(comp),
  'subsection invokes the deriver for side A');
assert(/var burdenB = _deriveBurdenTiersForEntry\(entryB\)/.test(comp),
  'subsection invokes the deriver for side B');

console.log('\n[test] county-fallback disclosure exists');
assert(/anyCountyFallback/.test(comp),
  'subsection computes anyCountyFallback flag');
assert(/Tier burden rates are county-level/.test(comp),
  'disclosure text surfaces the county-fallback caveat');

console.log('\n[test] init() pre-loads PlaceChas');
assert(/window\.PlaceChas[\s\S]{0,200}\.init\(\)/.test(comp),
  'init() kicks off PlaceChas.init() so the lookup is warm when the user clicks Compare');

console.log('\n[test] HTML loads PlaceChas before hna-comparison.js');
const scriptOrder = html.match(/<script defer src="(js\/[a-z0-9\-\/]+\.js)"><\/script>/g) || [];
const placeIdx = scriptOrder.findIndex(s => s.includes('place-chas-lookup'));
const compIdx  = scriptOrder.findIndex(s => s.includes('hna-comparison'));
assert(placeIdx !== -1, 'place-chas-lookup.js script tag is in hna-comparative-analysis.html');
assert(placeIdx < compIdx,
  'place-chas-lookup.js loads BEFORE hna-comparison.js so window.PlaceChas exists at init time');

console.log('\n[test] Homeownership Affordability owner-burden uses 2023 PE codes');
const noComments = comp
  .replace(/\/\/[^\n]*/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '');
assert(/DP04_0114PE/.test(noComments) && /DP04_0115PE/.test(noComments),
  'owner cost-burden reads DP04_0114PE + DP04_0115PE (ACS 2023 SMOCAPI)');
assert(!/DP04_0145PE|DP04_0146PE/.test(noComments),
  'legacy 2022 DP04_0145PE/0146PE codes no longer referenced in executable code');

console.log('\n=========================================');
console.log('Results: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed === 0 ? 0 : 1);
