'use strict';
/**
 * test/data-freshness-v2.test.js
 *
 * Validates the Data Freshness v2 freshnessState helper exposed on
 * window.DataQuality. The helper maps (dataAgeMs, datasetConfig) to
 *   'fresh' | 'aging' | 'stale' | 'unknown'
 * which the data-status dashboard surfaces as a badge per-dataset.
 *
 * Run: node test/data-freshness-v2.test.js
 */

const { JSDOM } = require('jsdom');
const dom = new JSDOM('<!DOCTYPE html><body></body>', { url: 'http://localhost/' });
global.document = dom.window.document;
global.window   = dom.window;
global.location = dom.window.location;
// jsdom provides localStorage; no stub needed

require('../js/data-quality-check.js');
const D = window.DataQuality;

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { console.log('  ✅ PASS:', msg); passed++; }
  else       { console.error('  ❌ FAIL:', msg); failed++; }
}
function test(name, fn) {
  console.log('\n[test]', name);
  try { fn(); } catch (e) { console.error('  ❌ FAIL: threw —', e.message); failed++; }
}

const DAY  = 24 * 60 * 60 * 1000;
const WEEK = 7 * DAY;

// Canonical FRED config — weekly cadence; aging at 7d, stale at 30d
const FRED_CFG = {
  agingThresholdMs: 7  * DAY,
  staleThresholdMs: 30 * DAY,
};
// Canonical CHFA config — annual cadence; aging at 14d, stale at 60d
const CHFA_CFG = {
  agingThresholdMs: 14 * DAY,
  staleThresholdMs: 60 * DAY,
};

test('API exposed', function () {
  assert(typeof D.freshnessState === 'function', 'freshnessState exported');
});

test('null / undefined dataAgeMs → unknown', function () {
  assert(D.freshnessState(null,      FRED_CFG) === 'unknown', 'null age → unknown');
  assert(D.freshnessState(undefined, FRED_CFG) === 'unknown', 'undefined age → unknown');
  assert(D.freshnessState(NaN,       FRED_CFG) === 'unknown', 'NaN age → unknown');
});

test('null / missing config → fresh (when age is finite)', function () {
  assert(D.freshnessState(0,    null)      === 'fresh', 'no config → fresh');
  assert(D.freshnessState(WEEK, undefined) === 'fresh', 'undefined config → fresh');
  assert(D.freshnessState(WEEK, {})        === 'fresh', 'empty config → fresh');
});

test('FRED cadence — fresh under 7 days', function () {
  assert(D.freshnessState(0,           FRED_CFG) === 'fresh', '0ms → fresh');
  assert(D.freshnessState(DAY,         FRED_CFG) === 'fresh', '1 day → fresh');
  assert(D.freshnessState(6 * DAY,     FRED_CFG) === 'fresh', '6 days → fresh');
  assert(D.freshnessState(7 * DAY - 1, FRED_CFG) === 'fresh', '6.99 days → fresh');
});

test('FRED cadence — aging from 7 to 30 days', function () {
  assert(D.freshnessState(7 * DAY,      FRED_CFG) === 'aging', '7 days → aging');
  assert(D.freshnessState(15 * DAY,     FRED_CFG) === 'aging', '15 days → aging');
  assert(D.freshnessState(30 * DAY - 1, FRED_CFG) === 'aging', '29.99 days → aging');
});

test('FRED cadence — stale at 30+ days', function () {
  assert(D.freshnessState(30 * DAY,     FRED_CFG) === 'stale', '30 days → stale');
  assert(D.freshnessState(90 * DAY,     FRED_CFG) === 'stale', '90 days → stale');
});

test('CHFA cadence — different thresholds, same logic', function () {
  assert(D.freshnessState(7  * DAY, CHFA_CFG) === 'fresh', '7 days → fresh (CHFA aging is 14d)');
  assert(D.freshnessState(14 * DAY, CHFA_CFG) === 'aging', '14 days → aging');
  assert(D.freshnessState(60 * DAY, CHFA_CFG) === 'stale', '60 days → stale');
});

test('only aging threshold defined → stale boundary not enforced', function () {
  const cfg = { agingThresholdMs: 7 * DAY }; // no staleThresholdMs
  assert(D.freshnessState(6 * DAY, cfg)   === 'fresh', '6 days → fresh');
  assert(D.freshnessState(8 * DAY, cfg)   === 'aging', '8 days → aging');
  assert(D.freshnessState(365 * DAY, cfg) === 'aging', 'no stale threshold → never stale');
});

test('only stale threshold defined → fresh until stale', function () {
  const cfg = { staleThresholdMs: 30 * DAY }; // no agingThresholdMs
  assert(D.freshnessState(0,           cfg) === 'fresh', '0 → fresh');
  assert(D.freshnessState(20 * DAY,    cfg) === 'fresh', '20 days → fresh (no aging threshold)');
  assert(D.freshnessState(30 * DAY,    cfg) === 'stale', '30 days → stale');
});

test('zero / negative thresholds are ignored (treated as not set)', function () {
  const cfg = { agingThresholdMs: 0, staleThresholdMs: -100 };
  assert(D.freshnessState(WEEK, cfg) === 'fresh', 'zero/negative thresholds → fresh');
});

test('boundary exactly at staleThresholdMs is stale (not aging)', function () {
  const cfg = { agingThresholdMs: 7 * DAY, staleThresholdMs: 30 * DAY };
  assert(D.freshnessState(30 * DAY, cfg) === 'stale', 'exact boundary → stale (≥, not >)');
});

console.log('\n' + '='.repeat(50));
console.log('Results:', passed, 'passed,', failed, 'failed');
process.exit(failed > 0 ? 1 : 0);
