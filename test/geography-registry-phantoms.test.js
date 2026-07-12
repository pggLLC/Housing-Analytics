#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const registry = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'data', 'hna', 'geography-registry.json'), 'utf8')
);
const lookup = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'data', 'hna', 'derived', 'place_county_lookup.json'), 'utf8')
);
const phantomAliases = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'data', 'hna', 'place-phantom-aliases.json'), 'utf8')
);
const boundaries = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'data', 'co-place-boundaries.geojson'), 'utf8')
);

let checks = 0;
let failures = 0;

function report(ok, message) {
  checks += 1;
  if (!ok) {
    failures += 1;
    console.error(`FAIL: ${message}`);
    return;
  }
  console.log(`PASS: ${message}`);
}

function sorted(values) {
  return Array.from(values).sort();
}

const authorityGeoids = new Set();
for (const feature of boundaries.features || []) {
  const geoid = feature && feature.properties && feature.properties.geoid;
  if (typeof geoid === 'string' && geoid) {
    authorityGeoids.add(geoid);
  }
}

const placeRows = registry.geographies.filter(geo => geo.type === 'place' || geo.type === 'cdp');
const registryGeoids = new Set(placeRows.map(geo => geo.geoid));
const lookupGeoids = new Set(Object.keys(lookup.places || {}));
const duplicateGeoids = registry.geographies
  .map(geo => geo.geoid)
  .filter((geoid, index, all) => all.indexOf(geoid) !== index);

console.log('\nGeography registry phantom-GEOID guard');

report(
  /TIGERweb/i.test((boundaries.metadata && boundaries.metadata.source) || ''),
  'offline authority declares Census TIGERweb as its source'
);
report(
  authorityGeoids.size >= 480,
  `offline authority is non-vacuous (${authorityGeoids.size} place/CDP GEOIDs)`
);

for (const geoid of ['0843110', '0804000', '0803620', '0830780', '0811810']) {
  report(authorityGeoids.has(geoid), `offline authority contains known current GEOID ${geoid}`);
}
report(!authorityGeoids.has('0831400'), 'offline authority excludes phantom GEOID 0831400');

const missingFromAuthority = placeRows
  .filter(geo => !authorityGeoids.has(geo.geoid))
  .map(geo => `${geo.geoid} ${geo.name} (${geo.type})`);
report(
  missingFromAuthority.length === 0,
  `all ${placeRows.length} registry place/CDP rows exist in the offline authority`
);
if (missingFromAuthority.length) {
  console.error(missingFromAuthority.join('\n'));
}

report(duplicateGeoids.length === 0, 'registry GEOIDs are unique');
if (duplicateGeoids.length) {
  console.error(sorted(new Set(duplicateGeoids)).join('\n'));
}

report(!registryGeoids.has('0831400'), 'registry excludes phantom GEOID 0831400');
report(!Object.prototype.hasOwnProperty.call(phantomAliases.aliases || {}, '0831400'), 'phantom alias map excludes retired Lamar GEOID 0831400');

const lookupMissing = sorted(registryGeoids).filter(geoid => !lookupGeoids.has(geoid));
const lookupExtras = sorted(lookupGeoids).filter(geoid => !registryGeoids.has(geoid));
report(lookupMissing.length === 0, 'place_county_lookup covers every registry place/CDP');
if (lookupMissing.length) {
  console.error(lookupMissing.join('\n'));
}
report(lookupExtras.length === 0, 'place_county_lookup has no removed/phantom place GEOIDs');
if (lookupExtras.length) {
  console.error(lookupExtras.join('\n'));
}
report(lookup.meta && lookup.meta.count === placeRows.length, 'place_county_lookup meta.count matches registry place/CDP count');

console.log(`\nGeography registry phantom-GEOID guard: ${checks - failures} passed, ${failures} failed`);
if (failures) {
  process.exit(1);
}
