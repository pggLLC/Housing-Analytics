'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const ozPath = process.env.OZ_GEOJSON_PATH || path.join(root, 'data', 'market', 'opportunity_zones_co.geojson');
const inventoryPath = path.join(root, 'js', 'data-source-inventory.js');
const softFundingPath = path.join(root, 'data', 'policy', 'soft-funding-status.json');
const opportunityFinderPath = path.join(root, 'js', 'lihtc-opportunity-finder.js');

const data = JSON.parse(fs.readFileSync(ozPath, 'utf8'));
const inventorySrc = fs.readFileSync(inventoryPath, 'utf8');
const softFunding = JSON.parse(fs.readFileSync(softFundingPath, 'utf8'));
const opportunityFinderSrc = fs.readFileSync(opportunityFinderPath, 'utf8');

console.log('\nOpportunity Zones data guard');
console.log('='.repeat(40));

assert.strictEqual(data.type, 'FeatureCollection', 'OZ artifact is GeoJSON');
assert(data.meta, 'OZ artifact has metadata');
assert.strictEqual(data.meta.source_url, 'https://www.cdfifund.gov/system/files/documents/opportunity-zones=8764.-9-10-2019.zip', 'source URL pins official CDFI shapefile archive');
assert.strictEqual(data.meta.url, 'https://www.cdfifund.gov/opportunity-zones', 'metadata links official CDFI OZ page');
assert(/Notice 2018-48/.test(data.meta.vintage), 'metadata names official designation notice vintage');

assert(Array.isArray(data.features), 'features array exists');
assert.strictEqual(data.features.length, 126, 'Colorado designated QOZ feature count is exactly 126');
assert.strictEqual(data.meta.feature_count, 126, 'meta feature count matches designated count');
assert.strictEqual(data.meta.designated_count, 126, 'meta designated count matches designated count');
assert(data.features.length >= 100 && data.features.length <= 150, 'Colorado count stays within sane shrink-guard bounds');

const geoids = new Set();
for (const feature of data.features) {
  assert(feature && feature.type === 'Feature', 'each row is a Feature');
  assert(feature.properties && feature.properties.designated === true, `${feature.properties && feature.properties.geoid}: only designated tracts are emitted`);
  assert(/^08\d{9}$/.test(feature.properties.geoid), `${feature.properties.geoid}: Colorado 11-digit tract GEOID`);
  assert.strictEqual(feature.properties.county_fips, feature.properties.geoid.slice(0, 5), `${feature.properties.geoid}: county_fips derives from tract`);
  assert(!geoids.has(feature.properties.geoid), `${feature.properties.geoid}: no duplicate tract`);
  geoids.add(feature.properties.geoid);
}

assert(geoids.has('08045951702'), 'known Garfield County QOZ tract from official archive is present');
assert(geoids.has('08071000800'), 'known Las Animas County QOZ tract from official archive is present');
assert(!geoids.has('08059011601'), 'non-designated Jefferson County tract is not emitted');

const firstRing = data.features[0].geometry && data.features[0].geometry.coordinates && data.features[0].geometry.coordinates[0];
assert(Array.isArray(firstRing) && Array.isArray(firstRing[0]), 'geometry has polygon coordinates');
const [lon, lat] = firstRing[0];
assert(lon >= -110 && lon <= -101.5, 'longitude is transformed to WGS84 degrees');
assert(lat >= 36.5 && lat <= 41.5, 'latitude is transformed to WGS84 degrees');

assert(inventorySrc.includes("coverage: 'Colorado — 126 designated OZ tracts'"), 'data-source inventory discloses 126-tract coverage');
assert(inventorySrc.includes('features: 126'), 'data-source inventory feature count stays aligned');

assert(softFunding.programs && softFunding.programs['OZ-EQUITY'], 'OZ soft-funding reference exists');
const ozProgram = softFunding.programs['OZ-EQUITY'];
assert(/OZ 2\.0/.test(ozProgram.note), 'soft-funding reference discloses OZ 2.0 context');
assert(/rural/i.test(ozProgram.note), 'soft-funding reference names rural QROF context');
assert(opportunityFinderSrc.includes('QROF basis step-up'), 'Opportunity Finder discloses rural QROF context');
assert(!opportunityFinderSrc.includes('no path to add new ones'), 'Opportunity Finder does not contradict OZ 2.0 decennial rounds');

console.log('Opportunity Zones data guard passed.');
