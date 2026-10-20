// test/preservation.test.js
//
// Unit tests for js/preservation.js (PreservationDashboard public API, which
// shows the CHFA preservation inventory) and js/data-connectors/nhpd.js
// (Nhpd connector, used by the market analysis).
//
// Runs with plain Node.js — no jest/mocha required.
// Exit code 0 = all pass; 1 = one or more failures.
//
// Usage:
//   node test/preservation.test.js

'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✅ PASS: ${message}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${message}`);
    failed++;
  }
}

function test(name, fn) {
  console.log(`\n[test] ${name}`);
  try {
    fn();
  } catch (err) {
    console.error(`  ❌ FAIL: threw unexpected error — ${err.message}`);
    failed++;
  }
}

// ── Minimal browser shims ────────────────────────────────────────────────────

const window = global;
global.window = global;
global.console = console;
global.CacheManager = class CacheManager {
  constructor() { this._store = {}; }
  get(k)    { return this._store[k] !== undefined ? this._store[k] : null; }
  set(k, v) { this._store[k] = v; }
  clear(k)  { delete this._store[k]; }
};
global.DataService = null;  // not needed for unit tests

// ── Load nhpd.js connector ───────────────────────────────────────────────────
eval(fs.readFileSync(path.join(ROOT, 'js/data-connectors/nhpd.js'), 'utf8'));  // eslint-disable-line no-eval

// ── Load preservation.js (suppress DOM calls in init) ────────────────────────
//
// We stub document so that DOMContentLoaded listener registers but no DOM ops run.
global.document = {
  readyState: 'complete',
  getElementById:     () => null,
  querySelectorAll:   () => [],
  createElement:      (tag) => ({ href: '', download: '', click: () => {}, style: {} }),
  body:               { appendChild: () => {}, removeChild: () => {} },
  addEventListener:   () => {},
};
global.requestAnimationFrame = (fn) => fn();
global.URL = { createObjectURL: () => 'blob:test', revokeObjectURL: () => {} };
global.Blob = class Blob { constructor(parts) { this.content = parts.join(''); } };

eval(fs.readFileSync(path.join(ROOT, 'js/preservation.js'), 'utf8'));  // eslint-disable-line no-eval

// ── Sample data ──────────────────────────────────────────────────────────────

// Nhpd connector fixtures (used by market-analysis, not by preservation.html).
const SAMPLE_FEATURE = {
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [-104.99, 39.74] },
  properties: {
    nhpd_id: 'CO-001', property_name: 'Test Apartments', address: '100 Main St',
    city: 'Denver', county: 'Denver', county_fips: '08031', state: 'CO', zip: '80204',
    total_units: 120, assisted_units: 100, subsidy_type: 'HUD Section 8 PBRA',
    subsidy_expiration: '2027-06-30', owner_type: 'nonprofit', ami_targeting: '60%',
  }
};

const SAMPLE_GEOJSON = {
  type: 'FeatureCollection',
  meta: { generated: '2026-03-13T00:00:00Z', feature_count: 3 },
  features: [
    SAMPLE_FEATURE,
    { type: 'Feature', geometry: { type: 'Point', coordinates: [-105.27, 40.01] },
      properties: { nhpd_id: 'CO-002', property_name: 'Boulder Flats', city: 'Boulder', county: 'Boulder',
        county_fips: '08013', total_units: 60, assisted_units: 50, subsidy_type: 'LIHTC', subsidy_expiration: '2035-12-31' } },
    { type: 'Feature', geometry: { type: 'Point', coordinates: [-104.82, 38.83] },
      properties: { nhpd_id: 'CO-003', property_name: 'Springs Manor', city: 'Colorado Springs', county: 'El Paso',
        county_fips: '08041', total_units: 80, assisted_units: 72, subsidy_type: 'HOME',
        subsidy_expiration: String(new Date().getFullYear() + 1) + '-06-30' } }
  ]
};

