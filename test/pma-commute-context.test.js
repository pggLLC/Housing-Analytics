#!/usr/bin/env node
// Regression guards for #1232 D-lite commute context overlay.

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const CommuteContext = require('../js/pma-commute-context.js');

function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
}

const lodes = readJson('data/market/lodes_co.json');
const arcs = readJson('data/market/lodes_od_arcs_co.geojson');
const source = fs.readFileSync(path.join(ROOT, 'js/pma-commute-context.js'), 'utf8');
const engineSource = fs.readFileSync(path.join(ROOT, 'js/market-analysis.js'), 'utf8');
const scoringSource = fs.readFileSync(path.join(ROOT, 'js/market-analysis-scoring.js'), 'utf8');

assert.equal(
  CommuteContext.LEGEND_TEXT,
  'LODES 2023 commute context \u2014 does not change PMA scores or tract selection',
  'legend disclosure string is pinned'
);
assert(source.includes('LODES 2023 commute context'), 'overlay source carries the commute-context legend');
assert(!source.includes('PMACommuting'), 'D-lite overlay does not call PMACommuting synthetic/hull module');
assert(!source.includes('_buildSyntheticWorkplaces'), 'D-lite overlay cannot invoke synthetic workplace fallback');
assert(!source.includes('generateCommutingBoundary'), 'D-lite overlay does not render commute-shaped PMA boundaries');
assert(engineSource.includes('commuteContextOverlay'), 'PMA result/export records commute-context overlay state');

assert(lodes && Array.isArray(lodes.tracts) && lodes.tracts.length === 1447, 'real lodes_co.json is loaded and non-vacuous');
assert(arcs && Array.isArray(arcs.features) && arcs.features.length === 500, 'real lodes_od_arcs_co.geojson top-500 sample is loaded');

const touchingArc = arcs.features.find((feature) => {
  const p = feature.properties || {};
  return p.home_tract && p.work_tract && p.home_tract !== p.work_tract;
});
assert(touchingArc, 'fixture found a real OD arc with home/work tract GEOIDs');
const touchingHome = touchingArc.properties.home_tract;
const touchingWork = touchingArc.properties.work_tract;

const untouchedTract = lodes.tracts.find((tract) => {
  return !arcs.features.some((feature) => {
    const p = feature.properties || {};
    return p.home_tract === tract.geoid || p.work_tract === tract.geoid;
  });
});
assert(untouchedTract, 'fixture found a real tract outside every top-500 OD arc');

const oneTouch = CommuteContext.buildOverlayData(
  { _tractIds: [touchingHome] },
  lodes,
  arcs
);
assert.equal(oneTouch.blocked, false, 'overlay renders with committed LODES data');
assert(oneTouch.tractJobs.some((row) => row.geoid === touchingHome && row.work_workers > 0), 'selected tract WAC jobs render');
assert(oneTouch.arcs.some((feature) => {
  const p = feature.properties || {};
  return p.home_tract === touchingHome || p.work_tract === touchingHome;
}), 'arc touching the selected PMA tract renders');

const tractSetResult = { _tractIds: [touchingHome, touchingWork] };
const tractSetBefore = JSON.stringify(tractSetResult._tractIds);
CommuteContext.buildOverlayData(tractSetResult, lodes, arcs);
assert.equal(JSON.stringify(tractSetResult._tractIds), tractSetBefore, 'overlay build leaves rendered/analytic tract set unchanged');

const twoTouch = CommuteContext.buildOverlayData(
  { bufferTractsDetail: [{ geoid: touchingHome }, { geoid: touchingWork }] },
  lodes,
  arcs
);
assert(twoTouch.tractGeoids.includes(touchingWork), 'bufferTractsDetail path contributes selected PMA tract GEOIDs');
assert(twoTouch.arcs.length >= oneTouch.arcs.length, 'adding the work tract keeps or expands the filtered arc set');

const noTouch = CommuteContext.buildOverlayData(
  { _tractIds: [untouchedTract.geoid] },
  lodes,
  arcs
);
assert.equal(noTouch.blocked, false, 'overlay still renders tract WAC context when no top-500 arc touches');
assert.equal(noTouch.arcs.length, 0, 'arc touching no PMA tract never renders');

const emptyLodes = CommuteContext.buildOverlayData(
  { _tractIds: [touchingHome] },
  { meta: { vintage: 2023 }, tracts: [] },
  arcs
);
assert.equal(emptyLodes.blocked, true, 'empty committed lodes_co.json blocks overlay');
assert(emptyLodes.warning.includes('no synthetic commute content'), 'empty LODES warning rejects synthetic content');

const fallback = CommuteContext.buildOverlayData(
  { _tractIds: [touchingHome] },
  lodes,
  arcs,
  { lastDataCoverage: 'fallback' }
);
assert.equal(fallback.blocked, true, 'fallback data coverage blocks overlay');
assert(fallback.warning.includes('fallback commute data'), 'fallback warning is visible');

const syntheticSabotage = {
  fetchLODESWorkplaces() {
    return Promise.resolve({ workplaces: [{ tractId: 'synthetic', jobCount: 999999 }], commutingFlows: [] });
  },
  _buildSyntheticWorkplaces() {
    throw new Error('synthetic path should be unreachable');
  },
  generateCommutingBoundary() {
    throw new Error('convex-hull boundary should be unreachable');
  }
};
global.window = { PMACommuting: syntheticSabotage };
const before = JSON.stringify(oneTouch);
const after = JSON.stringify(CommuteContext.buildOverlayData({ _tractIds: [touchingHome] }, lodes, arcs));
delete global.window;
assert.equal(after, before, 'force-enabled synthetic PMACommuting path leaves D-lite output byte-identical');

assert(engineSource.includes("ctx.render(map, lastResult)"), 'market-analysis refreshes commute context from the current PMA result');
assert(engineSource.includes('computePma(acs, lihtcUnits, 0, lat, lon, bufTracts, _pmaCountyAmi, nearbyLihtc, acsIdx)'),
  'computePma call signature remains unchanged');
assert(!scoringSource.includes('commuteContext'), 'shared PMA scoring helper does not read commute context overlay state');

console.log('pma-commute-context: PASS');
