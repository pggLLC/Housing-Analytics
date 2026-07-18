#!/usr/bin/env node
// Regression guards for #1232 C2 barrier-aware PMA downweight.

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const BarrierAware = require('../js/pma-barrier-aware.js');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function readJson(rel) {
  return JSON.parse(read(rel));
}

const fixture = readJson('test/fixtures/pma/barrier-downweight.fixture.json');
assert.equal(fixture.production_use, false, 'downweight multiplier fixture is explicitly non-production');
assert.equal(fixture.multiplier, 0.5, 'placeholder multiplier is pinned by fixture');
assert.match(fixture.note, /Placeholder only/i, 'fixture labels multiplier as placeholder only');

assert.equal(BarrierAware.isEnabled(), false, 'barrier-aware PMA flag is default off');
assert.equal(BarrierAware.PMA_BARRIER_AWARE_ENABLED, false, 'exported flag value is false');
const moduleSource = read('js/pma-barrier-aware.js');
assert(moduleSource.includes('var PMA_BARRIER_AWARE_ENABLED = false'), 'source pins hidden flag off');
assert(!moduleSource.includes('PMA_BARRIER_AWARE_ENABLED = true'), 'module never flips barrier-aware flag on');

const html = read('market-analysis.html');
const dom = new JSDOM(html);
const scripts = [...dom.window.document.querySelectorAll('script[src]')].map((script) => script.getAttribute('src'));
assert(scripts.indexOf('js/pma-barrier-aware.js') > -1, 'market-analysis.html loads barrier-aware helper');
assert(scripts.indexOf('js/pma-barrier-aware.js') < scripts.indexOf('js/market-analysis.js'),
  'barrier-aware helper loads before market-analysis.js');
assert(!html.includes('PMA_BARRIER_AWARE_ENABLED = true'), 'no shipped page enables the hidden barrier-aware flag');

function feature(type, geometry, props) {
  return {
    type: 'Feature',
    properties: Object.assign({ barrier_type: type }, props || {}),
    geometry
  };
}

function highway(route, coords) {
  return feature('highway', { type: 'LineString', coordinates: coords }, {
    route,
    route_sign: route.indexOf('I-') === 0 ? 'I' : 'U',
    name: route
  });
}

function water(name, coords, subType) {
  return feature('water', { type: 'Polygon', coordinates: [coords] }, {
    name,
    sub_type: subType || 'reservoir'
  });
}

const site = { lon: 0, lat: 0 };
const baseTracts = [
  { geoid: 'glenwood-cross', _bufferShare: 0.8 },
  { geoid: 'glenwood-same-side', _bufferShare: 0.6 },
  { geoid: 'dillon-water', _bufferShare: 0.7 },
  { geoid: 'denver-bridge', _bufferShare: 0.9 }
];
const pointIndex = {
  'glenwood-cross': { lon: 1, lat: 0 },
  'glenwood-same-side': { lon: 0.25, lat: 0 },
  // Inside the reservoir polygon but short of I-70 (x=0.5): the site line
  // touches ONLY the water barrier, so this fixture isolates the polygon
  // branch — QA found the previous point (1, 0.8) also crossed I-70,
  // letting the water logic go untested.
  'dillon-water': { lon: 0.4, lat: 0.5 },
  'denver-bridge': { lon: -1, lat: 0 }
};
const barriers = {
  type: 'FeatureCollection',
  meta: { generated_at: '2026-07-18T00:00:00Z' },
  features: [
    highway('I-70', [[0.5, -1], [0.5, 1]]),
    water('Dillon Reservoir', [[0.35, 0.25], [0.8, 0.25], [0.8, 1.0], [0.35, 1.0], [0.35, 0.25]], 'lake'),
    highway('I-25', [[-0.5, -1], [-0.5, 1]])
  ]
};

const offResult = BarrierAware.applyToTracts(baseTracts, {
  site,
  pointIndex,
  barrierData: barriers,
  fixture
});
assert.strictEqual(offResult.tracts, baseTracts, 'default-off path returns the original tract array');
assert.deepEqual(baseTracts.map((t) => t._bufferShare), [0.8, 0.6, 0.7, 0.9],
  'default-off path leaves buffer shares byte-identical');

const onResult = BarrierAware.applyToTracts(baseTracts, {
  forceEnabled: true,
  site,
  pointIndex,
  barrierData: barriers,
  fixture
});
const byGeoid = Object.fromEntries(onResult.tracts.map((tract) => [tract.geoid, tract]));
assert.equal(byGeoid['glenwood-cross']._bufferShare, 0.4,
  'Glenwood Canyon I-70 fixture downweights the separated tract flag-on');
