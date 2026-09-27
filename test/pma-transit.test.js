'use strict';
/**
 * test/pma-transit.test.js
 *
 * Unit tests for js/pma-transit.js — transit-accessibility scoring for
 * primary market area analysis, measured from confirmed transit stops
 * (owner decision 2026-09-27). Covers calculateTransitScore, the distance
 * tiers, frequency (not measurable from stops: null, never false), EPA-data
 * weight redistribution, identifyTransitDeserts, getTransitLayer, and
 * getTransitJustification. The stop-selection rule and the absence cases
 * are in test/pma-transit-stops.test.js.
 *
 * Module exports a CommonJS surface, so no DOM / browser context needed.
 *
 * Run: node test/pma-transit.test.js
 */

const assert = require('node:assert/strict');

const Transit = require('../js/pma-transit.js');
const fs = require('node:fs');
const path = require('node:path');

// The two distances come from the status file, as on the page.
const MAP_STATUS = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data/policy/thiz-map-status.json'), 'utf8'));
const calc = (lat, lon, stops, epa) => Transit.calculateTransitScore(lat, lon, stops, epa, MAP_STATUS);

/* ── Test harness ───────────────────────────────────────────────────── */

let passed = 0;
let failed = 0;
const pending = [];
function test(name, fn) {
  try {
    const result = fn();
    if (result && typeof result.then === 'function') {
      pending.push(result.then(() => { console.log(`  ✅ ${name}`); passed++; })
        .catch((err) => { console.log(`  ❌ ${name}`); console.log(`     ${err.message}`); failed++; }));
    } else {
      console.log(`  ✅ ${name}`); passed++;
    }
  }
  catch (err) { console.log(`  ❌ ${name}`); console.log(`     ${err.message}`); failed++; }
}
function group(name, fn) { console.log(`\n${name}`); fn(); }

/* ── Fixtures ───────────────────────────────────────────────────────── */

// Denver City Hall as the site center
const SITE = { lat: 39.7392, lon: -104.9903 };

// Half-mile ≈ 0.00725° lat, 0.00945° lon at ~40°N
// A stop 0.4 mi due north is clearly within the 0.5-mi walk catchment
const NEAR_STOP = { lat: 39.7450, lon: -104.9903 };   // ~0.4 mi from site
const FAR_STOP  = { lat: 39.7610, lon: -104.9903 };   // ~1.5 mi from site: beyond ½ mi, inside the 2-mi zone radius

// A confirmed public scheduled stop, as the statewide stop file writes it.
function stopFeature({ lat, lon }, extra = {}) {
  return { type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] },
    properties: Object.assign({ name: 'Stop', agency: 'Test Transit', operator: 'public',
      sources: ['cdot'], reliability: 'confirmed', service: 'fixed_route' }, extra) };
}
function stopFile(points, extra) {
  return { type: 'FeatureCollection', meta: { generated: '2026-09-27T00:00:00Z' },
    features: points.map((p) => stopFeature(p, extra)) };
}
// A stop file that loaded but has no stop anywhere near the site.
const NOWHERE = stopFile([{ lat: 37.0, lon: -102.1 }]);
const NEAR = stopFile([NEAR_STOP]);
const FAR  = stopFile([FAR_STOP]);

// EPA data shapes
const EPA_LIVE = {
  transitAccessibility: 85,
  walkScore:            80,
  _dataSource:          'epa-live',
};
const EPA_MISSING = {};
const EPA_UNAVAILABLE_REASON = 'EPA Smart Location data is unavailable; no EPA transit or walkability score was calculated.';

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
  test('no stop within the zone radius + no EPA data → measured score 0', () => {
    const s = calc(SITE.lat, SITE.lon, NOWHERE, EPA_MISSING);
    assert.equal(s, 0);
  });

  test('no stop within the zone radius + EPA live → score > 0 (EPA is still measured)', () => {
    const s = calc(SITE.lat, SITE.lon, NOWHERE, EPA_LIVE);
    assert.ok(s > 0, `expected positive score from EPA-only input, got ${s}`);
  });

  test('returns value in [0, 100]', () => {
    const s = calc(SITE.lat, SITE.lon, NEAR, EPA_LIVE);
    assert.ok(s >= 0 && s <= 100, `score out of range: ${s}`);
  });
});

