// test/epa-walkability-site-lookup.test.js
//
// EpaWalkability must score a site from the block group the site is in.
//
// Until this test, getMetrics() never located anything: its two lookups read
// window.PMAEngine.tractsInBuffer and window.DataService._tractCentroidsCache,
// neither of which is exposed, so every site in Colorado fell through to "the
// first block group" (080010094092, Adams County). Denver, Boulder, Fruita,
// Durango and Limon all got identical walk and bike scores, and that constant
// fed 45% of SiteSelectionScore.scoreAccess().
//
// This runs the real module against the real data files. The expected GEOIDs
// are what the Census Bureau's own 2010 block-group layer returns for each
// point (TIGERweb tigerWMS_Census2010 layer 16, spatialRel intersects), not
// what the module computes; and each site is also checked for agreement with
// an independent file (the TIGER 2020 tract polygon containing it must be in
// the same county) and with the EPA record it claims to be reporting.
//
// Run: node test/epa-walkability-site-lookup.test.js

'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const ROOT = path.join(__dirname, '..');
const MODULE = process.env.EPA_WALK_MODULE || 'js/data-connectors/epa-walkability.js';

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { console.log('  ✅ PASS: ' + msg); passed++; }
  else { console.error('  ❌ FAIL: ' + msg); failed++; }
}

function readJSON(rel) { return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8')); }

const SLD = readJSON('data/market/epa_sld_co.json');
const GEOM = readJSON('data/market/epa_sld_bg_geometry_co.geojson');
const TRACTS = readJSON('data/market/tract_boundaries_co.geojson');

/** Load the real module in a sandbox; `files` overrides what safeFetchJSON returns. */
function loadModule(files) {
  const win = {};
  const pending = [];
  win.safeFetchJSON = (url) => {
    const p = Object.prototype.hasOwnProperty.call(files, url)
      ? (files[url] instanceof Error ? Promise.reject(files[url]) : Promise.resolve(files[url]))
      : Promise.reject(new Error('unexpected fetch ' + url));
    pending.push(p.catch(() => {}));
    return p;
  };
  const ctx = {
    window: win,
    document: { readyState: 'complete', addEventListener() {} },
    console: { log() {}, warn() {} },
    setTimeout() {},
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.resolve(ROOT, MODULE), 'utf8'), ctx, { filename: MODULE });
  // Let every fetch settle, then one more tick for the .then handlers.
  return Promise.all(pending).then(() => new Promise((r) => setImmediate(r))).then(() => win.EpaWalkability);
}

