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
// Configuration — loaded from lihtc-co-query.json
// ---------------------------------------------------------------------------

const QUERY_CONFIG = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'lihtc-co-query.json'), 'utf8')
);

const CHFA_HOST = QUERY_CONFIG.host;
const CHFA_BASE = QUERY_CONFIG.basePath;
const CHFA_LAYERS_PATH = QUERY_CONFIG.layersPath + '?f=json';
const DATA_DIR = path.resolve(__dirname, '..', 'data');
const OUTPUT_FILE = path.join(__dirname, '..', QUERY_CONFIG.outputFile);

/**
 * Maximum records to include per page query.
 */
const PAGE_SIZE = QUERY_CONFIG.pageSize;

/**
 * WHERE clause filter — matches Colorado records regardless of how the state
 * field is stored: 'CO' (abbreviation), '08' (state FIPS), or 'Colorado'
 * (full name).  Defined in scripts/lihtc-co-query.json.
 */
const WHERE_CLAUSE = QUERY_CONFIG.where;

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
const OUT_FIELDS = QUERY_CONFIG.outFields;

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
 * Lookup table: Colorado city/place name → 5-digit county FIPS.
 * Keys are uppercase to match the PROJ_CTY field in the CHFA ArcGIS response,
 * which returns city names in all-caps (e.g. "DENVER", "AURORA").
 * Used as a secondary fallback when the ArcGIS service omits CNTY_NAME.
 * Cities that straddle county lines are mapped to the county containing the
 * majority of the city's population / LIHTC inventory.
 */
const CO_CITY_TO_COUNTY_FIPS = {
  'ALAMOSA':           '08003', // Alamosa County
  'ALMA':              '08093', // Park County
  'ANTONITO':          '08021', // Conejos County
  'ARVADA':            '08059', // Jefferson County (majority)
  'ASPEN':             '08097', // Pitkin County
  'AURORA':            '08005', // Arapahoe County (majority)
  'AVON':              '08037', // Eagle County
  'BASALT':            '08097', // Pitkin County
  'BAYFIELD':          '08067', // La Plata County
  'BOULDER':           '08013', // Boulder County
  'BRECKENRIDGE':      '08117', // Summit County
  'BRIGHTON':          '08001', // Adams County
  'BROOMFIELD':        '08014', // Broomfield County
  'BRUSH':             '08087', // Morgan County
  'BUENA VISTA':       '08015', // Chaffee County
  'BURLINGTON':        '08063', // Kit Carson County
  'CANON CITY':        '08043', // Fremont County
  'CARBONDALE':        '08045', // Garfield County
  'CASTLE ROCK':       '08035', // Douglas County
  'CENTER':            '08109', // Saguache County
  'CENTRAL CITY':      '08047', // Gilpin County
  'CLIFTON':           '08077', // Mesa County
  'COLORADO SPRINGS':  '08041', // El Paso County
  'COMMERCE CITY':     '08001', // Adams County
  'CORTEZ':            '08083', // Montezuma County
  'CRESTED BUTTE':     '08051', // Gunnison County
  'DACONO':            '08123', // Weld County
  'DEL NORTE':         '08105', // Rio Grande County
  'DELTA':             '08029', // Delta County
  'DENVER':            '08031', // Denver County
  'DIVIDE':            '08119', // Teller County
  'DURANGO':           '08067', // La Plata County
  'EAGLE':             '08037', // Eagle County
  'ENGLEWOOD':         '08005', // Arapahoe County
  'ESTES PARK':        '08069', // Larimer County
  'EVANS':             '08123', // Weld County
  'EVERGREEN':         '08059', // Jefferson County
  'FLORENCE':          '08043', // Fremont County
  'FORT COLLINS':      '08069', // Larimer County
  'FORT LUPTON':       '08123', // Weld County
  'FORT MORGAN':       '08087', // Morgan County
  'FOUNTAIN':          '08041', // El Paso County
  'FRASER':            '08049', // Grand County
  'FRUITA':            '08077', // Mesa County
  'GLENDALE':          '08005', // Arapahoe County
  'GLENWOOD SPRINGS':  '08045', // Garfield County
  'GOLDEN':            '08059', // Jefferson County
  'GRAND JUNCTION':    '08077', // Mesa County
  'GREELEY':           '08123', // Weld County
  'GREENWOOD VILLAGE': '08005', // Arapahoe County
  'GYPSUM':            '08037', // Eagle County
  'HIGHLANDS RANCH':   '08035', // Douglas County
  'IDAHO SPRINGS':     '08019', // Clear Creek County
  'KEYSTONE':          '08117', // Summit County
  'LA JUNTA':          '08089', // Otero County
  'LAFAYETTE':         '08013', // Boulder County
  'LAKEWOOD':          '08059', // Jefferson County
  'LAMAR':             '08099', // Prowers County
  'LAS ANIMAS':        '08071', // Las Animas County (city)
  'LEADVILLE':         '08065', // Lake County
  'LITTLETON':         '08005', // Arapahoe County (majority)
  'LONGMONT':          '08013', // Boulder County
  'LOUISVILLE':        '08013', // Boulder County
  'LOVELAND':          '08069', // Larimer County
  'MANCOS':            '08083', // Montezuma County
  'MILLIKEN':          '08123', // Weld County
  'MONTE VISTA':       '08105', // Rio Grande County
  'MONTROSE':          '08085', // Montrose County
  'NEDERLAND':         '08013', // Boulder County
  'NEW CASTLE':        '08045', // Garfield County
  'NORTHGLENN':        '08001', // Adams County
  'NORWOOD':           '08113', // San Miguel County
  'NUCLA':             '08085', // Montrose County
  'PAONIA':            '08029', // Delta County
  'PARKER':            '08035', // Douglas County
  'PONCHA SPRINGS':    '08015', // Chaffee County
  'PUEBLO':            '08101', // Pueblo County
  'PUEBLO WEST':       '08101', // Pueblo County
  'RIFLE':             '08045', // Garfield County
  'SALIDA':            '08015', // Chaffee County
  'SHERIDAN':          '08005', // Arapahoe County
  'SILVER CLIFF':      '08027', // Custer County
  'SILVERTHORNE':      '08117', // Summit County
  'SOUTH FORK':        '08105', // Rio Grande County
  'STEAMBOAT SPRINGS': '08107', // Routt County
  'STERLING':          '08075', // Logan County
  'TELLURIDE':         '08113', // San Miguel County
  'THORNTON':          '08001', // Adams County
  'VAIL':              '08037', // Eagle County
  'WALSENBURG':        '08055', // Huerfano County
  'WESTMINSTER':       '08001', // Adams County (majority)
  'WHEAT RIDGE':       '08059', // Jefferson County
  'WINDSOR':           '08123', // Weld County
  'YUMA':              '08125', // Yuma County
};

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
 * Discover all layer IDs published by the LIHTC FeatureServer.
 * Uses the /layers endpoint so that every layer (point, polygon, etc.)
 * is included rather than hard-coding layer 0.
 *
 * @returns {Promise<number[]>}  Array of integer layer IDs.
 */