// CHFA preservation-map records, in the shape of
// data/affordable-housing/preservation/chfa-preservation.json.
const CHFA_FEATURES = [
  { type: 'Feature', geometry: { type: 'Point', coordinates: [-104.99, 39.74] },
    properties: { PROJECT: '1001 Lincoln Street ', PROJ_ADD: '1001 North Lincoln Street', PROJ_CTY: 'Denver',
      PROJ_ST: 'CO', N_UNITS: 118, UniqueProjID: '80203-MF-1001', RecordID: 1, Zip: 80203 } },
  { type: 'Feature', geometry: { type: 'Point', coordinates: [-105.27, 40.01] },
    properties: { PROJECT: 'Boulder Flats', PROJ_ADD: '200 Pearl St', PROJ_CTY: 'BOULDER',
      PROJ_ST: 'CO', N_UNITS: 40, UniqueProjID: '80302-MF-Boulder', RecordID: 2, Zip: 80302 } },
  { type: 'Feature', geometry: { type: 'Point', coordinates: [-104.82, 38.83] },
    properties: { PROJECT: 'Springs Manor', PROJ_ADD: '300 Tejon St', PROJ_CTY: 'Colorado Springs',
      PROJ_ST: 'CO', N_UNITS: null, UniqueProjID: '80903-MF-Springs', RecordID: 3, Zip: 80903 } },
];

// ── Tests: PreservationDashboard (CHFA inventory) ────────────────────────────

test('normaliseFeature: maps CHFA fields', function () {
  const n = window.PreservationDashboard._normaliseFeature(CHFA_FEATURES[0]);
  assert(n.property_name === '1001 Lincoln Street', 'property_name trimmed');
  assert(n.address === '1001 North Lincoln Street', 'address');
  assert(n.city === 'Denver', 'city');
  assert(n.zip === '80203', 'zip as string');
  assert(n.units === 118, 'units');
  assert(n.lon === -104.99 && n.lat === 39.74, 'lon/lat from geometry');
});

test('normaliseFeature: upper-case city is title-cased; missing unit count stays unknown', function () {
  const b = window.PreservationDashboard._normaliseFeature(CHFA_FEATURES[1]);
  assert(b.city === 'Boulder', 'BOULDER → Boulder');
  const s = window.PreservationDashboard._normaliseFeature(CHFA_FEATURES[2]);
  assert(s.units === null, 'null N_UNITS → null, not 0');
  assert(window.PreservationDashboard._normaliseFeature(null) === null, 'null input → null');
});

test('assignCounties + computeKpis: unknown unit counts are counted separately', function () {
  const rows = CHFA_FEATURES.map(f => window.PreservationDashboard._normaliseFeature(f));
  const names = { '-104.99': 'Denver', '-105.27': 'Boulder', '-104.82': 'El Paso' };
  window.PreservationDashboard._assignCounties(rows, (lat, lon) => ({ name: names[String(lon)] }));
  assert(rows.map(r => r.county).join('|') === 'Denver|Boulder|El Paso', 'counties assigned from location');
  const k = window.PreservationDashboard._computeKpis(rows);
  assert(k.total === 3, 'total 3');
  assert(k.totalUnits === 158, 'units 118+40, unknown excluded');
  assert(k.unknownUnits === 1, 'one property with no unit count');
  assert(k.counties === 3, 'three counties');
  const e = window.PreservationDashboard._computeKpis([]);
  assert(e.total === 0 && e.totalUnits === 0 && e.unknownUnits === 0, 'empty → zeros');
});

test('buildChartData: counties ordered by listed units', function () {
  const rows = CHFA_FEATURES.map(f => window.PreservationDashboard._normaliseFeature(f));
  rows[0].county = 'Denver'; rows[1].county = 'Boulder'; rows[2].county = '';
  const cd = window.PreservationDashboard._buildChartData(rows);
  assert(cd.labels.join('|') === 'Denver|Boulder', 'unassigned rows are left out');
  assert(cd.unitCounts[0] === 118 && cd.propertyCounts[1] === 1, 'sums agree');
});

test('inSizeBand: bands and unknown counts', function () {
  const f = window.PreservationDashboard._inSizeBand;
  assert(f({ units: 24 }, '1-24') && !f({ units: 25 }, '1-24'), '1–24 band');
  assert(f({ units: 100 }, '100+'), '100+ band');
  assert(f({ units: null }, 'unknown') && !f({ units: null }, '50-99'), 'unknown count only in unknown band');
  assert(f({ units: null }, ''), 'no filter matches everything');
});

