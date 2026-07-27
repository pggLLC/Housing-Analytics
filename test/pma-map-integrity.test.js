#!/usr/bin/env node

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const count = (text, needle) => (text.match(new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;

const market = read('market-analysis.html');
assert(!market.includes('Point-based lookup, not parcel-level'), 'FEMA disclosure should not claim point-based lookup');
assert(market.includes('Polygon SFHA high-risk zones only'), 'FEMA disclosure should describe polygon SFHA high-risk coverage');
assert(market.includes("vintage: '2026 (NFHL current effective)'"), 'FEMA disclosure should carry 2026 NFHL vintage');
assert(!market.includes("vintage: '2025', coverage: 'Colorado', note: 'Point-based"), 'old FEMA 2025 point-based disclosure is absent');

assert.equal(count(market, 'data-layer="commuting"'), 1, 'market map should expose exactly one commuting layer checkbox');
assert.equal(count(market, 'data-layer="commutingFlows"'), 1, 'commutingFlows layer should remain distinct and present once');
assert.equal(count(market, 'data-layer="commuteContext"'), 1, 'commuteContext layer should remain distinct and present once');

const floodText = read('data/environmental/fema-flood-co.geojson');
const flood = JSON.parse(floodText);
assert.equal(flood.features.length, 4, 'legacy FEMA flood fallback should contain four features');
assert(!flood.features.some((feature) => (feature.properties || {}).FLD_ZONE === 'VE'), 'legacy FEMA flood fallback should not contain VE coastal zone features');
assert(!floodText.includes('COASTAL HIGH HAZARD'), 'legacy FEMA flood fallback should not mention coastal high hazard');

const dataMap = read('data-map-browser.html');
assert(!dataMap.includes('5-record'), 'data map browser should not describe the flood fallback as a 5-record stub');
assert(!dataMap.includes('5-feature'), 'data map browser should not describe the flood fallback as a 5-feature stub');
assert(dataMap.includes('4-record'), 'data map browser should describe the flood fallback as a 4-record stub');
assert(dataMap.includes('4-feature'), 'data map browser should describe the flood fallback as a 4-feature stub');

console.log('pma-map-integrity: PASS');
