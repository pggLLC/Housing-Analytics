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
 *
 * PERSISTENT BACKUP STRATEGY
 * ---------------------------
 * This script is the "write" side of the multi-tier data fallback used by all
 * Colorado map pages (colorado-deep-dive.html, housing-needs-assessment.html,
 * LIHTC-dashboard.html).  The fallback order for each overlay is:
 *
 *   1. Live API  (CHFA ArcGIS / HUD ArcGIS / HUD FeatureServer)
 *   2. Local file  data/chfa-lihtc.json  (written here by CI)
 *   3. GitHub Pages backup  https://pggllc.github.io/Housing-Analytics/data/chfa-lihtc.json
 *      (automatically updated each time the deploy.yml workflow runs and this
 *       script succeeds — the committed data/ files are served as static assets)
 *   4. Minimal embedded JSON  (hard-coded representative projects)
 *
 * Running this script in CI (e.g., via .github/workflows/deploy.yml) keeps
 * tiers 2 and 3 current.  If the live API is ever unavailable, the site still
 * loads data from the most recent successful CI fetch.
 *
 * CRITICAL DATA FILES
 * -------------------
 * The following files in /data/ are referenced by the UI and must be present
 * for all site panels to display fully.  They are NOT included as blank files
 * because they require live data to be useful:
 *
 *   data/car-market.json
 *     Referenced by colorado-deep-dive.html (CAR market KPI panel).
 *     Supply via a scheduled GitHub Actions workflow (scripts/fetch-car-data.js)
 *     or by manually running that script and committing the output.
 *
 *   data/prop123_jurisdictions.json
 *     Referenced by colorado-deep-dive.html (Prop 123 commitment table via
 *     js/prop123-map.js and js/colorado-deep-dive.js).
 *     Supply by running scripts/fetch-prop123.js or by populating it with
 *     jurisdiction data from the CDOLA commitment-filings portal.
 *
 * Without these files the affected panels show a placeholder / warning message
 * rather than crashing, but real data is needed for a fully functional site.
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

/**
 * Fields to request from the ArcGIS service.
 * Keeping this explicit list (rather than outFields=*) avoids pulling dozens
 * of internal geocoding/administrative columns and keeps the output file small.
 *
 * Field reference (HUD / CHFA standard LIHTC schema):
 *   PROJECT   – Project name
 *   PROJ_ADD  – Street address
 *   PROJ_CTY  – City
 *   PROJ_ST   – State abbreviation
 *   CNTY_NAME – County name
 *   CNTY_FIPS – 5-digit county FIPS code
 *   STATEFP   – 2-digit state FIPS code
 *   COUNTYFP  – 3-digit county FIPS suffix
 *   N_UNITS   – Total housing units
 *   LI_UNITS  – Low-income restricted units
 *   YR_PIS    – Year placed in service
 *   YR_ALLOC  – Year of tax-credit allocation
 *   CREDIT    – Credit type ("9%" or "4%")
 *   NON_PROF  – Nonprofit sponsor flag (0/1)
 *   QCT       – Qualified Census Tract flag
 *   DDA       – Difficult Development Area flag
 *
 * Note: CNTY_FIPS and COUNTYFP are requested from the service; when the
 * service does not return them they are derived locally from CNTY_NAME using
 * CO_COUNTY_FIPS below as a fallback.
 */
const OUT_FIELDS =
  'PROJECT,PROJ_ADD,PROJ_CTY,PROJ_ST,CNTY_NAME,CNTY_FIPS,STATEFP,COUNTYFP,N_UNITS,LI_UNITS,YR_PIS,YR_ALLOC,CREDIT,NON_PROF,QCT,DDA';

/**
 * Lookup table: Colorado county name → 5-digit FIPS code.
 * Keys are lowercase for case-insensitive matching.
 * Covers all 64 Colorado counties (Census FIPS 08001–08125).
 */
