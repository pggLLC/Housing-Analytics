// test/preservation.test.js
//
// Unit tests for js/preservation.js (PreservationDashboard public API)
// and js/data-connectors/nhpd.js (Nhpd connector).
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

const SAMPLE_FEATURE = {
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [-104.99, 39.74] },
  properties: {
    nhpd_id: 'CO-001',
    property_name: 'Test Apartments',
    address: '100 Main St',
    city: 'Denver',
    county: 'Denver',
    county_fips: '08031',
    state: 'CO',
    zip: '80204',
    total_units: 120,
    assisted_units: 100,
    subsidy_type: 'HUD Section 8 PBRA',
    subsidy_expiration: '2027-06-30',
    owner_type: 'nonprofit',
    ami_targeting: '60%',
  }
};

const SAMPLE_GEOJSON = {
  type: 'FeatureCollection',
  meta: {
    generated: '2026-03-13T00:00:00Z',
    feature_count: 3,
  },
  features: [
    SAMPLE_FEATURE,
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [-105.27, 40.01] },
      properties: {
        nhpd_id: 'CO-002',
        property_name: 'Boulder Flats',
        address: '200 Pearl St',
        city: 'Boulder',
        county: 'Boulder',
        county_fips: '08013',
        state: 'CO',
        zip: '80302',
        total_units: 60,
        assisted_units: 50,
        subsidy_type: 'LIHTC',
        subsidy_expiration: '2035-12-31',
        owner_type: 'nonprofit',
        ami_targeting: '60%',
      }
    },
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [-104.82, 38.83] },
      properties: {
        nhpd_id: 'CO-003',
        property_name: 'Springs Manor',
        address: '300 Tejon St',
        city: 'Colorado Springs',
        county: 'El Paso',
        county_fips: '08041',
        state: 'CO',
        zip: '80903',
        total_units: 80,
        assisted_units: 72,
        subsidy_type: 'HOME',
        subsidy_expiration: String(new Date().getFullYear() + 1) + '-06-30',
        owner_type: 'for-profit',
        ami_targeting: '80%',
      }
    }
  ]
};

// ── Tests: PreservationDashboard._normaliseFeature ───────────────────────────

test('normaliseFeature: extracts standard fields', function () {
  const n = window.PreservationDashboard._normaliseFeature(SAMPLE_FEATURE);
  assert(n.property_name === 'Test Apartments',  'property_name correct');
  assert(n.city          === 'Denver',           'city correct');
  assert(n.county        === 'Denver',           'county correct');
  assert(n.assisted_units === 100,               'assisted_units correct');
  assert(n.total_units    === 120,               'total_units correct');
  assert(n.subsidy_type  === 'HUD Section 8 PBRA', 'subsidy_type correct');
});

test('normaliseFeature: injects lon/lat from geometry', function () {
  const n = window.PreservationDashboard._normaliseFeature(SAMPLE_FEATURE);
  assert(n.lon === -104.99, 'lon from geometry');
  assert(n.lat === 39.74,   'lat from geometry');
});

test('normaliseFeature: handles null input gracefully', function () {
  const n = window.PreservationDashboard._normaliseFeature(null);
  assert(n === null, 'returns null for null input');
});

test('normaliseFeature: handles flat object (no geometry)', function () {
  const flat = { property_name: 'Flat Prop', assisted_units: 10, subsidy_type: 'LIHTC' };
  const n = window.PreservationDashboard._normaliseFeature(flat);
  assert(n.property_name === 'Flat Prop', 'property_name from flat object');
  assert(n.assisted_units === 10,         'assisted_units from flat object');
});

// ── Tests: PreservationDashboard._parseExpiryYear ────────────────────────────

test('parseExpiryYear: parses ISO date string', function () {
  const y = window.PreservationDashboard._parseExpiryYear('2027-06-30');
  assert(y === 2027, 'year from ISO string');
});

test('parseExpiryYear: accepts numeric year', function () {
  const y = window.PreservationDashboard._parseExpiryYear(2031);
  assert(y === 2031, 'year from number');
});

test('parseExpiryYear: returns null for null input', function () {
  const y = window.PreservationDashboard._parseExpiryYear(null);
  assert(y === null, 'null input → null');
});

