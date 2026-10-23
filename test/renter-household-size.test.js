'use strict';
// Renter need by bedroom count (HNA) must draw for visitors, who have no
// Census key. It reads the published B25009 file; the live API is a fallback.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const data = require('../data/market/acs_renter_household_size_co.json');
const config = require('../data/hna/geo-config.json');
const bedrooms = require('../data/market/acs_renter_bedrooms_co.json');

assert.equal(data.meta.table, 'B25009');
assert.match(data.meta.source_url, /^https:\/\/www2\.census\.gov\/.+acsdt5y2024-b25009\.dat$/);
assert.equal(Object.keys(data.counties).length, 64);
assert.equal(Object.keys(data.places).length, config.places.length + config.cdps.length);
assert(data.state['08'] && !data.state['08'].unavailable_reason);
let rows = 0;
for (const bucket of [data.state, data.counties, data.places]) {
  for (const [geoid, row] of Object.entries(bucket)) {
    if (row.unavailable_reason) continue;
    const sum = Object.values(row.by_size).reduce((a, b) => a + b, 0);
    assert.equal(sum, row.renter_households, geoid + ' sizes reconcile');
    // Same ACS universe as B25042 renter-occupied units.
    const other = (bedrooms.counties[geoid] || bedrooms.places[geoid] || {}).renter_units;
    if (other != null) assert.equal(row.renter_households, other, geoid + ' matches B25042 renter total');
    rows++;
  }
}
assert(rows > 450, 'most geographies have renter households');

const controller = fs.readFileSync(path.join(__dirname, '../js/hna/hna-controller.js'), 'utf8');
assert.match(controller, /loadJson\('data\/market\/acs_renter_household_size_co\.json'\)/);
assert.match(controller, /await loadCachedB25009\(geoType, geoid\) \|\| await fetchAcsB25009\(geoType, geoid\)/,
  'cached file is read before the keyed live API');
const audit = fs.readFileSync(path.join(__dirname, '../scripts/audit/chart-population-audit.mjs'), 'utf8');
assert.match(audit, /chart: 'chartBedroomNeed'/, 'daily chart audit checks the bedroom-need chart');
console.log('renter-household-size: ' + rows + ' geographies reconcile; chart reads the cached file');
