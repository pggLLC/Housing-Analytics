#!/usr/bin/env node
// test/home-jurisdiction-search.test.js
//
// B-06 / #1097: guard the homepage jurisdiction autocomplete's pure
// search/routing helpers and the static ARIA contract in index.html.

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const {
  MAX_RESULTS,
  searchJurisdictions,
  jurisdictionUrl
} = require('../js/home-jurisdiction-search.js');

const registry = require('../data/hna/geography-registry.json');
const entries = registry.geographies || [];
const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

assert.equal(entries.length, 546, 'cleaned geography registry should expose 546 rows');

const fixtureEntries = [
  { geoid: '0812910', name: 'La Junta (city)', type: 'place' },
  { geoid: '0870310', name: 'Salida (city)', type: 'place' },
  { geoid: '08045', name: 'Garfield County', type: 'county' },
  { geoid: '0803620', name: 'Aspen (city)', type: 'place' },
  { geoid: '0812345', name: 'Alamosa (city)', type: 'place' },
  { geoid: '0899999', name: 'Aspen Park CDP', type: 'cdp' },
  { geoid: '0800001', name: 'Lakewood (city)', type: 'place' },
  { geoid: '0800002', name: 'Lafayette (city)', type: 'place' },
  { geoid: '0800003', name: 'Las Animas (city)', type: 'place' },
  { geoid: '0800004', name: 'Larkspur (town)', type: 'place' },
  { geoid: '0800005', name: 'Laporte CDP', type: 'cdp' },
  { geoid: '0800006', name: 'La Veta (town)', type: 'place' }
];
const prefixFixtureEntries = [
  { geoid: '0812910', name: 'La Junta (city)', type: 'place' },
  { geoid: '0899998', name: 'Mala Vista (city)', type: 'place' }
];

assert.deepEqual(searchJurisdictions(null, 'aspen'), [], 'null entries should return no matches');
assert.deepEqual(searchJurisdictions(fixtureEntries, '   '), [], 'blank queries should return no matches');

assert.equal(
  searchJurisdictions(fixtureEntries, 'ASPEN')[0].geoid,
  '0803620',
  'matching should be case-insensitive'
);

const laResults = searchJurisdictions(prefixFixtureEntries, 'la').map((entry) => entry.name);
assert.equal(laResults[0], 'La Junta (city)', 'prefix matches should rank before mid-word matches');
assert(laResults.indexOf('Mala Vista (city)') > 0, 'mid-word hits should rank after prefix hits');

assert.equal(
  searchJurisdictions(fixtureEntries, 'a').length,
  MAX_RESULTS,
  'default result cap should use MAX_RESULTS'
);
assert.equal(
  searchJurisdictions(fixtureEntries, 'a', 3).length,
  3,
  'explicit result cap should be honored'
);

assert.equal(
  jurisdictionUrl({ geoid: '08045', type: 'county' }),
  'housing-needs-assessment.html?geoid=08045&geoType=county&auto=1',
  'county routes should use HNA profile URL with county geoType'
);
assert.equal(
  jurisdictionUrl({ geoid: '0803620', type: 'place' }),
  'housing-needs-assessment.html?geoid=0803620&geoType=place&auto=1',
  'place routes should use HNA profile URL with place geoType'
);
assert.equal(jurisdictionUrl({ geoid: '0803620' }), null, 'missing type should not route');
assert.equal(jurisdictionUrl({ type: 'place' }), null, 'missing geoid should not route');

const aspen = searchJurisdictions(entries, 'aspen')[0];
assert(aspen, 'real registry search should find Aspen');
assert.equal(aspen.geoid, '0803620', 'Aspen fixture should use the cleaned registry GEOID');
assert.equal(aspen.type, 'place', 'Aspen fixture should be a place');
assert(
  jurisdictionUrl(aspen).startsWith('housing-needs-assessment.html?'),
  'Aspen routed URL should point at the HNA profile'
);

const garfieldResults = searchJurisdictions(entries, 'garfield');
const garfield = garfieldResults.find((entry) => entry.geoid === '08045');
assert(garfield, 'real registry search should find Garfield County');
assert.equal(garfield.geoid, '08045', 'Garfield County fixture should use county GEOID 08045');
assert.equal(garfield.type, 'county', 'Garfield fixture should be a county');
assert(
  jurisdictionUrl(garfield).startsWith('housing-needs-assessment.html?'),
  'Garfield routed URL should point at the HNA profile'
);

for (const needle of [
  'id="homeJurisdictionSearch"',
  'role="combobox"',
  'aria-controls="homeJurisdictionSearchResults"',
  'id="homeJurisdictionSearchResults"',
  'role="listbox"',
  'src="js/home-jurisdiction-search.js"'
]) {
  assert(indexHtml.includes(needle), `index.html must include ${needle}`);
}

console.log('Homepage jurisdiction search (#1097): PASS');
