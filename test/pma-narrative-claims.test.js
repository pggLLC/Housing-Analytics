#!/usr/bin/env node
'use strict';
// The PMA narrative may only claim what the run measured (Codex audit,
// 2026-10-17). Three claims it made without support:
//  1. "The boundary excludes N water feature(s)…" when PMABarriers returns
//     the boundary unchanged — nearby-feature counts are context.
//  2. "54 % of the site area is in a FEMA flood zone" for a point-only run —
//     the figure is the share of nearby census tracts containing an SFHA.
//  3. "Data vintage: ACS_2023_5YR" hard-coded while the tract file says 2024.
// Each check runs the real modules and compares the narrative with the input
// that has to back it, not with fixed wording.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
global.window = global;
require(path.join(ROOT, 'js/pma-barriers.js'));
require(path.join(ROOT, 'js/pma-infrastructure.js'));
require(path.join(ROOT, 'js/pma-justification.js'));
const J = global.PMAJustification, B = global.PMABarriers, I = global.PMAInfrastructure;

// ── 1. barriers ─────────────────────────────────────────────────────────────
const polygon = { type: 'Polygon', coordinates: [[[-108.8, 39.1], [-108.6, 39.1], [-108.6, 39.2], [-108.8, 39.2], [-108.8, 39.1]]] };
const water = Array.from({ length: 11 }, (_, k) => ({ name: 'Water ' + k, geometry: null }));
const res = B.subtractBarriers(polygon, { waterBodies: water, highways: [{ name: 'I-70' }], landCover: [] });
const boundaryChanged = JSON.stringify(res.refinedBoundary) !== JSON.stringify(polygon);
const barriers = B.getBarrierSummary();
assert.equal(barriers.waterBodyCount, 11, 'the scan counted the nearby water features');
assert.equal(barriers.boundaryExcludesFeatures, boundaryChanged, 'the summary says whether the boundary actually changed');
let text = J.generateNarrative(J.synthesizePMA({ barriers }));
assert(/\b11 water feature/.test(text), 'the nearby features are still reported');
// The scan covers a fixed envelope around the site, not the chosen tracts, so
// the narrative may not say the market area contains them.
assert(!/(analysis|market) area contains/i.test(text), 'search-envelope counts are not described as inside the market area');
if (!boundaryChanged) {
  assert(!/\bexclud/i.test(text.split('\n\n').find((p) => /water feature/.test(p))),
    'an unchanged boundary is never said to exclude the features');
}
// No code path redraws the boundary, so even a run carrying a true flag
// (supplied by a caller or edited in a saved run) gets no exclusion claim.
text = J.generateNarrative(J.synthesizePMA({ barriers: Object.assign({}, barriers, { boundaryExcludesFeatures: true }) }));
assert(!/exclud/i.test(text.split('\n\n').find((p) => /water feature/.test(p))), 'a flag alone never produces an exclusion claim');

// ── 2. flood ────────────────────────────────────────────────────────────────
// The local-data shape: 6 of 11 nearby tracts contain an SFHA.
const measure = { kind: 'tract-share', tractCount: 11, sfhaTractCount: 6, description: 'share of census tracts near the site that contain a FEMA Special Flood Hazard Area' };
const sc = I.buildInfrastructureScorecard({ floodZones: [], hazardPercent: 6 / 11, hazardMeasure: measure }, {}, {}, {});
assert.deepEqual(JSON.parse(JSON.stringify(sc.floodMeasure)), measure, 'the scorecard carries what the flood figure measures');
text = J.generateNarrative(J.synthesizePMA({ infrastructure: I.getInfrastructureJustification() }));
const floodLine = text.split('\n\n').find((p) => /flood/i.test(p)) || '';
assert(floodLine, 'a >10 % flood reading is still reported');
assert(!/site area|of the site\b/i.test(floodLine), `a point-only run never claims a share of the site's area: "${floodLine}"`);
assert(floodLine.includes(measure.sfhaTractCount + ' of ' + measure.tractCount + ' census tracts'),
  'the reading names its own geography and counts');