async function fetchLayerIds() {
  console.log(`Fetching layer list from ${CHFA_LAYERS_PATH}…`);
  const body = await httpsGet(CHFA_HOST, CHFA_LAYERS_PATH);
  const parsed = JSON.parse(body);
  if (parsed.error) {
    throw new Error(`ArcGIS layers error ${parsed.error.code}: ${parsed.error.message}`);
  }
  const layers = (Array.isArray(parsed.layers) ? parsed.layers : []).concat(
    Array.isArray(parsed.tables) ? parsed.tables : []
  );
  if (!layers.length) {
    // Fall back to layer 0 if the service doesn't advertise layers
    console.warn('  No layers returned — defaulting to layer 0.');
    return [0];
  }
  const ids = layers.map((l) => l.id);
  console.log(`  Found layer(s): ${ids.join(', ')}`);
  return ids;
}

/**
 * Fetch all Colorado LIHTC records from a single layer using WHERE clause and
 * resultOffset pagination.  Uses a WHERE clause with OR conditions covering
 * Proj_St='CO', Proj_St='08', and Proj_St='Colorado' to match records
 * regardless of how the state field is stored, avoiding the unreliable
 * objectIds parameter approach that causes HTTP 400 errors when passing large
 * ID arrays to the ArcGIS FeatureServer.
 *
 * @param {number} layerId  ArcGIS FeatureServer layer ID.
 * @returns {Promise<object[]>}  Array of raw ArcGIS feature objects.
 */
async function fetchRecordsFromLayer(layerId) {
  const queryPath = `${CHFA_BASE}/${layerId}/query`;
  const allFeatures = [];
  let offset = 0;
  let page = 0;

  for (;;) {
    page++;
    process.stdout.write(`  Layer ${layerId} — page ${page} (offset ${offset})… `);
    const params = new URLSearchParams({
      where: WHERE_CLAUSE,
      outFields: OUT_FIELDS,
      f: 'json',
      outSR: '4326',
      resultOffset: String(offset),
      resultRecordCount: String(PAGE_SIZE),
    });
    const pathAndQuery = `${queryPath}?${params.toString()}`;
    const body = await httpsGet(CHFA_HOST, pathAndQuery);
    const parsed = JSON.parse(body);
    if (parsed.error) {
      throw new Error(`ArcGIS error ${parsed.error.code}: ${parsed.error.message}`);
    }
    const features = parsed.features || [];
    allFeatures.push(...features);
    console.log(`${features.length} record(s) (${allFeatures.length} total)`);

    if (!parsed.exceededTransferLimit) {
      break;
    }
    offset += features.length;
  }

  return allFeatures;
}

