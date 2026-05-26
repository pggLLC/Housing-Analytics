#!/usr/bin/env node
/**
 * fetch-usda-rural-housing.js
 *
 * Fetches USDA Rural Housing Assets feature layer and writes to:
 *   data/affordable-housing/preservation/usda-rural-housing.json
 *
 * Coverage in CO: ~116 properties.
 *
 * Critical fields not available in other sources:
 *   - RESTRICTIVE_CLAUSE_EXPIRATION — the actual subsidy expiration date,
 *     which is the single most-important signal for preservation deal
 *     targeting (a property expiring within 5 years is a much hotter
 *     preservation candidate than one expiring in 30 years)
 *   - RA_UNITS — Rental Assistance units (Section 521 RA program)
 *   - HUD_UNITS — overlapping HUD-funded units within RD property
 *   - RENTAL_DESIGNATION — Family / Elderly / Special
 *
 * Source: https://services.arcgis.com/VTyQ9soqVukalItT/arcgis/rest/services/USDA_Rural_Housing_Assets/FeatureServer/0
 *
 * Run:  node scripts/fetch-usda-rural-housing.js
 */

'use strict';

const https = require('https');
const fs = require('fs');
const path = require('path');

const SERVICE = 'https://services.arcgis.com/VTyQ9soqVukalItT/arcgis/rest/services/USDA_Rural_Housing_Assets/FeatureServer/0';
const WHERE = "std_st='CO'";
const PAGE_SIZE = 2000;
const OUT_PATH = path.resolve(__dirname, '..', 'data/affordable-housing/preservation/usda-rural-housing.json');

// Field names uppercase. PRJ_ADDRESS_STATE = 2-letter, COUNTY_LEVEL = 5-digit FIPS,
// STATE2KX = 2-digit state FIPS. STD_ST is on this layer too.
const OUT_FIELDS = [
  'PROJECT_NAME', 'PRJ_ADDRESS_LINE1', 'PRJ_ADDRESS_CITY',
  'PRJ_ADDRESS_STATE', 'PRJ_ADDRESS_ZIP',
  'STD_ST', 'STD_ZIP5', 'STATE2KX', 'COUNTY_LEVEL',
  'EFFECTIVE_DATE', 'RESTRICTIVE_CLAUSE_EXPIRATION',
  'TOTAL_UNITS', 'HUD_UNITS', 'RA_UNITS',
  'RENTAL_DESIGNATION',
  'MGMT_AGENT_NAME', 'MGMT_AGENT_PH_NBR'
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
 * Compute years-to-expiration from RESTRICTIVE_CLAUSE_EXPIRATION (string).
 * Helps surface preservation urgency.
 */
function yearsToExpiration(expirationStr) {
  if (!expirationStr) return null;
  // Accept multiple formats: '2030-12-31', '12/31/2030', '20301231'
  let year = null;
  const m1 = expirationStr.match(/^(\d{4})/);
  const m2 = expirationStr.match(/(\d{4})\s*$/);
  if (m1) year = parseInt(m1[1], 10);
  else if (m2) year = parseInt(m2[1], 10);
  if (!year || year < 2000 || year > 2100) return null;
  return year - new Date().getFullYear();
}

function toGeoJsonFeature(esriFeature) {
  const a = esriFeature.attributes || {};
  const geom = esriFeature.geometry;
  if (!geom || geom.x == null || geom.y == null) return null;

  // COUNTY_LEVEL on USDA layer is unpadded (e.g. '8001' for Adams, '8085' for Montrose).
  // Pad to 5 digits for consistency with other site data.
  const rawCnty = a.COUNTY_LEVEL ? String(a.COUNTY_LEVEL) : '';
  const cntyFips = rawCnty ? rawCnty.padStart(5, '0') : null;

  // USDA RD program detection. Most CO RD properties are 515 (rural rental
  // housing). The schema doesn't have explicit 515/521/538 flags, so we
  // derive a generic 'usda-rural' subsidy_type. RA_UNITS > 0 indicates
  // Section 521 rental assistance is layered in.
  const subsidyType = (a.RA_UNITS && a.RA_UNITS > 0) ? 'usda-rd-with-ra' : 'usda-rd';

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
      PROJECT:   a.PROJECT_NAME || null,
      PROJ_ADD:  a.PRJ_ADDRESS_LINE1 || null,
      PROJ_CTY:  a.PRJ_ADDRESS_CITY || null,
      PROJ_ST:   a.PRJ_ADDRESS_STATE || a.std_st || 'CO',
      CNTY_NAME: a.std_county || null,
      CNTY_FIPS: cntyFips,
      N_UNITS:   a.TOTAL_UNITS || null,
      LI_UNITS:  a.TOTAL_UNITS || null,
      // Source-specific
      _source: 'USDA Rural Housing Assets',
      Zip: a.PRJ_ADDRESS_ZIP || null,
      effective_date: a.EFFECTIVE_DATE || null,
      restrictive_expiration: a.RESTRICTIVE_CLAUSE_EXPIRATION || null,
      years_to_expiration: yearsToExpiration(a.RESTRICTIVE_CLAUSE_EXPIRATION),
      hud_units: a.HUD_UNITS || 0,
      ra_units: a.RA_UNITS || 0,
      rental_designation: a.RENTAL_DESIGNATION || null,
      subsidy_type: subsidyType,
      mgmt_agent: a.MGMT_AGENT_NAME || null,
      program_type: 'preservation-candidate'
    }
  };
}

async function main() {
  console.log(`USDA Rural Housing Assets fetch (CO)`);
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

  // Expiration breakdown
  const buckets = { 'expired or 0-5y': 0, '5-10y': 0, '10-20y': 0, '20y+': 0, 'unknown': 0 };
  geoJson.features.forEach(f => {
    const y = f.properties.years_to_expiration;
    if (y == null) buckets['unknown']++;
    else if (y <= 5) buckets['expired or 0-5y']++;
    else if (y <= 10) buckets['5-10y']++;
    else if (y <= 20) buckets['10-20y']++;
    else buckets['20y+']++;
  });
  console.log('  Restrictive-clause expiration:');
  Object.entries(buckets).forEach(([k, n]) => console.log(`    ${k.padEnd(20)} ${n}`));

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(geoJson));
  console.log(`\n  Wrote ${OUT_PATH} (${(fs.statSync(OUT_PATH).size / 1024).toFixed(1)} KB)`);
}

main().catch(e => { console.error('::error::' + e.message); process.exit(1); });