test('parseExpiryYear: returns null for invalid string', function () {
  const y = window.PreservationDashboard._parseExpiryYear('not-a-date');
  assert(y === null, 'invalid string → null');
});

// ── Tests: PreservationDashboard._computeKpis ────────────────────────────────

test('computeKpis: sums units and flags expiring correctly', function () {
  const rows = SAMPLE_GEOJSON.features.map(
    f => window.PreservationDashboard._normaliseFeature(f)
  );
  const kpis = window.PreservationDashboard._computeKpis(rows);
  assert(kpis.total === 3,            'total count is 3');
  assert(kpis.totalUnits === 222,     'total units = 100+50+72');
  // Springs Manor expiry is next year → should be flagged
  assert(kpis.expiringCount >= 1,     'at least 1 expiring within 3 years');
  assert(kpis.expiringUnits >= 72,    'at-risk units includes Springs Manor');
});

test('computeKpis: empty array returns zeros', function () {
  const kpis = window.PreservationDashboard._computeKpis([]);
  assert(kpis.total         === 0, 'total 0');
  assert(kpis.totalUnits    === 0, 'totalUnits 0');
  assert(kpis.expiringCount === 0, 'expiringCount 0');
  assert(kpis.expiringUnits === 0, 'expiringUnits 0');
});

// ── Tests: PreservationDashboard._buildChartData ─────────────────────────────

test('buildChartData: labels span current year + 15 years', function () {
  const rows = SAMPLE_GEOJSON.features.map(
    f => window.PreservationDashboard._normaliseFeature(f)
  );
  const cd = window.PreservationDashboard._buildChartData(rows);
  const currentYear = new Date().getFullYear();
  assert(cd.labels[0] === String(currentYear),               'first label = current year');
  assert(cd.labels[cd.labels.length - 1] === String(currentYear + 15), 'last label = current+15');
  assert(cd.unitCounts.length === cd.labels.length,          'unit count array aligned with labels');
  assert(cd.propertyCounts.length === cd.labels.length,      'property count array aligned');
});

test('buildChartData: 2035 bucket contains Boulder Flats (50 units)', function () {
  const rows = SAMPLE_GEOJSON.features.map(
    f => window.PreservationDashboard._normaliseFeature(f)
  );
  const cd = window.PreservationDashboard._buildChartData(rows);
  const idx = cd.labels.indexOf('2035');
  assert(idx !== -1,              '2035 label present');
  assert(cd.unitCounts[idx] === 50, '50 units in 2035 bucket');
  assert(cd.propertyCounts[idx] === 1, '1 property in 2035 bucket');
});

// ── Tests: PreservationDashboard._expiryClass ─────────────────────────────────

test('expiryClass: expired date returns pres-exp-expired', function () {
  const cls = window.PreservationDashboard._expiryClass('2020-01-01');
  assert(cls === 'pres-exp-expired', 'past date → expired class');
});

test('expiryClass: null input returns pres-exp-unknown', function () {
  const cls = window.PreservationDashboard._expiryClass(null);
  assert(cls === 'pres-exp-unknown', 'null → unknown class');
});

test('expiryClass: future date 5+ years returns pres-exp-ok', function () {
  const futureYear = new Date().getFullYear() + 8;
  const cls = window.PreservationDashboard._expiryClass(futureYear + '-12-31');
  assert(cls === 'pres-exp-ok', 'far future → ok class');
});

// ── Tests: PreservationDashboard._subsidyTypeSlug ────────────────────────────

test('subsidyTypeSlug: HUD Section 8 PBRA → hud-section-8-pbra', function () {
  const s = window.PreservationDashboard._subsidyTypeSlug('HUD Section 8 PBRA');
  assert(s === 'hud-section-8-pbra', 'slug correct');
});

test('subsidyTypeSlug: empty string returns "other"', function () {
  const s = window.PreservationDashboard._subsidyTypeSlug('');
  assert(s === 'other', 'empty → other');
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
  assert(html.includes('js/data-connectors/nhpd.js'),  'includes nhpd.js connector');
  assert(html.includes('js/cache-manager.js'),          'includes cache-manager.js');
  assert(html.includes('js/data-service-portable.js'), 'includes data-service-portable.js');
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
