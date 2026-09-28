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
 * returned must equal the mean D3b of the block groups whose 2010 boundaries
 * (epa_sld_bg_geometry_co.geojson) intersect the bbox, computed here
 * independently — by clipping each polygon to the bbox and keeping those with
 * area left, not by the edge-crossing test the module uses.
 *
 * Why 2010 boundaries: EPA SLD v3 is published on 2010 block groups, and the
 * lookup used to select them by 11-digit prefix against TIGER 2020 tracts
 * (tract_centroids_co.json). 186 of EPA's 1,249 tracts do not exist in 2020
 * geography, so 667 block groups (19%) could never be selected, and 384 2020
 * tracts matched nothing.
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

const readJSON = rel => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
const BGS = readJSON('data/market/epa_sld_co.json').blockGroups;
const GEOM = readJSON('data/market/epa_sld_bg_geometry_co.geojson').features;
const TRACTS_2020 = new Set(readJSON('data/market/tract_centroids_co.json').tracts.map(t => t.geoid));

const polysOf = g => g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
const shoelace = ring => {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += (ring[j][0] * ring[i][1]) - (ring[i][0] * ring[j][1]);
  return Math.abs(a) / 2;
};
// Sutherland-Hodgman against each side of the bbox in turn.
function clipRing(ring, bb) {
  const sides = [
    [p => p[0] >= bb.minLon, (a, b) => { const t = (bb.minLon - a[0]) / (b[0] - a[0]); return [bb.minLon, a[1] + t * (b[1] - a[1])]; }],
    [p => p[0] <= bb.maxLon, (a, b) => { const t = (bb.maxLon - a[0]) / (b[0] - a[0]); return [bb.maxLon, a[1] + t * (b[1] - a[1])]; }],
    [p => p[1] >= bb.minLat, (a, b) => { const t = (bb.minLat - a[1]) / (b[1] - a[1]); return [a[0] + t * (b[0] - a[0]), bb.minLat]; }],
    [p => p[1] <= bb.maxLat, (a, b) => { const t = (bb.maxLat - a[1]) / (b[1] - a[1]); return [a[0] + t * (b[0] - a[0]), bb.maxLat]; }]
  ];
  let out = ring;
  for (const [inside, cross] of sides) {
    const src = out; out = [];
    for (let i = 0; i < src.length; i++) {
      const cur = src[i], prev = src[(i + src.length - 1) % src.length];
      if (inside(cur)) { if (!inside(prev)) out.push(cross(prev, cur)); out.push(cur); }
      else if (inside(prev)) out.push(cross(prev, cur));
    }
    if (!out.length) break;
  }
  return out;
}
// Area of the block group inside the bbox: clipped outer rings minus clipped holes.
const areaInBbox = (g, bb) => polysOf(g).reduce((sum, rings) =>
  sum + rings.reduce((s, ring, k) => s + (k === 0 ? 1 : -1) * shoelace(clipRing(ring, bb)), 0), 0);

function expectedWalk(bbox) {
  const ids = GEOM.filter(f => areaInBbox(f.geometry, bbox) > 0).map(f => f.properties.geoid);
  const hit = ids.map(k => BGS[k]).filter(Boolean);
  const mean = a => a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : null;
  const vals = hit.map(b => b.walkability).filter(v => v != null);
  const d4a = hit.map(b => b.transitAccess).filter(v => v != null);
  return {
    ids, bgs: vals.length, walk: mean(vals), d4aMeters: mean(d4a), d4aN: d4a.length,
    // block groups the 2020-tract-prefix lookup could never have reached
    lost: ids.filter(k => !TRACTS_2020.has(k.slice(0, 11))).length
  };
}

