#!/usr/bin/env node
/**
 * split-lihtc-by-county.js
 * Reads data/chfa-lihtc.json (a GeoJSON FeatureCollection of all Colorado
 * LIHTC projects) and writes one per-county GeoJSON file into
 * data/hna/lihtc/<FIPS>.json for all 64 Colorado counties.
 *
 * Counties with no matching projects are written as an empty FeatureCollection
 * so that the front-end always finds a valid file.
 *
 * Run:  node scripts/split-lihtc-by-county.js
 *
 * This script is called by .github/workflows/fetch-chfa-lihtc.yml immediately
 * after fetch-chfa-lihtc.js so that the per-county files are kept in sync
 * with the source data on every Monday refresh.
 */

'use strict';

const fs   = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const ROOT        = path.resolve(__dirname, '..');
const SOURCE_FILE = path.join(ROOT, 'data', 'chfa-lihtc.json');
const OUT_DIR     = path.join(ROOT, 'data', 'hna', 'lihtc');

// ---------------------------------------------------------------------------
// All 64 Colorado county FIPS codes (Census 08001–08125).
// Every county gets a file, even if it has no projects.
// ---------------------------------------------------------------------------

const ALL_CO_FIPS = [
  '08001','08003','08005','08007','08009','08011','08013','08014','08015','08017',
  '08019','08021','08023','08025','08027','08029','08031','08033','08035','08037',
  '08039','08041','08043','08045','08047','08049','08051','08053','08055','08057',
  '08059','08061','08063','08065','08067','08069','08071','08073','08075','08077',
  '08079','08081','08083','08085','08087','08089','08091','08093','08095','08097',
  '08099','08101','08103','08105','08107','08109','08111','08113','08115','08117',
  '08119','08121','08123','08125',
];

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

(function main() {
  // Read source file.
  if (!fs.existsSync(SOURCE_FILE)) {
    console.error(`ERROR: Source file not found: ${SOURCE_FILE}`);
    process.exit(1);
  }

  let source;
  try {
    source = JSON.parse(fs.readFileSync(SOURCE_FILE, 'utf8'));
  } catch (err) {
    console.error(`ERROR: Failed to parse ${SOURCE_FILE}: ${err.message}`);
    process.exit(1);
  }

  const features = Array.isArray(source.features) ? source.features : [];
  const fetchedAt = source.fetchedAt || null;

  console.log(`Source: ${SOURCE_FILE}`);
  console.log(`Features loaded: ${features.length}`);

  // Group features by CNTY_FIPS property.
  /** @type {Map<string, object[]>} */
  const byFips = new Map();
  for (const fips of ALL_CO_FIPS) {
    byFips.set(fips, []);
  }

  let skipped = 0;
  for (const feature of features) {
    const fips = feature && feature.properties && feature.properties.CNTY_FIPS;
    if (fips && byFips.has(fips)) {
      byFips.get(fips).push(feature);
    } else {
      skipped++;
    }
  }

  if (skipped > 0) {
    console.warn(`Warning: ${skipped} feature(s) skipped (missing or unrecognised CNTY_FIPS).`);
  }

  // Ensure output directory exists.
  fs.mkdirSync(OUT_DIR, { recursive: true });

  // Write one file per county.
  let written = 0;
  let nonEmpty = 0;
  for (const [fips, countyFeatures] of byFips) {
    const outFile = path.join(OUT_DIR, `${fips}.json`);
    const geojson = {
      type: 'FeatureCollection',
      fetchedAt,
      features: countyFeatures,
    };
    fs.writeFileSync(outFile, JSON.stringify(geojson), 'utf8');
    written++;
    if (countyFeatures.length > 0) nonEmpty++;
  }

  console.log(`Wrote ${written} county file(s) to ${OUT_DIR}/`);
  console.log(`Counties with ≥1 project: ${nonEmpty} / ${written}`);
})();
