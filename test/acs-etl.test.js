// test/acs-etl.test.js
//
// Unit tests for the ACS ETL pipeline components:
//   - scripts/hna/acs_field_mapping.json  field mapping correctness
//   - js/acs-data-loader.js               loadACSData / field coercion
//   - js/acs-error-handler.js             error messages / freshness text
//
// Tests run with plain Node.js (no jest/mocha):
//   node test/acs-etl.test.js
//
// Because the JS files use IIFEs bound to window, this test file
// re-implements the pure logic functions directly.

'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

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

// ── Re-implemented helpers (mirrors js/acs-data-loader.js) ──────────────────

function coerce(value, type) {
  if (value === null || value === undefined || value === '' ||
      value === '-666666666' || value === '-888888888' || value === '-999999999') {
    return null;
  }
  if (type === 'integer') {
    const n = parseInt(value, 10);
    return isNaN(n) ? null : n;
  }
  if (type === 'float' || type === 'percentage') {
    const f = parseFloat(value);
    return isNaN(f) ? null : f;
  }
  return value;
}

function parseACSResponse(arr) {
  if (!Array.isArray(arr) || arr.length < 2) return null;
  const header = arr[0];
  const row    = arr[1];
  const out    = {};
  header.forEach((h, i) => { out[h] = row[i]; });
  return out;
}

function makeFreshnessInfo(fetchedAt) {
  const now      = Date.now();
  const ts       = new Date(fetchedAt).getTime();
  const ageMs    = now - ts;
  const ageHours = ageMs / (1000 * 60 * 60);
  const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
  return {
    fetchedAt,
    ageHours: Math.round(ageHours * 10) / 10,
    isFresh:  ageMs < CACHE_TTL_MS,
    isStale:  ageMs >= CACHE_TTL_MS,
  };
}

// Re-implemented freshness text (mirrors js/acs-error-handler.js)
function formatFreshnessText(info) {
  if (!info || !info.fetchedAt) return 'Data freshness unknown';
  const h = info.ageHours || 0;
  if (h < 1)              return 'Data updated just now';
  if (h < 24)             return `Data updated ${Math.round(h)}h ago`;
  const days = Math.round(h / 24);
  if (days === 1)         return 'Data updated 1 day ago';
  if (days < 30)          return `Data updated ${days} days ago`;
  const months = Math.round(days / 30);
  if (months === 1)       return 'Data updated 1 month ago';
  return `Data updated ${months} months ago`;
}

// Re-implemented friendly error message (mirrors js/acs-error-handler.js)
function friendlyMessage(error) {
  if (!error) return 'ACS data is temporarily unavailable.';
  const msg = error.message || String(error);
  if (/network|failed to fetch|load/i.test(msg))
    return 'Census data could not be loaded. Displaying cached or placeholder values.';
  if (/timeout|abort/i.test(msg))
    return 'Census API request timed out. Please try again shortly.';
  if (/429|rate/i.test(msg))
    return 'Census API rate limit reached. Data will reload automatically.';
  if (/404|not found/i.test(msg))
    return 'ACS data not found for this geography. Some fields may be unavailable.';
  return 'ACS data is temporarily unavailable. Displaying fallback values.';
}

// ── File existence checks ───────────────────────────────────────────────────

test('required ACS ETL source files exist', () => {
  const files = [
    'scripts/hna/acs_etl.py',
    'scripts/hna/acs_field_mapping.json',
    'scripts/hna/acs_validator.py',
    'scripts/hna/acs_cache.py',
    'js/acs-data-loader.js',
    'js/acs-error-handler.js',
  ];
  files.forEach(f => {
    assert(fs.existsSync(path.join(ROOT, f)), `${f} exists`);
  });
});

// ── acs_field_mapping.json ──────────────────────────────────────────────────

test('acs_field_mapping.json is valid JSON', () => {
  const raw = fs.readFileSync(path.join(ROOT, 'scripts/hna/acs_field_mapping.json'), 'utf8');
  let parsed;
  try {
    parsed = JSON.parse(raw);
    assert(true, 'JSON parses without error');
  } catch (e) {
    assert(false, 'JSON parses without error — ' + e.message);
    return;
  }
  assert(typeof parsed === 'object' && parsed !== null, 'root is an object');
});

