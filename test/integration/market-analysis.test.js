// test/integration/market-analysis.test.js
//
// Integration tests for the Market Analysis page PMA guard clause.
//
// Verifies:
//   1. market-analysis.js contains the lihtcLoadError guard.
//   2. Guard clause is positioned before computePma call.
//   3. Error message is user-visible and actionable.
//   4. market-analysis.html contains the pmaDataTimestamp element.
//   5. lihtcLoadError flag is exposed for testing via PMAEngine._state.
//
// Usage:
//   node test/integration/market-analysis.test.js
//
// Exit code 0 = all checks passed; non-zero = one or more failures.

'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');

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

const MA_JS   = path.join(ROOT, 'js',   'market-analysis.js');
const MA_HTML = path.join(ROOT, 'market-analysis.html');

const maSrc  = fs.readFileSync(MA_JS,   'utf8');
const maHtml = fs.readFileSync(MA_HTML, 'utf8');

// ── Tests ───────────────────────────────────────────────────────────────────

test('market-analysis.js exists and is non-empty', () => {
  assert(fs.existsSync(MA_JS), 'js/market-analysis.js exists');
  assert(maSrc.length > 1000,  'file is non-trivially sized');
});

test('market-analysis.html references market-analysis.js', () => {
  assert(maHtml.includes('js/market-analysis.js'),
    'market-analysis.html includes market-analysis.js script tag');
});

test('lihtcLoadError state variable is declared', () => {
  assert(maSrc.includes('var lihtcLoadError'),
    'lihtcLoadError variable is declared in module state');
});

test('lihtcLoadError is set true when LIHTC data fails', () => {
  // The loadData() function should set lihtcLoadError = true on _loadError
  assert(maSrc.includes('lihtcLoadError = true'),
    'lihtcLoadError is set to true when lihtcData._loadError is truthy');
  assert(maSrc.includes('lihtcLoadError = false'),
    'lihtcLoadError is reset to false on successful load');
});

test('guard clause blocks scoring when lihtcLoadError is set', () => {
  const guardIdx = maSrc.indexOf('if (lihtcLoadError)');
  assert(guardIdx !== -1, 'lihtcLoadError guard clause exists in runAnalysis');

  // Guard must appear before the computePma() call (not the function definition).
  // The call site assigns to `var pma`: var pma = computePma(acs, lihtcUnits, 0)
  const callIdx = maSrc.indexOf('var pma          = computePma(');
  assert(callIdx !== -1, 'computePma() call site (var pma = ...) exists');
  assert(guardIdx < callIdx,
    'guard clause appears before computePma call in source order');
});

test('guard clause error message is user-visible and actionable', () => {
  assert(maSrc.includes('LIHTC data is unavailable'),
    'guard clause sets user-visible error message about LIHTC unavailability');
  assert(maSrc.includes('PMA score cannot be computed'),
    'guard clause message explains why scoring is blocked');
  assert(maSrc.includes('"Generate Market Analysis Data"') ||
         maSrc.includes("'Generate Market Analysis Data'"),
    'guard clause references the workflow to resolve the issue');
});

test('market-analysis.html has pmaDataTimestamp element', () => {
  assert(maHtml.includes('id="pmaDataTimestamp"'),
    'market-analysis.html has pmaDataTimestamp element');
  assert(maHtml.includes('data-timestamp'),
    'timestamp element uses data-timestamp CSS class');
});

test('market-analysis.js updates timestamp after data loads', () => {
  assert(maSrc.includes('pmaDataTimestamp'),
    'market-analysis.js references pmaDataTimestamp');
  assert(maSrc.includes('Data as of'),
    'market-analysis.js sets "Data as of" timestamp text');
});

test('PMAEngine exposes _state for testability', () => {
  assert(maSrc.includes('PMAEngine'),        'PMAEngine is exposed on window');
  assert(maSrc.includes('_state'),           'PMAEngine has _state accessor');
  assert(maSrc.includes('getLihtcLoadError'), 'getLihtcLoadError accessor is exposed');
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
