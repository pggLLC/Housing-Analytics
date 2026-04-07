/**
 * test/test_soft_funding_tracker.js
 * Unit tests for js/soft-funding-tracker.js
 *
 * Usage:
 *   node test/test_soft_funding_tracker.js
 *
 * Exit code 0 = all checks passed; non-zero = one or more failures.
 */
'use strict';

const path    = require('path');
const tracker = require(path.resolve(__dirname, '..', 'js', 'soft-funding-tracker'));
const data    = require(path.resolve(__dirname, '..', 'data', 'policy', 'soft-funding-status.json'));

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log('  \u2705 PASS: ' + message);
    passed++;
  } else {
    console.error('  \u274c FAIL: ' + message);
    failed++;
  }
}

function test(name, fn) {
  console.log('\n[test] ' + name);
  try {
    fn();
  } catch (e) {
    console.error('  \u274c EXCEPTION: ' + e.message);
    failed++;
  }
}

/* ── Module exports ─────────────────────────────────────────────── */
test('Module exports', function () {
  assert(typeof tracker === 'object',                  'module is an object');
  assert(typeof tracker.load === 'function',           'exports load()');
  assert(typeof tracker.check === 'function',          'exports check()');
  assert(typeof tracker.getLastUpdated === 'function', 'exports getLastUpdated()');
  assert(typeof tracker.isLoaded === 'function',       'exports isLoaded()');
  assert(typeof tracker._daysToDeadline === 'function',    'exports _daysToDeadline for testing');
  assert(typeof tracker._computeConfidence === 'function', 'exports _computeConfidence for testing');
  assert(typeof tracker._fmtDollars === 'function',        'exports _fmtDollars for testing');
});

/* ── _daysToDeadline ─────────────────────────────────────────────── */
test('_daysToDeadline: correct calculation', function () {
  // Use a fixed reference date: 2026-03-24
  var ref = '2026-03-24';

  var days30 = tracker._daysToDeadline('2026-04-23', ref);
  assert(days30 === 30, '30 days to 2026-04-23 from 2026-03-24 (got ' + days30 + ')');

  var days0 = tracker._daysToDeadline('2026-03-24', ref);
  assert(days0 === 0, '0 days to same date (got ' + days0 + ')');

  var daysNull = tracker._daysToDeadline(null, ref);
  assert(daysNull === null, 'null deadline returns null');

  var daysPast = tracker._daysToDeadline('2026-03-01', ref);
  assert(daysPast < 0, 'past deadline returns negative');
});

/* ── _fmtDollars ─────────────────────────────────────────────────── */
test('_fmtDollars: formatting', function () {
  assert(tracker._fmtDollars(2500000) === '$2.5M', '2.5M formatted');
  assert(tracker._fmtDollars(500000)  === '$500K', '500K formatted');
  assert(tracker._fmtDollars(1000)    === '$1K',   '1K formatted');
  assert(tracker._fmtDollars(0)       === '$0',    '0 formatted');
  assert(tracker._fmtDollars(750)     === '$750',  'sub-1K formatted');
});

/* ── _computeConfidence ─────────────────────────────────────────── */
test('_computeConfidence: range and logic', function () {
  var highConf = tracker._computeConfidence({ available: 2500000, awarded: 0, capacity: 5000000, deadline: '2030-01-01' });
  assert(highConf >= 0.7 && highConf <= 1.0, 'High availability = high confidence: ' + highConf);

  var lowConf = tracker._computeConfidence({ available: 0, awarded: 5000000, capacity: 5000000, deadline: null });
  assert(lowConf <= 0.1, 'Zero availability = low confidence: ' + lowConf);

  var nearDeadline = tracker._computeConfidence({ available: 1000000, awarded: 0, capacity: 5000000, deadline: '2026-04-01' });
  var farDeadline  = tracker._computeConfidence({ available: 1000000, awarded: 0, capacity: 5000000, deadline: '2028-01-01' });
  // Near deadline should be <= far deadline
  assert(nearDeadline <= farDeadline, 'Near deadline reduces confidence vs far deadline');
});

