const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

function indexOfOrFail(source, needle, label) {
  const idx = source.indexOf(needle);
  assert.notEqual(idx, -1, `${label}: expected to find ${needle}`);
  return idx;
}

function readJson(relPath) {
  return JSON.parse(read(relPath));
}

const odSrc = read('scripts/hna/build_place_od_flows.py');
assert.match(odSrc, /MIN_OD_PLACES\s*=\s*100/, 'LODES OD builder defines the minimum place floor');
assert(
  /len\(out_places\)\s*<\s*MIN_OD_PLACES/.test(odSrc) &&
    odSrc.includes('refusing to overwrite') &&
    odSrc.includes('sys.exit(1)'),
  'LODES OD builder refuses to overwrite when place coverage falls below the floor',
);
assert(
  odSrc.indexOf('len(out_places) < MIN_OD_PLACES') < odSrc.indexOf('with OUT_PATH.open("w"'),
  'LODES OD floor guard runs before the final write',
);

const econSrc = read('scripts/fetch_county_economic_indicators.py');
assert(
  econSrc.includes('not laus_ur and not laus_emp_growth') &&
    econSrc.includes('BLS LAUS returned no data for any county; retaining existing file') &&
    econSrc.includes('return 0'),
  'county economic indicators retains the existing file when both BLS LAUS fetches return empty',
);

const zoriSrc = read('scripts/build_market_rents_co.py');
assert.match(zoriSrc, /MIN_ZORI_COUNTIES\s*=\s*20/, 'ZORI builder defines the minimum county floor');
assert(
  zoriSrc.includes('statewide_median is None') &&
    zoriSrc.includes('len(co_counties) < MIN_ZORI_COUNTIES') &&
    zoriSrc.includes('retaining existing file') &&
    zoriSrc.includes('return 1'),
  'ZORI builder refuses to overwrite when schema drift yields too few CO records',
);
assert(
  zoriSrc.indexOf('len(co_counties) < MIN_ZORI_COUNTIES') < zoriSrc.indexOf('OUT.write_text('),
  'ZORI floor guard runs before the final write',
);

const zillowSrc = read('scripts/fetch-zillow.js');
const filteredGuardIdx = indexOfOrFail(zillowSrc, 'filtered.length === 0', 'Zillow success-path empty-result guard');
const savePayloadIdx = indexOfOrFail(zillowSrc, 'saveJson(dataset.key, payload)', 'Zillow success-path write');
assert(filteredGuardIdx < savePayloadIdx, 'Zillow empty-result guard runs before writing a success payload');
assert(
  zillowSrc.includes('loadCache(dataset.key)') &&
    zillowSrc.includes('cached.records') &&
    zillowSrc.includes("source: 'cache'") &&
    zillowSrc.includes('schema drift'),
  'Zillow empty-result success path falls back to populated cache with a schema-drift warning',
);

const freshnessSrc = read('scripts/audit/data-freshness-check.mjs');
assert(
  freshnessSrc.includes("entry.file.endsWith('.json') || entry.file.endsWith('.geojson')"),
  'freshness check parses .geojson files for in-file timestamps',
);
assert(freshnessSrc.includes("'fetchedAt'"), 'freshness check recognizes fetchedAt timestamps');

const TIMESTAMP_FIELDS = [
  'updated',
  'generated',
  'generatedAt',
  'fetchedAt',
  'last_updated',
  'lastUpdated',
  'timestamp',
];
const TIMESTAMP_PARENTS = ['metadata', 'meta'];

function findTimestamp(obj) {
  if (!obj || typeof obj !== 'object') return null;
  for (const key of TIMESTAMP_FIELDS) {
    if (typeof obj[key] === 'string' && Date.parse(obj[key])) {
      return { source: key, value: obj[key] };
    }
  }
  for (const parent of TIMESTAMP_PARENTS) {
    const sub = obj[parent];
    if (sub && typeof sub === 'object') {
      for (const key of TIMESTAMP_FIELDS) {
        if (typeof sub[key] === 'string' && Date.parse(sub[key])) {
          return { source: `${parent}.${key}`, value: sub[key] };
        }
      }
    }
  }
  return null;
}

for (const relPath of [
  'data/market/hud_lihtc_co.geojson',
  'data/market/nhpd_co.geojson',
  'data/market/cdphe_county_boundaries_co.geojson',
  'data/market/transit_routes_co.geojson',
]) {
  const found = findTimestamp(readJson(relPath));
  assert(found, `${relPath} resolves an in-file freshness timestamp`);
  assert.notEqual(found.source, 'mtime', `${relPath} must not rely on checkout mtime`);
}

console.log('pipeline-guards-a2: PASS');
