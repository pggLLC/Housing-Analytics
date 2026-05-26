#!/usr/bin/env node
/**
 * fetch-hud-multifamily.js
 *
 * Fetches HUD's MULTIFAMILY_PROPERTIES_ASSISTED feature layer (HUD's master
 * list of project-based assisted multifamily properties) and writes
 * a HUD-compatible GeoJSON to:
 *   data/affordable-housing/preservation/hud-multifamily-assisted.json
 *
 * Coverage in CO: ~343 properties.
 *
 * Why this matters: CHFA's preservation layer (1,688 properties) lacks
 * subsidy_type detail. HUD MF Assisted has 284 fields including:
 *   - IS_SEC8_STATE_AGENCY_HFA_IND (Section 8 PBRA project-based)
 *   - IS_202_811_IND               (Section 202 elderly / 811 disabled)
 *   - IS_INSURED_IND               (FHA-insured mortgage)
 *   - IS_221D3_IND / IS_221D4_IND  (FHA programs)
 *   - IS_236_IND                   (Section 236 interest reduction)
 *   - IS_FLEXIBLE_SUBSIDY_IND
 *   - HAS_USE_RESTRICTION_IND      (affordability restriction still active)
 *
 * Source: https://services.arcgis.com/VTyQ9soqVukalItT/arcgis/rest/services/MULTIFAMILY_PROPERTIES_ASSISTED/FeatureServer/0
 * Discovered via: HUD Open Data Hub (hudgis-hud.opendata.arcgis.com)
 *
 * Run:  node scripts/fetch-hud-multifamily.js
 */

'use strict';

const https = require('https');
const fs = require('fs');
const path = require('path');

const SERVICE = 'https://services.arcgis.com/VTyQ9soqVukalItT/arcgis/rest/services/MULTIFAMILY_PROPERTIES_ASSISTED/FeatureServer/0';
const WHERE = "std_st='CO'";
const PAGE_SIZE = 2000;
const OUT_PATH = path.resolve(__dirname, '..', 'data/affordable-housing/preservation/hud-multifamily-assisted.json');

// Subset of the 284 source fields that are useful downstream. The full set
// includes many financial-performance and inspection fields that bloat the
// output without serving the targeting use case.
// Field names in HUD's MULTIFAMILY_PROPERTIES_ASSISTED layer are uppercase.
// STD_ST = 2-letter state · STD_ZIP5 = ZIP · STATE2KX = 2-digit state FIPS
// COUNTY_LEVEL = 5-digit county FIPS (e.g. '08085' = Montrose CO)
const OUT_FIELDS = [
  'PROPERTY_ID', 'PROPERTY_NAME_TEXT', 'ADDRESS_LINE1_TEXT', 'PLACED_BASE_CITY_NAME_TEXT',
  'STD_ST', 'STD_ZIP5', 'STATE2KX', 'COUNTY_LEVEL',
  'TOTAL_UNIT_COUNT', 'TOTAL_ASSISTED_UNIT_COUNT',
  'PROPERTY_CATEGORY_NAME', 'CLIENT_GROUP_NAME', 'CLIENT_GROUP_TYPE',
  'TROUBLED_CODE',
  'IS_INSURED_IND', 'IS_202_811_IND', 'WAS_EVER_202_811_IND',
  'IS_HUD_HELD_IND', 'IS_HUD_OWNED_IND',
  'IS_FLEXIBLE_SUBSIDY_IND', 'HAS_USE_RESTRICTION_IND',
  'IS_NURSING_HOME_IND', 'IS_ASSISTED_LIVING_IND',
  'IS_221D3_IND', 'IS_221D4_IND', 'IS_236_IND',
  'IS_SEC8_STATE_AGENCY_HFA_IND',
  'REAC_LAST_INSPECTION_SCORE'
].join(',');

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'coho-analytics/1.0' } }, (res) => {
      let body = '';
      res.on('data', (c) => body += c);
      res.on('end', () => {
        if (res.statusCode >= 400) return reject(new Error(`HTTP ${res.statusCode}: ${body.slice(0, 200)}`));
        try { resolve(JSON.parse(body)); } catch (e) { reject(new Error('Bad JSON: ' + e.message)); }
      });
    }).on('error', reject);
  });
}