/* ── isLoaded before load ────────────────────────────────────────── */
test('isLoaded() before load()', function () {
  assert(typeof tracker.isLoaded() === 'boolean', 'isLoaded returns boolean');
});

/* ── load() ─────────────────────────────────────────────────────── */
test('load() with program data', function () {
  return tracker.load(data).then(function () {
    assert(tracker.isLoaded() === true,  'isLoaded() is true after load()');
    assert(typeof tracker.getLastUpdated() === 'string', 'getLastUpdated returns string');
  });
});

/* ── check() result schema ──────────────────────────────────────── */
test('check(): result schema validation', function () {
  tracker.load(data);
  var result = tracker.check('08013', 2026);

  assert(typeof result.available === 'number',       'available is number');
  assert(typeof result.program === 'string',         'program is string');
  assert(result.deadline === null || typeof result.deadline === 'string', 'deadline is null or string');
  assert(result.daysRemaining === null || typeof result.daysRemaining === 'number', 'daysRemaining is null or number');
  assert(typeof result.competitiveness === 'string', 'competitiveness is string');
  assert(typeof result.narrative === 'string',       'narrative is string');
  assert(typeof result.confidence === 'number',      'confidence is number');
  assert(result.confidence >= 0 && result.confidence <= 1, 'confidence 0–1: ' + result.confidence);
  assert(result.warning === null || typeof result.warning === 'string', 'warning is null or string');
  assert(Array.isArray(result.programs),             'programs is array');
});

/* ── check(): competitiveness values ───────────────────────────── */
test('check(): competitiveness is valid value', function () {
  tracker.load(data);
  var validCompetitiveness = ['high', 'moderate', 'low'];
  var result = tracker.check('08031', 2026);
  assert(validCompetitiveness.indexOf(result.competitiveness) !== -1,
    'competitiveness is valid: ' + result.competitiveness);
});

/* ── check(): county-specific program priority ───────────────────── */
test('check(): Denver (08031) finds county-specific program first', function () {
  tracker.load(data);
  var result = tracker.check('08031', 2026);
  // Denver has a specific program (Denver-AHTF county: "08031")
  assert(result.available > 0, 'Denver has available funds');
  // The top program should be Denver-specific
  var hasCountySpecific = result.programs.some(function (p) {
    return p.name.indexOf('Denver') !== -1;
  });
  assert(hasCountySpecific, 'Denver finds county-specific program');
});

/* ── check(): programs array structure ──────────────────────────── */
test('check(): programs array items have required fields', function () {
  tracker.load(data);
  var result = tracker.check('08013', 2026);
  assert(result.programs.length > 0, 'at least one program found');
  result.programs.forEach(function (p) {
    assert(typeof p.name === 'string',           'program.name is string');
    assert(typeof p.available === 'number',      'program.available is number');
    assert(typeof p.confidence === 'number',     'program.confidence is number');
    assert(p.confidence >= 0 && p.confidence <= 1, 'program.confidence 0–1');
  });
});

/* ── check(): unknown county gets statewide programs ─────────────── */
test('check(): unknown FIPS still returns statewide programs', function () {
  tracker.load(data);
  var result = tracker.check('08999', 2026);
  // Statewide programs (county: "All") should always be returned
  assert(result.programs.length > 0, 'Unknown FIPS still finds statewide programs');
});

/* ── check(): project need warning ──────────────────────────────── */
test('check(): project need > available triggers warning', function () {
  tracker.load(data);
  // Find a program with limited availability
  var result = tracker.check('08031', 2026, 999999999);
  // If need exceeds availability, warning should be set
  if (result.available < 999999999) {
    assert(result.warning !== null, 'Warning set when need exceeds availability');
  } else {
    assert(true, 'Sufficient funds — no need warning expected');
  }
});

