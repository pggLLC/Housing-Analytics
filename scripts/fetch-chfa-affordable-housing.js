#!/usr/bin/env node
/**
 * fetch-chfa-affordable-housing.js
 * Fetches the CHFA Colorado Affordable Housing Database from the CHFA ArcGIS
 * FeatureServer and saves it as data/chfa-affordable-housing.json (GeoJSON).
 *
 * This is the broader affordable housing inventory (1,690+ properties) that
 * includes LIHTC, Section 8, HOME, public housing, and other subsidized
 * projects.  It supplements (not replaces) the LIHTC-specific data in
 * data/chfa-lihtc.json.
 *
 * Source map: https://chfa.maps.arcgis.com/apps/instant/basic/index.html?appid=d90075bcf7e041b99b219e7b241a21db
 * ArcGIS service: https://services3.arcgis.com/gSW3qyxbcpEXSMfe/arcgis/rest/services/PreservationProperties_Layer_Final_view_new/FeatureServer/0
 *
 * No API key required — the service is publicly accessible.
 *
 * Run:  node scripts/fetch-chfa-affordable-housing.js
 */

'use strict';

const https = require('https');
const fs = require('fs');
const path = require('path');

const HOST = 'services3.arcgis.com';
const BASE_PATH = '/gSW3qyxbcpEXSMfe/arcgis/rest/services/PreservationProperties_Layer_Final_view_new/FeatureServer/0/query';
const PAGE_SIZE = 1000;
const OUTPUT_FILE = path.resolve(__dirname, '..', 'data', 'chfa-affordable-housing.json');

/**
 * Colorado city → 5-digit county FIPS lookup.
 * Keys are uppercase to match the City field as returned by the service.
 */
const CO_CITY_TO_COUNTY_FIPS = {
  'ALAMOSA':'08003','ARVADA':'08059','ASPEN':'08097','AURORA':'08005','AVON':'08037',
  'BASALT':'08097','BAYFIELD':'08067','BOULDER':'08013','BRECKENRIDGE':'08117','BRIGHTON':'08001',
  'BROOMFIELD':'08014','BRUSH':'08087','BUENA VISTA':'08015','BURLINGTON':'08063',
  'CANON CITY':'08043','CARBONDALE':'08045','CASTLE ROCK':'08035','CENTER':'08109',
  'CLIFTON':'08077','COLORADO SPRINGS':'08041','COMMERCE CITY':'08001','CORTEZ':'08083',
  'CRESTED BUTTE':'08051','DACONO':'08123','DEL NORTE':'08105','DELTA':'08029','DENVER':'08031',
  'DURANGO':'08067','EAGLE':'08037','ENGLEWOOD':'08005','ESTES PARK':'08069','EVANS':'08123',
  'FLORENCE':'08043','FORT COLLINS':'08069','FORT LUPTON':'08123','FORT MORGAN':'08087',
  'FOUNTAIN':'08041','FRASER':'08049','FRUITA':'08077','GLENDALE':'08005',
  'GLENWOOD SPRINGS':'08045','GOLDEN':'08059','GRAND JUNCTION':'08077','GREELEY':'08123',
  'GREENWOOD VILLAGE':'08005','GYPSUM':'08037','HIGHLANDS RANCH':'08035',
  'IDAHO SPRINGS':'08019','LA JUNTA':'08089','LAFAYETTE':'08013','LAKEWOOD':'08059',
  'LAMAR':'08099','LAS ANIMAS':'08071','LEADVILLE':'08065','LITTLETON':'08005',
  'LONGMONT':'08013','LOUISVILLE':'08013','LOVELAND':'08069','MANCOS':'08083',
  'MILLIKEN':'08123','MONTE VISTA':'08105','MONTROSE':'08085','NEDERLAND':'08013',
  'NEW CASTLE':'08045','NORTHGLENN':'08001','NUCLA':'08085','PAONIA':'08029','PARKER':'08035',
  'PONCHA SPRINGS':'08015','PUEBLO':'08101','PUEBLO WEST':'08101','RIFLE':'08045',
  'SALIDA':'08015','SHERIDAN':'08005','SILVERTHORNE':'08117','SOUTH FORK':'08105',
  'STEAMBOAT SPRINGS':'08107','STERLING':'08075','TELLURIDE':'08113','THORNTON':'08001',
  'VAIL':'08037','WALSENBURG':'08055','WESTMINSTER':'08001','WHEAT RIDGE':'08059',
  'WINDSOR':'08123','YUMA':'08125'
};