test('chfa-preservation.json: real CHFA inventory with names, cities and points', function () {
  const geojson = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/affordable-housing/preservation/chfa-preservation.json'), 'utf8'));
  assert(geojson.type === 'FeatureCollection', 'FeatureCollection');
  assert(geojson.features.length > 1000, 'statewide inventory, not a sample (' + geojson.features.length + ')');
  assert(geojson.features.every(f => f.properties.PROJECT && f.properties.PROJ_CTY), 'every record has a name and city');
  assert(geojson.features.every(f => f.geometry && Array.isArray(f.geometry.coordinates)), 'every record has a point');
  assert(geojson.features.every(f => /PreservationProperties/.test(f.properties._source)), 'every record is from the CHFA layer');
});

// ── Tests: Nhpd connector ─────────────────────────────────────────────────────

test('Nhpd.loadFromGeoJSON: loads records and sets isLoaded()', function () {
  window.Nhpd.loadFromGeoJSON(SAMPLE_GEOJSON);
  assert(window.Nhpd.isLoaded() === true, 'isLoaded returns true after loadFromGeoJSON');
});

test('Nhpd.getInventoryInBuffer: finds Denver property near Denver coords', function () {
  window.Nhpd.loadFromGeoJSON(SAMPLE_GEOJSON);
  // Denver ~39.74 / -104.99 — 5 mile radius should hit Test Apartments
  const results = window.Nhpd.getInventoryInBuffer(39.74, -104.99, 5);
  assert(results.length >= 1, 'at least 1 property within 5 miles of Denver');
  const found = results.some(r => r.property_name === 'Test Apartments');
  assert(found, 'Test Apartments found in buffer');
});

test('Nhpd.getPropertiesNear: alias works identically to getInventoryInBuffer', function () {
  window.Nhpd.loadFromGeoJSON(SAMPLE_GEOJSON);
  const r1 = window.Nhpd.getInventoryInBuffer(39.74, -104.99, 5);
  const r2 = window.Nhpd.getPropertiesNear(39.74, -104.99, 5);
  assert(r1.length === r2.length, 'getPropertiesNear returns same count as getInventoryInBuffer');
});

test('Nhpd.getStats: computes expiringCount correctly', function () {
  window.Nhpd.loadFromGeoJSON(SAMPLE_GEOJSON);
  const all = window.Nhpd.getInventoryInBuffer(39.74, -104.99, 5000);
  const stats = window.Nhpd.getStats(all);
  assert(stats.count === 3,       'stats.count = 3');
  assert(stats.totalUnits > 0,    'totalUnits > 0');
  // HUD Section 8 PBRA expires 2027 — within 3 years from 2026 → should be flagged
  assert(stats.expiringCount >= 1, 'at least 1 property expiring within 3 years');
});

test('Nhpd.loadFromGeoJSON: rejects non-array gracefully', function () {
  // Should not throw, just warn
  try {
    window.Nhpd.loadFromGeoJSON({ features: 'not-an-array' });
    assert(true, 'no throw on bad features');
  } catch (e) {
    assert(false, 'threw on bad features: ' + e.message);
  }
});

// ── Tests: Data file integrity ────────────────────────────────────────────────

test('nhpd_co.geojson: exists and is valid JSON', function () {
  const filepath = path.join(ROOT, 'data/market/nhpd_co.geojson');
  assert(fs.existsSync(filepath), 'data/market/nhpd_co.geojson exists');
  let geojson;
  try {
    geojson = JSON.parse(fs.readFileSync(filepath, 'utf8'));
    assert(true, 'valid JSON');
  } catch (e) {
    assert(false, 'invalid JSON: ' + e.message);
    return;
  }
  assert(geojson.type === 'FeatureCollection',  'type is FeatureCollection');
  assert(Array.isArray(geojson.features),        'features is array');
  assert(geojson.features.length > 0,            'at least one feature');
  assert(geojson.meta && geojson.meta.generated, 'meta.generated present');
});

test('nhpd_co.geojson: all county_fips are 5-digit strings', function () {
  const filepath = path.join(ROOT, 'data/market/nhpd_co.geojson');
  const geojson  = JSON.parse(fs.readFileSync(filepath, 'utf8'));
  let invalid = 0;
  geojson.features.forEach(function (f) {
    const fips = f.properties && f.properties.county_fips;
    if (fips && String(fips).length !== 5) { invalid++; }
  });
  assert(invalid === 0, 'all county_fips are 5-digit strings');
});

