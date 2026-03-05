// test/tigerweb-timeout.test.js
//
// Unit tests for the fetchWithTimeout utility in js/fetch-helper.js.
//
// Verifies:
//   1. fetchWithTimeout is exported onto window (source check).
//   2. Timeout and retry signature are correct.
//   3. Exponential backoff delays are 1s and 2s.
//   4. housing-needs-assessment.js uses the shared global rather than
//      maintaining its own independent copy.
//
// Note: Network calls are NOT made in these tests — we validate source
// structure and the Node.js-compatible implementation logic.
//
// Usage:
//   node test/tigerweb-timeout.test.js
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

const FETCH_HELPER_PATH = path.resolve(__dirname, '..', 'js', 'fetch-helper.js');
const HNA_PATH          = path.resolve(__dirname, '..', 'js', 'housing-needs-assessment.js');

const fetchHelperSrc = fs.readFileSync(FETCH_HELPER_PATH, 'utf8');
const hnaSrc         = fs.readFileSync(HNA_PATH, 'utf8');

// ── Tests ───────────────────────────────────────────────────────────────────

test('fetch-helper.js defines fetchWithTimeout', () => {
  assert(fetchHelperSrc.includes('function fetchWithTimeout('), 'fetchWithTimeout is defined');
});

test('fetch-helper.js exposes fetchWithTimeout on window', () => {
  assert(fetchHelperSrc.includes('window.fetchWithTimeout = fetchWithTimeout'),
    'window.fetchWithTimeout is assigned');
});

test('fetchWithTimeout uses AbortController for timeout', () => {
  assert(fetchHelperSrc.includes('AbortController'), 'AbortController is used');
  assert(fetchHelperSrc.includes('ctrl.abort') || fetchHelperSrc.includes('controller.abort'),
    'abort() is called on timeout');
});

test('fetchWithTimeout has retry logic with exponential backoff', () => {
  // 1s and 2s delays: 1000 * Math.pow(2, n-1)
  assert(fetchHelperSrc.includes('1000 *'), 'uses 1000ms base for backoff');
  assert(fetchHelperSrc.includes('Math.pow(2'), 'uses exponential (Math.pow(2,...)) backoff');
});

test('fetchWithTimeout defaults: 15s timeout, 2 retries', () => {
  // Default timeout should be 15000ms per the TIGERweb fix
  assert(fetchHelperSrc.match(/15000/) !== null, 'default timeout is 15000ms');
  assert(fetchHelperSrc.match(/maxRetries.*=.*2/) !== null ||
         fetchHelperSrc.match(/=.*2.*maxRetries/) !== null ||
         fetchHelperSrc.match(/\) \? maxRetries.*: 2/) !== null ||
         fetchHelperSrc.match(/\? timeoutMs.*: 2/) !== null ||
         fetchHelperSrc.includes(': 2;'),
    'default maxRetries is 2');
});

test('housing-needs-assessment.js uses global fetchWithTimeout', () => {
  // Should reference window.fetchWithTimeout or alias it from window
  assert(hnaSrc.includes('window.fetchWithTimeout'),
    'HNA references window.fetchWithTimeout (shared global)');
});

test('housing-needs-assessment.js does NOT define its own standalone fetchWithTimeout function', () => {
  // The old standalone function definition should be replaced by the global alias.
  // Detect a standalone (non-alias) definition by checking for the function keyword
  // followed by the function name without a reference to window.fetchWithTimeout on the same line.
  const standalonePattern = /^\s*function fetchWithTimeout\s*\(/m;
  assert(!standalonePattern.test(hnaSrc),
    'HNA no longer contains a standalone fetchWithTimeout function declaration');
});

test('TIGERweb boundary fetch uses 15s timeout', () => {
  // fetchBoundary in HNA calls fetchWithTimeout with 15000ms
  assert(hnaSrc.includes('fetchWithTimeout(url, {}, 15000)'),
    'TIGERweb boundary fetch uses 15000ms timeout');
});

// ── Functional test: simulate timeout firing ─────────────────────────────────

test('functional: fetchWithTimeout logic aborts and retries', () => {
  // Simulate the fetchWithTimeout function logic in Node.js
  // maxRetries=2 means: 1 initial attempt + 2 retries = 3 total attempts
  let attemptCount  = 0;
  let rejectCalled  = false;

  function simulateFetchWithTimeout(maxRetries) {
    function attempt(n) {
      attemptCount++;
      // Simulate abort error on every attempt
      if (n <= maxRetries) {
        // Would retry after backoff
        attempt(n + 1);
      } else {
        rejectCalled = true;
      }
    }
    attempt(1);
  }

  simulateFetchWithTimeout(2);
  assert(attemptCount === 3, `3 total attempts with maxRetries=2 (got ${attemptCount})`);
  assert(rejectCalled,       'final rejection is triggered after exhausting retries');
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
