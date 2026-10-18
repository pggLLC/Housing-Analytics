#!/usr/bin/env node
/**
 * Tract-point layers must put each point inside its own tract.
 *
 * employment_centers_co.geojson and environmental_constraints_co.geojson are
 * one point per census tract. Until scripts/market/place_tract_points.py, no
 * point sat at its own tract: the median was 138 mi away, and La Plata County
 * (08067) tracts were drawn near Trinidad, so Market Analysis showed the wrong
 * job centres and EJI scores for any site. Nothing compared the points with
 * the tract they name.
 *
 * Each point must lie within its tract's TIGER bbox from
 * data/market/tract_centroids_co.json (padded 0.01 deg for rounding).
 */
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (p) => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));
const tracts = new Map(read('data/market/tract_centroids_co.json').tracts.map((t) => [t.geoid, t]));
const PAD = 0.01;
let failures = 0;

for (const file of [
  'data/market/employment_centers_co.geojson',
  'data/market/environmental_constraints_co.geojson',
]) {
  const bad = [];
  const feats = read(file).features;
  for (const f of feats) {
    const geoid = f.properties && f.properties.geoid;
    const t = tracts.get(geoid);
    const [lon, lat] = f.geometry.coordinates;
    if (!t) { bad.push(`${geoid}: not a 2020 tract`); continue; }
    const [w, s, e, n] = t.bbox;
    if (lon < w - PAD || lon > e + PAD || lat < s - PAD || lat > n + PAD) {
      bad.push(`${geoid}: [${lon}, ${lat}] outside its tract bbox`);
    }
  }
  if (bad.length) {
    failures += bad.length;
    console.error(`FAIL ${file}: ${bad.length} of ${feats.length} points misplaced, e.g.\n  ${bad.slice(0, 5).join('\n  ')}`);
  } else {
    console.log(`ok   ${file}: ${feats.length} points inside their own tracts`);
  }
}

// The case that exposed this: Bayfield's tract, 08067970602.
const bay = read('data/market/employment_centers_co.geojson').features
  .find((f) => f.properties.geoid === '08067970602');
if (!bay || bay.geometry.coordinates[0] > -107) {
  failures += 1;
  console.error('FAIL La Plata tract 08067970602 is not in La Plata County');
}

if (failures) process.exit(1);
