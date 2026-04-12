// test/unit/fema-flood.test.js
//
// Unit tests for js/data-connectors/fema-flood.js
//
// Verifies:
//   1. Public API is fully exposed on window.
//   2. isLoaded() returns false before data is loaded.
//   3. getRiskAtPoint() returns FALLBACK when not loaded.
//   4. loadFloodZones() accepts an array of plain objects.
//   5. loadFloodZones() accepts a GeoJSON FeatureCollection.
//   6. loadFloodZones() rejects null / unrecognised format without throwing.
//   7. isLoaded() returns true after successful load.
//   8. zoneToRisk — A-prefixed zones (high risk) → riskLevel "High", score 0.
//   9. zoneToRisk — V-prefixed zones (high risk) → riskLevel "High", score 0.
//  10. zoneToRisk — zone "X" (low risk) → riskLevel "Low", score 100.
//  11. zoneToRisk — zone "X500" (moderate) → riskLevel "Moderate", score 40.
//  12. zoneToRisk — zone "B" (moderate) → riskLevel "Moderate", score 40.
//  13. zoneToRisk — unknown zone code → riskLevel "Unknown", score 50.
//  14. getRiskAtPoint() returns FALLBACK for non-numeric coordinates.
//  15. getRiskAtPoint() finds nearest feature from plain-object array.
//  16. getRiskAtPoint() extracts zone from GeoJSON Feature properties.
//  17. getRiskAtPoint() extracts zone from GeoJSON geometry.coordinates [lon,lat].
//  18. getRiskAtPoint() handles feature with alternative lat/lon field names.
//  19. With multiple zones, nearest centroid wins.
//
// Usage: node test/unit/fema-flood.test.js

'use strict';

const path = require('path');

// fema-flood.js exposes window.FemaFlood
global.window = global;

// Mock console.warn / console.log to suppress output during tests
const _warn = console.warn;
const _log  = console.log;

require(path.join(__dirname, '../../js/data-connectors/fema-flood.js'));
const FF = global.FemaFlood;

// Restore logging for test output
console.warn = _warn;
console.log  = _log;

let passed = 0, failed = 0;

function assert(cond, msg) {
  if (cond) { console.log('  ✅ PASS:', msg); passed++; }
  else       { console.error('  ❌ FAIL:', msg); failed++; }
}

function test(name, fn) {
  console.log('\n[test]', name);
  try { fn(); }
  catch (e) { console.error('  ❌ FAIL: threw —', e.message); failed++; }
}

// ---------------------------------------------------------------------------
// Helper: reset module state between tests by loading empty array
// ---------------------------------------------------------------------------
function resetFloodData() {
  // Suppress the console.log for this call
  const orig = console.log;
  console.log = function () {};
  FF.loadFloodZones([]);
  console.log = orig;
}

// ---------------------------------------------------------------------------
// 1. API exposure
// ---------------------------------------------------------------------------

test('FemaFlood API fully exposed on window', function () {
  assert(typeof FF                 === 'object',   'FemaFlood is an object');
  assert(typeof FF.loadFloodZones  === 'function', 'loadFloodZones exported');
  assert(typeof FF.getRiskAtPoint  === 'function', 'getRiskAtPoint exported');
  assert(typeof FF.isLoaded        === 'function', 'isLoaded exported');
});

// ---------------------------------------------------------------------------
// 2. isLoaded() before any data
// ---------------------------------------------------------------------------

test('isLoaded() returns false before loadFloodZones() is called', function () {
  resetFloodData();
  assert(FF.isLoaded() === false, 'isLoaded() = false on fresh state (empty array)');
});

// ---------------------------------------------------------------------------
// 3. getRiskAtPoint() fallback when not loaded
// ---------------------------------------------------------------------------

test('getRiskAtPoint() returns FALLBACK when not loaded', function () {
  resetFloodData();
  const result = FF.getRiskAtPoint(39.7392, -104.9847);
  assert(result.zone      === 'Unknown', 'zone = "Unknown" when not loaded');
  assert(result.riskLevel === 'Unknown', 'riskLevel = "Unknown" when not loaded');
  assert(result.score     === 50,        'score = 50 (neutral) when not loaded');
});

// ---------------------------------------------------------------------------
// 4. loadFloodZones() accepts a plain-object array
// ---------------------------------------------------------------------------

test('loadFloodZones() accepts array of plain objects', function () {
  const zones = [
    { lat: 39.7392, lon: -104.9847, zone: 'AE' },
    { lat: 40.0150, lon: -105.2705, zone: 'X' },
  ];
  console.log = function () {}; // suppress noise
  FF.loadFloodZones(zones);
  console.log = _log;
  assert(FF.isLoaded() === true, 'isLoaded() = true after loading array');
});

// ---------------------------------------------------------------------------
// 5. loadFloodZones() accepts GeoJSON FeatureCollection
// ---------------------------------------------------------------------------

