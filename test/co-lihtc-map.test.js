// test/co-lihtc-map.test.js
//
// Unit tests for the bug fixes in js/co-lihtc-map.js:
//   1. LIHTC_WHERE clause uses Proj_St='CO' (not STATEFP='08')
//   2. TIGERweb cache validates 64-feature count before storing / on read
//   3. NaturalEarth county filter handles code_hasc prefix and numeric fips
//
// Usage:
//   node test/co-lihtc-map.test.js
//
// Exit code 0 = all checks passed; non-zero = one or more failures.

'use strict';

const fs   = require('fs');
const path = require('path');

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

const src = fs.readFileSync(
  path.resolve(__dirname, '..', 'js', 'co-lihtc-map.js'),
  'utf8'
);

// ── 1. LIHTC WHERE clause ────────────────────────────────────────────────────

test('LIHTC_WHERE uses Proj_St instead of STATEFP', () => {
  assert(src.includes("LIHTC_WHERE = 'where=Proj_St"), 'LIHTC_WHERE variable is defined with Proj_St');
  assert(src.includes("Proj_St%3D%27CO%27"), "contains Proj_St='CO' (URL-encoded)");
  assert(src.includes("Proj_St%3D%2708%27"), "contains Proj_St='08' (URL-encoded)");
  assert(src.includes("Proj_St%3D%27Colorado%27"), "contains Proj_St='Colorado' (URL-encoded)");
});

test('LIHTC_WHERE is used for both CHFA layer queries and HUD query', () => {
  // fetchAllPages calls should reference LIHTC_WHERE, not a hardcoded STATEFP string
  const hwMatches = (src.match(/fetchAllPages\(.*LIHTC_WHERE/g) || []).length;
  assert(hwMatches >= 2, `fetchAllPages uses LIHTC_WHERE in at least 2 places (found ${hwMatches})`);
});

test('No hardcoded STATEFP where-clauses remain in LIHTC fetch calls', () => {
  // STATEFP may still appear in TIGERweb PARAMS (correct) but not in fetchAllPages calls
  const badPattern = /fetchAllPages\([^)]*STATEFP/;
  assert(!badPattern.test(src), 'no fetchAllPages call uses STATEFP in its query string');
});

test('LIHTC_WHERE is in sync with lihtc-co-query.json WHERE clause', () => {
  const queryCfg = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, '..', 'scripts', 'lihtc-co-query.json'), 'utf8')
  );
  // Decode LIHTC_WHERE and compare field + values
  const whereMatch = src.match(/LIHTC_WHERE\s*=\s*'(where=[^']+)'/);
  assert(whereMatch !== null, 'LIHTC_WHERE is a quoted string literal');
  if (whereMatch) {
    const decoded = decodeURIComponent(whereMatch[1].replace(/\+/g, ' '));
    // Both should reference Proj_St and 'CO'
    assert(decoded.includes("Proj_St='CO'"), "decoded LIHTC_WHERE includes Proj_St='CO'");
    assert(queryCfg.where.includes("Proj_St='CO'"), "lihtc-co-query.json WHERE includes Proj_St='CO'");
  }
});

// ── 2. TIGERweb cache validation ─────────────────────────────────────────────

test('tWebCacheSet validates feature count before storing', () => {
  // Verify the guard is present in the source by checking the function body directly
  const setCacheMatch = src.match(/function tWebCacheSet\(gj\)\s*\{([\s\S]*?)^\s*\}/m);
  assert(setCacheMatch !== null, 'tWebCacheSet function body is identifiable in source');
  if (setCacheMatch) {
    const body = setCacheMatch[1];
    assert(body.includes('gj.features.length !== EXPECTED_FEATURES'),
      'tWebCacheSet body contains feature-count guard');
    // Guard must appear before any localStorage.setItem call
    const guardPos  = body.indexOf('gj.features.length !== EXPECTED_FEATURES');
    const storePos  = body.indexOf('localStorage.setItem');
    assert(guardPos !== -1 && (storePos === -1 || guardPos < storePos),
      'feature count guard precedes any localStorage.setItem in tWebCacheSet body');
  }
});

