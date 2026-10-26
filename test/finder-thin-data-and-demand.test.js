#!/usr/bin/env node
'use strict';
// paul, 2026-10-26: "why would nucla be rated so high, it has a very low population. Would it be
// competitive in 9s?" Nucla ranked #23 of 482 for 9% on a need percentile built from about 78
// renter households (± 46) and with no demand check. Two rules now hold:
//
// 1. A place whose ACS renter-household count is "use with caution" (CV over 0.30,
//    data/hna/acs-reliability.json) scores need from its county, marked 'county-thin'.
// 2. The 9% ranking leaves out places where a 24-home building would be over CHFA's 85% capture
//    line, counting qualifying renters within 15 miles with the Market analysis engine
//    (data/market/finder-place-demand.json, built by scripts/market/build_finder_demand.mjs).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const readJson = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const reliability = readJson('data/hna/acs-reliability.json').geos;
const demand = readJson('data/market/finder-place-demand.json');
const placeChas = readJson('data/hna/place-chas.json').places;
const counties = readJson('data/hna/chas_affordability_gap.json');
const places = readJson('data/co-place-centroids.json').byGeoid;

global.window = global;
global.document = {
  readyState: 'loading', addEventListener() {}, getElementById() { return null; }, querySelector() { return null; },
};
global.ChfaRentLimits = require('../js/chfa-rent-limits.js');
require('../js/components/zori-rent-utils.js');
require('../js/lihtc-opportunity-finder.js');
const lof = global.__LOF && global.__LOF._test;
assert(lof && lof.needCompositeFor && lof.placeDemandFor, 'finder exposes its need and demand helpers');

const NUCLA = '0854935', MONTROSE = '08085';
const chasByFips = counties.counties;

// 1. Thin data: Nucla's renter count is "use with caution", so need is Montrose County's.
assert.equal(reliability[NUCLA].DP04_0047E.t, 'use_with_caution', 'Nucla renter households are use-with-caution in the ACS file');
lof.setChasForTest(chasByFips, placeChas);
lof.setThinDataForTest(reliability, demand);
const nucla = lof.needCompositeFor(MONTROSE, NUCLA);
const county = lof.needCompositeFor(MONTROSE, null);
assert.equal(nucla.source, 'county-thin', 'Nucla need comes from the county and says why');
assert.equal(nucla.composite, county.composite, 'and is the county composite');

// A place with a reliable renter count still uses its own figures.
const solid = Object.keys(placeChas).find((g) => {
  const r = reliability[g] && reliability[g].DP04_0047E;
  return r && r.t === 'good' && placeChas[g].summary && !placeChas[g].low_confidence;
});
assert(solid, 'some place has a good renter count and place CHAS');
assert.equal(lof.needCompositeFor(solid.slice(0, 5), solid).source === 'county-thin', false, 'a reliable place is never marked thin');

// Without the reliability file nothing changes (soft load).
lof.setThinDataForTest(null, demand);
assert.notEqual(lof.needCompositeFor(MONTROSE, NUCLA).source, 'county-thin', 'missing reliability file: old behavior');
lof.setThinDataForTest(reliability, demand);

// 2. Demand: the file covers every place the Finder lists and matches the Market analysis figures
// paul was shown for Nucla (11 qualifying renter households, 10 tax-credit homes at 15 miles).
assert.equal(Object.keys(demand.places).length, Object.keys(places).length, 'one demand row per place');
assert.equal(demand.meta.miles, 15);
assert.deepEqual(demand.places[NUCLA], { qualified: 11, existing: 10 });
const d = lof.placeDemandFor(NUCLA);
assert.equal(Math.round(d.capture * 100), 218, '24 homes over 11 qualifying renters is a 218% capture rate');
assert.equal(d.thin, true);
assert.equal(lof.passesDemandRequirement({ demand: d }), false, 'Nucla is left out of the 9% ranking by default');
assert(/218%/.test(lof.demandTitle(d)) && /85%/.test(lof.demandTitle(d)), 'the flag explains the capture rate and CHFA line');

// The line sits at 24 / 0.85 = 28.2 qualifying renters.
assert.equal(lof.passesDemandRequirement({ demand: { thin: 24 / 29 > 0.85 } }), true);
const denver = lof.placeDemandFor('0820000');
assert(denver && !denver.thin, 'Denver passes');
assert.equal(lof.passesDemandRequirement({ demand: null }), true, 'a place with no demand row stays in');

// The other thin-market towns from the 2026-10-26 review are flagged too.
for (const g of ['0853120', '0837215', '0886475']) assert.equal(lof.placeDemandFor(g).thin, true, g + ' flagged');
console.log('finder thin data and demand: PASS');
