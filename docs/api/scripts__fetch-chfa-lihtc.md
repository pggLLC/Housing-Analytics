# `scripts/fetch-chfa-lihtc.js`

## Symbols

### `WHERE_ALTERNATIVES`

fetch-chfa-lihtc.js
Fetches Colorado LIHTC property data from the CHFA ArcGIS FeatureServer and
saves it as data/chfa-lihtc.json (GeoJSON FeatureCollection) for use by
the front-end map (js/co-lihtc-map.js).

No API key required — the CHFA service is publicly accessible.

Run:  node scripts/fetch-chfa-lihtc.js

PERSISTENT BACKUP STRATEGY
---------------------------
This script is the "write" side of the multi-tier data fallback used by all
Colorado map pages (colorado-deep-dive.html, housing-needs-assessment.html,
LIHTC-dashboard.html).  The fallback order for each overlay is:

  1. Live API  (CHFA ArcGIS / HUD ArcGIS / HUD FeatureServer)
  2. Local file  data/chfa-lihtc.json  (written here by CI)
  3. GitHub Pages backup  https://pggllc.github.io/Housing-Analytics/data/chfa-lihtc.json
     (automatically updated each time the deploy.yml workflow runs and this
      script succeeds — the committed data/ files are served as static assets)
  4. Minimal embedded JSON  (hard-coded representative projects)

Running this script in CI (e.g., via .github/workflows/deploy.yml) keeps
tiers 2 and 3 current.  If the live API is ever unavailable, the site still
loads data from the most recent successful CI fetch.

CRITICAL DATA FILES
-------------------
The following files in /data/ are referenced by the UI and must be present
for all site panels to display fully.  They are NOT included as blank files
because they require live data to be useful:

  data/car-market.json
    Referenced by colorado-deep-dive.html (CAR market KPI panel).
    Supply via a scheduled GitHub Actions workflow (scripts/fetch-car-data.js)
    or by manually running that script and committing the output.

  data/prop123_jurisdictions.json
    Referenced by colorado-deep-dive.html (Prop 123 commitment table via
    js/prop123-map.js and js/colorado-deep-dive.js).
    Supply by running scripts/fetch-prop123.js or by populating it with
    jurisdiction data from the CDOLA commitment-filings portal.

Without these files the affected panels show a placeholder / warning message
rather than crashing, but real data is needed for a fully functional site.
/

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

