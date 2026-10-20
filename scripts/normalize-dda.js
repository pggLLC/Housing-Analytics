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
 * Two kinds of Colorado DDA are kept; all other features are removed:
 *   - nonmetro county DDAs (DDA_CODE starts with "NCNTY", embedded state FIPS
 *     "08"): GEOID/COUNTYFP are the county FIPS, DDA_KIND = "county";
 *   - metro Small Area DDAs (DDA_TYPE "SA"), which HUD designates by ZIP
 *     (ZCTA5) — Colorado ZIPs are 80xxx/81xxx: GEOID/COUNTYFP are null (a ZIP
 *     is not a county and does not cover one), ZCTA5 is kept, DDA_KIND = "zip".
 * County rows are written first, then ZIP rows in ZIP order.
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
const CO_ZIP     = /^8[01]\d{3}$/;   // Colorado ZIPs

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

  // Colorado county-based DDAs (state FIPS "08")
  if (fips && fips.slice(0, 2) === CO_STATEFP) {
    return {
      ...feature,
      properties: {
        ...p,
        NAME:     p.DDA_NAME  || null,
        DDATYPE:  p.DDA_TYPE  || null,
        DDA_KIND: 'county',
        GEOID:    fips,
        COUNTYFP: fips.slice(2),   // 3-digit county FIPS
        STATEFP:  CO_STATEFP,
      },
    };
  }

  // Colorado metro Small Area DDAs (one row per ZIP and metro area)
  const zip = String(p.ZCTA5 || '');
  if (p.DDA_TYPE === 'SA' && CO_ZIP.test(zip)) {
    return {
      ...feature,
      properties: {
        ...p,
        NAME:     'ZIP ' + zip + (p.DDA_NAME ? ' (' + p.DDA_NAME + ')' : ''),
        DDATYPE:  p.DDA_TYPE,
        DDA_KIND: 'zip',
        GEOID:    null,
        COUNTYFP: null,
        STATEFP:  CO_STATEFP,
      },
    };
  }

  return null;
}

function sortKey(feature) {
  const p = feature.properties || {};
  return (p.DDA_KIND === 'county' ? '0' : '1') + (p.GEOID || p.ZCTA5 || '') + (p.DDA_CODE || '');
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
  const normalised = raw.features.map(normaliseFeature).filter(Boolean)
    .sort((a, b) => (sortKey(a) < sortKey(b) ? -1 : sortKey(a) > sortKey(b) ? 1 : 0));
  const zipRows = normalised.filter((f) => f.properties.DDA_KIND === 'zip');

  const output = {
    ...raw,
    normalizedAt: new Date().toISOString(),
    features: normalised,
  };

  fs.writeFileSync(DDA_FILE, JSON.stringify(output, null, 2), 'utf8');
  console.log(
    `Normalized ${DDA_FILE}: ${before} input → ${normalised.length} Colorado features retained ` +
    `(${normalised.length - zipRows.length} nonmetro counties, ${zipRows.length} Small Area ZIP rows ` +
    `covering ${new Set(zipRows.map((f) => f.properties.ZCTA5)).size} ZIPs).`,
  );
})();
