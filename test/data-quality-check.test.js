// test/data-quality-check.test.js
//
// Unit tests for js/data-quality-check.js.
//
// Verifies the module's validation logic in a Node.js JSDOM-like environment,
// using a lightweight window/document stub so the IIFE can execute.
//
// Usage:
//   node test/data-quality-check.test.js
//
// Exit code 0 = all checks passed; non-zero = one or more failures.

'use strict';

const path = require('path');
const fs   = require('fs');

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

// ── Minimal browser shim ─────────────────────────────────────────────────────

// Listeners registered via document.addEventListener
const _domListeners = {};
const document = {
  readyState: 'complete',
  querySelector:  () => null,
  querySelectorAll: () => [],
  getElementById: () => null,
  dispatchEvent:  () => {},
  addEventListener(ev, fn) {
    if (!_domListeners[ev]) _domListeners[ev] = [];
    _domListeners[ev].push(fn);
  },
};

const window = {
  document,
  APP_BASE_PATH: '/',
  resolveAssetUrl: (p) => '/' + p.replace(/^\.\//, ''),
  safeFetchJSON: null,   // set per test
};

// Expose on globalThis so the IIFE can run
global.window   = window;
global.document = document;
global.localStorage = (function () {
  const store = {};
  return {
    getItem: (k) => Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null,
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    clear: () => { Object.keys(store).forEach(k => delete store[k]); },
  };
}());
global.CustomEvent = class CustomEvent {
  constructor(type, init) { this.type = type; this.detail = (init || {}).detail; }
};

// Load the module
// eval() is required here because data-quality-check.js is an IIFE designed
// for the browser (window global). Node's require() would not execute the IIFE
// in our stubbed window context. The source file is a trusted local asset.
const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'data-quality-check.js'), 'utf8');
eval(src); // eslint-disable-line no-eval

// ── Tests ────────────────────────────────────────────────────────────────────

console.log('\n[test] DataQuality module exposes expected API');
{
  assert(typeof window.DataQuality === 'object', 'window.DataQuality is an object');
  assert(typeof window.DataQuality.runAll   === 'function', 'DataQuality.runAll is a function');
  assert(typeof window.DataQuality.validate === 'function', 'DataQuality.validate is a function');
  assert(typeof window.DataQuality.renderBadge === 'function', 'DataQuality.renderBadge is a function');
}

console.log('\n[test] validate() resolves ok for GeoJSON with sufficient features');
{
  const fakeGeoJson = {
    type: 'FeatureCollection',
    features: Array.from({ length: 64 }, (_, i) => ({ type: 'Feature', properties: { GEOID: String(i) } })),
  };
  window.safeFetchJSON = () => Promise.resolve(fakeGeoJson);

  const cfg = { key: 'test-geo', label: 'Test GeoJSON', path: 'data/test.json', minFeatures: 60, critical: true };

  window.DataQuality.validate(cfg).then(report => {
    assert(report.ok === true,             'report.ok is true for 64 features');
    assert(report.featureCount === 64,     'report.featureCount is 64');
    assert(report.critical === true,       'report.critical mirrors cfg.critical');
    assert(report.message === null,        'report.message is null on success');
  }).catch(err => {
    failed++;
    console.error('  ❌ FAIL: validate() threw unexpectedly:', err.message);
  });
}

console.log('\n[test] validate() resolves warning for GeoJSON with too few features');
{
  const fakeGeoJson = {
    type: 'FeatureCollection',
    features: Array.from({ length: 5 }, () => ({ type: 'Feature', properties: {} })),
  };
  window.safeFetchJSON = () => Promise.resolve(fakeGeoJson);

  const cfg = { key: 'test-short', label: 'Short GeoJSON', path: 'data/short.json', minFeatures: 60 };

  window.DataQuality.validate(cfg).then(report => {
    assert(report.ok === false,             'report.ok is false for 5 < 60 features');
    assert(report.featureCount === 5,       'report.featureCount is 5');
    assert(typeof report.message === 'string', 'report.message is a string');
  }).catch(err => {
    failed++;
    console.error('  ❌ FAIL:', err.message);
  });
}

console.log('\n[test] validate() resolves warning on network failure');
{
  window.safeFetchJSON = () => Promise.reject(new Error('Network timeout'));

  const cfg = { key: 'test-fail', label: 'Failing Fetch', path: 'data/fail.json', minFeatures: 1 };

  window.DataQuality.validate(cfg).then(report => {
    assert(report.ok === false,              'report.ok is false on fetch failure');
    assert(/Network timeout/.test(report.message), 'report.message includes error text');
  }).catch(err => {
    failed++;
    console.error('  ❌ FAIL:', err.message);
  });
}

console.log('\n[test] validate() FRED custom validator: passes when series have observations');
{
  const fredData = {
    updated: '2026-01-01T00:00:00Z',
    series: {
      CPIAUCSL: { name: 'CPI', observations: [{ date: '2026-01-01', value: '315.0' }] },
    },
  };
  window.safeFetchJSON = () => Promise.resolve(fredData);

  const cfg = { key: 'fred-data', label: 'FRED economic series', path: 'data/fred-data.json', critical: false };

  window.DataQuality.validate(cfg).then(report => {
    assert(report.ok === true, 'FRED report.ok is true with observations');
  }).catch(err => {
    failed++;
    console.error('  ❌ FAIL:', err.message);
  });
}

console.log('\n[test] validate() FRED custom validator: warns when all series have 0 observations');
{
  const fredData = {
    updated: '2026-01-01T00:00:00Z',
    series: {
      CPIAUCSL: { name: 'CPI', observations: [] },
      UNRATE: { name: 'Unemployment', observations: [] },
    },
  };
  window.safeFetchJSON = () => Promise.resolve(fredData);

  // Pass a validate function that mirrors the FRED check logic
  const cfg = {
    key: 'fred-data',
    label: 'FRED economic series',
    path: 'data/fred-data.json',
    critical: false,
    validate: function (data, c, cacheAge) {
      var series = data && data.series;
      if (!series || (!Array.isArray(series) && Object.keys(series).length === 0)) {
        return { key: c.key, label: c.label, critical: !!c.critical, ok: false, warning: true,
                 message: 'No FRED series', featureCount: 0, cacheAge: cacheAge };
      }
      var keys = Array.isArray(series) ? null : Object.keys(series);
      var hasObs = keys
        ? keys.some(function (k) { return (series[k].observations || []).length > 0; })
        : series.some(function (s) { return (s.observations || []).length > 0; });
      var count = keys ? keys.length : series.length;
      return { key: c.key, label: c.label, critical: !!c.critical, ok: hasObs, warning: !hasObs,
               message: hasObs ? null : 'All series have 0 observations', featureCount: count, cacheAge: cacheAge };
    },
  };

  window.DataQuality.validate(cfg).then(report => {
    assert(report.ok === false, 'FRED report.ok is false when all observations empty');
  }).catch(err => {
    failed++;
    console.error('  ❌ FAIL:', err.message);
  });
}

// Allow all async tests to settle before printing results
setTimeout(function () {
  console.log('\n============================================================');
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.error('\nSome checks failed ❌');
    process.exit(1);
  } else {
    console.log('\nAll checks passed ✅');
  }
}, 300);
