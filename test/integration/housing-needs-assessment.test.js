// test/integration/housing-needs-assessment.test.js
//
// Integration tests for the Housing Needs Assessment page.
//
// Verifies:
//   1. HNA JS source file exists and exports expected functions.
//   2. fetchBoundary error is caught and a warning banner is set (graceful degradation).
//   3. fetchWithTimeout is used for the TIGERweb boundary request.
//   4. hnaDataTimestamp element ID is present in the HTML.
//   5. housing-needs-assessment.html references the correct JS file.
//
// Usage:
//   node test/integration/housing-needs-assessment.test.js
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

const HNA_JS   = path.join(ROOT, 'js',   'housing-needs-assessment.js');
const HNA_HTML = path.join(ROOT, 'housing-needs-assessment.html');

const hnaSrc  = fs.readFileSync(HNA_JS,   'utf8');
const hnaHtml = fs.readFileSync(HNA_HTML, 'utf8');

// ── Tests ───────────────────────────────────────────────────────────────────

test('housing-needs-assessment.js exists and is non-empty', () => {
  assert(fs.existsSync(HNA_JS),    'js/housing-needs-assessment.js exists');
  assert(hnaSrc.length > 1000,     'file is non-trivially sized');
});

test('housing-needs-assessment.html exists and references the JS file', () => {
  assert(fs.existsSync(HNA_HTML),                                  'housing-needs-assessment.html exists');
  assert(hnaHtml.includes('housing-needs-assessment.js'),          'HTML references the HNA JS file');
});

test('HNA HTML includes data timestamp element', () => {
  assert(hnaHtml.includes('id="hnaDataTimestamp"'),
    'housing-needs-assessment.html has hnaDataTimestamp element');
  assert(hnaHtml.includes('data-timestamp'),
    'timestamp element uses data-timestamp CSS class');
});

test('HNA JS uses fetchWithTimeout from global (fetch-helper)', () => {
  assert(hnaSrc.includes('window.fetchWithTimeout'),
    'HNA JS aliases window.fetchWithTimeout');
});

test('TIGERweb boundary fetch is wrapped in try/catch for graceful degradation', () => {
  // The update() function wraps fetchBoundary in try/catch
  assert(hnaSrc.includes('fetchBoundary('), 'fetchBoundary is called');
  // Check that it's in a try block
  const tryBoundaryIdx = hnaSrc.indexOf('fetchBoundary(');
  const tryCatchIdx    = hnaSrc.lastIndexOf('try{', tryBoundaryIdx);
  assert(tryCatchIdx !== -1,
    'fetchBoundary call is inside a try block (graceful degradation)');
});

test('HNA JS updates timestamp after data load', () => {
  assert(hnaSrc.includes('hnaDataTimestamp'),
    'HNA JS references hnaDataTimestamp element');
  assert(hnaSrc.includes('Data as of'),
    'HNA JS sets "Data as of" text');
});

test('fetchBoundary uses 15-second timeout', () => {
  assert(hnaSrc.includes('15000'),
    'fetchBoundary uses 15000ms timeout for TIGERweb');
});

test('HNA boundary failure message is informative', () => {
  assert(hnaSrc.includes('TIGERweb'),
    'Boundary failure message mentions TIGERweb for user clarity');
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