assert.equal(byGeoid['glenwood-cross']._bufferShareBase, 0.8,
  'downweighted tract preserves its original buffer share for audit');
assert.match(byGeoid['glenwood-cross']._barrierBadge, /separated by I-70 · weight reduced \[placeholder\]/,
  'per-tract audit badge labels the crossed I-70 route and placeholder status');
assert.equal(byGeoid['glenwood-same-side']._bufferShare, 0.6,
  'same-side Glenwood control keeps weight exactly');
assert.equal(byGeoid['dillon-water']._bufferShare, 0.35,
  'Dillon Reservoir water polygon separation is recognized');
assert.equal(byGeoid['denver-bridge']._bufferShare, 0.45,
  'Denver I-25 bridge-bound fixture loses at most the placeholder fraction');
assert(onResult.tracts.some((tract) => tract.geoid === 'denver-bridge'),
  'cross-interstate tract remains in the PMA tract set');
assert(onResult.tracts.every((tract) => tract._bufferShare > 0),
  'no barrier-aware branch zeroes or excludes a tract');
assert.deepEqual(onResult.tracts.map((tract) => tract.geoid), baseTracts.map((tract) => tract.geoid),
  'rendered tract set equals analytic tract set under flag-on');
assert.equal(onResult.state.adjusted_tracts, 3, 'state reports the three adjusted fixture tracts');
assert.equal(onResult.state.multiplier_source, fixture.source, 'state records multiplier source');
assert.equal(onResult.state.inventory_vintage, barriers.meta.generated_at, 'state records barrier inventory vintage');

const sameRouteDouble = {
  type: 'FeatureCollection',
  features: [
    highway('I-70', [[0.25, -1], [0.25, 1]]),
    highway('I-70', [[0.75, -1], [0.75, 1]])
  ]
};
const dedupCrossings = BarrierAware.crossingInventory(site, { lon: 1, lat: 0 }, sameRouteDouble);
assert.equal(dedupCrossings.length, 1, 'same-route dedup counts two I-70 crossings once');
const dedupResult = BarrierAware.applyToTracts([{ geoid: 'dedup', _bufferShare: 0.8 }], {
  forceEnabled: true,
  site,
  pointIndex: { dedup: { lon: 1, lat: 0 } },
  barrierData: sameRouteDouble,
  fixture
});
assert.equal(dedupResult.tracts[0]._bufferShare, 0.4,
  'same-route dedup applies one placeholder downweight, not cascading reductions');

const removed = BarrierAware.applyToTracts(baseTracts, {
  forceEnabled: true,
  site,
  pointIndex,
  barrierData: null,
  fixture
});
assert.equal(removed.warning, BarrierAware.WARNING_UNAVAILABLE,
  'missing barrier artifact surfaces the warning instead of silently falling back');
assert.deepEqual(removed.tracts.map((tract) => tract._bufferShare), baseTracts.map((tract) => tract._bufferShare),
  'missing barrier artifact leaves weights identical to flag-off');
const weightedHouseholds = (tracts) => tracts.reduce((sum, tract) => {
  const householdCounts = {
    'glenwood-cross': 100,
    'glenwood-same-side': 200,
    'dillon-water': 300,
    'denver-bridge': 400
  };
  return sum + householdCounts[tract.geoid] * tract._bufferShare;
}, 0);
assert.equal(weightedHouseholds(removed.tracts), weightedHouseholds(baseTracts),
  'missing barrier artifact leaves weighted PMA inputs and scores unchanged');

const displayIndex = BarrierAware.pointIndexFromDisplayGeometry({
  type: 'FeatureCollection',
  features: [{
    type: 'Feature',
    properties: { GEOID: '08045000100', point_on_surface: { lon: -107.3, lat: 39.5 } },
    geometry: null
  }]
});
assert.deepEqual(displayIndex['08045000100'], { lon: -107.3, lat: 39.5 },
  'point_on_surface display geometry feeds the crossing test');

const marketSource = read('js/market-analysis.js');
assert(marketSource.includes('barrierAwareInputs') && marketSource.includes('applyBarrierAware(bufTracts)'),
  'market-analysis applies barrier-aware hook only at the tract share stage');
assert(marketSource.includes('barrierAware: r.barrierAware'), 'PMA export records barrier-aware mode state');
assert(!read('js/market-analysis-scoring.js').includes('PMABarrierAware'),
  'shared scoring weights and formulas do not import barrier-aware mode');

console.log('pma-barrier-aware: PASS');