group('3. Distance tiers (QAP TOD distance, zone radius — from the status file)', () => {
  test('stop between the TOD distance and the zone radius contributes partial credit', () => {
    const withFar  = calc(SITE.lat, SITE.lon, FAR, EPA_MISSING);
    const empty    = calc(SITE.lat, SITE.lon, NOWHERE, EPA_MISSING);
    assert.ok(withFar > empty, 'a stop in the zone tier should contribute partial credit');
    assert.ok(withFar < 50, 'partial credit should be substantially less than TOD-tier credit');
  });

  test('stop beyond the zone radius does NOT contribute', () => {
    const veryFar = stopFile([{ lat: 39.8000, lon: -104.9903 }]);  // ~4.2 mi north of site
    const withVeryFar = calc(SITE.lat, SITE.lon, veryFar, EPA_MISSING);
    const empty       = calc(SITE.lat, SITE.lon, NOWHERE, EPA_MISSING);
    assert.equal(withVeryFar, empty, 'a stop beyond the zone radius should produce 0 transit credit');
  });

  test('TOD-tier stop (≤ the QAP TOD distance) gets credit', () => {
    const withNear = calc(SITE.lat, SITE.lon, NEAR, EPA_MISSING);
    assert.ok(withNear > 0, 'near stop should add to the score');
  });

  test('getTransitJustification.nearbyStopCount = TOD-tier stops only', () => {
    calc(SITE.lat, SITE.lon, stopFile([NEAR_STOP, FAR_STOP]), EPA_MISSING);
    const j = Transit.getTransitJustification();
    assert.equal(j.nearbyStopCount, 1, 'nearbyStopCount counts only stops within the TOD distance; FAR_STOP is in the zone tier');
    assert.equal(j.stopsWithinZoneRadius, 2);
    assert.equal('nearbyRouteCount' in j, false, 'the old route-count field must not survive with a stop count in it');
  });

  test('TOD-tier stop scores higher than zone-tier stop', () => {
    const withNear = calc(SITE.lat, SITE.lon, NEAR, EPA_MISSING);
    const withFar  = calc(SITE.lat, SITE.lon, FAR,  EPA_MISSING);
    assert.ok(withNear > withFar, 'TOD-tier stop (full credit) should outscore a zone-tier stop (half credit)');
  });
});

group('4. Frequency is not measurable from the stop file', () => {
  test('hasHighFrequencyService is null with a reason, never false', () => {
    calc(SITE.lat, SITE.lon, NEAR, EPA_MISSING);
    const j = Transit.getTransitJustification();
    assert.equal(j.hasHighFrequencyService, null);
    assert.match(j.highFrequencyUnavailableReason, /no schedule/);
    assert.equal(j._dataSources.frequencyData, 'unavailable');
  });

  test('no stop property the file does not carry changes the score', () => {
    const plain = calc(SITE.lat, SITE.lon, NEAR, EPA_MISSING);
    const withHeadway = calc(SITE.lat, SITE.lon, stopFile([NEAR_STOP], { headwayMinutes: 5 }), EPA_MISSING);
    assert.equal(withHeadway, plain, 'a headway field is not read, so it cannot move the score');
  });
});