/** Fallback WHERE clauses to probe when the primary clause returns 0 features.

### `PAGE_SIZE`

Maximum records to include per page query.

### `WHERE_CLAUSE`

WHERE clause filter — matches Colorado records regardless of how the state
field is stored: 'CO' (abbreviation), '08' (state FIPS), or 'Colorado'
(full name).  Defined in scripts/lihtc-co-query.json.

### `OUT_FIELDS`

Fields to request from the ArcGIS service.
Keeping this explicit list (rather than outFields=*) avoids pulling dozens
of internal geocoding/administrative columns and keeps the output file small.

Field reference (HUD / CHFA standard LIHTC schema):
  PROJECT   – Project name
  PROJ_ADD  – Street address
  PROJ_CTY  – City
  PROJ_ST   – State abbreviation
  CNTY_NAME – County name
  CNTY_FIPS – 5-digit county FIPS code
  STATEFP   – 2-digit state FIPS code
  COUNTYFP  – 3-digit county FIPS suffix
  N_UNITS   – Total housing units
  LI_UNITS  – Low-income restricted units
  YR_PIS    – Year placed in service
  YR_ALLOC  – Year of tax-credit allocation
  CREDIT    – Credit type ("9%" or "4%")
  NON_PROF  – Nonprofit sponsor flag (0/1)
  QCT       – Qualified Census Tract flag
  DDA       – Difficult Development Area flag

Note: CNTY_FIPS and COUNTYFP are requested from the service; when the
service does not return them they are derived locally from CNTY_NAME using
CO_COUNTY_FIPS below as a fallback.

### `CO_COUNTY_FIPS`

Lookup table: Colorado county name → 5-digit FIPS code.
Keys are lowercase for case-insensitive matching.
Covers all 64 Colorado counties (Census FIPS 08001–08125).

### `CO_CITY_TO_COUNTY_FIPS`

Lookup table: Colorado city/place name → 5-digit county FIPS.
Keys are uppercase to match the PROJ_CTY field in the CHFA ArcGIS response,
which returns city names in all-caps (e.g. "DENVER", "AURORA").
Used as a secondary fallback when the ArcGIS service omits CNTY_NAME.
Cities that straddle county lines are mapped to the county containing the
majority of the city's population / LIHTC inventory.

### `httpsRequest(host, pathAndQuery, retries = 3, postOptions)`

Make an HTTPS request and return the raw response body as a string.
Retries on 429 / 5xx with exponential backoff.

@param {string} host
@param {string} pathAndQuery
@param {number} [retries=3]
@param {object} [postOptions]  If provided, sends a POST with form-encoded body.
@param {string} postOptions.body  URL-encoded form body string.
@returns {Promise<string>}

### `httpsGet(host, pathAndQuery, retries = 3)`

Convenience wrapper for GET requests.

### `fetchLayerIds()`

Discover all layer IDs published by the LIHTC FeatureServer.
Uses the /layers endpoint so that every layer (point, polygon, etc.)
is included rather than hard-coding layer 0.

@returns {Promise<{ids: number[], meta: object[]}>}  Layer IDs and metadata.

### `fetchRecordsFromLayer(layerId, where = WHERE_CLAUSE)`

Fetch all Colorado LIHTC records from a single layer using WHERE clause and
resultOffset pagination.  Uses a WHERE clause with OR conditions covering
Proj_St='CO', Proj_St='08', and Proj_St='Colorado' to match records
regardless of how the state field is stored, avoiding the unreliable
objectIds parameter approach that causes HTTP 400 errors when passing large
ID arrays to the ArcGIS FeatureServer.

@param {number} layerId    ArcGIS FeatureServer layer ID.
@param {string} [where]    WHERE clause override; defaults to WHERE_CLAUSE.
@returns {Promise<object[]>}  Array of raw ArcGIS feature objects.

### `diagnoseLayerWhereClause(layerId)`

Probe a layer with alternative WHERE clauses to diagnose field-name changes.
Returns details about which clause worked (or none), to aid in fixing the
primary WHERE clause.  Uses resultRecordCount=1 to avoid pulling large sets.

@param {number} layerId
@returns {Promise<void>}

### `fetchAllRecords()`

Fetch all Colorado LIHTC records from every layer of the FeatureServer.

@returns {Promise<{features: object[], layerIds: number[]}>}  Combined raw features and IDs.

### `CO_FIPS_TO_COUNTY_NAME`

Reverse lookup: 5-digit county FIPS → Title-Case county name.
Built by inverting CO_COUNTY_FIPS at module load time.
Example: '08031' → 'Denver', '08067' → 'La Plata'.

### `resolveCntyFips(cntyName)`

Resolve a county name to its 5-digit Colorado FIPS code.
Normalises the input to lowercase and trims whitespace before lookup so
that alternate capitalisations and leading/trailing spaces don't silently
fail to match.

@param {string|null} cntyName  County name (e.g. "Denver", "La Plata").
@returns {string}  5-digit FIPS string (e.g. "08031") or empty string if unresolved.

### `resolveCntyNameFromFips(fips)`

Reverse-resolve a county name from a 5-digit Colorado FIPS code.
Returns the Title-Case county name (e.g. "Denver", "La Plata") or null.

@param {string|null} fips  5-digit FIPS (e.g. "08031").
@returns {string|null}

### `resolveCntyFipsFromCity(cityName)`

Resolve a county FIPS from a city/place name using CO_CITY_TO_COUNTY_FIPS.
Used as a secondary fallback when the ArcGIS service omits CNTY_NAME.
Normalises input to uppercase to match the table keys, which mirror the
all-caps PROJ_CTY values returned by the CHFA ArcGIS service.

@param {string|null} cityName  City/place name in any case (e.g. "Denver").
@returns {string}  5-digit FIPS string or empty string if unresolved.

### `normalizeCreditField(raw)`

Normalise the CREDIT field to a consistent percentage string ("9%" or "4%").

The HUD ArcGIS service has historically returned three different encodings:
  "9%"  — modern string (preferred)
  "4%"  — modern string (preferred)
  "1"   — legacy HUD integer code meaning 9% new-construction credit
  "2"   — legacy HUD integer code meaning 4% bond-financed credit

@param {*} raw  Raw CREDIT attribute value from ArcGIS.
@returns {string|null}  Normalised string ("9%" | "4%") or null if unknown.

### `toGeoJsonFeature(esriFeature)`

Convert an ArcGIS JSON feature to a GeoJSON Feature.
Handles Point geometry (x/y) only; skips features without valid geometry.

@param {object} esriFeature
@returns {object|null}  GeoJSON Feature or null if geometry is missing.
