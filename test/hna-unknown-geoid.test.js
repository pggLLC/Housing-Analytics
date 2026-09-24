#!/usr/bin/env node
// test/hna-unknown-geoid.test.js
//
// An HNA address naming a geography that does not exist must say so. Until
// 2026-09-24, ?geoid=9999999 loaded nothing: blank stats, four 404s, the
// generic "select a geography" line, a banner naming the last saved
// jurisdiction. The registry lists all 546 geographies and is awaited before
// the restore block, so it is the validity check; on an unknown ID the page
// must not run its initial load, must clear the select, and must put a
// specific message in the waiting state.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'js', 'hna', 'hna-controller.js'), 'utf8');
const registry = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'hna', 'geography-registry.json'), 'utf8'));

let failures = 0;
function run(name, fn) {
  try { fn(); console.log('  ✓ ' + name); }
  catch (err) { failures += 1; console.error('  ✗ ' + name + '\n    ' + err.message); }
}

console.log('hna-unknown-geoid');

run('the registry is the validity check and lists every ranked geography', () => {
  assert.equal(registry.geographies.length, 546);
  assert.ok(registry.geographies.some((g) => g.geoid === '08077'), 'counties are in it');
  assert.ok(registry.geographies.some((g) => g.geoid === '0828745'), 'places are in it');
  assert.ok(!registry.geographies.some((g) => g.geoid === '9999999'), 'the test ID is not');
  assert.match(src, /!_registryHasGeoid\(restoredGeoId\)\) \{\s*unknownGeoid = String\(restoredGeoId\);/, 'an unknown restored ID is recognised via the registry');
});

run('an unknown ID clears the select, explains itself in the waiting state, and skips the initial load', () => {
  const block = src.slice(src.indexOf('let unknownGeoid = null;'), src.indexOf('_syncCombinedPanel();', src.indexOf('let unknownGeoid = null;')));
  assert.match(block, /geoSelect\.value = '';/, 'select cleared');
  assert.match(block, /No Colorado geography has the ID ' \+ unknownGeoid \+ '\. Choose a county, city, town or CDP above to load housing data\./, 'the message names the ID and what to do');
  assert.match(src, /ensureMap\(\);\s*\/\/[^\n]*\n\s*if \(!unknownGeoid\) update\(\);/, 'initial load skipped for an unknown ID');
});

run('regional, combined and state addresses are not treated as unknown', () => {
  const cond = /if \(restoredGeoId && restoredGeoType !== 'state' && !String\(restoredGeoId\)\.startsWith\('region:'\) && !_combined && !_registryHasGeoid\(restoredGeoId\)\)/;
  assert.match(src, cond, 'the check excludes state, region: and combined-member addresses');
});

if (failures) { console.error('hna-unknown-geoid: FAIL'); process.exitCode = 1; }
else console.log('hna-unknown-geoid: PASS');
