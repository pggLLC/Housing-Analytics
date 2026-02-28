#!/usr/bin/env node
/**
 * fetch-chfa-lihtc.js
 * Fetches Colorado LIHTC property data from the CHFA ArcGIS FeatureServer and
 * saves it as data/chfa-lihtc.json (GeoJSON FeatureCollection) for use by
 * the front-end map (js/co-lihtc-map.js).
 *
 * No API key required — the CHFA service is publicly accessible.
 *
 * Run:  node scripts/fetch-chfa-lihtc.js
 */

'use strict';

const https = require('https');
const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const CHFA_HOST = 'services.arcgis.com';
const CHFA_PATH =
  '/VTyQ9soqVukalItT/arcgis/rest/services/LIHTC/FeatureServer/0/query';
const DATA_DIR = path.resolve(__dirname, '..', 'data');
const OUTPUT_FILE = path.join(DATA_DIR, 'chfa-lihtc.json');

/** Maximum records to request per page (ArcGIS default cap is often 1000 or 2000). */
const PAGE_SIZE = 1000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Make an HTTPS GET request and return the raw response body as a string.
 * Retries on 429 / 5xx with exponential backoff.
 *
 * @param {string} host
 * @param {string} pathAndQuery
 * @param {number} [retries=3]
 * @returns {Promise<string>}
 */
function httpsGet(host, pathAndQuery, retries = 3) {
  function attempt(remaining) {
    return new Promise((resolve, reject) => {
      const options = {
        hostname: host,
        path: pathAndQuery,
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'HousingAnalytics-DataSync/1.0',
        },
      };

      const req = https.request(options, (res) => {
        if (res.statusCode === 429 || (res.statusCode >= 500 && res.statusCode < 600)) {
          res.resume();
          if (remaining > 0) {
            const delay = Math.pow(2, 3 - remaining) * 1000;
            console.warn(`  HTTP ${res.statusCode} — retrying in ${delay / 1000}s…`);
            return setTimeout(() => attempt(remaining - 1).then(resolve, reject), delay);
          }
          return reject(new Error(`HTTP ${res.statusCode} for ${pathAndQuery}`));
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode} for ${pathAndQuery}`));
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        res.on('error', reject);
      });
      req.on('error', reject);
      req.end();
    });
  }
  return attempt(retries);
}

/**
 * Fetch one page of ArcGIS JSON results.
 *
 * @param {number} offset  Record offset for pagination.
 * @returns {Promise<{features: object[], exceededTransferLimit: boolean}>}
 */
async function fetchPage(offset) {
  const params = new URLSearchParams({
    where: '1=1',
    outFields: '*',
    f: 'json',
    outSR: '4326',
    resultRecordCount: String(PAGE_SIZE),
    resultOffset: String(offset),
  });
  const pathAndQuery = `${CHFA_PATH}?${params.toString()}`;
  const body = await httpsGet(CHFA_HOST, pathAndQuery);
  const parsed = JSON.parse(body);
  if (parsed.error) {
    throw new Error(`ArcGIS error ${parsed.error.code}: ${parsed.error.message}`);
  }
  return {
    features: parsed.features || [],
    exceededTransferLimit: Boolean(parsed.exceededTransferLimit),
  };
}

/**
 * Convert an ArcGIS JSON feature to a GeoJSON Feature.
 * Handles Point geometry (x/y) only; skips features without valid geometry.
 *
 * @param {object} esriFeature
 * @returns {object|null}  GeoJSON Feature or null if geometry is missing.
 */
function toGeoJsonFeature(esriFeature) {
  const attrs = esriFeature.attributes || {};
  const geom = esriFeature.geometry;

  if (!geom || geom.x == null || geom.y == null) {
    return null;
  }

  return {
    type: 'Feature',
    geometry: {
      type: 'Point',
      coordinates: [geom.x, geom.y],
    },
    properties: attrs,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

(async () => {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  console.log('Fetching CHFA LIHTC data from ArcGIS FeatureServer…');

  const allFeatures = [];
  let offset = 0;
  let page = 0;

  // Paginate until the service stops returning more records.
  while (true) {
    page++;
    process.stdout.write(`  Page ${page} (offset ${offset})… `);
    const result = await fetchPage(offset);
    const converted = result.features.map(toGeoJsonFeature).filter(Boolean);
    allFeatures.push(...converted);
    console.log(`${converted.length} features (${allFeatures.length} total)`);

    if (!result.exceededTransferLimit || result.features.length === 0) {
      break;
    }
    offset += PAGE_SIZE;
  }

  const geojson = {
    type: 'FeatureCollection',
    fetchedAt: new Date().toISOString(),
    source: `https://${CHFA_HOST}${CHFA_PATH}`,
    features: allFeatures,
  };

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(geojson), 'utf8');
  console.log(`\nWrote ${OUTPUT_FILE} (${allFeatures.length} feature(s)).`);
})().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
