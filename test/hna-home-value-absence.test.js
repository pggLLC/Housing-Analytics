'use strict';

/**
 * Regression: a place with no median home value must not render "$0".
 *
 * Found on live cohoanalytics.com 2026-09-05 for Air Force Academy CDP
 * (0800870). Its cascade record is:
 *
 *   { "value": null, "source": "acs_raw", "confidence": "missing" }
 *
 * The data explicitly said "missing", and the Executive Snapshot rendered
 * "Median home value $0" beside a caption reading "... · missing · low
 * confidence". The cause was `safeNum(null)` -> `Number(null)` -> 0, which is
 * finite, so the `homeVal !== null` guard in hna-renderers.js let it through.
 *
 * Same defect class as #1531 and issue #1480: absence rendered as a confident
 * value.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');

function loadUtils() {
  const dom = new JSDOM('<div></div>', {
    runScripts: 'outside-only',
    url: 'http://127.0.0.1/housing-needs-assessment.html',
  });
  dom.window.eval(fs.readFileSync(path.join(ROOT, 'js/hna/hna-utils.js'), 'utf8'));
  const U = dom.window.HNAUtils || dom.window.HnaUtils || dom.window.HNA_UTILS;
  assert(U, 'hna-utils must expose its API on window');
  return U;
}

const U = loadUtils();
assert(typeof U.homeValueInfo === 'function', 'homeValueInfo must be exported');

// ── A missing home value must resolve to null, not 0 ────────────────────────
const missing = U.homeValueInfo({
  median_home_value: { value: null, source: 'acs_raw', confidence: 'missing' },
});
assert.strictEqual(
  missing.value, null,
  'a null cascade value must resolve to null, never 0 — 0 renders as "$0"'
);

// Empty string is the same kind of absence.
const empty = U.homeValueInfo({
  median_home_value: { value: '', source: 'acs_raw', confidence: 'missing' },
});
assert.strictEqual(empty.value, null, "an empty-string home value must resolve to null");

// ── A real value must be untouched ──────────────────────────────────────────
const real = U.homeValueInfo({
  median_home_value: { value: 710351, source: 'zhvi', confidence: 'high' },
});
assert.strictEqual(real.value, 710351, 'a real home value must pass through unchanged');

// A string-encoded number is still a value.
const strNum = U.homeValueInfo({
  median_home_value: { value: '425000', source: 'zhvi' },
});
assert.strictEqual(strNum.value, 425000, 'a numeric string must still resolve to its number');

// ── The DP04 fallback path has the same requirement ─────────────────────────
assert.strictEqual(
  U.homeValueInfo({ DP04_0089E: null }).value, null,
  'a null DP04_0089E must resolve to null, not 0'
);
assert.strictEqual(
  U.homeValueInfo({ DP04_0089E: 512000 }).value, 512000,
  'a real DP04_0089E must pass through'
);

// ── Every genuinely-null place in the shipped cascade must resolve to null ──
const cascade = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'data/hna/home-value-cascade.json'), 'utf8')
);
const nullGeoids = Object.keys(cascade.places).filter((g) => {
  const rec = cascade.places[g];
  return rec && rec.value == null;
});

assert(nullGeoids.length > 0, 'fixture sanity: the cascade should contain null-value places');

const leaked = nullGeoids.filter(
  (g) => U.homeValueInfo({ median_home_value: cascade.places[g] }).value !== null
);
assert.deepStrictEqual(
  leaked, [],
  `every null-value place must resolve to null; these rendered a number: ${leaked.slice(0, 5).join(', ')}`
);

// A genuine 0 is a value, not an absence — do not over-correct.
assert.strictEqual(
  U.homeValueInfo({ median_home_value: { value: 0, source: 'zhvi' } }).value, 0,
  'an explicit 0 must be preserved; only null/empty are absence'
);

console.log(
  `hna-home-value-absence: PASS (${nullGeoids.length} null-value places all resolve to null)`
);
