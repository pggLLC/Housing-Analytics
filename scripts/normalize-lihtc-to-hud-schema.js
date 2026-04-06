#!/usr/bin/env node
/**
 * scripts/normalize-lihtc-to-hud-schema.js
 *
 * Rebuilds data/market/hud_lihtc_co.geojson as a normalized derivative of
 * data/chfa-lihtc.json, mapping CHFA field names to HUD-compatible names and
 * preserving all 716+ features so the PMA market-analysis tool always has the
 * most complete LIHTC picture available.
 *
 * Run automatically by .github/workflows/fetch-chfa-lihtc.yml immediately
 * after the CHFA fetch step.  May also be run locally:
 *   node scripts/normalize-lihtc-to-hud-schema.js
 *
 * Field mapping (CHFA → HUD-compatible):
 *   PROJECT    → PROJECT_NAME
 *   PROJ_CTY   → CITY
 *   N_UNITS    → TOTAL_UNITS
 *   YR_ALLOC   → YEAR_ALLOC
 *   CREDIT     → CREDIT_PCT
 *   LI_UNITS   → LI_UNITS   (unchanged)
 *   YR_PIS     → YR_PIS     (unchanged)
 *   CNTY_FIPS  → CNTY_FIPS  (unchanged)
 *   CNTY_NAME  → CNTY_NAME  (unchanged)
 *   STATEFP    → STATEFP    (unchanged)
 *   COUNTYFP   → COUNTYFP   (unchanged)
 *   QCT        → QCT        (unchanged)
 *   DDA        → DDA        (unchanged)
 *
 * The output file retains both CHFA and HUD field names so legacy callers
 * that reference either schema continue to work without modification.
 * Sentinel metadata fields (fetchedAt, source, _metadata) are preserved
 * verbatim from the source file (Rule 18).
 */

'use strict';

var fs   = require('fs');
var path = require('path');

var REPO_ROOT  = path.join(__dirname, '..');
var INPUT_PATH = path.join(REPO_ROOT, 'data', 'chfa-lihtc.json');
var OUTPUT_DIR = path.join(REPO_ROOT, 'data', 'market');
var OUTPUT_PATH = path.join(OUTPUT_DIR, 'hud_lihtc_co.geojson');

// ---------------------------------------------------------------------------
// Read source
// ---------------------------------------------------------------------------
if (!fs.existsSync(INPUT_PATH)) {
  console.error('[normalize-lihtc] ERROR: source file not found:', INPUT_PATH);
  process.exit(1);
}

var raw;
try {
  raw = JSON.parse(fs.readFileSync(INPUT_PATH, 'utf8'));
} catch (e) {
  console.error('[normalize-lihtc] ERROR: could not parse', INPUT_PATH, '—', e.message);
  process.exit(1);
}

var sourceFeatures = (raw && raw.features) || [];
if (sourceFeatures.length === 0) {
  console.error('[normalize-lihtc] ERROR: no features found in', INPUT_PATH);
  process.exit(1);
}

console.log('[normalize-lihtc] Read ' + sourceFeatures.length + ' features from chfa-lihtc.json');

// ---------------------------------------------------------------------------
// Map each feature to HUD-compatible schema, keeping all CHFA fields too
// ---------------------------------------------------------------------------
var normalized = sourceFeatures.map(function (f) {
  if (!f || !f.properties) { return f; }
  var p = f.properties;

  // CHFA → HUD-compatible additions (only add HUD name when absent)
  if (!p.PROJECT_NAME && p.PROJECT)   { p.PROJECT_NAME = p.PROJECT; }
  if (!p.CITY         && p.PROJ_CTY)  { p.CITY         = p.PROJ_CTY; }
  if (!p.TOTAL_UNITS  && p.N_UNITS)   { p.TOTAL_UNITS  = p.N_UNITS; }
  if (!p.YEAR_ALLOC   && p.YR_ALLOC)  { p.YEAR_ALLOC   = p.YR_ALLOC; }
  if (!p.CREDIT_PCT   && p.CREDIT)    { p.CREDIT_PCT   = p.CREDIT; }

  return f;
});

// ---------------------------------------------------------------------------
// Build output GeoJSON with preserved sentinel metadata (Rule 18)
// ---------------------------------------------------------------------------
var now = new Date().toISOString();
var output = {
  type:       'FeatureCollection',
  fetchedAt:  raw.fetchedAt || now,
  _metadata:  {
    source:         'CHFA LIHTC FeatureServer via chfa-lihtc.json',
    source_url:     raw.source || 'https://services.arcgis.com/VTyQ9soqVukalItT/arcgis/rest/services/LIHTC/FeatureServer',
    state:          'Colorado',
    state_fips:     '08',
    generated:      now.slice(0, 10),
    fetchedAt:      raw.fetchedAt || now,
    coverage_note:  normalized.length + ' Colorado LIHTC projects normalized from data/chfa-lihtc.json. ' +
                    'Rebuilt automatically by scripts/normalize-lihtc-to-hud-schema.js after each CHFA fetch.',
    fallback:       'Dashboards fall back to data/chfa-lihtc.json (CHFA schema) when this file is unavailable.'
  },
  features:   normalized
};

// ---------------------------------------------------------------------------
// Write output
// ---------------------------------------------------------------------------
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output), 'utf8');

var sizeKb = Math.round(fs.statSync(OUTPUT_PATH).size / 1024);
console.log('[normalize-lihtc] Wrote ' + normalized.length + ' features → ' + OUTPUT_PATH + ' (' + sizeKb + ' KB)');
console.log('[normalize-lihtc] Done.');