test('loadFloodZones() accepts GeoJSON FeatureCollection', function () {
  const geojson = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [-104.9847, 39.7392] },
        properties: { FLD_ZONE: 'AE' },
      },
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [-105.2705, 40.0150] },
        properties: { FLD_ZONE: 'X' },
      },
    ],
  };
  console.log = function () {};
  FF.loadFloodZones(geojson);
  console.log = _log;
  assert(FF.isLoaded() === true, 'isLoaded() = true after loading FeatureCollection');
});

// ---------------------------------------------------------------------------
// 6. loadFloodZones() rejects null/unrecognised format
// ---------------------------------------------------------------------------

test('loadFloodZones() handles null and unrecognised format without throwing', function () {
  let threw = false;
  try {
    console.warn = function () {};
    FF.loadFloodZones(null);
    FF.loadFloodZones({ unknownField: true });
    console.warn = _warn;
  } catch (e) {
    threw = true;
  }
  assert(!threw, 'no exception thrown for null/bad format');
});

// ---------------------------------------------------------------------------
// Zone risk classification tests (exercised through getRiskAtPoint)
// ---------------------------------------------------------------------------

function loadSingleZone(zone, lat, lon) {
  console.log = function () {};
  FF.loadFloodZones([{ lat: lat || 39.7392, lon: lon || -104.9847, zone: zone }]);
  console.log = _log;
}

// ---------------------------------------------------------------------------
// 8. A-prefixed zones → High risk
// ---------------------------------------------------------------------------

test('A-prefixed zones map to riskLevel "High" and score 0', function () {
  const aCodes = ['A', 'AE', 'AH', 'AO', 'AR', 'A99'];
  aCodes.forEach(function (code) {
    loadSingleZone(code);
    const r = FF.getRiskAtPoint(39.7392, -104.9847);
    assert(r.riskLevel === 'High' && r.score === 0,
      'zone "' + code + '" → High / 0 (got ' + r.riskLevel + '/' + r.score + ')');
  });
});

// ---------------------------------------------------------------------------
// 9. V-prefixed zones → High risk
// ---------------------------------------------------------------------------

test('V-prefixed zones map to riskLevel "High" and score 0', function () {
  ['V', 'VE'].forEach(function (code) {
    loadSingleZone(code);
    const r = FF.getRiskAtPoint(39.7392, -104.9847);
    assert(r.riskLevel === 'High' && r.score === 0,
      'zone "' + code + '" → High / 0 (got ' + r.riskLevel + '/' + r.score + ')');
  });
});

// ---------------------------------------------------------------------------
// 10. Zone "X" → Low risk, score 100
// ---------------------------------------------------------------------------

test('zone "X" maps to riskLevel "Low" and score 100', function () {
  loadSingleZone('X');
  const r = FF.getRiskAtPoint(39.7392, -104.9847);
  assert(r.riskLevel === 'Low', 'zone X → riskLevel "Low"');
  assert(r.score     === 100,   'zone X → score 100');
});

test('zone "C" maps to riskLevel "Low" and score 100', function () {
  loadSingleZone('C');
  const r = FF.getRiskAtPoint(39.7392, -104.9847);
  assert(r.riskLevel === 'Low', 'zone C → riskLevel "Low"');
  assert(r.score     === 100,   'zone C → score 100');
});

// ---------------------------------------------------------------------------
// 11. Zone "X500" → Moderate, score 40
// ---------------------------------------------------------------------------

test('zone "X500" maps to riskLevel "Moderate" and score 40', function () {
  loadSingleZone('X500');
  const r = FF.getRiskAtPoint(39.7392, -104.9847);
  assert(r.riskLevel === 'Moderate', 'zone X500 → riskLevel "Moderate"');
  assert(r.score     === 40,         'zone X500 → score 40');
});

// ---------------------------------------------------------------------------
// 12. Zone "B" → Moderate, score 40
// ---------------------------------------------------------------------------

test('zone "B" maps to riskLevel "Moderate" and score 40', function () {
  loadSingleZone('B');
  const r = FF.getRiskAtPoint(39.7392, -104.9847);
  assert(r.riskLevel === 'Moderate', 'zone B → riskLevel "Moderate"');
  assert(r.score     === 40,         'zone B → score 40');
});

// ---------------------------------------------------------------------------
// 13. Unknown zone code → "Unknown", score 50
// ---------------------------------------------------------------------------

test('unknown zone code maps to riskLevel "Unknown" and score 50', function () {
  ['Z99', 'FLOODWAY', 'UNKNOWN_CODE', ''].forEach(function (code) {
    loadSingleZone(code);
    const r = FF.getRiskAtPoint(39.7392, -104.9847);
    assert(r.riskLevel === 'Unknown' && r.score === 50,
      'zone "' + code + '" → Unknown / 50 (got ' + r.riskLevel + '/' + r.score + ')');
  });
});