test('nhpd_co.geojson: all required fields present', function () {
  const filepath = path.join(ROOT, 'data/market/nhpd_co.geojson');
  const geojson  = JSON.parse(fs.readFileSync(filepath, 'utf8'));
  const required = ['property_name', 'city', 'county', 'total_units', 'assisted_units', 'subsidy_type'];
  let missing = 0;
  geojson.features.forEach(function (f) {
    const p = f.properties || {};
    required.forEach(function (field) {
      if (p[field] == null) { missing++; }
    });
  });
  assert(missing === 0, 'no required fields are null/missing');
});

// ── Tests: preservation.html ─────────────────────────────────────────────────

test('preservation.html: file exists', function () {
  assert(fs.existsSync(path.join(ROOT, 'preservation.html')), 'preservation.html exists');
});

test('preservation.html: includes required scripts', function () {
  const html = fs.readFileSync(path.join(ROOT, 'preservation.html'), 'utf8');
  assert(html.includes('js/preservation.js'),           'includes preservation.js');
  assert(html.includes('js/county-from-coords.js'),     'includes county-from-coords.js');
  assert(html.includes('js/cache-manager.js'),          'includes cache-manager.js');
  assert(html.includes('js/data-service-portable.js'), 'includes data-service-portable.js');
  assert(!html.includes('js/data-connectors/nhpd.js'),  'no longer loads the NHPD stub connector');
});

test('preservation.html: names CHFA as the source and NHPD partners correctly, with no stub or build text', function () {
  const html = fs.readFileSync(path.join(ROOT, 'preservation.html'), 'utf8');
  assert(html.includes('chfainfo.com/rental-housing/preservation'), 'links CHFA preservation page');
  assert(html.includes('Public and Affordable Housing Research Corporation'), 'NHPD partner is PAHRC');
  assert(!/Public Housing Analytics/.test(html), 'no misnamed NHPD partner');
  assert(!/stub|snapshot|fetch_nhpd|HTTP 404|scripts\//i.test(html.replace(/<script[\s\S]*?<\/script>/g, '')), 'no stub, snapshot or build text');
  assert(/does not list subsidy type or expiration dates/.test(html), 'states the layer limitation');
  const js = fs.readFileSync(path.join(ROOT, 'js/preservation.js'), 'utf8');
  assert(js.includes("'affordable-housing/preservation/chfa-preservation.json'"), 'dashboard loads the CHFA inventory');
  assert(!js.includes('nhpd_co.geojson'), 'dashboard does not load the NHPD stub');
});

test('market-analysis.html: NHPD stub surface discloses vintage and gated-source limitation', function () {
  const market = fs.readFileSync(path.join(ROOT, 'market-analysis.html'), 'utf8');
  const snapshot = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/market/nhpd_co.geojson'), 'utf8'));
  assert(market.includes(snapshot.meta.generated.slice(0, 10)), 'surface vintage agrees with the source metadata');
  assert(market.includes('registration-gated'), 'surface discloses the NHPD access limitation');
  assert(/verify current subsidy status/i.test(market), 'surface requires current-source verification');
});

test('preservation.html: accessibility — landmarks present', function () {
  const html = fs.readFileSync(path.join(ROOT, 'preservation.html'), 'utf8');
  assert(html.includes('<main'),       '<main> landmark present');
  assert(html.includes('<header'),     '<header> landmark present');
  assert(html.includes('<footer'),     '<footer> landmark present');
  assert(html.includes('id="main-content"'), 'main has id="main-content"');
  assert(html.includes('href="#main-content"'), 'skip-link targets #main-content');
});

test('preservation.html: accessibility — aria-live region present', function () {
  const html = fs.readFileSync(path.join(ROOT, 'preservation.html'), 'utf8');
  assert(html.includes('aria-live'), 'aria-live region present');
});

test('preservation.html: accessibility — canvas has role and aria-label', function () {
  const html = fs.readFileSync(path.join(ROOT, 'preservation.html'), 'utf8');
  assert(html.includes('role="img"'),  'canvas has role="img"');
  assert(html.includes('aria-label'),  'canvas has aria-label');
});

// ── Summary ───────────────────────────────────────────────────────────────────

console.log('\n' + '─'.repeat(60));
console.log(`Tests: ${passed + failed}  |  Passed: ${passed}  |  Failed: ${failed}`);
if (failed > 0) {
  process.exit(1);
}
