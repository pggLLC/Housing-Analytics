# `scripts/fetch-chfa-preservation.js`

## Symbols

### `toGeoJsonFeature(esriFeature)`

fetch-chfa-preservation.js

Fetches CHFA's PreservationProperties_Layer_Final_view_new feature layer and
writes a HUD-compatible GeoJSON to data/affordable-housing/preservation/chfa-preservation.json.

The CHFA preservation layer tracks 1,690+ affordable rental properties in
Colorado that are at risk of subsidy loss — including:
  - Section 8 PBRA (HUD project-based rental assistance)
  - HUD Section 202 / 811 (elderly / disabled)
  - USDA Rural Development 515 / 521 / 538
  - HOME-funded properties
  - LIHTC properties approaching Year-15 compliance period end

The source schema is intentionally lean (property identity only —
UniqueProjID / PropertyAddress / City / State / Zip / ProjectName /
TotalNumberofUnits / Latitude / Longitude). Subsidy-type and expiration
details are NOT in this layer — they would need to be joined from
HUD's Multifamily Properties Assisted dataset or NHPD.

For the Opportunity Finder, this layer answers "where are the
existing affordable rental properties?" — used by the Preservation
deal-type (forthcoming).

Source: https://services3.arcgis.com/gSW3qyxbcpEXSMfe/arcgis/rest/services/PreservationProperties_Layer_Final_view_new/FeatureServer/0
Surfaced via: https://chfa.maps.arcgis.com (CHFA's public preservation map app)

Run:  node scripts/fetch-chfa-preservation.js

Output: data/affordable-housing/preservation/chfa-preservation.json
Format: GeoJSON FeatureCollection
Field aliases: HUD-compatible (PROJECT, PROJ_ADD, PROJ_CTY, PROJ_ST,
  N_UNITS) for site-wide consumer compatibility + the source's
  original UniqueProjID for joining to other CHFA datasets.
/

'use strict';

const https = require('https');
const fs = require('fs');
const path = require('path');

const HOST = 'services3.arcgis.com';
const BASE_PATH = '/gSW3qyxbcpEXSMfe/arcgis/rest/services/PreservationProperties_Layer_Final_view_new/FeatureServer/0';
const PAGE_SIZE = 2000;
const OUT_PATH = path.resolve(__dirname, '..', 'data/affordable-housing/preservation/chfa-preservation.json');

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'coho-analytics/1.0 (+github.com/pggLLC/Housing-Analytics)' } }, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        if (res.statusCode >= 400) return reject(new Error(`HTTP ${res.statusCode}: ${body.slice(0, 200)}`));
        try { resolve(JSON.parse(body)); } catch (e) { reject(new Error('Bad JSON: ' + e.message)); }
      });
    }).on('error', reject);
  });
}

async function fetchAllPages(whereClause) {
  const features = [];
  let offset = 0;
  while (true) {
    const url = `https://${HOST}${BASE_PATH}/query?` + new URLSearchParams({
      where: whereClause,
      outFields: '*',
      outSR: '4326',
      returnGeometry: 'true',
      resultOffset: String(offset),
      resultRecordCount: String(PAGE_SIZE),
      f: 'json'
    }).toString();
    console.log(`  fetching offset=${offset}…`);
    const page = await httpsGet(url);
    if (page.error) throw new Error('ArcGIS error: ' + JSON.stringify(page.error));
    const pageFeatures = page.features || [];
    features.push(...pageFeatures);
    if (pageFeatures.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return features;
}

/**
Convert a CHFA preservation feature to a HUD-compatible GeoJSON Feature.
Mirrors the schema-mapping pattern of scripts/fetch-chfa-lihtc.js so the
resulting file is shape-compatible with existing site consumers that
read PROJECT / PROJ_CTY / N_UNITS / etc.
