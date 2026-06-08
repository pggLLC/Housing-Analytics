# `scripts/fetch-usda-rural-housing.js`

## Symbols

### `yearsToExpiration(expirationStr)`

fetch-usda-rural-housing.js

Fetches USDA Rural Housing Assets feature layer and writes to:
  data/affordable-housing/preservation/usda-rural-housing.json

Coverage in CO: ~116 properties.

Critical fields not available in other sources:
  - RESTRICTIVE_CLAUSE_EXPIRATION — the actual subsidy expiration date,
    which is the single most-important signal for preservation deal
    targeting (a property expiring within 5 years is a much hotter
    preservation candidate than one expiring in 30 years)
  - RA_UNITS — Rental Assistance units (Section 521 RA program)
  - HUD_UNITS — overlapping HUD-funded units within RD property
  - RENTAL_DESIGNATION — Family / Elderly / Special

Source: https://services.arcgis.com/VTyQ9soqVukalItT/arcgis/rest/services/USDA_Rural_Housing_Assets/FeatureServer/0

Run:  node scripts/fetch-usda-rural-housing.js
/

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
Compute years-to-expiration from RESTRICTIVE_CLAUSE_EXPIRATION (string).
Helps surface preservation urgency.
