#!/usr/bin/env node
// test/data-source-inventory-paths.test.js
//
// Package B: user-facing Data Trust Center "Local File" provenance should
// resolve to committed files unless the source is intentionally runtime-fetched
// or build-generated and parked for owner triage.

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const INVENTORY_REL = 'js/data-source-inventory.js';
const inventorySrc = fs.readFileSync(path.join(ROOT, INVENTORY_REL), 'utf8');

const KNOWN_UNCOMMITTED = new Set([
  'data/economic-indicators.json',
  'data/construction-commodities.json',
  'data/dola_sya/',
  'data/hud-income-limits.json',
  'data/zillow-zhvi-metro.json',
  'data/zillow-zori.json',
  'data/hna/lehd_wac_snapshots/',
  'maps/co-counties.geojson',
  'data/projections/',
  'data/hna/municipal/municipal-config.json',
  'data/hna/municipal/growth-rates.json',
  'data/hna/county/',
  'data/cra-expansion.json',
  'data/kalshi-housing.json',
  'data/compliance-metrics.json',
  'data/policy/housing-legislation-2026.json',
  'data/regional-overview.json',
  'data/state-allocation-map.json',
  'data/zillow-county-values.json',
  'data/market/epa_cleanup_co.geojson',
  'data/market/epa_smart_location_co.json',
  'data/market/nhd_barriers_co.geojson',
]);

const localFiles = [...inventorySrc.matchAll(/localFile:\s*'([^']+)'/g)].map((m) => m[1]);

assert(localFiles.length >= 60, 'inventory exposes a non-vacuous localFile set');

for (const localFile of localFiles) {
  const exists = fs.existsSync(path.join(ROOT, localFile));
  assert(
    exists || KNOWN_UNCOMMITTED.has(localFile),
    `${localFile} must exist on disk or be frozen in KNOWN_UNCOMMITTED`
  );
}

for (const fixedPath of [
  'data/market/flood_zones_co.geojson',
  'data/amenities/transit_stops_co.geojson',
]) {
  assert(localFiles.includes(fixedPath), `${fixedPath} is registered in the inventory`);
  assert(fs.existsSync(path.join(ROOT, fixedPath)), `${fixedPath} exists on disk`);
  assert(!KNOWN_UNCOMMITTED.has(fixedPath), `${fixedPath} must not be allowlisted`);
}

for (const stalePath of [
  'data/market/fema_flood_co.geojson',
  'data/market/transit_stops_co.geojson',
]) {
  assert(!inventorySrc.includes(stalePath), `${stalePath} typo must not appear in inventory`);
}

for (const allowlistedPath of KNOWN_UNCOMMITTED) {
  assert(
    !fs.existsSync(path.join(ROOT, allowlistedPath)),
    `${allowlistedPath} exists on disk and must be removed from KNOWN_UNCOMMITTED`
  );
}

console.log(`data-source-inventory-paths: PASS (${localFiles.length} localFile entries, ${KNOWN_UNCOMMITTED.size} known uncommitted)`);