/* ── check(): load with null data ────────────────────────────────── */
test('check(): null data returns empty result gracefully', function () {
  var fresh = require(path.resolve(__dirname, '..', 'js', 'soft-funding-tracker'));
  fresh.load({ programs: {}, lastUpdated: null });
  var result = fresh.check('08013', 2026);
  assert(typeof result === 'object',         'returns object for empty programs');
  assert(typeof result.narrative === 'string', 'narrative is string');
  assert(result.available === 0,              'available = 0 when no programs');
});

/* ── getEligiblePrograms(): filters by county + execution type ───── */
test('getEligiblePrograms(): returns 9% programs for Denver', function () {
  tracker.load(data); // reload after null-data test above
  var progs = tracker.getEligiblePrograms('08031', '9%');
  assert(Array.isArray(progs), 'returns array');
  assert(progs.length > 0, 'at least one program');
  // Should include Denver AHTF (county-specific) and statewide programs
  var names = progs.map(function (p) { return p.key; });
  assert(names.indexOf('Denver-AHTF') >= 0, 'includes Denver AHTF (county-specific)');
  assert(names.indexOf('CHFA-HTF') >= 0, 'includes CHFA HTF (statewide)');
  // Should NOT include PAB (volume cap) or OZ (market source)
  assert(names.indexOf('PAB-CO') === -1, 'excludes PAB volume cap by default');
  assert(names.indexOf('OZ-EQUITY') === -1, 'excludes OZ market source by default');
});

test('getEligiblePrograms(): 4% filter excludes non-LIHTC-only programs', function () {
  var progs = tracker.getEligiblePrograms('08001', '4%');
  var keys = progs.map(function (p) { return p.key; });
  // PROP123-LBTF is non-LIHTC only — should be excluded from 4%
  assert(keys.indexOf('PROP123-LBTF') === -1, 'excludes non-LIHTC-only programs from 4%');
  // CHFA-CCLA is eligible for 4% — should be included
  assert(keys.indexOf('CHFA-CCLA') >= 0, 'includes CHFA CCLA for 4%');
});

test('getEligiblePrograms(): includes market sources when requested', function () {
  var progs = tracker.getEligiblePrograms('08031', '9%', { includeMarket: true });
  var keys = progs.map(function (p) { return p.key; });
  assert(keys.indexOf('OZ-EQUITY') >= 0 || keys.indexOf('TIF-LOCAL') >= 0, 'includes at least one market source');
});

/* ── getPabStatus(): returns volume cap data ─────────────────────── */
test('getPabStatus(): returns PAB volume cap data', function () {
  var pab = tracker.getPabStatus();
  assert(pab !== null, 'returns object');
  assert(typeof pab.totalCap === 'number', 'totalCap is number');
  assert(typeof pab.remaining === 'number', 'remaining is number');
  assert(typeof pab.pctCommitted === 'number', 'pctCommitted is number');
  assert(pab.totalCap > 0, 'totalCap > 0');
  assert(pab.remaining <= pab.totalCap, 'remaining <= totalCap');
});

/* ── sumEligible(): totals available funding ─────────────────────── */
test('sumEligible(): returns total for county + execution type', function () {
  var result = tracker.sumEligible('08031', '9%');
  assert(typeof result.total === 'number', 'total is number');
  assert(result.total > 0, 'total > 0 for Denver 9%');
  assert(result.programCount > 0, 'programCount > 0');
  assert(Array.isArray(result.programs), 'programs is array');
  // Denver should have more total than a rural county due to Denver AHTF
  var ruralResult = tracker.sumEligible('08001', '9%');
  assert(result.total > ruralResult.total, 'Denver total > rural total (Denver AHTF adds local funds)');
});

/* ── Summary ─────────────────────────────────────────────────────── */
console.log('\n' + '='.repeat(50));
console.log('Results: ' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) {
  process.exit(1);
}