/**
 * Fetch all Colorado LIHTC records from every layer of the FeatureServer.
 *
 * @returns {Promise<object[]>}  Combined array of raw ArcGIS feature objects.
 */
async function fetchAllRecords() {
  const layerIds = await fetchLayerIds();
  const allFeatures = [];
  for (const id of layerIds) {
    const features = await fetchRecordsFromLayer(id);
    allFeatures.push(...features);
  }
  return allFeatures;
}

/**
 * Reverse lookup: 5-digit county FIPS → Title-Case county name.
 * Built by inverting CO_COUNTY_FIPS at module load time.
 * Example: '08031' → 'Denver', '08067' → 'La Plata'.
 */
const CO_FIPS_TO_COUNTY_NAME = Object.fromEntries(
  Object.entries(CO_COUNTY_FIPS).map(([name, fips]) => [
    fips,
    name.replace(/\b\w/g, (c) => c.toUpperCase()),
  ])
);

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
 * Reverse-resolve a county name from a 5-digit Colorado FIPS code.
 * Returns the Title-Case county name (e.g. "Denver", "La Plata") or null.
 *
 * @param {string|null} fips  5-digit FIPS (e.g. "08031").
 * @returns {string|null}
 */
function resolveCntyNameFromFips(fips) {
  if (!fips) return null;
  return CO_FIPS_TO_COUNTY_NAME[String(fips).trim()] || null;
}

/**
 * Resolve a county FIPS from a city/place name using CO_CITY_TO_COUNTY_FIPS.
 * Used as a secondary fallback when the ArcGIS service omits CNTY_NAME.
 * Normalises input to uppercase to match the table keys, which mirror the
 * all-caps PROJ_CTY values returned by the CHFA ArcGIS service.
 *
 * @param {string|null} cityName  City/place name in any case (e.g. "Denver").
 * @returns {string}  5-digit FIPS string or empty string if unresolved.
 */
function resolveCntyFipsFromCity(cityName) {
  if (!cityName) return '';
  const key = String(cityName).trim().toUpperCase();
  return CO_CITY_TO_COUNTY_FIPS[key] || '';
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

  // Resolve county FIPS:
  //   1. CNTY_FIPS from the ArcGIS service (ideal, but often absent)
  //   2. Derived from CNTY_NAME using the county name lookup table
  //   3. Derived from PROJ_CTY using the city→county lookup table (fallback)
  const cntyFipsFromName = resolveCntyFips(attrs.CNTY_NAME ?? null);
  const cntyFipsFromCity = resolveCntyFipsFromCity(attrs.PROJ_CTY ?? null);
  const cntyFips = (attrs.CNTY_FIPS ?? cntyFipsFromName || cntyFipsFromCity) || '';
  // COUNTYFP is the 3-digit suffix of the 5-digit CNTY_FIPS (e.g. "031").
  const countyFp = cntyFips ? cntyFips.slice(2) : '';
  // STATEFP is always "08" for Colorado; derive if absent.
  const stateFp = attrs.STATEFP ?? (cntyFips ? cntyFips.slice(0, 2) : null) ?? null;
  // Resolve county name: prefer service value; fall back to reverse FIPS lookup so
  // CNTY_NAME is never left null when CNTY_FIPS is known.
  const cntyName = attrs.CNTY_NAME ?? resolveCntyNameFromFips(cntyFips) ?? null;

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
      CNTY_NAME: cntyName,
      CNTY_FIPS: cntyFips || null,
      STATEFP:   stateFp,
      COUNTYFP:  countyFp || null,
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

  const rawFeatures = await fetchAllRecords();
  const allFeatures = rawFeatures.map(toGeoJsonFeature).filter(Boolean);
  console.log(`\n${allFeatures.length} feature(s) converted from ${rawFeatures.length} record(s).`);

  const geojson = {
    type: 'FeatureCollection',
    fetchedAt: new Date().toISOString(),
    source: `https://${CHFA_HOST}${CHFA_BASE}/layers`,
    features: allFeatures,
  };

  // Guard: never overwrite an existing populated file with an empty result.
  // An empty fetch most likely means the ArcGIS service was temporarily
  // unavailable.  Preserving the previous file keeps the map functional.
  if (allFeatures.length === 0 && fs.existsSync(OUTPUT_FILE)) {
    const existing = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8'));
    const existingCount = (existing.features || []).length;
    if (existingCount > 0) {
      console.warn(`\nFetch returned 0 features but ${OUTPUT_FILE} already has ${existingCount} features — preserving existing file.`);
      process.exit(0);
    }
  }

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(geojson), 'utf8');
  console.log(`\nWrote ${OUTPUT_FILE} (${allFeatures.length} feature(s)).`);
})().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
