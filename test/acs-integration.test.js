// test/acs-integration.test.js
//
// Integration tests for the ACS ETL pipeline:
//   - End-to-end flow: extract → validate → cache → serve
//   - Data freshness timestamp verification
//   - Cache hit / miss / TTL expiry behaviour
//   - Fallback behaviour when API is unavailable
//
// Tests run with plain Node.js (no jest/mocha):
//   node test/acs-integration.test.js

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

async function testAsync(name, fn) {
  console.log(`\n[test] ${name}`);
  try {
    await fn();
  } catch (err) {
    console.error(`  ❌ FAIL: threw unexpected error — ${err.message}`);
    failed++;
  }
}

// ── In-process cache (mirrors CacheManager behaviour for Node.js tests) ─────

function buildCache(ttlMs) {
  const store = {};
  const TTL   = ttlMs || (24 * 60 * 60 * 1000);
  return {
    get(key) {
      const entry = store[key];
      if (!entry) return null;
      if (Date.now() - entry.ts > TTL) { delete store[key]; return null; }
      return entry.data;
    },
    set(key, value) { store[key] = { ts: Date.now(), data: value }; },
    _store: store,
  };
}

// ── Simulated ACS API (mock Census API responses) ───────────────────────────

function mockCensusResponse(overrides) {
  const defaults = {
    NAME:         'Mesa County, Colorado',
    DP04_0001E:   '62000',
    DP04_0046PE:  '34.5',
    DP04_0047PE:  '65.5',
    DP04_0089E:   '310000',
    DP04_0134E:   '1150',
    DP04_0142PE:  '15.2',
    DP04_0143PE:  '9.8',
    DP04_0144PE:  '8.1',
    DP04_0145PE:  '7.3',
    DP04_0146PE:  '6.2',
    DP04_0147PE:  '12.4',
    DP05_0001E:   '154800',
    DP05_0018E:   '39.1',
    DP05_0037PE:  '83.2',
    DP05_0038PE:  '1.2',
    DP05_0044PE:  '1.8',
    DP05_0071PE:  '16.5',
    state:        '08',
    county:       '077',
  };
  return Object.assign({}, defaults, overrides || {});
}

function mockApiArrayFromObject(obj) {
  const keys = Object.keys(obj);
  return [keys, keys.map(k => obj[k])];
}

// ── Simulated ETL pipeline ───────────────────────────────────────────────────

function parseResponse(arr) {
  if (!Array.isArray(arr) || arr.length < 2) return null;
  const header = arr[0], row = arr[1];
  const out = {};
  header.forEach((h, i) => { out[h] = row[i]; });
  return out;
}

function coerce(v, type) {
  if (v === null || v === undefined || v === '' ||
      v === '-666666666' || v === '-888888888' || v === '-999999999') return null;
  if (type === 'integer')                     return parseInt(v, 10) || null;
  if (type === 'float' || type === 'percentage') { const f = parseFloat(v); return isNaN(f) ? null : f; }
  return v;
}

function mapFields(raw, fieldMapping) {
  const out = {};
  Object.entries(fieldMapping).forEach(([fieldId, meta]) => {
    if (fieldId.startsWith('_')) return;
    out[fieldId] = coerce(raw[fieldId], meta.type);
  });
  return out;
}

function loadFieldMapping() {
  return JSON.parse(
    fs.readFileSync(path.join(ROOT, 'scripts/hna/acs_field_mapping.json'), 'utf8')
  );
}

// Simulates ACSExtractor.fetch_geoid (in-memory, no network)
function simulateExtract(geoid, tableIds, mockOverrides) {
  const mapping = loadFieldMapping();
  const merged  = {};
  let   anyOk   = false;

  tableIds.forEach(tableId => {
    const tableMapping = mapping[tableId];
    if (!tableMapping) return;

    // Simulate API response
    const mockObj = mockCensusResponse(mockOverrides);
    const arr     = mockApiArrayFromObject(mockObj);
    const raw     = parseResponse(arr);
    if (!raw) return;

    const mapped = mapFields(raw, tableMapping);
    Object.assign(merged, mapped);
    anyOk = true;
  });

  if (!anyOk) return null;
  return Object.assign(merged, {
    _geoid:     geoid,
    _tables:    tableIds,
    _fetchedAt: new Date().toISOString(),
  });
}

// Simulates ACSValidator.validate_record
function simulateValidate(record, tableIds) {
  const mapping = loadFieldMapping();
  const errors  = [];
  const warnings = [];

  tableIds.forEach(tableId => {
    const tableMapping = mapping[tableId];
    if (!tableMapping) return;

    Object.entries(tableMapping).forEach(([fieldId, meta]) => {
      if (fieldId.startsWith('_')) return;
      const value = record[fieldId];

      if (value === null || value === undefined) {
        if (meta.required) errors.push(`Required field ${fieldId} is null`);
        else warnings.push(`Optional field ${fieldId} is null`);
        return;
      }

      if (meta.type === 'integer' && !Number.isInteger(value)) {
        errors.push(`${fieldId} expected integer, got ${typeof value}`);
      }
      if ((meta.type === 'float' || meta.type === 'percentage') && typeof value !== 'number') {
        errors.push(`${fieldId} expected number, got ${typeof value}`);
      }
      if (meta.range && typeof value === 'number') {
        const [lo, hi] = meta.range;
        if (value < lo || value > hi) {
          errors.push(`${fieldId} value ${value} out of range [${lo}, ${hi}]`);
        }
      }
    });
  });

  return { ok: errors.length === 0, errors, warnings };
}