// No measure attached (e.g. an older saved run): still no site-area claim.
const legacy = J.generateNarrative({ infrastructure: { floodRiskPercent: 0.54 }, barriers: {}, run_id: 'x' });
assert(!/site area/i.test(legacy), 'a run without a measure never says "site area"');
// The live NFHL fallback measured no share; it must not invent one.
const dss = fs.readFileSync(path.join(ROOT, 'js/data-service-portable.js'), 'utf8');
assert(!/features\.length\s*\*\s*0\.0\d/.test(dss), 'the live FEMA fallback does not turn a feature count into a percentage');

// ── 3. vintage ──────────────────────────────────────────────────────────────
const fileMeta = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/market/acs_tract_metrics_co.json'), 'utf8')).meta;
const want = 'ACS_' + parseInt(fileMeta.vintage, 10) + '_5YR';
let run = J.synthesizePMA({ acsMeta: fileMeta });
assert.equal(run.data_vintage, want, 'the run carries the tract file\'s own vintage');
assert(J.generateNarrative(run).includes('Data vintage: ' + want), 'the narrative prints it');
assert.equal(J.generateAuditTrail(run).data_vintage, want, 'the audit trail / export carries it');
// A changed fixture vintage flows through, so a refresh cannot leave it stale.
run = J.synthesizePMA({ acsMeta: { vintage: '2031' } });
assert.equal(run.data_vintage, 'ACS_2031_5YR', 'a different input vintage changes the label');
// The page path: the market page caches the tract file as PMADataCache 'acsMetrics'.
global.PMADataCache = { get: (k) => (k === 'acsMetrics' ? { meta: fileMeta } : null) };
assert.equal(J.synthesizePMA({}).data_vintage, want, 'without an override the cached tract metadata is used');
delete global.PMADataCache;
run = J.synthesizePMA({});
assert.equal(run.data_vintage, null, 'no metadata means no vintage, not a guessed one');
assert(/Data vintage: ACS vintage not supplied/.test(J.generateNarrative(run)), 'and the narrative says so');

// A run restored from localStorage: a pre-fix run carries the old hard-coded
// label, which never came from the data, so it is not reported; a current run
// keeps its own label, and a note appears when the loaded tract data differs.
const legacyRun = { run_id: 'old', data_vintage: 'ACS_2023_5YR', barriers: {} };
global.PMADataCache = { get: (k) => (k === 'acsMetrics' ? { meta: fileMeta } : null) };
assert(!J.generateNarrative(legacyRun).includes('ACS_2023_5YR'), 'a pre-fix saved label is not reported as the data vintage');
assert.equal(J.generateAuditTrail(legacyRun).data_vintage, null, 'nor carried into the audit trail');
assert.equal(JSON.parse(J.exportToJSON(legacyRun)).data_vintage, null, 'nor into the export top level');
const savedRun = JSON.parse(JSON.stringify(J.synthesizePMA({ acsMeta: { vintage: '2019' } })));
const savedText = J.generateNarrative(savedRun);
assert(savedText.includes('Data vintage: ACS_2019_5YR'), 'a saved run keeps the vintage it was computed with');
assert(savedText.includes(want), 'and says the loaded tract data is now ' + want);
const exported = JSON.parse(J.exportToJSON(savedRun));
assert.equal(exported.data_vintage, exported.auditTrail.data_vintage, 'export top level and audit trail agree');
assert(exported.auditTrail.data_vintage_note && exported.auditTrail.data_vintage_note.includes(want), 'the export carries the re-run note');
const freshRun = J.synthesizePMA({ acsMeta: fileMeta });
assert.equal(J.generateAuditTrail(freshRun).data_vintage_note, null, 'no note when the run matches the loaded data');
delete global.PMADataCache;

console.log(`pma-narrative-claims: PASS (barriers, flood measure, ${want})`);
