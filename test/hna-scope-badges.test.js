'use strict';
/**
 * test/hna-scope-badges.test.js
 *
 * Validates the scope-badge helpers in js/hna/hna-comparison.js:
 *   - _scopeBadge: produces a labeled span for county/city/CDP/state
 *   - _scopeNote: surfaces the CDP advisory note when applicable
 *
 * The badges are how users distinguish a county-vs-city comparison
 * from an apples-to-apples city-vs-city comparison.
 *
 * Run: node test/hna-scope-badges.test.js
 */

const { JSDOM } = require('jsdom');
const dom = new JSDOM('<!DOCTYPE html><body></body>', { url: 'http://localhost/' });
global.document = dom.window.document;
global.window   = dom.window;
global.location = dom.window.location;

// hna-comparison.js depends on a few window-level helpers — stub minimally
window.HNARanking  = { _get: function () { return null; }, getScorecardData: function () { return {}; } };
window.HNAUtils    = window.HNAUtils || {};
window.HNAState    = { state: {} };
// Aliased on global so the auto-init setTimeout doesn't ReferenceError
global.HNARanking  = window.HNARanking;
global.HNAComparison = null;

require('../js/hna/hna-comparison.js');
const C = window.HNAComparison;

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { console.log('  ✅ PASS:', msg); passed++; }
  else       { console.error('  ❌ FAIL:', msg); failed++; }
}
function test(name, fn) {
  console.log('\n[test]', name);
  try { fn(); } catch (e) { console.error('  ❌ FAIL: threw —', e.message); failed++; }
}

test('API exposed', function () {
  assert(typeof C._scopeBadge === 'function', '_scopeBadge exposed');
  assert(typeof C._scopeNote  === 'function', '_scopeNote exposed');
});

test('_scopeBadge — county type renders "County" badge', function () {
  const html = C._scopeBadge('county');
  assert(html.indexOf('>County<') > -1, 'badge contains "County" label');
  assert(html.indexOf('class="hca-cp-scope-badge"') > -1, 'has scope-badge class');
});

test('_scopeBadge — place type renders "City" (not "Place")', function () {
  const html = C._scopeBadge('place');
  assert(html.indexOf('>City<') > -1, 'place type renders as "City"');
});

test('_scopeBadge — cdp type renders "CDP" badge', function () {
  const html = C._scopeBadge('cdp');
  assert(html.indexOf('>CDP<') > -1, 'cdp type renders as "CDP"');
});

test('_scopeBadge — town type renders "Town"', function () {
  const html = C._scopeBadge('town');
  assert(html.indexOf('>Town<') > -1, 'town type renders as "Town"');
});

test('_scopeBadge — state type renders "State"', function () {
  const html = C._scopeBadge('state');
  assert(html.indexOf('>State<') > -1, 'state type renders as "State"');
});

test('_scopeBadge — handles undefined / null / empty', function () {
  // Should produce a benign fallback, not throw
  assert(typeof C._scopeBadge(undefined) === 'string', 'undefined → string');
  assert(typeof C._scopeBadge(null)      === 'string', 'null → string');
  assert(typeof C._scopeBadge('')        === 'string', '"" → string');
});

test('_scopeBadge — case-insensitive ("COUNTY", "County", "county" all equivalent)', function () {
  // Strip the inline style + class for comparison; just confirm same label
  function _label(html) {
    const m = html.match(/>([^<]+)<\/span>/);
    return m ? m[1] : null;
  }
  assert(_label(C._scopeBadge('county')) === _label(C._scopeBadge('County')),
    'lowercase / titlecase match');
  assert(_label(C._scopeBadge('COUNTY')) === _label(C._scopeBadge('county')),
    'uppercase normalizes');
});

test('_scopeNote — CDP gets an advisory note', function () {
  const note = C._scopeNote('cdp');
  assert(typeof note === 'string',                            'cdp returns a note');
  assert(note.toLowerCase().indexOf('census-designated') > -1, 'note mentions Census-Designated');
  assert(note.toLowerCase().indexOf('not a legal') > -1,       'note explains it\'s not a legal jurisdiction');
});

test('_scopeNote — non-CDP types return null (no note)', function () {
  assert(C._scopeNote('county') === null, 'county → null');
  assert(C._scopeNote('place')  === null, 'place → null');
  assert(C._scopeNote('state')  === null, 'state → null');
  assert(C._scopeNote('town')   === null, 'town → null');
});

test('_scopeNote — null/undefined input returns null safely', function () {
  assert(C._scopeNote(null)      === null, 'null → null');
  assert(C._scopeNote(undefined) === null, 'undefined → null');
  assert(C._scopeNote('')        === null, '"" → null');
});

test('color coding differs by type (visual differentiation)', function () {
  // Each type should produce a different background color so users can
  // visually distinguish in the comparison panel
  const countyColors = C._scopeBadge('county');
  const placeColors  = C._scopeBadge('place');
  const cdpColors    = C._scopeBadge('cdp');
  // Extract background-color tokens
  function _bg(html) {
    const m = html.match(/background:([^;]+);/);
    return m ? m[1].trim() : '';
  }
  const cBg = _bg(countyColors);
  const pBg = _bg(placeColors);
  const dBg = _bg(cdpColors);
  assert(cBg !== pBg, 'county and place have different backgrounds');
  assert(pBg !== dBg, 'place and CDP have different backgrounds');
  assert(cBg !== dBg, 'county and CDP have different backgrounds');
});

console.log('\n' + '='.repeat(50));
console.log('Results:', passed, 'passed,', failed, 'failed');
// hna-comparison.js sets a setTimeout for auto-init that requires DOM
// elements not present in the test env — exit cleanly so the auto-init
// doesn't keep the process alive.
process.exit(failed > 0 ? 1 : 0);
