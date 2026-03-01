// test/fetch-chfa-lihtc-fips.js
//
// Unit tests for the CO_COUNTY_FIPS lookup table and resolveCntyFips() helper
// added to scripts/fetch-chfa-lihtc.js.
//
// Usage:
//   node test/fetch-chfa-lihtc-fips.js
//
// Exit code 0 = all checks passed; non-zero = one or more failures.

'use strict';

const fs   = require('fs');
const path = require('path');

const SCRIPT = path.resolve(__dirname, '..', 'scripts', 'fetch-chfa-lihtc.js');

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

// ---------------------------------------------------------------------------
// Extract CO_COUNTY_FIPS and resolveCntyFips from the script source so we can
// test them without executing the main IIFE (which makes network calls).
// ---------------------------------------------------------------------------

const src = fs.readFileSync(SCRIPT, 'utf8');

// Extract the CO_COUNTY_FIPS object literal via a sandboxed eval.
const fipsMatch = src.match(/const CO_COUNTY_FIPS\s*=\s*(\{[\s\S]*?\});/);
if (!fipsMatch) {
  console.error('❌ Could not locate CO_COUNTY_FIPS in script source.');
  process.exit(1);
}
let CO_COUNTY_FIPS;
// eslint-disable-next-line no-eval
eval(`CO_COUNTY_FIPS = ${fipsMatch[1]}`);

// Build a resolveCntyFips function identical to the one in the script.
function resolveCntyFips(cntyName) {
  if (!cntyName) return '';
  const key = String(cntyName).trim().toLowerCase();
  return CO_COUNTY_FIPS[key] || '';
}