const CO_COUNTY_FIPS = {
  'adams':       '08001',
  'alamosa':     '08003',
  'arapahoe':    '08005',
  'archuleta':   '08007',
  'baca':        '08009',
  'bent':        '08011',
  'boulder':     '08013',
  'broomfield':  '08014',
  'chaffee':     '08015',
  'cheyenne':    '08017',
  'clear creek': '08019',
  'conejos':     '08021',
  'costilla':    '08023',
  'crowley':     '08025',
  'custer':      '08027',
  'delta':       '08029',
  'denver':      '08031',
  'dolores':     '08033',
  'douglas':     '08035',
  'eagle':       '08037',
  'elbert':      '08039',
  'el paso':     '08041',
  'fremont':     '08043',
  'garfield':    '08045',
  'gilpin':      '08047',
  'grand':       '08049',
  'gunnison':    '08051',
  'hinsdale':    '08053',
  'huerfano':    '08055',
  'jackson':     '08057',
  'jefferson':   '08059',
  'kiowa':       '08061',
  'kit carson':  '08063',
  'lake':        '08065',
  'la plata':    '08067',
  'larimer':     '08069',
  'las animas':  '08071',
  'lincoln':     '08073',
  'logan':       '08075',
  'mesa':        '08077',
  'mineral':     '08079',
  'moffat':      '08081',
  'montezuma':   '08083',
  'montrose':    '08085',
  'morgan':      '08087',
  'otero':       '08089',
  'ouray':       '08091',
  'park':        '08093',
  'phillips':    '08095',
  'pitkin':      '08097',
  'prowers':     '08099',
  'pueblo':      '08101',
  'rio blanco':  '08103',
  'rio grande':  '08105',
  'routt':       '08107',
  'saguache':    '08109',
  'san juan':    '08111',
  'san miguel':  '08113',
  'sedgwick':    '08115',
  'summit':      '08117',
  'teller':      '08119',
  'washington':  '08121',
  'weld':        '08123',
  'yuma':        '08125',
};

/**
 * Name of the unique row-identifier field on this service.
 * Used when retrieving all IDs for OBJECTID-based pagination.
 */
const OBJECT_ID_FIELD = 'OBJECTID';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Make an HTTPS request and return the raw response body as a string.
 * Retries on 429 / 5xx with exponential backoff.
 *
 * @param {string} host
 * @param {string} pathAndQuery
 * @param {number} [retries=3]
 * @param {object} [postOptions]  If provided, sends a POST with form-encoded body.
 * @param {string} postOptions.body  URL-encoded form body string.
 * @returns {Promise<string>}
 */