test('acs_field_mapping.json contains DP04 table', () => {
  const m = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/hna/acs_field_mapping.json'), 'utf8'));
  assert('DP04' in m, 'DP04 key present');
  assert(typeof m.DP04 === 'object', 'DP04 is an object');
});

test('acs_field_mapping.json contains DP05 table', () => {
  const m = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/hna/acs_field_mapping.json'), 'utf8'));
  assert('DP05' in m, 'DP05 key present');
  assert(typeof m.DP05 === 'object', 'DP05 is an object');
});

test('acs_field_mapping.json: all entries have required shape', () => {
  const m = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/hna/acs_field_mapping.json'), 'utf8'));
  let ok = true;
  ['DP04', 'DP05'].forEach(table => {
    Object.entries(m[table]).forEach(([fieldId, meta]) => {
      if (fieldId.startsWith('_')) return;
      if (typeof meta.name !== 'string')        { ok = false; assert(false, `${fieldId} has string 'name'`); }
      if (typeof meta.type !== 'string')        { ok = false; assert(false, `${fieldId} has string 'type'`); }
      if (typeof meta.description !== 'string') { ok = false; assert(false, `${fieldId} has string 'description'`); }
      if (typeof meta.required !== 'boolean')   { ok = false; assert(false, `${fieldId} has boolean 'required'`); }
    });
  });
  if (ok) assert(true, 'all DP04/DP05 field entries have name/type/description/required');
});

test('acs_field_mapping.json: critical DP04 fields present', () => {
  const m = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/hna/acs_field_mapping.json'), 'utf8'));
  const dp04 = m.DP04;
  ['DP04_0001E', 'DP04_0046PE', 'DP04_0089E', 'DP04_0134E',
   'DP04_0142PE', 'DP04_0144PE', 'DP04_0145PE', 'DP04_0146PE'].forEach(f => {
    assert(f in dp04, `DP04 contains ${f}`);
  });
});

test('acs_field_mapping.json: critical DP05 fields present', () => {
  const m = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/hna/acs_field_mapping.json'), 'utf8'));
  const dp05 = m.DP05;
  ['DP05_0001E', 'DP05_0018E', 'DP05_0037PE', 'DP05_0038PE',
   'DP05_0044PE', 'DP05_0071PE'].forEach(f => {
    assert(f in dp05, `DP05 contains ${f}`);
  });
});

test('acs_field_mapping.json: DP04_0001E is required integer', () => {
  const m = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/hna/acs_field_mapping.json'), 'utf8'));
  const f = m.DP04.DP04_0001E;
  assert(f.required === true,      'DP04_0001E is required');
  assert(f.type === 'integer',     'DP04_0001E type is integer');
});

test('acs_field_mapping.json: percentage fields have range [0, 100]', () => {
  const m = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/hna/acs_field_mapping.json'), 'utf8'));
  let checked = 0;
  ['DP04', 'DP05'].forEach(table => {
    Object.entries(m[table]).forEach(([fieldId, meta]) => {
      if (fieldId.startsWith('_')) return;
      if (meta.type === 'percentage' && meta.range) {
        assert(Array.isArray(meta.range) && meta.range[0] === 0 && meta.range[1] === 100,
          `${fieldId} percentage range is [0, 100]`);
        checked++;
      }
    });
  });
  assert(checked > 0, `at least one percentage field has a range (checked ${checked})`);
});

// ── js/acs-data-loader.js source checks ────────────────────────────────────

test('acs-data-loader.js defines loadACSData and ACS_FIELD_MAPPING', () => {
  const src = fs.readFileSync(path.join(ROOT, 'js/acs-data-loader.js'), 'utf8');
  assert(src.includes('loadACSData'),         'loadACSData defined');
  assert(src.includes('ACS_FIELD_MAPPING'),   'ACS_FIELD_MAPPING defined');
  assert(src.includes('global.loadACSData'),  'loadACSData exposed on global');
  assert(src.includes('CacheManager'),        'CacheManager referenced');
  assert(src.includes('fetchWithTimeout'),    'fetchWithTimeout referenced');
});

