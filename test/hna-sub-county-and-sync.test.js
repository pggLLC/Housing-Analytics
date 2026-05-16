'use strict';
/**
 * test/hna-sub-county-and-sync.test.js
 *
 * Regression for 2026-05-16 batch:
 *
 *   1. Small towns (Paonia, etc.) showed empty Commuting / Age pyramid /
 *      Senior growth pressure charts. Root cause: ensureGeographyRegistry
 *      was fired non-blocking; update() ran countyFromGeoid() before the
 *      registry had loaded, so non-featured place lookups returned null
 *      and the LEHD/DOLA fallback never ran.
 *
 *   2. "Baseline: 60% AMI Rentals" + "Fast-Track Approval Eligibility"
 *      cards stayed on their "Select a geography…" placeholders forever
 *      — no renderer touched the prop123BaselineContent or
 *      prop123FastTrackContent containers.
 *
 *   3. Changing the HNA dropdown selections did NOT write back to
 *      WorkflowState. HSA was read-only from the workflow's POV, so
 *      revisiting Select Jurisdiction showed the old selection.
 *
 * Run: node test/hna-sub-county-and-sync.test.js
 */

const fs   = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { console.log('  ✅ PASS:', msg); passed++; }
  else       { console.error('  ❌ FAIL:', msg); failed++; }
}

const root = path.join(__dirname, '..');
const ctl  = fs.readFileSync(path.join(root, 'js/hna/hna-controller.js'),  'utf8');
const rend = fs.readFileSync(path.join(root, 'js/hna/hna-renderers.js'),   'utf8');

console.log('\n[test] #1 ensureGeographyRegistry is awaited before update()');
// The await must appear inside an async function and BEFORE update()
// uses countyFromGeoid for non-featured places.
assert(/await\s+window\.HNAUtils\.ensureGeographyRegistry\(\)/.test(ctl),
  'controller awaits ensureGeographyRegistry()');

console.log('\n[test] #2 renderProp123BaselineAndFastTrack exists and is wired up');
assert(/function renderProp123BaselineAndFastTrack\(profile, geoType, geoLabel\)/.test(rend),
  'renderer accepts (profile, geoType, geoLabel)');
assert(/renderProp123BaselineAndFastTrack,/.test(rend),
  'renderer is exported on HNARenderers');
assert(/renderProp123BaselineAndFastTrack\(profile, geoType, label\)/.test(ctl),
  'controller calls the renderer in the update() flow');
assert(/prop123BaselineContent/.test(rend),
  'renderer writes #prop123BaselineContent');
assert(/prop123FastTrackContent/.test(rend),
  'renderer writes #prop123FastTrackContent');
// Fast-track uses the existing eligibility helper (population + threshold).
assert(/checkFastTrackEligibility\(pop,\s*geoType\)/.test(rend),
  'fast-track delegates to checkFastTrackEligibility utility');

console.log('\n[test] #3 HSA dropdown changes sync back to WorkflowState');
assert(/_syncJurisdictionToWorkflowState\(\)/.test(ctl),
  'sync helper defined in controller init');
assert(/setJurisdiction\(payload\)/.test(ctl),
  'sync calls WorkflowState.setJurisdiction');
// Convention: place selections use type='city' + placeGeoid (matches
// the convention select-jurisdiction.js writes, so restoration in
// update() init reads it back cleanly).
const placeBranch = ctl.match(
  /if \(gt === 'county'\)[\s\S]*?else\s*\{[\s\S]*?type:\s*'city'/
);
assert(placeBranch != null,
  'place/cdp sync payload uses type:"city" + placeGeoid (matches selector convention)');
// Wired to BOTH change events so geoType swaps and geoSelect swaps both sync.
const gtListener = ctl.match(
  /geoType\.addEventListener\('change'[\s\S]{0,200}_syncJurisdictionToWorkflowState/
);
const gsListener = ctl.match(
  /geoSelect\.addEventListener\('change'[\s\S]{0,200}_syncJurisdictionToWorkflowState/
);
assert(gtListener != null, 'geoType change listener calls sync');
assert(gsListener != null, 'geoSelect change listener calls sync');

console.log('\n=========================================');
console.log('Results: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed === 0 ? 0 : 1);
