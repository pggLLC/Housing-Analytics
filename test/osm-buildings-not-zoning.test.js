'use strict';

/**
 * The OpenStreetMap layer in data/market/landuse_zoning_proxy_co.geojson shows
 * what people have mapped (apartments, townhomes, shops, industry). It is not
 * zoning. Its mf_suitability value is a fixed number per tag set in
 * scripts/market/build_osm_landuse.py (apartments 90, industrial 20), not a
 * measurement, so no page may show it as a score, and every label for the
 * layer must say "not zoning". Checked against town zoning maps 2026-11-05.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
let failures = 0;
function run(name, fn) {
  try { fn(); console.log('  ✓ ' + name); }
  catch (err) { failures += 1; console.error('  ✗ ' + name + '\n    ' + err.message); }
}

console.log('osm-buildings-not-zoning');

const page = read('market-analysis.html');
const js = read('js/market-analysis.js');
const browser = read('data-map-browser.html');

run('the market map toggle says it is not zoning', () => {
  const m = page.match(/id="pmaParcelZoningToggle"[^>]*>\s*([\s\S]*?)<\/label>/);
  assert.ok(m, 'toggle label not found');
  assert.match(m[1], /not zoning/i);
  assert.doesNotMatch(m[1], /suitability/i);
});

run('the market map tooltip shows no suitability score', () => {
  const start = js.indexOf("if (key === 'parcelZoning' && p.zone_proxy)");
  assert.ok(start > 0, 'tooltip block not found');
  const block = js.slice(start, js.indexOf('return;', start));
  assert.doesNotMatch(block, /mf_suitability/);
  assert.match(block, /not zoning/i);
});

run('marker size does not depend on the fixed suitability value', () => {
  const start = js.indexOf("if (key === 'parcelZoning' && fp.zone_proxy)");
  assert.ok(start > 0, 'styling block not found');
  const block = js.slice(start, js.indexOf('}', js.indexOf('ps.radius', start)));
  assert.doesNotMatch(block, /mf_suitability/);
});

run('the data map browser names the layer as not zoning', () => {
  const start = browser.indexOf("key: 'landuse-zoning'");
  assert.ok(start > 0, 'layer entry not found');
  const block = browser.slice(start, browser.indexOf('} },', start));
  assert.match(block, /not zoning/i);
  assert.doesNotMatch(block, /mf_suitability|MF suitability/);
});

if (failures) { console.error(failures + ' failed'); process.exit(1); }