test('acs-data-loader.js has retry logic with correct delay array', () => {
  const src = fs.readFileSync(path.join(ROOT, 'js/acs-data-loader.js'), 'utf8');
  assert(src.includes('RETRY_DELAYS'),  'RETRY_DELAYS constant present');
  assert(src.includes('1000'),          'first retry delay 1000ms');
  assert(src.includes('2000'),          'second retry delay 2000ms');
  assert(src.includes('4000'),          'third retry delay 4000ms');
});

test('acs-data-loader.js includes fallback and freshness metadata', () => {
  const src = fs.readFileSync(path.join(ROOT, 'js/acs-data-loader.js'), 'utf8');
  assert(src.includes('_fetchedAt'),    '_fetchedAt timestamp stamped');
  assert(src.includes('_fromCache'),    '_fromCache flag present');
  assert(src.includes('_partial'),      '_partial fallback flag present');
  assert(src.includes('_freshness'),    '_freshness info present');
  assert(src.includes('FALLBACKS'),     'FALLBACKS object present');
});

// ── js/acs-error-handler.js source checks ──────────────────────────────────

test('acs-error-handler.js defines ACSErrorHandler with required methods', () => {
  const src = fs.readFileSync(path.join(ROOT, 'js/acs-error-handler.js'), 'utf8');
  assert(src.includes('handleError'),            'handleError defined');
  assert(src.includes('showFreshnessIndicator'), 'showFreshnessIndicator defined');
  assert(src.includes('formatFreshnessText'),    'formatFreshnessText defined');
  assert(src.includes('clearError'),             'clearError defined');
  assert(src.includes('global.ACSErrorHandler'), 'ACSErrorHandler exposed on global');
});

// ── coerce() value type enforcement ─────────────────────────────────────────

test('coerce: integer type', () => {
  assert(coerce('12345', 'integer') === 12345,  'string int → number');
  assert(coerce(500,     'integer') === 500,    'numeric → same');
  assert(coerce('abc',   'integer') === null,   'non-numeric → null');
  assert(coerce('',      'integer') === null,   'empty → null');
  assert(coerce(null,    'integer') === null,   'null → null');
});

test('coerce: float / percentage type', () => {
  assert(coerce('30.5', 'percentage') === 30.5, 'string float → number');
  assert(coerce('0',    'float')      === 0,    '"0" → 0');
  assert(coerce('abc',  'percentage') === null, 'non-numeric → null');
});

test('coerce: Census sentinel values become null', () => {
  ['-666666666', '-888888888', '-999999999'].forEach(sentinel => {
    assert(coerce(sentinel, 'integer') === null, `${sentinel} → null`);
  });
});

test('coerce: string type passes through', () => {
  assert(coerce('Denver', 'string') === 'Denver', 'string passes through');
  assert(coerce('',       'string') === null,     'empty string → null');
});

// ── parseACSResponse ─────────────────────────────────────────────────────────

test('parseACSResponse: extracts header→row mapping', () => {
  const mockArr = [
    ['NAME', 'DP04_0001E', 'DP04_0046PE', 'state', 'county'],
    ['Mesa County, Colorado', '62000', '34.5', '08', '077'],
  ];
  const result = parseACSResponse(mockArr);
  assert(result !== null,                           'returns non-null');
  assert(result.NAME === 'Mesa County, Colorado',   'NAME extracted');
  assert(result.DP04_0001E === '62000',             'DP04_0001E extracted');
  assert(result.DP04_0046PE === '34.5',             'DP04_0046PE extracted');
});

test('parseACSResponse: returns null for malformed input', () => {
  assert(parseACSResponse(null)   === null, 'null → null');
  assert(parseACSResponse([])     === null, 'empty array → null');
  assert(parseACSResponse([[]])   === null, 'single-row → null');
});

// ── makeFreshnessInfo ────────────────────────────────────────────────────────

test('makeFreshnessInfo: marks very recent data as fresh', () => {
  const now = new Date().toISOString();
  const info = makeFreshnessInfo(now);
  assert(info.isFresh  === true,     'just-fetched data is fresh');
  assert(info.isStale  === false,    'just-fetched data is not stale');
  assert(info.ageHours < 1,         'ageHours < 1 for just-fetched');
});

test('makeFreshnessInfo: marks old data as stale', () => {
  const old = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(); // 25h ago
  const info = makeFreshnessInfo(old);
  assert(info.isStale === true,      '25h old data is stale');
  assert(info.isFresh === false,     '25h old data is not fresh');
  assert(info.ageHours >= 24,        'ageHours >= 24');
});