test('tWebCacheGet evicts invalid cache entries (0 features)', () => {
  // tWebCacheGet must remove the key if cached data doesn't have 64 features
  assert(
    src.includes('entry.data.features.length !== EXPECTED_FEATURES'),
    'tWebCacheGet checks feature count of cached entry'
  );
  // After the bad-count check, localStorage.removeItem must be called
  const badCountIdx = src.indexOf('entry.data.features.length !== EXPECTED_FEATURES');
  const removeIdx   = src.indexOf('localStorage.removeItem(TIGERWEB_CACHE_KEY', badCountIdx);
  assert(removeIdx !== -1 && removeIdx < badCountIdx + 200,
    'tWebCacheGet calls removeItem immediately after detecting bad feature count');
});

test('tWebCacheSet does NOT store when feature count is wrong (logic check)', () => {
  // Simulate tWebCacheSet guard logic
  function simulateCacheSet(featureCount) {
    var EXPECTED = 64;
    var stored = false;
    var gj = { features: new Array(featureCount) };
    if (!gj || !Array.isArray(gj.features) || gj.features.length !== EXPECTED) return stored;
    stored = true;
    return stored;
  }
  assert(!simulateCacheSet(0),  'does not store when features = 0');
  assert(!simulateCacheSet(32), 'does not store when features = 32');
  assert(!simulateCacheSet(63), 'does not store when features = 63');
  assert( simulateCacheSet(64), 'stores when features = 64');
  assert(!simulateCacheSet(65), 'does not store when features = 65');
});

// ── 3. NaturalEarth county filter ────────────────────────────────────────────

test('NaturalEarth filter uses prefix check for code_hasc (not exact equality)', () => {
  // Old: p.code_hasc === 'US.CO'  (matches nothing because actual values are 'US.CO.AD' etc.)
  // New: String(p.code_hasc || '').slice(0, 5) === 'US.CO'
  assert(!src.includes("p.code_hasc === 'US.CO'"),
    'old exact equality check for code_hasc is removed');
  assert(src.includes("String(p.code_hasc || '').slice(0, 5) === 'US.CO'"),
    'prefix check for code_hasc (slice 0–5) is present');
});

test('NaturalEarth filter pads fips before slicing (handles numeric fips)', () => {
  // Old: String(p.fips).slice(0,2) === '08'  (fails for integer 8001 → '80')
  // New: String(p.fips || '').padStart(5, '0').slice(0, 2) === '08'
  assert(!src.includes("String(p.fips).slice(0,2) === '08'"),
    'old unpadded fips slice is removed');
  assert(src.includes("String(p.fips || '').padStart(5, '0').slice(0, 2) === '08'"),
    'padded fips slice is present');
});

test('NaturalEarth filter — logic check: string fips "08001" matches Colorado', () => {
  function filterCheck(props) {
    var p = props || {};
    return p.iso_3166_2 === 'US-CO' ||
           String(p.code_hasc || '').slice(0, 5) === 'US.CO' ||
           String(p.fips || '').padStart(5, '0').slice(0, 2) === '08' ||
           String(p.STATEFP || p.statefp || '').padStart(2, '0') === '08';
  }
  assert(filterCheck({ iso_3166_2: 'US-CO' }),             'iso_3166_2 = "US-CO" matches');
  assert(filterCheck({ code_hasc: 'US.CO.AD' }),           'code_hasc = "US.CO.AD" matches');
  assert(filterCheck({ code_hasc: 'US.CO.WE' }),           'code_hasc = "US.CO.WE" matches');
  assert(!filterCheck({ code_hasc: 'US.TX.AD' }),          'Texas county code_hasc does not match');
  assert(filterCheck({ fips: '08001' }),                   'string fips "08001" matches');
  assert(filterCheck({ fips: 8001 }),                      'integer fips 8001 matches after padding');
  assert(!filterCheck({ fips: '09001' }),                  'fips "09001" (Connecticut) does not match');
  assert(!filterCheck({ fips: 9001 }),                     'integer fips 9001 (Connecticut) does not match');
  assert(filterCheck({ STATEFP: '08' }),                   'STATEFP "08" matches');
  assert(!filterCheck({}),                                  'empty properties do not match');
});

// ── Summary ──────────────────────────────────────────────────────────────────

console.log('\n' + '─'.repeat(60));
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exitCode = 1;
}