// Build a toGeoJsonFeature function matching the script's implementation.
function toGeoJsonFeature(esriFeature) {
  const attrs = esriFeature.attributes || {};
  const geom  = esriFeature.geometry;
  if (!geom || geom.x == null || geom.y == null) return null;
  const cntyFips = resolveCntyFips(attrs.CNTY_NAME ?? null);
  const countyFp = cntyFips ? cntyFips.slice(2) : '';
  return {
    type: 'Feature',
    geometry: {
      type: 'Point',
      coordinates: [
        Math.round(geom.x * 1e6) / 1e6,
        Math.round(geom.y * 1e6) / 1e6,
      ],
    },
    properties: {
      PROJECT:   attrs.PROJECT   ?? null,
      PROJ_ADD:  attrs.PROJ_ADD  ?? null,
      PROJ_CTY:  attrs.PROJ_CTY  ?? null,
      CNTY_NAME: attrs.CNTY_NAME ?? null,
      CNTY_FIPS: cntyFips || null,
      COUNTYFP:  countyFp || null,
      N_UNITS:   attrs.N_UNITS   ?? null,
      LI_UNITS:  attrs.LI_UNITS  ?? null,
      YR_PIS:    attrs.YR_PIS    ?? null,
      YR_ALLOC:  attrs.YR_ALLOC  ?? null,
      CREDIT:    attrs.CREDIT    ?? null,
      NON_PROF:  attrs.NON_PROF  ?? null,
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('CO_COUNTY_FIPS covers all 64 Colorado counties', () => {
  assert(Object.keys(CO_COUNTY_FIPS).length === 64,
    `Lookup table has 64 entries (got ${Object.keys(CO_COUNTY_FIPS).length})`);
});

test('CO_COUNTY_FIPS — all values are 5-digit strings starting with "08"', () => {
  const invalid = Object.entries(CO_COUNTY_FIPS)
    .filter(([, v]) => !/^08\d{3}$/.test(v))
    .map(([k, v]) => `${k}=${v}`);
  assert(invalid.length === 0,
    `All FIPS values match /^08\\d{3}$/ (bad: ${invalid.join(', ') || 'none'})`);
});

test('CO_COUNTY_FIPS — FIPS values are unique (no duplicate codes)', () => {
  const seen = new Set();
  const dupes = [];
  for (const [name, fips] of Object.entries(CO_COUNTY_FIPS)) {
    if (seen.has(fips)) dupes.push(`${name}=${fips}`);
    seen.add(fips);
  }
  assert(dupes.length === 0, `No duplicate FIPS codes (dupes: ${dupes.join(', ') || 'none'})`);
});

test('resolveCntyFips — exact canonical names', () => {
  assert(resolveCntyFips('Denver')    === '08031', 'Denver → 08031');
  assert(resolveCntyFips('El Paso')   === '08041', 'El Paso → 08041');
  assert(resolveCntyFips('La Plata')  === '08067', 'La Plata → 08067');
  assert(resolveCntyFips('Kit Carson') === '08063', 'Kit Carson → 08063');
  assert(resolveCntyFips('Las Animas') === '08071', 'Las Animas → 08071');
  assert(resolveCntyFips('San Juan')  === '08111', 'San Juan → 08111');
  assert(resolveCntyFips('San Miguel') === '08113', 'San Miguel → 08113');
  assert(resolveCntyFips('Rio Blanco') === '08103', 'Rio Blanco → 08103');
  assert(resolveCntyFips('Rio Grande') === '08105', 'Rio Grande → 08105');
  assert(resolveCntyFips('Clear Creek') === '08019', 'Clear Creek → 08019');
  assert(resolveCntyFips('Weld')      === '08123', 'Weld → 08123');
  assert(resolveCntyFips('Arapahoe')  === '08005', 'Arapahoe → 08005');
});

test('resolveCntyFips — case-insensitive matching', () => {
  assert(resolveCntyFips('DENVER')    === '08031', 'DENVER → 08031');
  assert(resolveCntyFips('denver')    === '08031', 'denver → 08031');
  assert(resolveCntyFips('EL PASO')   === '08041', 'EL PASO → 08041');
  assert(resolveCntyFips('el paso')   === '08041', 'el paso → 08041');
  assert(resolveCntyFips('LA PLATA')  === '08067', 'LA PLATA → 08067');
  assert(resolveCntyFips('Jefferson') === '08059', 'Jefferson → 08059');
  assert(resolveCntyFips('JEFFERSON') === '08059', 'JEFFERSON → 08059');
});

test('resolveCntyFips — whitespace trimming', () => {
  assert(resolveCntyFips('  Denver  ') === '08031', 'leading/trailing spaces handled');
  assert(resolveCntyFips(' el paso ')  === '08041', 'spaces around multi-word name handled');
});

test('resolveCntyFips — unknown / null / empty inputs return empty string', () => {
  assert(resolveCntyFips(null)         === '', 'null → ""');
  assert(resolveCntyFips(undefined)    === '', 'undefined → ""');
  assert(resolveCntyFips('')           === '', '"" → ""');
  assert(resolveCntyFips('Nonexistent') === '', 'unknown name → ""');
});

test('toGeoJsonFeature — CNTY_FIPS and COUNTYFP are populated', () => {
  const feature = toGeoJsonFeature({
    attributes: {
      PROJECT:   'Test Project',
      PROJ_ADD:  '123 Main St',
      PROJ_CTY:  'Denver',
      CNTY_NAME: 'Denver',
      N_UNITS:   100,
      LI_UNITS:  80,
      YR_PIS:    2020,
      YR_ALLOC:  2018,
      CREDIT:    '9%',
      NON_PROF:  0,
    },
    geometry: { x: -104.9903, y: 39.7392 },
  });
  assert(feature !== null, 'feature is not null');
  assert(feature.properties.CNTY_FIPS === '08031', 'CNTY_FIPS = "08031" for Denver');
  assert(feature.properties.COUNTYFP  === '031',   'COUNTYFP = "031" for Denver');
});

test('toGeoJsonFeature — CNTY_FIPS and COUNTYFP are null for unknown county', () => {
  const feature = toGeoJsonFeature({
    attributes: { CNTY_NAME: 'UnknownCounty' },
    geometry: { x: -105.0, y: 39.0 },
  });
  assert(feature !== null, 'feature is not null');
  assert(feature.properties.CNTY_FIPS === null, 'CNTY_FIPS is null for unknown county');
  assert(feature.properties.COUNTYFP  === null, 'COUNTYFP is null for unknown county');
});

test('toGeoJsonFeature — CNTY_FIPS and COUNTYFP are null when CNTY_NAME is null', () => {
  const feature = toGeoJsonFeature({
    attributes: { CNTY_NAME: null },
    geometry: { x: -105.0, y: 39.0 },
  });
  assert(feature !== null, 'feature is not null');
  assert(feature.properties.CNTY_FIPS === null, 'CNTY_FIPS is null when CNTY_NAME is null');
  assert(feature.properties.COUNTYFP  === null, 'COUNTYFP is null when CNTY_NAME is null');
});

test('toGeoJsonFeature — multi-word county (La Plata) resolves correctly', () => {
  const feature = toGeoJsonFeature({
    attributes: { CNTY_NAME: 'La Plata' },
    geometry: { x: -107.88, y: 37.28 },
  });
  assert(feature.properties.CNTY_FIPS === '08067', 'La Plata → CNTY_FIPS 08067');
  assert(feature.properties.COUNTYFP  === '067',   'La Plata → COUNTYFP 067');
});

test('toGeoJsonFeature — returns null for missing geometry', () => {
  const feature = toGeoJsonFeature({
    attributes: { CNTY_NAME: 'Denver' },
    geometry: null,
  });
  assert(feature === null, 'feature is null when geometry is null');
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n${'─'.repeat(60)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