function httpsGet(pathAndQuery) {
  return new Promise((resolve, reject) => {
    https.get({
      hostname: HOST,
      path: pathAndQuery,
      headers: { 'User-Agent': 'HousingAnalytics-DataSync/1.0', 'Accept': 'application/json' }
    }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch (e) { reject(e); }
      });
      res.on('error', reject);
    }).on('error', reject);
  });
}

function toGeoJSON(f) {
  const a = f.attributes || {};
  const g = f.geometry;
  const lat = a.Latitude || (g && g.y);
  const lon = a.Longitude || (g && g.x);
  if (!lat || !lon) return null;

  const city = (a.City || '').trim().toUpperCase();
  const cntyFips = CO_CITY_TO_COUNTY_FIPS[city] || '';

  return {
    type: 'Feature',
    geometry: {
      type: 'Point',
      coordinates: [Math.round(lon * 1e6) / 1e6, Math.round(lat * 1e6) / 1e6]
    },
    properties: {
      PROJECT: a.ProjectName || null,
      PROJ_ADD: a.PropertyAddress || null,
      PROJ_CTY: a.City || null,
      PROJ_ST: a.State || 'CO',
      PROJ_ZIP: a.Zip || null,
      N_UNITS: a.TotalNumberofUnits || null,
      CNTY_FIPS: cntyFips || null,
      STATEFP: cntyFips ? cntyFips.slice(0, 2) : '08',
      COUNTYFP: cntyFips ? cntyFips.slice(2) : null,
      UNIQUE_ID: a.UniqueProjID || null,
      RECORD_ID: a.RecordID || null
    }
  };
}

(async () => {
  console.log('Fetching CHFA Colorado Affordable Housing Database…');
  console.log(`  Host: ${HOST}`);
  console.log(`  Service: PreservationProperties_Layer_Final_view_new`);

  const allFeatures = [];
  let offset = 0;
  let page = 0;

  for (;;) {
    page++;
    process.stdout.write(`  Page ${page} (offset ${offset})… `);
    const qs = `where=1%3D1&outFields=*&f=json&outSR=4326&resultOffset=${offset}&resultRecordCount=${PAGE_SIZE}`;
    const resp = await httpsGet(`${BASE_PATH}?${qs}`);
    if (resp.error) throw new Error(`ArcGIS error: ${resp.error.message}`);
    const feats = resp.features || [];
    allFeatures.push(...feats);
    console.log(`${feats.length} records (${allFeatures.length} total)`);
    if (!resp.exceededTransferLimit) break;
    offset += feats.length;
  }

  const geojsonFeatures = allFeatures.map(toGeoJSON).filter(Boolean);

  // Guard: never overwrite existing file with empty result
  if (geojsonFeatures.length === 0 && fs.existsSync(OUTPUT_FILE)) {
    const existing = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8'));
    const existingCount = (existing.features || []).length;
    if (existingCount > 0) {
      console.warn(`Fetch returned 0 features — preserving existing file with ${existingCount} features.`);
      process.exit(0);
    }
  }

  const geojson = {
    type: 'FeatureCollection',
    fetchedAt: new Date().toISOString(),
    source: `https://${HOST}/gSW3qyxbcpEXSMfe/arcgis/rest/services/PreservationProperties_Layer_Final_view_new/FeatureServer/0`,
    sourceApp: 'https://chfa.maps.arcgis.com/apps/instant/basic/index.html?appid=d90075bcf7e041b99b219e7b241a21db',
    sourceName: 'CHFA Colorado Affordable Housing Database',
    features: geojsonFeatures
  };

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(geojson), 'utf8');
  console.log(`\nWrote ${OUTPUT_FILE} (${geojsonFeatures.length} features).`);
})().catch(err => {
  console.error('::error::CHFA Affordable Housing fetch failed:', err.message);
  process.exit(1);
});