(async function main() {
  console.log('[test] EPA SLD: fetchEPASmartLocation uses the committed local file offline');
  const DS = loadDataService();

  // --- 1. Denver bbox: the local file must be the source. ---
  const denver = { minLat: 39.6, maxLat: 39.8, minLon: -105.1, maxLon: -104.9 };
  const exp = expectedWalk(denver);
  // Non-vacuity on the scan: the bbox must actually contain data to compare.
  check(exp.bgs > 200,
    'Denver bbox covers real block groups (' + exp.bgs + ' with D3b)');
  check(exp.lost > 0,
    'the bbox includes block groups whose 2010 tract is not a 2020 tract (' + exp.lost + ')');

  const r = await DS.fetchEPASmartLocation(denver);
  check(r && r._dataSource === 'epa-sld-local',
    "_dataSource is 'epa-sld-local' offline (got '" + (r && r._dataSource) + "')");
  check(r && typeof r.walkScore === 'number' && Number.isFinite(r.walkScore),
    'walkScore is a finite number (got ' + (r && r.walkScore) + ')');
  check(r && r.walkScore === exp.walk,
    'walkScore equals mean D3b of the block groups whose 2010 boundary meets the bbox (' + exp.walk + ', got ' + (r && r.walkScore) + ')');
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

  // --- 1d. A site inside a block group whose 2010 tract has no 2020 namesake. ---
  //         Found from the data, not hard-coded: the first such block group with a
  //         D3b value and a vertex-average point that lies inside its own polygon.
  const inRings = (x, y, rings) => rings.reduce((inside, ring) => {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }, false);
  let site = null;
  for (const f of GEOM) {
    const id = f.properties.geoid;
    if (TRACTS_2020.has(id.slice(0, 11)) || !BGS[id] || BGS[id].walkability == null) continue;
    const rings = polysOf(f.geometry)[0], outer = rings[0];
    const x = outer.reduce((s, p) => s + p[0], 0) / outer.length, y = outer.reduce((s, p) => s + p[1], 0) / outer.length;
    const d = 1e-5, bb = { minLat: y - d, maxLat: y + d, minLon: x - d, maxLon: x + d };
    if (!inRings(x, y, rings)) continue;
    const e = expectedWalk(bb);
    if (e.ids.length === 1 && e.ids[0] === id) { site = { id, bb, walk: e.walk }; break; }
  }
  check(site !== null, 'found a block group the 2020-tract lookup could not reach (' + (site && site.id) + ')');
  if (site) {
    const s1 = await DS.fetchEPASmartLocation(site.bb);
    check(s1 && s1._dataSource === 'epa-sld-local' && s1.blockGroupCount === 1 && s1.walkScore === site.walk,
      'a site in ' + site.id + ' gets that block group\'s own D3b (' + site.walk + ', got ' +
      (s1 && s1.walkScore) + ' from ' + (s1 && s1.blockGroupCount) + ' BG via ' + (s1 && s1._dataSource) + ')');
  }

  // --- 1e. Boundary, not envelope: a site in the notch of a concave block group ---
  //         must not pick that block group up. Found from the data: the first
  //         vertex-average point that lies inside some block group's envelope but
  //         outside its polygon, where the clip still finds a block group to use.
  const envOf = g => polysOf(g).reduce((e, rings) => rings[0].reduce((e2, [x, y]) =>
    [Math.min(e2[0], x), Math.min(e2[1], y), Math.max(e2[2], x), Math.max(e2[3], y)], e), [Infinity, Infinity, -Infinity, -Infinity]);
  let notch = null;
  for (const f of GEOM) {
    const outer = polysOf(f.geometry)[0][0];
    const x = outer.reduce((s, p) => s + p[0], 0) / outer.length, y = outer.reduce((s, p) => s + p[1], 0) / outer.length;
    const d = 1e-5, bb = { minLat: y - d, maxLat: y + d, minLon: x - d, maxLon: x + d };
    const e = expectedWalk(bb);
    if (e.walk == null) continue;
    const envOnly = GEOM.filter(g => { const v = envOf(g.geometry);
      return v[2] >= bb.minLon && v[0] <= bb.maxLon && v[3] >= bb.minLat && v[1] <= bb.maxLat; })
      .map(g => g.properties.geoid).filter(id => !e.ids.includes(id) && BGS[id] && BGS[id].walkability != null);
    if (envOnly.length) { notch = { bb, exp: e, envOnly }; break; }
  }
  check(notch !== null, 'found a site inside a block group\'s envelope but outside its boundary (' +
    (notch && notch.envOnly.join(', ')) + ')');
  if (notch) {
    const s2 = await DS.fetchEPASmartLocation(notch.bb);
    check(s2 && s2.blockGroupCount === notch.exp.bgs && s2.walkScore === notch.exp.walk,
      'that site averages only the block groups whose boundary it meets (' + notch.exp.ids.join(', ') +
      ': ' + notch.exp.walk + ', got ' + (s2 && s2.walkScore) + ' from ' + (s2 && s2.blockGroupCount) + ' BG)');
  }

  // --- 2. A bbox that meets no block group is absence, not a number. ---
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
