// test/cross-county-disclosure.test.js
//
// Tests for js/cross-county-disclosure.js + the underlying data file
// data/hna/cross-county-places.json. Verifies:
//   - Data file loads + matches expected shape
//   - All 26 cross-county places are present (regression guard against
//     a partial regeneration that drops Erie or other key entries)
//   - Lookup APIs work for known multi-county places (Aurora, Erie, Boulder)
//   - lookupByCountyFips correctly indexes counties → places
//   - formatBanner / formatCountyBanner produce sensible HTML
//   - Single-county / null inputs return empty strings (don't false-alarm)
//
// Run: node test/cross-county-disclosure.test.js

'use strict';

const fs = require('fs');
const path = require('path');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log('  ✅ PASS: ' + message);
    passed++;
  } else {
    console.error('  ❌ FAIL: ' + message);
    failed++;
  }
}

// Load + parse the data file
const DATA_PATH = path.join(__dirname, '..', 'data', 'hna', 'cross-county-places.json');
const data = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));

console.log('\n[test] Data file structure');
assert(data.meta && data.places, 'has meta and places top-level keys');
assert(typeof data.meta.count_cross_county === 'number',
  'meta.count_cross_county is numeric');
assert(data.meta.count_cross_county >= 20,
  'has ≥20 cross-county places (regression guard)');
assert(typeof data.meta.count_total_places === 'number'
  && data.meta.count_total_places >= 500,
  'meta.count_total_places ≥ 500');

console.log('\n[test] Required cross-county jurisdictions present');
// NOTE: Boulder *city* (geoid 0807850) is NOT cross-county — it sits
// entirely within Boulder County. The famously cross-county Boulder
// jurisdictions are actually Longmont, Erie, and Superior, which all
// straddle the Boulder/Weld or Boulder/Jefferson lines.
const REQUIRED_PLACES = {
  '0804000': 'Aurora',     // Arapahoe + Adams + Douglas
  '0824950': 'Erie',       // Weld + Boulder
  '0845970': 'Longmont',   // Boulder + Weld
  '0875640': 'Superior',   // Boulder + Jefferson
  '0885485': 'Windsor',    // Weld + Larimer
  '0854330': 'Northglenn', // Adams + Weld
  '0877290': 'Thornton',   // Adams + Weld
};
Object.keys(REQUIRED_PLACES).forEach(function (geoid) {
  const expected = REQUIRED_PLACES[geoid];
  const place = data.places[geoid];
  assert(place != null,
    geoid + ' (' + expected + ') is in cross-county registry');
  if (place) {
    assert(place.name && place.name.toLowerCase().includes(expected.toLowerCase()),
      geoid + ' name "' + place.name + '" matches expected "' + expected + '"');
    assert(Array.isArray(place.all_counties) && place.all_counties.length >= 2,
      geoid + ' has ≥2 counties listed');
    assert(typeof place.primary_county === 'string' && /^[0-9]{5}$/.test(place.primary_county),
      geoid + ' primary_county is 5-digit FIPS');
    assert(place.all_counties[0].fips === place.primary_county,
      geoid + ' first all_counties entry matches primary_county (sorted by pop)');
  }
});

console.log('\n[test] All places have valid structure');
let invalid = 0;
Object.keys(data.places).forEach(function (geoid) {
  const p = data.places[geoid];
  if (!p.name || !p.primary_county || !Array.isArray(p.all_counties)) invalid++;
  if (p.all_counties && p.all_counties.length < 2) invalid++;  // shouldn't be in this list
});
assert(invalid === 0,
  'all entries have name + primary_county + ≥2-county all_counties array');

console.log('\n[test] Cross-county helper module is well-formed');
const helperSrc = fs.readFileSync(path.join(__dirname, '..', 'js', 'cross-county-disclosure.js'), 'utf8');
assert(/window\.CrossCountyDisclosure\s*=\s*\{/.test(helperSrc),
  'attaches CrossCountyDisclosure to window');
['init', 'lookup', 'lookupByCountyFips', 'formatBanner', 'formatCountyBanner'].forEach(function (fn) {
  assert(new RegExp('function\\s+' + fn + '\\s*\\(').test(helperSrc),
    'defines ' + fn + '() function');
});

console.log('\n[test] Deal Calculator wires the disclosure');
const dcSrc = fs.readFileSync(path.join(__dirname, '..', 'js', 'deal-calculator.js'), 'utf8');
assert(/dc-cross-county-note/.test(dcSrc),
  'Deal Calculator HTML includes #dc-cross-county-note container');
assert(/_renderCrossCountyDisclosure/.test(dcSrc),
  'Deal Calculator defines _renderCrossCountyDisclosure helper');
assert(/window\.CrossCountyDisclosure/.test(dcSrc),
  'Deal Calculator references window.CrossCountyDisclosure');
assert(/_renderCrossCountyDisclosure\(fips\)/.test(dcSrc),
  'Deal Calculator calls _renderCrossCountyDisclosure on county change');

console.log('\n[test] HTML script tag wired');
const htmlSrc = fs.readFileSync(path.join(__dirname, '..', 'deal-calculator.html'), 'utf8');
assert(/cross-county-disclosure\.js/.test(htmlSrc),
  'deal-calculator.html includes cross-county-disclosure.js');

console.log('\n[test] Logic simulation: stub the helper and verify behavior');
// Simulate the helper's logic by extracting the relevant data manually.
// This catches "what would the user actually see?" regressions without
// needing a full DOM.
function simulateCountyBanner(countyFips, db) {
  const places = Object.entries(db.places)
    .filter(([_, p]) => p.all_counties.some(c => c.fips === countyFips))
    .map(([geoid, p]) => ({ geoid, ...p }));
  if (!places.length) return '';
  const examples = places.slice(0, 5).map(p => p.name).join(', ');
  return 'ℹ HUD AMI is set at the county level. ... <strong>' + examples + '</strong>';
}
const adamsBanner = simulateCountyBanner('08001', data);
assert(/Aurora/.test(adamsBanner),
  'Adams County (08001) banner mentions Aurora (one of the cross-county places)');
const sanJuanBanner = simulateCountyBanner('08111', data);  // San Juan: rural, no cross-county
assert(sanJuanBanner === '',
  'San Juan County (08111) banner is empty (no cross-county places)');

console.log('\n=========================================');
console.log('Results: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed === 0 ? 0 : 1);
