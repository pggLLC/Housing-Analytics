#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const checks = [
  { file: 'data/co-county-boundaries.json', expectedMinFeatures: 64 },
  { file: 'data/boundaries/counties_co.geojson', expectedMinFeatures: 64 },
  { file: 'data/qct-colorado.json', expectedMinFeatures: 1 },
  { file: 'data/dda-colorado.json', expectedMinFeatures: 1 }
];
let failed = false;
for (const check of checks) {
  const abs = path.resolve(process.cwd(), check.file);
  if (!fs.existsSync(abs)) {
    console.error('Missing required file: ' + check.file);
    failed = true;
    continue;
  }
  let json;
  try {
    json = JSON.parse(fs.readFileSync(abs, 'utf8'));
  } catch (err) {
    console.error('Invalid JSON: ' + check.file);
    failed = true;
    continue;
  }
  const features = Array.isArray(json && json.features) ? json.features.length : 0;
  if (features < check.expectedMinFeatures) {
    console.error('Placeholder or incomplete GeoJSON: ' + check.file + ' has ' + features + ' features; expected at least ' + check.expectedMinFeatures);
    failed = true;
  } else {
    console.log('OK ' + check.file + ': ' + features + ' features');
  }
}
if (failed) process.exit(1);
console.log('Critical data validation passed.');

/* ── Sparse market-analysis data checks ──────────────────────────────────
 * These files back the statewide market-analysis and PMA scoring features.
 * Colorado has ~1,300 census tracts and hundreds of LIHTC properties, so
 * single-digit or very low feature counts indicate placeholder data that has
 * not yet been populated by the build-market-data workflow.
 *
 * Thresholds are set to detect placeholder vs real data:
 *   - 100 tracts / ACS records  (placeholder data typically has < 25)
 *   - 50 LIHTC properties       (placeholder data typically has < 15)
 *
 * Failing on placeholder data prevents the map from shipping stale results.
 * Run `gh workflow run build-market-data.yml` or trigger the workflow via the
 * GitHub UI to populate real data (requires CENSUS_API_KEY secret).
 */

/**
 * Count the number of records in a parsed JSON object.
 * Handles: {tracts:[]} (ACS/centroid files), GeoJSON FeatureCollections,
 * and plain arrays.
 * @param {*} json
 * @returns {number}
 */
function countRecords(json) {
  if (Array.isArray(json && json.tracts))    return json.tracts.length;
  if (Array.isArray(json && json.features))  return json.features.length;
  if (Array.isArray(json))                   return json.length;
  return 0;
}

const sparseChecks = [
  {
    file: 'data/market/acs_tract_metrics_co.json',
    // Colorado has ~1,300 census tracts; fewer than 100 entries means placeholder data.
    minFeatures: 100,
  },
  {
    file: 'data/market/tract_centroids_co.json',
    // Should have one centroid per census tract (~1,300 for Colorado).
    minFeatures: 100,
  },
  {
    file: 'data/market/hud_lihtc_co.geojson',
    // Colorado has hundreds of LIHTC-funded properties; fewer than 50 means placeholder data.
    minFeatures: 50,
  },
];

let sparseFailed = false;
for (const sc of sparseChecks) {
  const abs = path.resolve(process.cwd(), sc.file);
  if (!fs.existsSync(abs)) {
    console.error('Missing market-analysis file: ' + sc.file +
      ' — run the build-market-data workflow to generate it.');
    sparseFailed = true;
    continue;
  }
  let raw;
  try {
    raw = fs.readFileSync(abs, 'utf8').trim();
  } catch (err) {
    console.error('Cannot read market-analysis file: ' + sc.file + ' — ' + err.message);
    sparseFailed = true;
    continue;
  }
  if (!raw) {
    console.error('Empty market-analysis file: ' + sc.file +
      ' — run the build-market-data workflow to populate it.');
    sparseFailed = true;
    continue;
  }
  let json;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    console.error('Invalid JSON in market-analysis file: ' + sc.file);
    sparseFailed = true;
    continue;
  }
  const count = countRecords(json);
  if (count < sc.minFeatures) {
    console.error(
      'Placeholder/sparse market-analysis data: ' + sc.file +
      ' has ' + count + ' features/records; minimum is ' + sc.minFeatures + '.' +
      ' Run the build-market-data workflow (requires CENSUS_API_KEY secret).'
    );
    sparseFailed = true;
  } else {
    console.log('OK (market) ' + sc.file + ': ' + count + ' features/records');
  }
}
if (sparseFailed) process.exit(1);