function httpsRequest(host, pathAndQuery, retries = 3, postOptions) {
  function attempt(remaining) {
    return new Promise((resolve, reject) => {
      const isPost = Boolean(postOptions);
      const options = {
        hostname: host,
        path: pathAndQuery,
        method: isPost ? 'POST' : 'GET',
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'HousingAnalytics-DataSync/1.0',
          ...(isPost && {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Content-Length': Buffer.byteLength(postOptions.body),
          }),
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
      if (isPost) req.write(postOptions.body);
      req.end();
    });
  }
  return attempt(retries);
}

/** Convenience wrapper for GET requests. */
function httpsGet(host, pathAndQuery, retries = 3) {
  return httpsRequest(host, pathAndQuery, retries);
}

/**
 * Fetch all OBJECTID values from the service in a single request.
 * This avoids offset-based pagination which many FeatureServer endpoints
 * do not support (returns error 400 with invalid query parameters).
 *
 * @returns {Promise<number[]>} Sorted array of all OBJECTIDs.
 */
async function fetchAllIds() {
  const params = new URLSearchParams({
    where: '1=1',
    returnIdsOnly: 'true',
    f: 'json',
  });
  const pathAndQuery = `${CHFA_PATH}?${params.toString()}`;
  const body = await httpsGet(CHFA_HOST, pathAndQuery);
  const parsed = JSON.parse(body);
  if (parsed.error) {
    throw new Error(`ArcGIS error ${parsed.error.code}: ${parsed.error.message}`);
  }
  const ids = parsed.objectIds || [];
  ids.sort((a, b) => a - b);
  return ids;
}

/**
 * Fetch a batch of ArcGIS features by their OBJECTID values.
 * Uses HTTP POST to avoid URL-length limits that cause HTTP 404 errors
 * when passing large numbers of IDs as query-string parameters.
 *
 * @param {number[]} ids  OBJECTID values to retrieve.
 * @returns {Promise<object[]>}
 */
async function fetchByIds(ids) {
  const params = new URLSearchParams({
    objectIds: ids.join(','),
    outFields: OUT_FIELDS,
    f: 'json',
    outSR: '4326',
  });
  const body = await httpsRequest(CHFA_HOST, CHFA_PATH, 3, { body: params.toString() });
  const parsed = JSON.parse(body);
  if (parsed.error) {
    throw new Error(`ArcGIS error ${parsed.error.code}: ${parsed.error.message}`);
  }
  return parsed.features || [];
}

/**
 * Resolve a county name to its 5-digit Colorado FIPS code.
 * Normalises the input to lowercase and trims whitespace before lookup so
 * that alternate capitalisations and leading/trailing spaces don't silently
 * fail to match.
 *
 * @param {string|null} cntyName  County name (e.g. "Denver", "La Plata").
 * @returns {string}  5-digit FIPS string (e.g. "08031") or empty string if unresolved.
 */
function resolveCntyFips(cntyName) {
  if (!cntyName) return '';
  const key = String(cntyName).trim().toLowerCase();
  return CO_COUNTY_FIPS[key] || '';
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

  const cntyFips = resolveCntyFips(attrs.CNTY_NAME ?? null);
  // COUNTYFP is the 3-digit suffix of the 5-digit CNTY_FIPS (e.g. "031").
  const countyFp = cntyFips ? cntyFips.slice(2) : '';

  return {
    type: 'Feature',
    geometry: {
      type: 'Point',
      // Round to 6 decimal places (~0.1 m accuracy) to keep the file small.
      coordinates: [
        Math.round(geom.x * 1e6) / 1e6,
        Math.round(geom.y * 1e6) / 1e6,
      ],
    },
    // Explicitly pick only the fields consumed by the front-end so that
    // extra ArcGIS attributes don't inflate the output file.
    properties: {
      PROJECT:   attrs.PROJECT   ?? null,
      PROJ_ADD:  attrs.PROJ_ADD  ?? null,
      PROJ_CTY:  attrs.PROJ_CTY  ?? null,
      PROJ_ST:   attrs.PROJ_ST   ?? null,
      CNTY_NAME: attrs.CNTY_NAME ?? null,
      CNTY_FIPS: (attrs.CNTY_FIPS ?? cntyFips) || null,
      STATEFP:   attrs.STATEFP   ?? null,
      COUNTYFP:  (attrs.COUNTYFP ?? countyFp) || null,
      N_UNITS:   attrs.N_UNITS   ?? null,
      LI_UNITS:  attrs.LI_UNITS  ?? null,
      YR_PIS:    attrs.YR_PIS    ?? null,
      YR_ALLOC:  attrs.YR_ALLOC  ?? null,
      CREDIT:    attrs.CREDIT    ?? null,
      NON_PROF:  attrs.NON_PROF  ?? null,
      QCT:       attrs.QCT       ?? null,
      DDA:       attrs.DDA       ?? null,
    },
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

  process.stdout.write('  Fetching all OBJECTIDs… ');
  const allIds = await fetchAllIds();
  console.log(`${allIds.length} record(s) found`);

  const allFeatures = [];
  let page = 0;

  // Iterate over OBJECTID chunks to avoid offset-based pagination,
  // which is not supported by all ArcGIS FeatureServer endpoints.
  for (let i = 0; i < allIds.length; i += PAGE_SIZE) {
    page++;
    const chunk = allIds.slice(i, i + PAGE_SIZE);
    process.stdout.write(`  Page ${page} (${chunk.length} record(s))… `);
    const rawFeatures = await fetchByIds(chunk);
    const converted = rawFeatures.map(toGeoJsonFeature).filter(Boolean);
    allFeatures.push(...converted);
    console.log(`${converted.length} features (${allFeatures.length} total)`);
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
