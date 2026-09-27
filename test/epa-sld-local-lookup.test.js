'use strict';

/**
 * fetchEPASmartLocation must read the committed EPA SLD file, offline.
 *
 * js/data-service-portable.js declared two functions named _tractsInBbox in
 * the same IIFE: a synchronous (tracts, bbox) -> GEOID[] helper and an async
 * (bbox) -> Promise<GEOID[]> one. Function declarations hoist, so the second
 * silently replaced the first everywhere. fetchEPASmartLocation called
 * _tractsInBbox(tracts, bbox), got a Promise back, read .length as undefined,
 * and logged "No tract centroids in bbox" for every site — so the 3,532 block
 * groups in data/market/epa_sld_co.json were never used and every offline PMA
 * run reported EPA walkability as unavailable.
 *
 * This runs the real module in a vm with fetch pointed at the repo's files and
 * the network refused, so the only way to get a number is the local file.
 * What the result has to agree with is the data file itself: the walkScore
 * returned must equal the mean D3b of the block groups whose tracts fall in the
 * bbox, computed here independently from epa_sld_co.json + tract_centroids_co.json.
 *
 * Fixing that switched on a second defect: the file's `transitAccess` is EPA
 * D4A, metres to the nearest transit stop, and PMATransit clamped it as a 0-100
 * index — so being farther from transit scored higher (223 of 224 places with a
 * value pinned at 100). D4A must reach the scorer as a distance under its own
 * name, never as transitAccessibility, until a distance-to-score method exists.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const SRC_PATH = process.env.EPA_SLD_TEST_SRC || path.join(ROOT, 'js', 'data-service-portable.js');
const PMATransit = require(path.join(ROOT, 'js', 'pma-transit.js'));

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { passed++; console.log('  ✅ PASS: ' + msg); }
  else { failed++; console.log('  ❌ FAIL: ' + msg); }
}

function loadDataService() {
  const window = {
    // Local files resolve from the repo; anything else is a network call and fails.
    safeFetchJSON: function (p) {
      if (/^https?:/i.test(p)) return Promise.reject(new Error('offline: ' + p));
      return Promise.resolve(JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8')));
    }
  };
  const sandbox = {
    window,
    console: { log() {}, warn() {}, error() {}, info() {} },
    fetch: function (u) { return Promise.reject(new Error('offline: ' + u)); },
    Promise, Object, Math, JSON, Array, Number, String, Error, isFinite, parseFloat
  };
  vm.runInNewContext(fs.readFileSync(SRC_PATH, 'utf8'), sandbox, { filename: SRC_PATH });
  return window.DataService;
}

function expectedWalk(bbox) {
  const tracts = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/market/tract_centroids_co.json'), 'utf8')).tracts;
  const bgs = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/market/epa_sld_co.json'), 'utf8')).blockGroups;
  const inBox = new Set(tracts.filter(t => t.lat >= bbox.minLat && t.lat <= bbox.maxLat &&
    t.lon >= bbox.minLon && t.lon <= bbox.maxLon).map(t => t.geoid));
  const hit = Object.keys(bgs).filter(k => inBox.has(k.slice(0, 11))).map(k => bgs[k]);
  const mean = a => a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : null;
  const vals = hit.map(b => b.walkability).filter(v => v != null);
  const d4a = hit.map(b => b.transitAccess).filter(v => v != null);
  return { tracts: inBox.size, bgs: vals.length, walk: mean(vals), d4aMeters: mean(d4a), d4aN: d4a.length };
}

(async function main() {
  console.log('[test] EPA SLD: fetchEPASmartLocation uses the committed local file offline');
  const DS = loadDataService();

  // --- 1. Denver bbox: the local file must be the source. ---
  const denver = { minLat: 39.6, maxLat: 39.8, minLon: -105.1, maxLon: -104.9 };
  const exp = expectedWalk(denver);
  // Non-vacuity on the scan: the bbox must actually contain data to compare.
  check(exp.tracts > 50 && exp.bgs > 50,
    'Denver bbox covers real tracts/block groups (' + exp.tracts + ' tracts, ' + exp.bgs + ' BGs)');

  const r = await DS.fetchEPASmartLocation(denver);
  check(r && r._dataSource === 'epa-sld-local',
    "_dataSource is 'epa-sld-local' offline (got '" + (r && r._dataSource) + "')");
  check(r && typeof r.walkScore === 'number' && Number.isFinite(r.walkScore),
    'walkScore is a finite number (got ' + (r && r.walkScore) + ')');
  check(r && r.walkScore === exp.walk,
    'walkScore equals mean D3b of the bbox block groups in epa_sld_co.json (' + exp.walk + ', got ' + (r && r.walkScore) + ')');
  check(r && r.blockGroupCount === exp.bgs,
    'blockGroupCount matches the file (' + exp.bgs + ', got ' + (r && r.blockGroupCount) + ')');

  // --- 1b. D4A is a distance: carried under its name, never as a score. ---
  check(exp.d4aN > 50, 'the bbox has block groups with a D4A value to check (' + exp.d4aN + ')');
  check(r && r.transitAccessibility === null,
    'transitAccessibility is null — D4A metres are not a 0-100 index (got ' + (r && r.transitAccessibility) + ')');
  check(r && r.nearestTransitStopMeters === exp.d4aMeters,
    'nearestTransitStopMeters equals mean D4A in epa_sld_co.json (' + exp.d4aMeters + ', got ' + (r && r.nearestTransitStopMeters) + ')');
  check(r && typeof r.unavailableReason === 'string' && /D4A/.test(r.unavailableReason) && /walkability/i.test(r.unavailableReason),
    'the reason names D4A and says walkability is still used');

  // --- 1c. What the scorer does with it: walk counts, EPA transit does not. ---
  PMATransit.calculateTransitScore(39.7, -105.0, [], r);
  const j = PMATransit.getTransitJustification();
  check(j.walkScoreAvailable === true && j.walkScore === Math.min(100, exp.walk),
    'PMATransit scores walkability from the local file (' + j.walkScore + ')');
  check(j.epaDataAvailable === false,
    'PMATransit does not count an EPA transit component (epaDataAvailable ' + j.epaDataAvailable + ')');
  check(j.unavailableReason === r.unavailableReason,
    'the D4A reason reaches the justification instead of "no EPA transit or walkability score"');

  // --- 2. A bbox with no tract centroids is absence, not a number. ---
  const empty = { minLat: 30, maxLat: 30.1, minLon: -120, maxLon: -119.9 };
  const e = await DS.fetchEPASmartLocation(empty);
  check(e && e.walkScore === null && e.transitAccessibility === null,
    'an empty bbox yields null walkScore/transitAccessibility, not 0');
  check(e && e._dataSource === 'epa-unavailable',
    "an empty bbox offline reports 'epa-unavailable' (got '" + (e && e._dataSource) + "')");

  // --- 3. The async tract lookup used by the other fetchers still works. ---
  const oa = await DS.fetchHudOpportunityAtlas(denver);
  check(oa && oa._dataSource === 'opportunity-insights-local' && oa._stub !== true,
    'fetchHudOpportunityAtlas still resolves Denver tracts via the async helper');

  // --- 4. The class, not just the instance: no function name is declared twice
  //        at the IIFE's top level (two-space indent), where the later one wins. ---
  const decls = (fs.readFileSync(SRC_PATH, 'utf8').match(/^  function ([A-Za-z_$][\w$]*)\s*\(/gm) || [])
    .map(m => m.replace(/^  function /, '').replace(/\s*\($/, ''));
  const dupes = decls.filter((n, i) => decls.indexOf(n) !== i);
  check(decls.length > 20, 'scan found the module\'s function declarations (' + decls.length + ')');
  check(dupes.length === 0, 'no top-level function name is declared twice (dupes: ' + (dupes.join(', ') || 'none') + ')');

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch(function (err) { console.error(err); process.exit(1); });