// ── formatFreshnessText ──────────────────────────────────────────────────────

test('formatFreshnessText: correct text for various ages', () => {
  const justNow   = makeFreshnessInfo(new Date().toISOString());
  const twoHrsAgo = makeFreshnessInfo(new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString());
  const twoDays   = makeFreshnessInfo(new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString());
  const sixWeeks  = makeFreshnessInfo(new Date(Date.now() - 42 * 24 * 60 * 60 * 1000).toISOString());

  assert(formatFreshnessText(justNow).includes('just now'),   'just now text');
  assert(formatFreshnessText(twoHrsAgo).includes('2h ago'),   '2h ago text');
  assert(formatFreshnessText(twoDays).includes('2 days'),     '2 days text');
  assert(formatFreshnessText(sixWeeks).includes('month'),     '6-week text contains month');
  assert(formatFreshnessText(null) === 'Data freshness unknown', 'null → unknown');
});

// ── friendlyMessage ──────────────────────────────────────────────────────────

test('friendlyMessage: maps error types to user-friendly strings', () => {
  assert(friendlyMessage(new Error('Failed to fetch')).includes('cached'),   'network error → cached msg');
  assert(friendlyMessage(new Error('Request timeout')).includes('timed out'), 'timeout → timed out msg');
  assert(friendlyMessage(new Error('HTTP 429 rate')).includes('rate limit'),  '429 → rate limit msg');
  assert(friendlyMessage(new Error('404 not found')).includes('geography'),   '404 → geography msg');
  assert(friendlyMessage(null).includes('temporarily unavailable'),            'null → generic msg');
  assert(friendlyMessage(new Error('unknown err')).includes('temporarily'),    'unknown → generic msg');
});

// ── Python source content checks ────────────────────────────────────────────

test('acs_etl.py defines ACSExtractor class with required methods', () => {
  const src = fs.readFileSync(path.join(ROOT, 'scripts/hna/acs_etl.py'), 'utf8');
  assert(src.includes('class ACSExtractor'),  'ACSExtractor class defined');
  assert(src.includes('def fetch_all'),       'fetch_all method defined');
  assert(src.includes('def fetch_geoid'),     'fetch_geoid method defined');
  assert(src.includes('MAX_RETRIES'),         'MAX_RETRIES constant defined');
  assert(src.includes('BACKOFF_BASE'),        'BACKOFF_BASE constant defined');
  assert(src.includes('_RateLimiter'),        '_RateLimiter class defined');
  assert(src.includes('RATE_LIMIT_MAX_RPS'),  'rate limit constant defined');
});

test('acs_etl.py has exponential backoff with 1s/2s/4s delays', () => {
  const src = fs.readFileSync(path.join(ROOT, 'scripts/hna/acs_etl.py'), 'utf8');
  assert(src.includes('MAX_RETRIES  = 3'),   'MAX_RETRIES = 3');
  assert(src.includes('BACKOFF_BASE = 1.0'), 'BACKOFF_BASE = 1.0 second');
  assert(src.includes('wait *= 2'),          'backoff doubles each retry');
});

test('acs_etl.py handles rate limiting (429) and retryable status codes', () => {
  const src = fs.readFileSync(path.join(ROOT, 'scripts/hna/acs_etl.py'), 'utf8');
  assert(src.includes('429'),   '429 rate-limit handled');
  assert(src.includes('503'),   '503 handled');
  assert(src.includes('Retry-After'), 'Retry-After header respected');
});

test('acs_validator.py defines ACSValidator with required methods', () => {
  const src = fs.readFileSync(path.join(ROOT, 'scripts/hna/acs_validator.py'), 'utf8');
  assert(src.includes('class ACSValidator'),    'ACSValidator class defined');
  assert(src.includes('def validate_record'),   'validate_record defined');
  assert(src.includes('def validate_batch'),    'validate_batch defined');
  assert(src.includes('class ValidationResult'), 'ValidationResult defined');
  assert(src.includes('add_error'),             'add_error method defined');
  assert(src.includes('add_warning'),           'add_warning method defined');
});