group('5. EPA data availability & weight redistribution', () => {
  test('EPA live data raises score above stop-only baseline', () => {
    const stopOnly = calc(SITE.lat, SITE.lon, NEAR, EPA_MISSING);
    const withEpa  = calc(SITE.lat, SITE.lon, NEAR, EPA_LIVE);
    assert.ok(withEpa > stopOnly,
      `EPA-live should push score up: stop-only ${stopOnly} vs with-EPA ${withEpa}`);
  });

  test('epa-sld-local _dataSource is accepted', () => {
    const epaLocal = { transitAccessibility: 60, walkScore: 60, _dataSource: 'epa-sld-local' };
    calc(SITE.lat, SITE.lon, NEAR, epaLocal);
    const j = Transit.getTransitJustification();
    assert.equal(j.epaDataAvailable, true);
  });

  test('EPA data without _dataSource flag is treated as unavailable', () => {
    const epaNoFlag = { transitAccessibility: 60, walkScore: 60 };
    calc(SITE.lat, SITE.lon, NEAR, epaNoFlag);
    const j = Transit.getTransitJustification();
    assert.equal(j.epaDataAvailable, false,
      'EPA values without _dataSource should not be trusted');
    assert.equal(j.walkScore, null, 'unavailable EPA walkability is not rendered as a numeric score');
    assert.equal(j.unavailableReason, EPA_UNAVAILABLE_REASON, 'unavailability reason travels with the result');
  });

  test('EPA raw 0-20 values are scaled up (interpreted as 0-20 index)', () => {
    // transitAccessibility of 18 on the 0-20 scale becomes 90 on the 0-100 scale.
    // Compare against a straight 0-100 value of 18.
    const epaLow  = { transitAccessibility: 18, walkScore: 18, _dataSource: 'epa-live' };
    const epaMid  = { transitAccessibility: 50, walkScore: 50, _dataSource: 'epa-live' };
    const sLow  = calc(SITE.lat, SITE.lon, NOWHERE, epaLow);
    const sMid  = calc(SITE.lat, SITE.lon, NOWHERE, epaMid);
    // The 0-20 branch multiplies by 5, so 18 → 90. That should beat 50 on a
    // straight-through 0-100 interpretation.
    assert.ok(sLow > sMid,
      `raw=18 (scaled to 90) should beat raw=50 on the 0-100 scale: low=${sLow}, mid=${sMid}`);
  });
});

group('9. EPA fetch fallback semantics', () => {
  test('fallback source declares EPA scores unavailable instead of returning neutral 50s', async () => {
    const priorWindow = global.window;
    global.window = {};
    try {
      const result = await Transit.fetchEPASmartLocation({ minLat: 39, minLon: -105, maxLat: 40, maxLon: -104 });
      assert.equal(result.transitAccessibility, null);
      assert.equal(result.walkScore, null);
      assert.equal(result.unavailableReason, EPA_UNAVAILABLE_REASON);
    } finally {
      global.window = priorWindow;
    }
  });

  test('present EPA Smart Location service still returns its measured scores', async () => {
    const priorWindow = global.window;
    global.window = { DataService: { fetchEPASmartLocation: () => Promise.resolve(EPA_LIVE) } };
    try {
      const result = await Transit.fetchEPASmartLocation({});
      assert.equal(result.transitAccessibility, 85);
      assert.equal(result.walkScore, 80);
    } finally {
      global.window = priorWindow;
    }
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
    const d = Transit.identifyTransitDeserts(poly, [], MAP_STATUS);
    assert.ok(Array.isArray(d));
    assert.ok(d.length > 0,
      'polygon with no routes should produce desert cells; got 0');
  });

  test('polygon densely covered by near stops produces fewer deserts', () => {
    const poly = {
      coordinates: [[
        [-104.99, 39.73],
        [-104.94, 39.73],
        [-104.94, 39.78],
        [-104.99, 39.78],
        [-104.99, 39.73],
      ]],
    };
    const emptyDeserts = Transit.identifyTransitDeserts(poly, [], MAP_STATUS);
    // Cover the polygon with a grid of stops
    const stops = [];
    for (let lat = 39.73; lat <= 39.78; lat += 0.01) {
      for (let lon = -104.99; lon <= -104.94; lon += 0.01) {
        stops.push({ lat, lon });
      }
    }
    const coveredDeserts = Transit.identifyTransitDeserts(poly, stops, MAP_STATUS);
    assert.ok(coveredDeserts.length < emptyDeserts.length,
      `dense coverage should reduce deserts: empty=${emptyDeserts.length}, covered=${coveredDeserts.length}`);
  });
});