// ── Tests ────────────────────────────────────────────────────────────────────

test('end-to-end: extract → validate for Mesa County (DP04 + DP05)', () => {
  const geoid  = '08077';
  const tables = ['DP04', 'DP05'];

  const record = simulateExtract(geoid, tables);
  assert(record !== null,                         'extract returns a record');
  assert(record._geoid === geoid,                 '_geoid matches input');
  assert(Array.isArray(record._tables),            '_tables is an array');
  assert(typeof record._fetchedAt === 'string',   '_fetchedAt is a string');
  assert(record.DP04_0001E === 62000,              'DP04_0001E coerced to integer');
  assert(record.DP04_0046PE === 34.5,              'DP04_0046PE coerced to float');
  assert(record.DP05_0001E === 154800,             'DP05_0001E coerced to integer');

  const validation = simulateValidate(record, tables);
  assert(validation.ok,                            'record passes validation');
  assert(validation.errors.length === 0,           'zero validation errors');
});

test('end-to-end: required field missing triggers validation error', () => {
  const geoid  = '08077';
  const tables = ['DP04'];

  // Override DP04_0001E (required) with a sentinel null value
  const record = simulateExtract(geoid, tables, { DP04_0001E: '-666666666' });
  assert(record !== null, 'extract returns record even with null required field');
  assert(record.DP04_0001E === null, 'sentinel value coerced to null');

  const validation = simulateValidate(record, tables);
  assert(!validation.ok, 'validation fails when required field is null');
  assert(validation.errors.some(e => e.includes('DP04_0001E')),
    'error message references missing required field');
});

test('end-to-end: out-of-range percentage triggers validation error', () => {
  const geoid  = '08077';
  const tables = ['DP04'];

  // Override pct_renter_occupied with a value > 100%
  const record = simulateExtract(geoid, tables, { DP04_0046PE: '150' });
  assert(record.DP04_0046PE === 150, 'raw 150 coerces to 150 (no clamping in extractor)');

  const validation = simulateValidate(record, tables);
  assert(!validation.ok, 'validation fails for out-of-range percentage');
  assert(validation.errors.some(e => e.includes('DP04_0046PE')),
    'error references out-of-range field');
});

test('data freshness: _fetchedAt is a valid ISO timestamp', () => {
  const record = simulateExtract('08077', ['DP04']);
  assert(typeof record._fetchedAt === 'string',  '_fetchedAt is string');
  const parsed = new Date(record._fetchedAt);
  assert(!isNaN(parsed.getTime()),               '_fetchedAt parses as valid date');
  // Should be within the last 5 seconds
  assert(Date.now() - parsed.getTime() < 5000,   '_fetchedAt is recent');
});

test('data freshness: timestamp comparison works correctly', () => {
  const ONE_HOUR_MS = 60 * 60 * 1000;
  const now         = new Date().toISOString();
  const oldTs       = new Date(Date.now() - 25 * ONE_HOUR_MS).toISOString();

  function isFresh(ts) {
    return (Date.now() - new Date(ts).getTime()) < 24 * ONE_HOUR_MS;
  }

  assert(isFresh(now)   === true,  'current timestamp is fresh');
  assert(isFresh(oldTs) === false, '25h old timestamp is not fresh');
});

test('cache: put and get round-trip within TTL', () => {
  const cache   = buildCache(60000);
  const geoid   = '08077';
  const key     = 'acs_' + geoid + '_DP04_DP05_2024';
  const record  = simulateExtract(geoid, ['DP04', 'DP05']);

  cache.set(key, record);
  const hit = cache.get(key);
  assert(hit !== null,                      'cache hit on fresh entry');
  assert(hit._geoid === geoid,              'cached record has correct geoid');
  assert(hit.DP04_0001E === 62000,          'cached field value intact');
});

test('cache: TTL expiry returns null', () => {
  const cache = buildCache(1);  // 1ms TTL
  const key   = 'acs_test';
  cache.set(key, { foo: 'bar' });

  const start = Date.now();
  while (Date.now() - start < 5) { /* busy-wait */ }

  assert(cache.get(key) === null, 'expired entry returns null');
});

test('cache: miss returns null for unknown key', () => {
  const cache = buildCache(60000);
  assert(cache.get('nonexistent') === null, 'unknown key → null');
});

