'use strict';
/**
 * test/pma-transit.test.js
 *
 * Unit tests for js/pma-transit.js — transit-accessibility scoring for
 * primary market area analysis. Covers calculateTransitScore, the
 * walk-distance filter, high-frequency threshold, EPA-data weight
 * redistribution, identifyTransitDeserts, getTransitLayer, and
 * getTransitJustification.
 *
 * Module exports a CommonJS surface, so no DOM / browser context needed.
 *
 * Run: node test/pma-transit.test.js
 */

const assert = require('node:assert/strict');

const Transit = require('../js/pma-transit.js');

/* ── Test harness ───────────────────────────────────────────────────── */

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✅ ${name}`); passed++; }
  catch (err) { console.log(`  ❌ ${name}`); console.log(`     ${err.message}`); failed++; }
}
function group(name, fn) { console.log(`\n${name}`); fn(); }

/* ── Fixtures ───────────────────────────────────────────────────────── */

// Denver City Hall as the site center
const SITE = { lat: 39.7392, lon: -104.9903 };

// Half-mile ≈ 0.00725° lat, 0.00945° lon at ~40°N
// A stop 0.4 mi due north is clearly within the 0.5-mi walk catchment
const NEAR_STOP = { lat: 39.7450, lon: -104.9903 };   // ~0.4 mi from site
const FAR_STOP  = { lat: 39.8000, lon: -104.9903 };   // ~4.2 mi from site

function route({ id, stops, headwayMinutes = 30 }) {
  return { id, stops, headwayMinutes };
}

// A high-frequency near route (headway 10 min, stop 0.4 mi away)
const HIGH_FREQ_NEAR = route({
  id:             'rt-high-near',
  stops:          [NEAR_STOP],
  headwayMinutes: 10,
});
// A low-frequency near route (headway 45 min, stop 0.4 mi away)
const LOW_FREQ_NEAR = route({
  id:             'rt-low-near',
  stops:          [NEAR_STOP],
  headwayMinutes: 45,
});
// A route with all stops out of the 0.5-mi catchment — should not count
const FAR_ROUTE = route({
  id:             'rt-far',
  stops:          [FAR_STOP],
  headwayMinutes: 10,
});

// EPA data shapes
const EPA_LIVE = {
  transitAccessibility: 85,
  walkScore:            80,
  _dataSource:          'epa-live',
};
const EPA_MISSING = {};

/* ── Tests ──────────────────────────────────────────────────────────── */

console.log('PMATransit — unit tests');

group('1. API surface', () => {
  test('exports calculateTransitScore, identifyTransitDeserts, getTransitLayer, getTransitJustification, TRANSIT_WEIGHTS', () => {
    assert.equal(typeof Transit.calculateTransitScore,   'function');
    assert.equal(typeof Transit.identifyTransitDeserts,  'function');
    assert.equal(typeof Transit.getTransitLayer,         'function');
    assert.equal(typeof Transit.getTransitJustification, 'function');
    assert.ok(Transit.TRANSIT_WEIGHTS);
  });

  test('TRANSIT_WEIGHTS sums to ~1.0', () => {
    const w = Transit.TRANSIT_WEIGHTS;
    const sum = w.frequency + w.coverage + w.epaIndex + w.walkScore;
    assert.ok(Math.abs(sum - 1) < 0.01, `weights sum should be ~1.0, got ${sum}`);
  });
});

group('2. calculateTransitScore — empty / edge cases', () => {
  test('no routes + no EPA data → score 0', () => {
    const s = Transit.calculateTransitScore(SITE.lat, SITE.lon, [], EPA_MISSING);
    assert.equal(s, 0);
  });

  test('no routes + EPA live → score > 0 (EPA weight redistributes)', () => {
    const s = Transit.calculateTransitScore(SITE.lat, SITE.lon, [], EPA_LIVE);
    assert.ok(s > 0, `expected positive score from EPA-only input, got ${s}`);
  });

  test('returns value in [0, 100]', () => {
    const s = Transit.calculateTransitScore(SITE.lat, SITE.lon, [HIGH_FREQ_NEAR], EPA_LIVE);
    assert.ok(s >= 0 && s <= 100, `score out of range: ${s}`);
  });
});

group('3. Walk-distance filter (0.5 mi)', () => {
  test('route with only far stops does NOT contribute to score', () => {
    const withFar  = Transit.calculateTransitScore(SITE.lat, SITE.lon, [FAR_ROUTE], EPA_MISSING);
    const empty    = Transit.calculateTransitScore(SITE.lat, SITE.lon, [], EPA_MISSING);
    assert.equal(withFar, empty,
      'far-only route should be filtered out by walk-distance (0.5 mi)');
  });

  test('route with a near stop DOES contribute to score', () => {
    const withNear = Transit.calculateTransitScore(SITE.lat, SITE.lon, [HIGH_FREQ_NEAR], EPA_MISSING);
    assert.ok(withNear > 0, 'near-stop route should add to the score');
  });

  test('getTransitJustification.nearbyRouteCount reflects the filter', () => {
    Transit.calculateTransitScore(SITE.lat, SITE.lon, [HIGH_FREQ_NEAR, FAR_ROUTE], EPA_MISSING);
    const j = Transit.getTransitJustification();
    assert.equal(j.nearbyRouteCount, 1,
      'only 1 of 2 routes is within 0.5 mi');
  });
});

group('4. High-frequency threshold (15 min headway)', () => {
  test('headway ≤ 15 min counts as high frequency', () => {
    Transit.calculateTransitScore(SITE.lat, SITE.lon, [HIGH_FREQ_NEAR], EPA_MISSING);
    const j = Transit.getTransitJustification();
    assert.equal(j.hasHighFrequencyService, true);
  });

  test('headway > 15 min alone does NOT flag high-frequency', () => {
    Transit.calculateTransitScore(SITE.lat, SITE.lon, [LOW_FREQ_NEAR], EPA_MISSING);
    const j = Transit.getTransitJustification();
    assert.equal(j.hasHighFrequencyService, false);
  });

  test('mixed: at least one high-freq route flags true', () => {
    Transit.calculateTransitScore(SITE.lat, SITE.lon, [HIGH_FREQ_NEAR, LOW_FREQ_NEAR], EPA_MISSING);
    const j = Transit.getTransitJustification();
    assert.equal(j.hasHighFrequencyService, true);
  });

  test('high-frequency routes produce higher score than low-frequency-only', () => {
    const hi = Transit.calculateTransitScore(SITE.lat, SITE.lon, [HIGH_FREQ_NEAR], EPA_MISSING);
    const lo = Transit.calculateTransitScore(SITE.lat, SITE.lon, [LOW_FREQ_NEAR],  EPA_MISSING);
    assert.ok(hi > lo, `hi-freq score (${hi}) should beat lo-freq (${lo})`);
  });
});

group('5. EPA data availability & weight redistribution', () => {
  test('EPA live data raises score above route-only baseline', () => {
    const routeOnly = Transit.calculateTransitScore(SITE.lat, SITE.lon, [LOW_FREQ_NEAR], EPA_MISSING);
    const withEpa   = Transit.calculateTransitScore(SITE.lat, SITE.lon, [LOW_FREQ_NEAR], EPA_LIVE);
    assert.ok(withEpa > routeOnly,
      `EPA-live should push score up: route-only ${routeOnly} vs with-EPA ${withEpa}`);
  });

  test('epa-sld-local _dataSource is accepted', () => {
    const epaLocal = { transitAccessibility: 60, walkScore: 60, _dataSource: 'epa-sld-local' };
    Transit.calculateTransitScore(SITE.lat, SITE.lon, [HIGH_FREQ_NEAR], epaLocal);
    const j = Transit.getTransitJustification();
    assert.equal(j.epaDataAvailable, true);
  });

  test('EPA data without _dataSource flag is treated as unavailable', () => {
    const epaNoFlag = { transitAccessibility: 60, walkScore: 60 };
    Transit.calculateTransitScore(SITE.lat, SITE.lon, [HIGH_FREQ_NEAR], epaNoFlag);
    const j = Transit.getTransitJustification();
    assert.equal(j.epaDataAvailable, false,
      'EPA values without _dataSource should not be trusted');
  });

  test('EPA raw 0-20 values are scaled up (interpreted as 0-20 index)', () => {
    // transitAccessibility of 18 on the 0-20 scale becomes 90 on the 0-100 scale.
    // Compare against a straight 0-100 value of 18.
    const epaLow  = { transitAccessibility: 18, walkScore: 18, _dataSource: 'epa-live' };
    const epaMid  = { transitAccessibility: 50, walkScore: 50, _dataSource: 'epa-live' };
    const sLow  = Transit.calculateTransitScore(SITE.lat, SITE.lon, [], epaLow);
    const sMid  = Transit.calculateTransitScore(SITE.lat, SITE.lon, [], epaMid);
    // The 0-20 branch multiplies by 5, so 18 → 90. That should beat 50 on a
    // straight-through 0-100 interpretation.
    assert.ok(sLow > sMid,
      `raw=18 (scaled to 90) should beat raw=50 on the 0-100 scale: low=${sLow}, mid=${sMid}`);
  });
});

group('6. identifyTransitDeserts', () => {
  test('null polygon returns empty array', () => {
    const d = Transit.identifyTransitDeserts(null, []);
    assert.deepEqual(d, []);
  });

  test('polygon with no coordinates returns empty array', () => {
    const d = Transit.identifyTransitDeserts({ coordinates: [] }, []);
    assert.deepEqual(d, []);
  });

  test('small polygon with no nearby routes produces desert cells', () => {
    // ~0.05° × 0.05° polygon around Denver — covers several grid cells
    const poly = {
      coordinates: [[
        [-104.99, 39.73],
        [-104.94, 39.73],
        [-104.94, 39.78],
        [-104.99, 39.78],
        [-104.99, 39.73],
      ]],
    };
    const d = Transit.identifyTransitDeserts(poly, []);
    assert.ok(Array.isArray(d));
    assert.ok(d.length > 0,
      'polygon with no routes should produce desert cells; got 0');
  });

  test('polygon densely covered by near routes produces fewer deserts', () => {
    const poly = {
      coordinates: [[
        [-104.99, 39.73],
        [-104.94, 39.73],
        [-104.94, 39.78],
        [-104.99, 39.78],
        [-104.99, 39.73],
      ]],
    };
    const emptyDeserts = Transit.identifyTransitDeserts(poly, []);
    // Cover the polygon with 10 synthetic routes at its corners
    const routes = [];
    for (let lat = 39.73; lat <= 39.78; lat += 0.01) {
      for (let lon = -104.99; lon <= -104.94; lon += 0.01) {
        routes.push(route({ id: `cov-${lat}-${lon}`, stops: [{lat, lon}], headwayMinutes: 20 }));
      }
    }
    const coveredDeserts = Transit.identifyTransitDeserts(poly, routes);
    assert.ok(coveredDeserts.length < emptyDeserts.length,
      `dense coverage should reduce deserts: empty=${emptyDeserts.length}, covered=${coveredDeserts.length}`);
  });
});

group('7. getTransitLayer', () => {
  test('returns a GeoJSON FeatureCollection', () => {
    const layer = Transit.getTransitLayer([HIGH_FREQ_NEAR]);
    assert.equal(layer.type, 'FeatureCollection');
    assert.ok(Array.isArray(layer.features));
  });

  test('empty routes → empty feature array', () => {
    const layer = Transit.getTransitLayer([]);
    assert.equal(layer.features.length, 0);
  });
});

group('8. getTransitJustification shape', () => {
  test('returns every documented key', () => {
    Transit.calculateTransitScore(SITE.lat, SITE.lon, [HIGH_FREQ_NEAR], EPA_LIVE);
    const j = Transit.getTransitJustification();
    for (const k of [
      'transitAccessibilityScore', 'walkScore', 'walkScoreAvailable',
      'epaDataAvailable', 'nearbyRouteCount', 'serviceGaps',
      'hasHighFrequencyService', '_dataSources',
    ]) {
      assert.ok(k in j, `missing key: ${k}`);
    }
  });

  test('_dataSources captures routeData, epaData, walkData', () => {
    Transit.calculateTransitScore(SITE.lat, SITE.lon, [HIGH_FREQ_NEAR], EPA_LIVE);
    const j = Transit.getTransitJustification();
    assert.equal(j._dataSources.routeData, 'local-gtfs');
    assert.equal(j._dataSources.epaData,   'epa-live');
    assert.equal(j._dataSources.walkData,  'epa-live');
  });
});

/* ── Summary ───────────────────────────────────────────────────────── */

console.log('\n=============================================');
console.log(`PMATransit: ${passed} passed, ${failed} failed`);

if (failed > 0) process.exit(1);
