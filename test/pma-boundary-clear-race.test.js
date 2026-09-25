'use strict';

// A PMA boundary cleared for a new site stays cleared.
//
// Found 2026-09-25: site-audit's PMA flow failed intermittently with "the
// previous site's PMA boundary stayed on the map for the new site". The
// included-tract fills draw after an async geometry load, so a draw started
// before removeAllBoundaries() could land after it and put the old site's PMA
// back under the new marker. This holds the ordering without a browser: the
// geometry fetch is held open across the clear, then released.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'pma-delineation.js'), 'utf8');

function load() {
  let release;
  const fetchCalls = [];
  const layer = () => ({ addTo() { return this; }, bindTooltip() { return this; } });
  const window = {
    L: { circle: layer, geoJSON: layer },
    fetch(url) {
      fetchCalls.push(url);
      return new Promise((resolve) => { release = () => resolve({ ok: true, json: () => ({
        type: 'FeatureCollection',
        features: [{ type: 'Feature', properties: { GEOID: '08077000100' }, geometry: { type: 'Point', coordinates: [0, 0] } }],
      }) }); });
    },
  };
  window.window = window;
  vm.runInNewContext(src, window);
  return { D: window.PMADelineation, release: () => release(), fetchCalls };
}

const map = { removeLayer() {} };
const tracts = [{ geoid: '08077000100', share: 1 }];
let failures = 0;
async function test(name, fn) {
  try { await fn(); console.log('  ✓ ' + name); }
  catch (e) { failures += 1; console.log('  ✗ ' + name + ' — ' + e.message); }
}

(async () => {
  console.log('\nA cleared PMA boundary stays cleared');

  await test('a draw with nothing in between lands (the scan below can fail)', async () => {
    const { D, release, fetchCalls } = load();
    const p = D.renderPmaLayer(map, 39.16, -108.73, 3, tracts);
    assert.strictEqual(fetchCalls.length, 1, 'the geometry was never requested');
    release(); await p;
    assert(D.getLastPmaPolygon(), 'an uninterrupted draw drew nothing');
  });

  await test('a draw in flight when the boundaries are cleared does not land after the clear', async () => {
    const { D, release } = load();
    const p = D.renderPmaLayer(map, 39.16, -108.73, 3, tracts);
    D.removeAllBoundaries(map);
    release(); await p;
    assert.strictEqual(D.getLastPmaPolygon(), null, "the previous site's PMA came back after the clear");
  });

  await test('a newer draw supersedes an older one still loading', async () => {
    const { D, release } = load();
    const older = D.renderPmaLayer(map, 39.16, -108.73, 3, tracts);
    const newer = D.renderPmaLayer(map, 39.06, -108.55, 3, [{ geoid: '08077000100', share: 0.5 }]);
    release(); await Promise.all([older, newer]);
    const fc = D.getLastPmaPolygon();
    assert(fc && fc.features[0].properties.pma_weight === 0.5, 'the older draw overwrote the newer one');
  });

  console.log(failures ? `\n${failures} failure(s)` : '\nAll checks passed ✅');
  process.exit(failures ? 1 : 0);
})();
