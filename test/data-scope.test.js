/**
 * test/data-scope.test.js — F248
 *
 * Unit tests for the place-vs-county masking helper.
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

// Load the browser module by reading + evaling against a stub window
const moduleSrc = fs.readFileSync(
  path.join(__dirname, '..', 'js', 'components', 'data-scope.js'),
  'utf8'
);
const win = { console: { warn: () => {} } };
new Function('window', 'console', moduleSrc)(win, win.console);
const DataScope = win.DataScope;

function run(name, fn) {
  try { fn(); console.log('  ✓ ' + name); }
  catch (err) { console.error('  ✗ ' + name + '\n    ' + err.message); process.exitCode = 1; }
}

console.log('DataScope — F248 place-vs-county helper');

// 1. Place hit when place data exists
run('returns place data when place key is present and not low-confidence', () => {
  const dataset = {
    '0815700': { value: 'Buena Vista', low_confidence: false },
    '08015':   { value: 'Chaffee County' }
  };
  const r = DataScope.lookup(dataset, '0815700', '08015');
  assert.strictEqual(r.scope, 'place');
  assert.strictEqual(r.value.value, 'Buena Vista');
  assert.strictEqual(r.isFallback, false);
  assert.strictEqual(r.confidence, 'high');
});

// 2. Falls back to county when place key is missing
run('falls back to county when no place key matches', () => {
  const dataset = { '08015': { value: 'Chaffee County' } };
  const r = DataScope.lookup(dataset, '0815700', '08015');
  assert.strictEqual(r.scope, 'county');
  assert.strictEqual(r.value.value, 'Chaffee County');
  assert.strictEqual(r.isFallback, true, 'must flag as fallback when place was requested but county was returned');
  assert.strictEqual(r.confidence, 'medium');
});

// 3. Place entry flagged low_confidence falls through to county
run('low_confidence place entries fall back to county', () => {
  const dataset = {
    '0815700': { value: 'tiny place', low_confidence: true },
    '08015':   { value: 'Chaffee County' }
  };
  const r = DataScope.lookup(dataset, '0815700', '08015');
  assert.strictEqual(r.scope, 'county');
  assert.strictEqual(r.value.value, 'Chaffee County');
  assert.strictEqual(r.isFallback, true);
});

// 4. countyOnly mode skips the place lookup entirely
run('countyOnly=true returns county without trying place', () => {
  const dataset = {
    '0815700': { value: 'unexpected place key' },
    '08015':   { value: 'Chaffee County' }
  };
  const r = DataScope.lookup(dataset, '0815700', '08015', { countyOnly: true });
  assert.strictEqual(r.scope, 'county');
  assert.strictEqual(r.value.value, 'Chaffee County');
  assert.strictEqual(r.isFallback, false, 'countyOnly tells the caller they explicitly asked for county data');
});

// 5. No data anywhere returns null cleanly
run('returns null when neither place nor county has data', () => {
  const r = DataScope.lookup({}, '0815700', '08015');
  assert.strictEqual(r.value, null);
  assert.strictEqual(r.scope, null);
  assert.strictEqual(r.confidence, null);
});

// 6. scopeBadge produces empty string for place scope (no disclosure needed)
run('scopeBadge returns "" for place scope (no pill)', () => {
  assert.strictEqual(DataScope.scopeBadge('place'), '');
  assert.strictEqual(DataScope.scopeBadge(null), '');
});

// 7. scopeBadge produces pill for county scope
run('scopeBadge produces warn-styled pill for county scope', () => {
  const html = DataScope.scopeBadge('county', { countyName: 'Chaffee County' });
  assert.ok(html.includes('via county'), 'should label as "via county"');
  assert.ok(html.includes('Chaffee'), 'should include county name minus "County" suffix');
  assert.ok(html.includes('ds-pill'), 'should have ds-pill class for CSS hook');
});

// 8. guardCountyOnly detects a county-keyed dataset
run('guardCountyOnly identifies a dataset with no 7-digit keys', () => {
  assert.strictEqual(DataScope.guardCountyOnly({ '08015': {}, '08031': {} }), true);
  assert.strictEqual(DataScope.guardCountyOnly({ '0815700': {}, '08015': {} }), false);
  assert.strictEqual(DataScope.guardCountyOnly({}), false);
  assert.strictEqual(DataScope.guardCountyOnly(null), false);
});

console.log('Done.');