group('7. getTransitLayer', () => {
  test('returns a GeoJSON FeatureCollection', () => {
    const layer = Transit.getTransitLayer([NEAR_STOP]);
    assert.equal(layer.type, 'FeatureCollection');
    assert.equal(layer.features.length, 1);
  });

  test('empty stops → empty feature array', () => {
    const layer = Transit.getTransitLayer([]);
    assert.equal(layer.features.length, 0);
  });
});

group('8. getTransitJustification shape', () => {
  test('returns every documented key', () => {
    calc(SITE.lat, SITE.lon, NEAR, EPA_LIVE);
    const j = Transit.getTransitJustification();
    for (const k of [
      'transitAccessibilityScore', 'transitUnavailableReason', 'walkScore', 'walkScoreAvailable',
      'epaDataAvailable', 'nearbyStopCount', 'stopsWithinZoneRadius', 'nearbyAgencyCount',
      'todMiles', 'zoneRadiusMiles', 'nearestConfirmedStop', 'noConfirmedStopWithinZoneRadius', 'serviceGaps',
      'hasHighFrequencyService', 'highFrequencyUnavailableReason', '_dataSources',
    ]) {
      assert.ok(k in j, `missing key: ${k}`);
    }
  });

  test('_dataSources captures stopData, epaData, walkData', () => {
    calc(SITE.lat, SITE.lon, NEAR, EPA_LIVE);
    const j = Transit.getTransitJustification();
    assert.equal(j._dataSources.stopData, 'local-stops');
    assert.equal(j._dataSources.epaData,   'epa-live');
    assert.equal(j._dataSources.walkData,  'epa-live');
  });
});

group('9. no score before calculation; score tagged with its site (#1937)', () => {
  test('a fresh module reports null, not 0, before any calculation', () => {
    const modPath = require.resolve('../js/pma-transit.js');
    delete require.cache[modPath];
    const Fresh = require('../js/pma-transit.js');
    const j = Fresh.getTransitJustification();
    assert.equal(j.transitAccessibilityScore, null);
    assert.equal(j.siteLat, null);
    assert.equal(j.siteLon, null);
  });

  test('the score carries the site it was computed for', () => {
    calc(SITE.lat, SITE.lon, NEAR, EPA_LIVE);
    const j = Transit.getTransitJustification();
    assert.equal(j.siteLat, SITE.lat);
    assert.equal(j.siteLon, SITE.lon);
    assert.equal(typeof j.transitAccessibilityScore, 'number');
  });

  test('scoreSite shares one computation per site (5 decimals) and never hands one site another\'s score', async () => {
    const raw = { lat: 39.7392358, lon: -104.9902512 };
    // The runner reads the site back from #pmaSiteCoords, written with toFixed(5).
    const a = Transit.scoreSite(raw.lat, raw.lon);
    const b = Transit.scoreSite(parseFloat(raw.lat.toFixed(5)), parseFloat(raw.lon.toFixed(5)));
    assert.equal(a, b, 'the same site read back at 5 decimals must share the computation');
    const other = Transit.scoreSite(39.75, -104.99);
    assert.notEqual(other, a, 'a different site must not reuse the previous site\'s score');
    const [ja, jo] = await Promise.all([a, other]);
    assert.equal(ja.siteLat, raw.lat);
    assert.equal(jo.siteLat, 39.75);
    // No DataService here: not measured, so null with a reason, never 0.
    assert.equal(jo.transitAccessibilityScore, null);
    assert.ok(jo.transitUnavailableReason);
  });
});

/* ── Summary ───────────────────────────────────────────────────────── */

Promise.all(pending).then(() => {
  console.log('\n=============================================');
  console.log(`PMATransit: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
});