// ---------------------------------------------------------------------------
// 14. getRiskAtPoint() — non-numeric coordinates
// ---------------------------------------------------------------------------

test('getRiskAtPoint() returns FALLBACK for non-numeric coordinates', function () {
  console.log = function () {};
  FF.loadFloodZones([{ lat: 39.7392, lon: -104.9847, zone: 'AE' }]);
  console.log = _log;
  console.warn = function () {};
  const r1 = FF.getRiskAtPoint('39.7', -104.9847);
  const r2 = FF.getRiskAtPoint(null, -104.9847);
  console.warn = _warn;
  assert(r1.riskLevel === 'Unknown', 'string lat → Unknown');
  assert(r2.riskLevel === 'Unknown', 'null lat → Unknown');
});

// ---------------------------------------------------------------------------
// 15. getRiskAtPoint() finds nearest plain-object feature
// ---------------------------------------------------------------------------

test('getRiskAtPoint() finds nearest zone by centroid from plain-object array', function () {
  console.log = function () {};
  FF.loadFloodZones([
    { lat: 39.7392, lon: -104.9847, zone: 'AE' },  // Denver
    { lat: 40.0150, lon: -105.2705, zone: 'X'  },  // Boulder
  ]);
  console.log = _log;

  // Site near Denver should get AE (High risk)
  const denver = FF.getRiskAtPoint(39.7400, -104.9840);
  assert(denver.zone === 'AE',        'near Denver → AE zone');
  assert(denver.riskLevel === 'High', 'near Denver → High risk');

  // Site near Boulder should get X (Low risk)
  const boulder = FF.getRiskAtPoint(40.0100, -105.2700);
  assert(boulder.zone === 'X',        'near Boulder → X zone');
  assert(boulder.riskLevel === 'Low', 'near Boulder → Low risk');
});

// ---------------------------------------------------------------------------
// 16. getRiskAtPoint() extracts zone from GeoJSON Feature properties
// ---------------------------------------------------------------------------

test('getRiskAtPoint() reads zone from GeoJSON Feature properties.FLD_ZONE', function () {
  const geojson = {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [-104.9847, 39.7392] },
      properties: { FLD_ZONE: 'VE' },
    }],
  };
  console.log = function () {};
  FF.loadFloodZones(geojson);
  console.log = _log;

  const r = FF.getRiskAtPoint(39.7392, -104.9847);
  assert(r.zone === 'VE',           'zone extracted from properties.FLD_ZONE');
  assert(r.riskLevel === 'High',    'VE → High risk');
  assert(r.score     === 0,         'VE → score 0');
});

// ---------------------------------------------------------------------------
// 17. getRiskAtPoint() extracts lat/lon from GeoJSON geometry.coordinates [lon,lat]
// ---------------------------------------------------------------------------

test('getRiskAtPoint() reads lat/lon from GeoJSON geometry.coordinates', function () {
  const geojson = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [-104.9847, 39.7392] }, // lon, lat
        properties: { FLD_ZONE: 'X' },
      },
    ],
  };
  console.log = function () {};
  FF.loadFloodZones(geojson);
  console.log = _log;

  // Query exactly at the feature's coordinates
  const r = FF.getRiskAtPoint(39.7392, -104.9847);
  assert(r.zone === 'X', 'zone read from GeoJSON geometry feature');
});

// ---------------------------------------------------------------------------
// 18. getRiskAtPoint() handles alternative field names (LATITUDE/LONGITUDE)
// ---------------------------------------------------------------------------

test('getRiskAtPoint() handles alternative LATITUDE/LONGITUDE field names', function () {
  console.log = function () {};
  FF.loadFloodZones([
    { LATITUDE: 39.7392, LONGITUDE: -104.9847, zone: 'AH' },
  ]);
  console.log = _log;

  const r = FF.getRiskAtPoint(39.7392, -104.9847);
  assert(r.riskLevel === 'High', 'reads LATITUDE/LONGITUDE and returns High risk for AH');
});

// ---------------------------------------------------------------------------
// 19. Nearest centroid wins with multiple zones
// ---------------------------------------------------------------------------

test('nearest centroid wins when multiple zones are present', function () {
  console.log = function () {};
  FF.loadFloodZones([
    { lat: 39.7392, lon: -104.9847, zone: 'AE' },  // 0.01° away from query
    { lat: 40.5000, lon: -105.0000, zone: 'X'  },  // ~50 miles away
    { lat: 38.8000, lon: -104.8000, zone: 'B'  },  // ~60 miles away
  ]);
  console.log = _log;

  const r = FF.getRiskAtPoint(39.7400, -104.9850);
  assert(r.zone === 'AE', 'nearest zone (AE) wins over distant X and B');
  assert(r.riskLevel === 'High', 'nearest zone → High risk');
});

// ---------------------------------------------------------------------------

console.log('\n' + '='.repeat(60));
console.log('Results:', passed, 'passed,', failed, 'failed');
if (failed > 0) process.exitCode = 1;
