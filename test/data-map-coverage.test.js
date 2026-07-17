#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'data-map-browser.html'), 'utf8');

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile() && entry.name.endsWith('.geojson')) out.push(full);
  }
  return out;
}

function relDataPath(full) {
  return path.relative(ROOT, full).replaceAll(path.sep, '/');
}

function extractRegisteredGeojson() {
  const urls = new Set();
  const re = /url:\s*['"](data\/[^'"]+\.geojson)['"]/g;
  let match;
  while ((match = re.exec(html))) urls.add(match[1]);
  return urls;
}

function extractExclusions() {
  const start = html.indexOf('const DATA_MAP_GEOJSON_EXCLUSIONS = {');
  assert(start >= 0, 'Data Map declares explicit GeoJSON exclusions');
  const end = html.indexOf('};', start);
  assert(end > start, 'Data Map exclusions object is closed');
  const block = html.slice(start, end);
  const exclusions = new Map();
  const re = /['"](data\/[^'"]+\.geojson)['"]:\s*['"]([^'"]{12,})['"]/g;
  let match;
  while ((match = re.exec(block))) exclusions.set(match[1], match[2]);
  return exclusions;
}

const geojsonFiles = walk(path.join(ROOT, 'data')).map(relDataPath).sort();
const registered = extractRegisteredGeojson();
const exclusions = extractExclusions();

assert(geojsonFiles.length >= 25, `geojson discovery is non-vacuous (${geojsonFiles.length} files)`);
assert(registered.size >= 25, `Data Map has a non-vacuous layer registry (${registered.size} GeoJSON layers)`);
assert(exclusions.size >= 3, `Data Map exclusions are non-vacuous (${exclusions.size} paths)`);

const missing = geojsonFiles.filter((p) => !registered.has(p) && !exclusions.has(p));
assert.deepStrictEqual(missing, [], `GeoJSON files must be registered or excluded with reason: ${missing.join(', ')}`);

for (const [file, reason] of exclusions) {
  assert(fs.existsSync(path.join(ROOT, file)), `${file} exclusion points at a real file`);
  assert(reason.length >= 12, `${file} exclusion has a real reason`);
}

[
  'data/market/flood_zones_co.geojson',
  'data/market/hud_lihtc_co.geojson',
  'data/market/commuting_co.geojson',
  'data/market/utility_capacity_co.geojson',
  'data/market/environmental_constraints_co.geojson',
  'data/market/natural_barriers_co.geojson',
  'data/market/housing_policy_jurisdictions_co.geojson',
  'data/market/hud_egis_co.geojson',
  'data/amenities/retail_nodes_co.geojson',
  'data/market/landuse_zoning_proxy_co.geojson',
].forEach((file) => {
  assert(registered.has(file), `${file} is registered as a Data Map layer`);
});

assert(html.includes('click to load'), 'lazy layer count affordance says click to load');
assert(!/id="dmb-count-[^"]+">—<\/span>/.test(html), 'pre-load layer counts do not render as a dash placeholder');

const sabotagedRegistered = new Set(registered);
sabotagedRegistered.delete('data/market/flood_zones_co.geojson');
const sabotagedMissing = geojsonFiles.filter((p) => !sabotagedRegistered.has(p) && !exclusions.has(p));
assert(
  sabotagedMissing.includes('data/market/flood_zones_co.geojson'),
  'non-vacuousness: removing a registered layer would fail coverage'
);

console.log('Data Map GeoJSON coverage: PASS');
