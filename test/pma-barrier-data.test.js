#!/usr/bin/env node
// Regression guards for #1232 C1 barrier-data completion.

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
}

function geoidOf(feature) {
  const p = feature && feature.properties;
  return p && (p.GEOID || p.geoid || p.GEOID20 || p.tract_geoid);
}

const barriers = readJson('data/market/natural_barriers_co.geojson');
const display = readJson('data/market/pma_tract_display_geometry.geojson');
const fixture = readJson('test/fixtures/pma/fruita-mews-calibration.json');

assert.equal(barriers.type, 'FeatureCollection', 'barrier artifact is a GeoJSON FeatureCollection');
assert(barriers.features.length > 10000, `barrier artifact is non-vacuous (${barriers.features.length} features)`);

const highwayFeatures = barriers.features.filter((feature) => (feature.properties || {}).barrier_type === 'highway');
const routeSigns = new Set(highwayFeatures.map((feature) => (feature.properties || {}).route_sign).filter(Boolean));
assert(routeSigns.has('I'), 'barrier artifact includes interstate route_sign I');
assert(routeSigns.has('U'), 'barrier artifact includes normalized U.S. route_sign U');

const riverFeatures = barriers.features.filter((feature) => {
  const props = feature.properties || {};
  const geom = feature.geometry || {};
  return props.barrier_type === 'water' &&
    props.sub_type === 'river' &&
    (geom.type === 'LineString' || geom.type === 'MultiLineString');
});
assert(riverFeatures.length > 0, 'barrier artifact includes named river LineStrings');
assert(riverFeatures.some((feature) => /Colorado|Arkansas|Gunnison|Yampa/.test((feature.properties || {}).name || '')),
  'river guard is non-vacuous for major Colorado named rivers');

const routeSignCounts = barriers.meta && barriers.meta.route_sign_counts;
assert(routeSignCounts && routeSignCounts.I > 0 && routeSignCounts.U > 0,
  'barrier metadata records both I and U route-sign counts');
assert(barriers.meta.river_line_features === riverFeatures.length,
  'barrier metadata river_line_features matches actual river LineStrings');

const shrink = barriers.meta && barriers.meta.shrink_guard;
assert(shrink && shrink.prior_highway_features >= 10084, 'shrink guard records prior highway feature floor');
assert(shrink && shrink.prior_areal_water_features >= 1091, 'shrink guard records prior areal-water feature floor');
assert(highwayFeatures.length >= Math.floor(shrink.prior_highway_features * (1 - shrink.tolerance)),
  'highway count stays within shrink-guard tolerance of prior vintage');
assert(
  (barriers.meta.areal_water_features || 0) >= Math.floor(shrink.prior_areal_water_features * (1 - shrink.tolerance)),
  'areal water count stays within shrink-guard tolerance of prior vintage'
);

assert.equal(display.meta.point_on_surface.includes('Computed at build time'), true,
  'display geometry documents build-time point_on_surface derivation');
assert(display.features.length > 1000, 'display geometry is non-vacuous');
for (const feature of display.features) {
  const point = feature.properties && feature.properties.point_on_surface;
  assert(point, `display tract ${geoidOf(feature)} exposes point_on_surface`);
  assert(Number.isFinite(point.lon), `display tract ${geoidOf(feature)} point_on_surface.lon is numeric`);
  assert(Number.isFinite(point.lat), `display tract ${geoidOf(feature)} point_on_surface.lat is numeric`);
  assert(point.lon >= -109.2 && point.lon <= -102.0, `display tract ${geoidOf(feature)} point lon is inside Colorado envelope`);
  assert(point.lat >= 36.9 && point.lat <= 41.1, `display tract ${geoidOf(feature)} point lat is inside Colorado envelope`);
}

assert.equal(fixture.production_use, false, 'Fruita calibration fixture is explicitly non-production');
assert.equal(fixture.source_doc, 'docs/audits/CALIBRATION-FRUITA-MEWS-PMA-2026-07.md',
  'Fruita fixture points to the calibration doc');
assert.deepStrictEqual(
  [...fixture.professional_pma.tract_geoids_2020].sort(),
  ['08077000900', '08077001402', '08077001403', '08077001404',
   '08077001502', '08077001503', '08077001504', '08077001600'],
  'Fruita professional PMA fixture pins the exact CHFA-approved 8-tract set'
);
assert.deepEqual(
  fixture.tool_buffer_current_main.tract_geoids,
  ['08077001503', '08077001504'],
  'Fruita current-tool fixture pins the 2-tract buffer set'
);
assert.equal(fixture.tool_buffer_current_main.tool_only_count, 0,
  'Fruita fixture pins zero current-tool false inclusions');

const scoringSource = fs.readFileSync(path.join(ROOT, 'js/market-analysis-scoring.js'), 'utf8');
assert(!scoringSource.includes('natural_barriers_co.geojson'), 'C1 does not wire barriers into PMA scoring');
assert(!scoringSource.includes('point_on_surface'), 'C1 representative points do not affect PMA scoring');

console.log('pma-barrier-data: PASS');
