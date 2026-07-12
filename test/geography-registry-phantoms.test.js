#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const registry = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'data', 'hna', 'geography-registry.json'), 'utf8')
);
const geoConfig = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'data', 'hna', 'geo-config.json'), 'utf8')
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
const hnaUtilsSource = fs.readFileSync(path.join(ROOT, 'js', 'hna', 'hna-utils.js'), 'utf8');
const hnaControllerSource = fs.readFileSync(path.join(ROOT, 'js', 'hna', 'hna-controller.js'), 'utf8');

const REMOVED_PHANTOM_GEOIDS = [
  '0800775',
  '0803875',
  '0810270',
  '0812910',
  '0817320',
  '0820730',
  '0821735',
  '0822465',
  '0823680',
  '0824640',
  '0826145',
  '0827290',
  '0827565',
  '0830475',
  '0831400',
  '0832515',
  '0835250',
  '0841930',
  '0844380',
  '0852290',
  '0855745',
  '0857330',
  '0866500',
  '0866955',
  '0869985',
  '0873220',
  '0875140',
  '0875415',
  '0877580',
  '0882870',
  '0884330',
];

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
const removedInAuthority = REMOVED_PHANTOM_GEOIDS.filter(geoid => authorityGeoids.has(geoid));
report(removedInAuthority.length === 0, 'offline authority excludes all 31 removed phantom GEOIDs');
if (removedInAuthority.length) {
  console.error(removedInAuthority.join('\n'));
}

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

const removedInRegistry = REMOVED_PHANTOM_GEOIDS.filter(geoid => registryGeoids.has(geoid));
report(removedInRegistry.length === 0, 'registry excludes all 31 removed phantom GEOIDs');
if (removedInRegistry.length) {
  console.error(removedInRegistry.join('\n'));
}

const aliasMap = phantomAliases.aliases || {};
const missingAliases = REMOVED_PHANTOM_GEOIDS.filter(geoid => !Object.prototype.hasOwnProperty.call(aliasMap, geoid));
const aliasTargetsMissing = REMOVED_PHANTOM_GEOIDS
  .map(geoid => [geoid, aliasMap[geoid]])
  .filter(([, canonical]) => !canonical || !registry.geographies.some(geo => geo.geoid === canonical));
report(missingAliases.length === 0, 'phantom alias map covers all 31 removed phantom GEOIDs');
if (missingAliases.length) {
  console.error(missingAliases.join('\n'));
}
report(aliasTargetsMissing.length === 0, 'phantom alias targets are retained in the cleaned registry');
if (aliasTargetsMissing.length) {
  console.error(aliasTargetsMissing.map(([phantom, canonical]) => `${phantom} -> ${canonical || '(missing)'}`).join('\n'));
}

const geoConfigRows = [
  ...(geoConfig.featured || []),
  ...(geoConfig.counties || []),
  ...(geoConfig.places || []),
  ...(geoConfig.cdps || []),
];
const removedInGeoConfig = geoConfigRows
  .filter(entry => REMOVED_PHANTOM_GEOIDS.includes(String(entry && entry.geoid)))
  .map(entry => `${entry.geoid} ${entry.label || ''}`.trim());
report(removedInGeoConfig.length === 0, 'geo-config.json does not expose removed phantom GEOIDs');
if (removedInGeoConfig.length) {
  console.error(removedInGeoConfig.join('\n'));
}

const removedInHnaUtils = REMOVED_PHANTOM_GEOIDS.filter(geoid => hnaUtilsSource.includes(geoid));
report(removedInHnaUtils.length === 0, 'hna-utils.js fallback list does not expose removed phantom GEOIDs');
if (removedInHnaUtils.length) {
  console.error(removedInHnaUtils.join('\n'));
}
report(
  /loadJson\('data\/hna\/place-phantom-aliases\.json'\)/.test(hnaControllerSource) &&
    /__HNA_PLACE_PHANTOM_ALIASES/.test(hnaControllerSource) &&
    /restoredGeoId = _resolveIncomingGeoid\(restoredGeoType, restoredGeoId\)/.test(hnaControllerSource),
  'hna-controller resolves retired phantom URL GEOIDs before selecting a jurisdiction'
);

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
