#!/usr/bin/env node
/**
 * normalize-dda.js
 * Post-processes data/dda-colorado.json to normalise the HUD DDA schema so it
 * matches the field names expected by the front-end rendering code
 * (colorado-deep-dive.html and js/housing-needs-assessment.js).
 *
 * HUD source schema  →  normalised target schema
 * -------------------------------------------------
 * DDA_NAME           →  NAME        (tooltip label)
 * DDA_TYPE           →  DDATYPE     (type shown in popup)
 * DDA_CODE           →  GEOID       (5-digit state+county FIPS, e.g. "08067")
 * DDA_CODE (derived) →  COUNTYFP    (3-digit county FIPS, e.g. "067")
 * (computed)         →  STATEFP     ("08" for Colorado)
 *
 * Only county-based DDA features (DDA_CODE starts with "NCNTY") whose embedded
 * state FIPS equals "08" (Colorado) are kept.  All other features are removed.
 *
 * DDA_CODE format for county-based DDAs:
 *   NCNTY<5-digit-FIPS>N<5-digit-FIPS>
 *   e.g. "NCNTY08067N08067"  →  FIPS = "08067"
 *        chars 5-9 (0-indexed) = 5-digit state+county FIPS
 *
 * Run:  node scripts/normalize-dda.js
 * Also called automatically by .github/workflows/cache-hud-gis-data.yml during CI.
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const DATA_DIR   = path.resolve(__dirname, '..', 'data');
const DDA_FILE   = path.join(DATA_DIR, 'dda-colorado.json');
const CO_STATEFP = '08';

/**
 * Extract the 5-digit state+county FIPS code from a county-based DDA_CODE.
 * Returns null for codes that are not in the expected NCNTY format.
 *
 * @param {string} ddaCode  e.g. "NCNTY08067N08067"
 * @returns {string|null}   e.g. "08067"
 */
function extractFips(ddaCode) {
  if (typeof ddaCode !== 'string' || !ddaCode.startsWith('NCNTY')) return null;
  // NCNTY<5-digit-FIPS>N<5-digit-FIPS>
  //       ^^^^^  positions 5–9 (0-indexed)
  const fips = ddaCode.slice(5, 10);
  // Must be exactly 5 digits
  return /^\d{5}$/.test(fips) ? fips : null;
}

/**
 * Normalise a single GeoJSON Feature from the HUD DDA schema to the schema
 * expected by the front-end.  Returns null if the feature should be dropped.
 *
 * @param {object} feature  GeoJSON Feature
 * @returns {object|null}
 */
function normaliseFeature(feature) {
  const p = feature.properties || {};
  const fips = extractFips(p.DDA_CODE || '');

  // Keep only Colorado county-based DDAs (state FIPS "08")
  if (!fips || fips.slice(0, 2) !== CO_STATEFP) return null;

  return {
    ...feature,
    properties: {
      ...p,
      NAME:     p.DDA_NAME  || null,
      DDATYPE:  p.DDA_TYPE  || null,
      GEOID:    fips,
      COUNTYFP: fips.slice(2),   // 3-digit county FIPS
      STATEFP:  CO_STATEFP,
    },
  };
}

(function main() {
  if (!fs.existsSync(DDA_FILE)) {
    console.error(`ERROR: ${DDA_FILE} not found. Nothing to normalise.`);
    process.exit(1);
  }

  const raw = JSON.parse(fs.readFileSync(DDA_FILE, 'utf8'));

  if (!raw || !Array.isArray(raw.features)) {
    console.error('ERROR: dda-colorado.json does not contain a features array.');
    process.exit(1);
  }

  const before = raw.features.length;
  const normalised = raw.features.map(normaliseFeature).filter(Boolean);

  const output = {
    ...raw,
    normalizedAt: new Date().toISOString(),
    features: normalised,
  };

  fs.writeFileSync(DDA_FILE, JSON.stringify(output, null, 2), 'utf8');
  console.log(
    `Normalized ${DDA_FILE}: ${before} input → ${normalised.length} Colorado features retained.`,
  );
})();
