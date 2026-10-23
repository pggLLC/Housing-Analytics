'use strict';
// The walkability map layer must cover every EPA SLD block group the PMA
// analysis scores. The layer it replaced had 1,070 tract points (179 tracts
// missing, 29 in Denver) and transit/bike scores that are not EPA fields.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (p) => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));

const layer = read('data/market/walkability_co.geojson');
const sld = read('data/market/epa_sld_co.json');
const groups = Object.keys(sld.blockGroups);

assert.strictEqual(layer.features.length, groups.length, 'one point per EPA SLD block group');
const ids = new Set(layer.features.map((f) => f.properties.geoid));
assert.strictEqual(ids.size, groups.length, 'no duplicate block groups');
groups.forEach((g) => assert(ids.has(g), 'block group ' + g + ' is on the map layer'));

layer.features.forEach((f) => {
  const p = f.properties;
  assert(!('transit_score' in p) && !('bike_score' in p), 'no unsourced transit or bike score on ' + p.geoid);
  assert(p.walkability_index >= 1 && p.walkability_index <= 20, 'NatWalkInd is 1-20 on ' + p.geoid);
  assert.strictEqual(p.walk_score, Math.round((p.walkability_index - 1) / 19 * 100), 'walk_score is NatWalkInd rescaled on ' + p.geoid);
  const [lon, lat] = f.geometry.coordinates;
  assert(lon > -109.1 && lon < -102 && lat > 36.9 && lat < 41.1, 'point is in Colorado for ' + p.geoid);
});

const browser = fs.readFileSync(path.join(root, 'data-map-browser.html'), 'utf8');
assert(!/p\.transit_score|p\.bike_score/.test(browser), 'data map browser no longer shows transit or bike scores');

console.log('walkability-layer: PASS (' + layer.features.length + ' block groups)');