// Independent point-in-polygon over the TIGER 2020 tract file (a different
// vintage and a different file from the one the module reads).
function tract2020For(lat, lon) {
  function inRing(ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > lat) !== (yj > lat) && lon < (xj - xi) * (lat - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  for (const f of TRACTS.features) {
    const g = f.geometry;
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
    for (const rings of polys) {
      if (inRing(rings[0]) && !rings.slice(1).some(inRing)) {
        return String(f.properties.GEOID || f.properties.geoid);
      }
    }
  }
  return null;
}

// Census TIGERweb 2010 block group containing each point (queried 2026-09-27).
const SITES = [
  { name: 'Denver (Civic Center)', lat: 39.7392, lon: -104.9903, bg: '080310020001' },
  { name: 'Fruita',                lat: 39.1589, lon: -108.7290, bg: '080770015012' },
  { name: 'Durango',               lat: 37.2753, lon: -107.8801, bg: '080679711001' },
  { name: 'Limon',                 lat: 39.2639, lon: -103.6922, bg: '080739617001' },
  { name: 'Boulder',               lat: 40.0150, lon: -105.2705, bg: '080130122023' },
];
const OLD_CONSTANT_BG = Object.keys(SLD.blockGroups)[0]; // what every site used to get

(async () => {
  console.log('\n[test] boundary file covers exactly the EPA block groups');
  const geomIds = GEOM.features.map((f) => f.properties.geoid);
  const sldIds = Object.keys(SLD.blockGroups);
  assert(geomIds.length > 3000, 'boundary file has ' + geomIds.length + ' features (non-vacuous)');
  assert(new Set(geomIds).size === geomIds.length, 'no duplicate GEOIDs in boundary file');
  assert(geomIds.length === sldIds.length && sldIds.every((id) => geomIds.includes(id)),
    'boundary GEOID set equals epa_sld_co.json GEOID set (' + sldIds.length + ')');

  const E = await loadModule({
    'data/market/epa_sld_co.json': SLD,
    'data/market/epa_sld_bg_geometry_co.geojson': GEOM,
  });
  assert(E && typeof E.resolveSite === 'function', 'module exposes resolveSite()');
  assert(E.isLoaded(), 'isLoaded() is true once both files have loaded');
  const resolve = (lat, lon) => (typeof E.resolveSite === 'function'
    ? E.resolveSite(lat, lon) : { blockGroups: [], method: null });
  const reasonFor = (M, lat, lon) => (typeof M.getUnavailableReason === 'function'
    ? M.getUnavailableReason(lat, lon) : undefined);

  console.log('\n[test] each site resolves to the block group it is in');
  const scored = [];
  for (const s of SITES) {
    const r = resolve(s.lat, s.lon);
    assert(r.blockGroups.length === 1 && r.blockGroups[0] === s.bg,
      s.name + ' → ' + JSON.stringify(r.blockGroups) + ' (Census: ' + s.bg + ')');
    assert(r.method === 'contains', s.name + ' matched by containment, not a fallback');

    const tract = tract2020For(s.lat, s.lon);
    assert(tract && tract.slice(0, 5) === s.bg.slice(0, 5),
      s.name + ' block group county ' + s.bg.slice(0, 5) + ' agrees with the TIGER 2020 tract containing it (' + tract + ')');

    const m = E.getMetrics(s.lat, s.lon);
    const rec = SLD.blockGroups[s.bg];
    assert(m && m.walkability === rec.walkability && m.landUseMix === rec.landUseMix &&
      m.autoNetDensity === rec.autoNetDensity,
      s.name + ' metrics equal epa_sld_co.json[' + s.bg + ']');
    const sc = E.getScores(s.lat, s.lon);
    assert(sc && rec.walkIndex != null && sc.walkabilityIndex === Math.round(rec.walkIndex * 10) / 10 &&
      sc.walkScore === Math.round((rec.walkIndex - 1) / 19 * 100),
      s.name + ' walk score ' + (sc && sc.walkScore) + ' is EPA\'s index ' + rec.walkIndex + ' on 0-100');
    scored.push({ name: s.name, scores: sc });
  }

  console.log('\n[test] sites far apart no longer share one answer');
  assert(!SITES.some((s) => s.bg === OLD_CONSTANT_BG), 'no expected block group is the old constant ' + OLD_CONSTANT_BG);
  const denver = scored[0].scores, fruita = scored[1].scores;
  assert(denver && fruita && (denver.walkScore !== fruita.walkScore || denver.bikeScore !== fruita.bikeScore),
    'Denver and Fruita scores differ (' + JSON.stringify([denver && denver.walkScore, fruita && fruita.walkScore]) + ')');
  const distinct = new Set(scored.map((x) => JSON.stringify(x.scores)));
  assert(distinct.size === SITES.length, SITES.length + ' sites give ' + distinct.size + ' distinct score objects');

  console.log('\n[test] no match is null with a reason, never another place');
  const outside = [
    { name: 'Salt Lake City, UT', lat: 40.7608, lon: -111.8910 },
    { name: 'Cheyenne, WY',       lat: 41.1400, lon: -104.8202 },
  ];
  for (const o of outside) {
    assert(E.getMetrics(o.lat, o.lon) === null, o.name + ': getMetrics() is null');
    assert(E.getScores(o.lat, o.lon) === null, o.name + ': getScores() is null');
    const why = reasonFor(E, o.lat, o.lon);
    assert(typeof why === 'string' && why.length > 0, o.name + ': reason given (' + why + ')');
  }
  assert(reasonFor(E, SITES[0].lat, SITES[0].lon) === null, 'a located site has no unavailable reason');
  const nanWhy = reasonFor(E, NaN, -105);
  assert(E.getScores(NaN, -105) === null && typeof nanWhy === 'string' && nanWhy.length > 0,
    'non-numeric coordinates are null with a reason');

  const noGeom = await loadModule({
    'data/market/epa_sld_co.json': SLD,
    'data/market/epa_sld_bg_geometry_co.geojson': new Error('404'),
  });
  assert(!noGeom.isLoaded(), 'isLoaded() is false when the boundaries fail to load');
  assert(noGeom.getScores(SITES[0].lat, SITES[0].lon) === null,
    'boundaries missing → getScores() null, not a substitute block group');
  const noGeomWhy = reasonFor(noGeom, SITES[0].lat, SITES[0].lon);
  assert(typeof noGeomWhy === 'string' && noGeomWhy.length > 0 &&
    noGeomWhy !== reasonFor(E, outside[0].lat, outside[0].lon),
    'boundaries missing → a reason distinct from "site not in Colorado" (' + noGeomWhy + ')');

  console.log('\n[test] renderer shows the reason instead of dropping the section');
  const html = {};
  const rctx = {
    window: {},
    document: { getElementById: (id) => ({ set innerHTML(v) { html[id] = v; } }), readyState: 'complete', addEventListener() {} },
    console: { log() {}, warn() {} },
  };
  vm.createContext(rctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/market-analysis/market-report-renderers.js'), 'utf8'), rctx);
  const reason = reasonFor(E, 40.7608, -111.8910) || 'no reason returned';
  rctx.window.MARenderers.renderNeighborhoodAccess({
    amenities: { grocery: 0.4 }, walkability: null, walkabilityUnavailableReason: reason, access_score: 50,
  });
  const out = html.maNeighborhoodAccessContent || '';
  rctx.window.MARenderers.renderNeighborhoodAccess({ amenities: { grocery: 0.4 }, walkability: scored[0].scores, access_score: 80 });
  const shown = html.maNeighborhoodAccessContent || '';
  const d = scored[0].scores;
  assert(shown.includes(d.walkabilityIndex.toFixed(1) + ' of 20') && shown.includes(d.walkLabel),
    'panel shows EPA\'s index (' + d.walkabilityIndex + ' of 20) and its category (' + d.walkLabel + ')');
  const colorOf = { 'Most walkable': 'good', 'Above average': 'good', 'Below average': 'warn', 'Least walkable': 'bad' };
  const breakColor = (v) => (v >= 60 ? 'good' : v >= 40 ? 'warn' : 'bad');
  let discriminating = 0;
  for (const x of scored) {
    rctx.window.MARenderers.renderNeighborhoodAccess({ amenities: { grocery: 0.4 }, walkability: x.scores, access_score: 80 });
    const h = html.maNeighborhoodAccessContent || '';
    const walkRow = h.slice(h.indexOf('Walkability</span>'), h.indexOf('Bikeability</span>'));
    const want = colorOf[x.scores.walkLabel];
    if (want !== breakColor(x.scores.walkScore)) discriminating++;
    assert(new RegExp('color:var\\(--' + want + '\\)').test(walkRow),
      x.name + ': walk bar colour ' + want + ' agrees with EPA\'s category (' + x.scores.walkLabel + ', score ' + x.scores.walkScore + ')');
  }
  assert(discriminating > 0, 'at least one site where category colour and score-break colour differ (' + discriminating + '), so the check can fail');
  assert(out.includes('Walkability') && out.includes('Unavailable') && out.includes(reason.slice(1)),
    'Neighborhood Access renders "Unavailable" and the connector\'s own reason');
  assert(!out.includes('&amp;amp;'), 'section heading is escaped once, not twice');

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
