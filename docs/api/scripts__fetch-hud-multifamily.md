# `scripts/fetch-hud-multifamily.js`

## Symbols

### `deriveSubsidyType(a)`

fetch-hud-multifamily.js

Fetches HUD's MULTIFAMILY_PROPERTIES_ASSISTED feature layer (HUD's master
list of project-based assisted multifamily properties) and writes
a HUD-compatible GeoJSON to:
  data/affordable-housing/preservation/hud-multifamily-assisted.json

Coverage in CO: ~343 properties.

Why this matters: CHFA's preservation layer (1,688 properties) lacks
subsidy_type detail. HUD MF Assisted has 284 fields including:
  - IS_SEC8_STATE_AGENCY_HFA_IND (Section 8 PBRA project-based)
  - IS_202_811_IND               (Section 202 elderly / 811 disabled)
  - IS_INSURED_IND               (FHA-insured mortgage)
  - IS_221D3_IND / IS_221D4_IND  (FHA programs)
  - IS_236_IND                   (Section 236 interest reduction)
  - IS_FLEXIBLE_SUBSIDY_IND
  - HAS_USE_RESTRICTION_IND      (affordability restriction still active)

Source: https://services.arcgis.com/VTyQ9soqVukalItT/arcgis/rest/services/MULTIFAMILY_PROPERTIES_ASSISTED/FeatureServer/0
Discovered via: HUD Open Data Hub (hudgis-hud.opendata.arcgis.com)

Run:  node scripts/fetch-hud-multifamily.js
/

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
Derive a subsidy_type label from the HUD MF indicator flags.
Order matters — more-specific labels first.