async function fetchAllPages() {
  const features = [];
  let offset = 0;
  while (true) {
    const url = SERVICE + '/query?' + new URLSearchParams({
      where: WHERE, outFields: OUT_FIELDS, outSR: '4326',
      returnGeometry: 'true', resultOffset: String(offset),
      resultRecordCount: String(PAGE_SIZE), f: 'json'
    }).toString();
    console.log(`  fetching offset=${offset}…`);
    const page = await httpsGet(url);
    if (page.error) throw new Error('ArcGIS error: ' + JSON.stringify(page.error));
    const pf = page.features || [];
    features.push(...pf);
    if (pf.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return features;
}

/**
 * Derive a subsidy_type label from the HUD MF indicator flags.
 * Order matters — more-specific labels first.
 */
function deriveSubsidyType(a) {
  // 'Y' / 'N' indicators in HUD's data
  const y = (v) => v === 'Y' || v === 'y' || v === '1' || v === 1 || v === true;
  if (y(a.IS_NURSING_HOME_IND)) return 'nursing-home';
  if (y(a.IS_ASSISTED_LIVING_IND)) return 'assisted-living';
  if (y(a.IS_202_811_IND)) return 'hud-202-or-811';        // elderly / disabled
  if (y(a.IS_236_IND)) return 'hud-236';                    // interest-reduction subsidy
  if (y(a.IS_221D3_IND) || y(a.IS_221D4_IND)) return 'fha-221d';
  if (y(a.IS_FLEXIBLE_SUBSIDY_IND)) return 'flexible-subsidy';
  if (y(a.IS_INSURED_IND)) return 'fha-insured';
  // Default: project-based Section 8 PBRA (most common when nothing else is flagged)
  if ((a.PROPERTY_CATEGORY_NAME || '').toLowerCase().includes('section 8')) return 'section-8-pbra';
  return 'unknown';
}

function toGeoJsonFeature(esriFeature) {
  const a = esriFeature.attributes || {};
  const geom = esriFeature.geometry;
  if (!geom || geom.x == null || geom.y == null) return null;

  const subsidyType = deriveSubsidyType(a);
  // COUNTY_LEVEL is the 5-digit FIPS code (e.g. '08085'), STATE2KX is 2-digit.
  const cntyFips = a.COUNTY_LEVEL || null;

  return {
    type: 'Feature',
    geometry: {
      type: 'Point',
      coordinates: [
        Math.round(geom.x * 1e6) / 1e6,
        Math.round(geom.y * 1e6) / 1e6
      ]
    },
    properties: {
      // HUD-compatible aliases
      PROJECT:   a.PROPERTY_NAME_TEXT || null,
      PROJ_ADD:  a.ADDRESS_LINE1_TEXT || null,
      PROJ_CTY:  a.PLACED_BASE_CITY_NAME_TEXT || null,
      PROJ_ST:   a.STD_ST || 'CO',
      CNTY_NAME: null,                         // not directly in this layer
      CNTY_FIPS: cntyFips,
      N_UNITS:   a.TOTAL_UNIT_COUNT || null,
      LI_UNITS:  a.TOTAL_ASSISTED_UNIT_COUNT || null,
      // Source-specific
      _source: 'HUD MULTIFAMILY_PROPERTIES_ASSISTED',
      PROPERTY_ID: a.PROPERTY_ID || null,
      Zip: a.STD_ZIP5 || null,
      subsidy_type: subsidyType,
      property_category: a.PROPERTY_CATEGORY_NAME || null,
      client_group: a.CLIENT_GROUP_NAME || null,
      has_use_restriction: a.HAS_USE_RESTRICTION_IND === 'Y',
      is_troubled: a.TROUBLED_CODE === 'T',
      reac_score: a.REAC_LAST_INSPECTION_SCORE || null,
      program_type: 'preservation-candidate'
    }
  };
}

async function main() {
  console.log(`HUD MULTIFAMILY_PROPERTIES_ASSISTED fetch (CO)`);
  console.log(`  Source: ${SERVICE}`);
  console.log(`  Output: ${OUT_PATH}\n`);

  const countResp = await httpsGet(SERVICE + `/query?where=${encodeURIComponent(WHERE)}&returnCountOnly=true&f=json`);
  console.log(`  Total CO features: ${countResp.count}`);
  if (!countResp.count) throw new Error('Zero count returned — service may be down or WHERE clause wrong');

  const allFeatures = await fetchAllPages();
  console.log(`  Fetched: ${allFeatures.length}`);

  const geoJson = {
    type: 'FeatureCollection',
    features: allFeatures.map(toGeoJsonFeature).filter(Boolean)
  };
  console.log(`  After geometry filter: ${geoJson.features.length}`);

  // Subsidy-type breakdown
  const types = {};
  geoJson.features.forEach(f => {
    const t = f.properties.subsidy_type;
    types[t] = (types[t] || 0) + 1;
  });
  console.log('  Subsidy-type breakdown:');
  Object.entries(types).sort((a, b) => b[1] - a[1]).forEach(([t, n]) => console.log(`    ${t.padEnd(20)} ${n}`));

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(geoJson));
  console.log(`\n  Wrote ${OUT_PATH} (${(fs.statSync(OUT_PATH).size / 1024).toFixed(1)} KB)`);
}

main().catch(e => { console.error('::error::' + e.message); process.exit(1); });
