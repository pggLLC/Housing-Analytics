#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

function readJson(relPath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relPath), 'utf8'));
}

function zpad(value, width) {
  return String(value || '').padStart(width, '0');
}

const registry = readJson('data/hna/geography-registry.json');
const crossCounty = readJson('data/hna/cross-county-places.json');

const registryByGeoid = new Map();
for (const geo of registry.geographies || []) {
  if (geo && (geo.type === 'place' || geo.type === 'cdp')) {
    registryByGeoid.set(zpad(geo.geoid, 7), geo);
  }
}

const crossCountyPlaces = crossCounty.places || {};
let checked = 0;

for (const [geoidRaw, place] of Object.entries(crossCountyPlaces)) {
  if (!place || !place.primary_county) continue;

  const geoid = zpad(geoidRaw, 7);
  const registryPlace = registryByGeoid.get(geoid);
  assert.ok(registryPlace, `cross-county place ${geoid} must exist in geography-registry.json`);

  const registryCounty = zpad(registryPlace.containingCounty, 5);
  const primaryCounty = zpad(place.primary_county, 5);
  assert.equal(
    registryCounty,
    primaryCounty,
    `${geoid} ${place.name || registryPlace.name}: registry containingCounty ${registryCounty} must match cross-county primary_county ${primaryCounty}`,
  );
  checked += 1;
}

const strasburg = registryByGeoid.get('0874375');
assert.ok(strasburg, 'Strasburg CDP 0874375 exists in geography-registry.json');
assert.equal(
  zpad(strasburg.containingCounty, 5),
  '08001',
  'Strasburg CDP 0874375 containingCounty is Adams County (08001)',
);

assert.ok(checked > 0, 'cross-county consistency guard checked at least one place');

console.log(`registry-cross-county-consistency: PASS (${checked} cross-county places checked)`);