test('acs_validator.py enforces types, ranges, and required fields', () => {
  const src = fs.readFileSync(path.join(ROOT, 'scripts/hna/acs_validator.py'), 'utf8');
  assert(src.includes('required'),    'required field check present');
  assert(src.includes('range'),       'range validation present');
  assert(src.includes('integer'),     'integer type check present');
  assert(src.includes('percentage'),  'percentage type check present');
});

test('acs_cache.py defines ACSCache with SQLite backend', () => {
  const src = fs.readFileSync(path.join(ROOT, 'scripts/hna/acs_cache.py'), 'utf8');
  assert(src.includes('class ACSCache'),    'ACSCache class defined');
  assert(src.includes('sqlite3'),          'sqlite3 module used');
  assert(src.includes('def get'),          'get method defined');
  assert(src.includes('def put'),          'put method defined');
  assert(src.includes('def purge_expired'), 'purge_expired method defined');
  assert(src.includes('expires_at'),       'TTL/expiry tracked');
  assert(src.includes('fetched_at'),       'fetch timestamp tracked');
});

test('acs_cache.py has 30-day default TTL', () => {
  const src = fs.readFileSync(path.join(ROOT, 'scripts/hna/acs_cache.py'), 'utf8');
  assert(src.includes('_DEFAULT_TTL_DAYS = 30'), '30-day TTL default');
});

// ── fetch-county-demographics.js: statewide aggregation & FIPS ──────────────

test('fetch-county-demographics.js: ACS_YEAR updated to 2023', () => {
  const src = fs.readFileSync(path.join(ROOT, 'scripts/fetch-county-demographics.js'), 'utf8');
  // Verify the declared ACS year is at least 2023 (updated from 2022)
  assert(src.includes('ACS_YEAR = 2023') || src.includes('ACS_YEAR = 2024'),
    'ACS_YEAR is 2023 or later (not 2022)');
  assert(!src.includes('ACS_YEAR = 2022'), 'ACS_YEAR is not 2022');
});

test('fetch-county-demographics.js: FIPS code extraction present', () => {
  const src = fs.readFileSync(path.join(ROOT, 'scripts/fetch-county-demographics.js'), 'utf8');
  assert(src.includes("headers.indexOf('state')"),  "reads 'state' field from Census API response");
  assert(src.includes("headers.indexOf('county')"), "reads 'county' field from Census API response");
  assert(src.includes('padStart(3'),                'zero-pads 3-digit county FIPS (Rule 1)');
  assert(src.includes("fips:"),                     "includes 'fips' in county record");
});

test('fetch-county-demographics.js: buildStatewideAggregate function defined', () => {
  const src = fs.readFileSync(path.join(ROOT, 'scripts/fetch-county-demographics.js'), 'utf8');
  assert(src.includes('buildStatewideAggregate'), 'buildStatewideAggregate function defined');
  assert(src.includes("fips: '08'"),              'statewide row uses FIPS "08"');
  assert(src.includes("counties['Colorado']"),    'statewide row added under "Colorado" key');
});

test('fetch-county-demographics.js: source label uses ACS_YEAR constant', () => {
  const src = fs.readFileSync(path.join(ROOT, 'scripts/fetch-county-demographics.js'), 'utf8');
  // Source string must use the ACS_YEAR constant, not a hardcoded year
  assert(src.includes('ACS_YEAR'), 'source label references ACS_YEAR constant');
  assert(!src.includes("Estimates (2022)"), 'source label no longer hardcodes 2022');
});

test('fetch-county-demographics.js: statewide note mentions aggregate', () => {
  const src = fs.readFileSync(path.join(ROOT, 'scripts/fetch-county-demographics.js'), 'utf8');
  assert(src.includes('statewide aggregate'), 'note describes statewide aggregate row');
  assert(src.includes('weighted'), 'note explains weighting method');
});

// ── fetch_census_state_hna.py: 64-county coverage check ─────────────────────

test('fetch_census_state_hna.py: EXPECTED_CO_COUNTY_COUNT = 64', () => {
  const src = fs.readFileSync(path.join(ROOT, 'scripts/fetch_census_state_hna.py'), 'utf8');
  assert(src.includes('EXPECTED_CO_COUNTY_COUNT = 64'), 'EXPECTED_CO_COUNTY_COUNT constant defined as 64');
});

