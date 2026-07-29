'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'lihtc-opportunity-finder.js'), 'utf8');

// The 10MB OZ GeoJSON must be fetched at most once (deduped), lazily.
const fetchCount = (src.match(/fetch\('data\/market\/opportunity_zones_co\.geojson'\)/g) || []).length;
assert.equal(fetchCount, 1, 'opportunity_zones_co.geojson is fetched from exactly one (deduped) site');

// That single site is the shared lazy loader.
assert(/function _ensureOzData\(\)/.test(src), 'defines the deduped _ensureOzData loader');
assert(/_ensureOzData[\s\S]{0,200}fetch\('data\/market\/opportunity_zones_co\.geojson'\)/.test(src),
  'the OZ fetch lives inside _ensureOzData');

// Boot must NOT eager-load OZ: the boot _loadRedevData call passes skipOz.
assert(/_loadRedevData\(function[\s\S]{0,120}\{\s*skipOz:\s*true\s*\}\)/.test(src),
  'boot _loadRedevData call passes { skipOz: true } (no eager 10MB OZ fetch on load)');

// OZ map layer populates lazily on user toggle (overlayadd), not on boot.
assert(/state\.map\.on\('overlayadd'/.test(src), 'OZ layer populates on map overlayadd (user toggle)');
assert(/function _populateOzLayer\(\)/.test(src), 'defines lazy _populateOzLayer');

console.log('lof-lazy-oz: PASS (single deduped OZ fetch, lazy on toggle, skipOz at boot)');