test('cache: hit rate — second call uses cache', () => {
  const cache = buildCache(60000);
  const key   = 'acs_08077_DP04_2024';
  const record = simulateExtract('08077', ['DP04']);

  // First call — cache miss (simulate network fetch + store)
  cache.set(key, record);
  const cached = cache.get(key);
  assert(cached !== null, 'first cache.get after set is a hit');

  // Second call — should still hit
  const cached2 = cache.get(key);
  assert(cached2 !== null,               'second call also hits cache');
  assert(cached2.DP04_0001E === cached.DP04_0001E, 'cached values match');
});

test('fallback: partial failure returns record with null fields', () => {
  const geoid  = '08077';
  const tables = ['DP04'];

  // Null out all the fields we can by supplying sentinels
  const overrides = {
    DP04_0001E:  '-666666666',
    DP04_0046PE: '-666666666',
    DP04_0089E:  '-666666666',
    DP04_0134E:  '-666666666',
  };
  const record = simulateExtract(geoid, tables, overrides);

  assert(record !== null,              'extract still returns a record');
  assert(record.DP04_0001E === null,   'null sentinel for DP04_0001E');
  assert(record.DP04_0046PE === null,  'null sentinel for DP04_0046PE');
  assert(record.DP04_0089E  === null,  'null sentinel for DP04_0089E');
  // _geoid and _fetchedAt should always be present
  assert(record._geoid === geoid,      '_geoid always present');
  assert(record._fetchedAt != null,    '_fetchedAt always present');
});

test('fallback: optional null fields produce warnings, not errors', () => {
  const geoid  = '08077';
  const tables = ['DP04'];

  // DP04_0142PE is optional — null it out
  const overrides = { DP04_0142PE: '-666666666' };
  const record     = simulateExtract(geoid, tables, overrides);
  const validation = simulateValidate(record, tables);

  // Should not produce an error for an optional null field
  const errForField = validation.errors.some(e => e.includes('DP04_0142PE'));
  assert(!errForField, 'null optional field produces warning, not error');
  const warnForField = validation.warnings.some(w => w.includes('DP04_0142PE'));
  assert(warnForField, 'null optional field produces a warning');
});

test('field mapping completeness: DP04 and DP05 cover all key GRAPI fields', () => {
  const mapping = loadFieldMapping();
  const dp04    = mapping.DP04;

  const grapiFields = [
    'DP04_0142PE', 'DP04_0143PE', 'DP04_0144PE',
    'DP04_0145PE', 'DP04_0146PE', 'DP04_0147PE',
  ];
  grapiFields.forEach(f => {
    assert(f in dp04, `GRAPI field ${f} present in DP04 mapping`);
    assert(dp04[f].type === 'percentage', `${f} type is percentage`);
  });
});

test('field mapping completeness: DP05 covers racial/ethnic composition fields', () => {
  const mapping = loadFieldMapping();
  const dp05    = mapping.DP05;

  const raceFields = [
    'DP05_0037PE', // White alone
    'DP05_0038PE', // Black alone
    'DP05_0044PE', // Asian alone
    'DP05_0071PE', // Hispanic/Latino
  ];
  raceFields.forEach(f => {
    assert(f in dp05, `Race/ethnicity field ${f} present in DP05 mapping`);
    assert(Array.isArray(dp05[f].range) && dp05[f].range[1] === 100,
      `${f} has range [0, 100]`);
  });
});

test('js/acs-data-loader.js references DP04 and DP05 fields in ACS_FIELD_MAPPING', () => {
  const src = fs.readFileSync(path.join(ROOT, 'js/acs-data-loader.js'), 'utf8');
  // DP04
  assert(src.includes('DP04_0001E'),  'loader maps DP04_0001E (total housing units)');
  assert(src.includes('DP04_0046PE'), 'loader maps DP04_0046PE (renter-occupied %)');
  assert(src.includes('DP04_0089E'),  'loader maps DP04_0089E (median home value)');
  assert(src.includes('DP04_0134E'),  'loader maps DP04_0134E (median gross rent)');
  // DP05
  assert(src.includes('DP05_0001E'),  'loader maps DP05_0001E (total population)');
  assert(src.includes('DP05_0018E'),  'loader maps DP05_0018E (median age)');
});

test('js/acs-error-handler.js references freshness CSS classes', () => {
  const src = fs.readFileSync(path.join(ROOT, 'js/acs-error-handler.js'), 'utf8');
  assert(src.includes('acs-freshness--fresh'),  'fresh CSS class defined');
  assert(src.includes('acs-freshness--stale'),  'stale CSS class defined');
  assert(src.includes('acs-freshness--error'),  'error CSS class defined');
  assert(src.includes('data-timestamp'),        'data-timestamp CSS class used');
});

// ── Summary ──────────────────────────────────────────────────────────────────
console.log('\n' + '='.repeat(60));
console.log(`Results: ${passed} passed, ${failed} failed`);

if (failed > 0) {
  console.error('\nSome checks failed. Review the output above for details.');
  process.exitCode = 1;
} else {
  console.log('\nAll checks passed ✅');
}