test('fetch_census_state_hna.py: county coverage warning present', () => {
  const src = fs.readFileSync(path.join(ROOT, 'scripts/fetch_census_state_hna.py'), 'utf8');
  assert(src.includes('EXPECTED_CO_COUNTY_COUNT'), 'references coverage constant in validation');
  assert(src.includes('county_coverage'),           'county_coverage field in output payload');
});

test('fetch_census_state_hna.py: S0801 records _acsYear and _acsSeries', () => {
  const src = fs.readFileSync(path.join(ROOT, 'scripts/fetch_census_state_hna.py'), 'utf8');
  assert(src.includes("data['_acsYear']"),   'fetch_acs_s0801 stores _acsYear in returned dict');
  assert(src.includes("data['_acsSeries']"), 'fetch_acs_s0801 stores _acsSeries in returned dict');
});

test('fetch_census_state_hna.py: acs_s0801_endpoint uses actual series/year', () => {
  const src = fs.readFileSync(path.join(ROOT, 'scripts/fetch_census_state_hna.py'), 'utf8');
  assert(src.includes('s0801_series') && src.includes('s0801_year'),
    's0801_series and s0801_year variables derived from returned data');
  assert(src.includes('acs_s0801_endpoint'), 'acs_s0801_endpoint field present in payload');
});

// ── build_hna_data.py: S0801 _acsSeries/_acsYear metadata ───────────────────

test('build_hna_data.py: fetch_acs_s0801 records _acsYear and _acsSeries', () => {
  const src = fs.readFileSync(path.join(ROOT, 'scripts/hna/build_hna_data.py'), 'utf8');
  assert(src.includes("data['_acsYear'] = year"),     'stores _acsYear in S0801 dict');
  assert(src.includes("data['_acsSeries'] = 'acs1'"), "stores 'acs1' as _acsSeries when ACS1 used");
  assert(src.includes("data['_acsSeries'] = 'acs5'"), "stores 'acs5' as _acsSeries when ACS5 fallback used");
});

test('build_hna_data.py: acs_s0801_endpoint uses s0801_year and s0801_series', () => {
  const src = fs.readFileSync(path.join(ROOT, 'scripts/hna/build_hna_data.py'), 'utf8');
  assert(src.includes('s0801_year')   && src.includes('s0801_series'),
    's0801_year and s0801_series variables derived from returned S0801 data');
  assert(src.includes('acs_s0801_endpoint'), 'acs_s0801_endpoint in source dict');
});

// ── housing-needs-assessment.js: commuting reliability & source labels ───────

test('housing-needs-assessment.js: S0801 commute source badge includes units', () => {
  const src = fs.readFileSync(path.join(ROOT, 'js/housing-needs-assessment.js'), 'utf8');
  assert(src.includes('mean travel time (min)'),
    'commute source badge includes "mean travel time (min)"');
});

test('housing-needs-assessment.js: mode share chart subtitle includes year/series/units', () => {
  const src = fs.readFileSync(path.join(ROOT, 'js/housing-needs-assessment.js'), 'utf8');
  assert(src.includes('mode shares (% of workers 16+)'),
    'mode share subtitle contains "mode shares (% of workers 16+)"');
  assert(src.includes('seriesLabel'), 'seriesLabel variable used in mode share subtitle');
  assert(src.includes('modeYear'),    'modeYear variable used in mode share subtitle');
});

test('housing-needs-assessment.js: CDP skips ACS1 S0801 probe', () => {
  const src = fs.readFileSync(path.join(ROOT, 'js/housing-needs-assessment.js'), 'utf8');
  assert(src.includes("geoType !== 'cdp'"),
    'fetchAcsS0801 skips ACS1 probe for CDPs to avoid unnecessary failed requests');
});

test('housing-needs-assessment.js: mode share y-axis title includes units', () => {
  const src = fs.readFileSync(path.join(ROOT, 'js/housing-needs-assessment.js'), 'utf8');
  assert(src.includes("'Mode Share (% of workers)'"),
    'y-axis title clarifies unit as "% of workers"');
});

// ── Summary ─────────────────────────────────────────────────────────────────
console.log('\n' + '='.repeat(60));
console.log(`Results: ${passed} passed, ${failed} failed`);

if (failed > 0) {
  console.error('\nSome checks failed. Review the output above for details.');
  process.exitCode = 1;
} else {
  console.log('\nAll checks passed ✅');
}
