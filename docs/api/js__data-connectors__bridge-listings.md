# `js/data-connectors/bridge-listings.js`

js/data-connectors/bridge-listings.js
Bridge Data Output — MLS listing connector for the PMA Comparables layer.

Queries the Bridge Web API (JSON format) at:
  GET https://api.bridgedataoutput.com/api/v2/{dataset}/listings

Requires two values in window.APP_CONFIG:
  BRIDGE_BROWSER_TOKEN — your browser-side access token
  BRIDGE_DATASET        — your assigned dataset slug (e.g. "ires_co")

HOW TO ENABLE:
  1. Open the Data Quality Dashboard.
  2. Paste your Bridge Browser Token and Dataset Code.
  3. They are saved to localStorage and loaded into APP_CONFIG on every page.

HOW TO FIND YOUR DATASET CODE:
  Log in at https://bridgedataoutput.com → API Dashboard → your dataset name
  appears in the URL or in the "Datasets" panel (e.g. "ires_co", "recolorado").

Public API (window.BridgeListings):
  isAvailable()                               → boolean
  fetchActiveListingsNearPoint(lat, lon, miles, options)
                                              → Promise<Listing[]>
  fetchRecentSalesNearPoint(lat, lon, miles, options)
                                              → Promise<Listing[]>
  toGeoJsonFeature(listing)                   → GeoJSON Feature
  toMapMarker(listing)                        → {lat, lon, popup, icon}

Bridge Web API reference:
  https://bridgedataoutput.com/docs/explorer/reso-web-api
  https://bridgedataoutput.com/docs/explorer/bridge-web-api

## Symbols

### `isAvailable()`

Returns true when both token AND dataset code are configured.

### `_fetchListings(params)`

Fetch listings from Bridge Web API.

@param {object} params — key/value pairs appended as query string
@returns {Promise<object[]>}

### `fetchActiveListingsNearPoint(lat, lon, miles, options)`

Fetch ACTIVE residential listings within `miles` of a lat/lon.
Filters to apartments, condos, and multi-family units relevant to
LIHTC/affordable housing market analysis.

@param {number} lat
@param {number} lon
@param {number} [miles=1]        search radius
@param {object} [options]
@param {number} [options.limit]  max records (default 200)
@param {string} [options.types]  comma-separated property types
@returns {Promise<object[]>}

### `fetchRecentSalesNearPoint(lat, lon, miles, options)`

Fetch RECENTLY SOLD listings within `miles` of a lat/lon.
Defaults to the past 12 months.

@param {number} lat
@param {number} lon
@param {number} [miles=1]
@param {object} [options]
@param {number} [options.monthsBack=12]
@returns {Promise<object[]>}

### `_listingFields()`

The set of Bridge/RESO fields we request to keep payloads small.

### `toGeoJsonFeature(listing)`

Convert a Bridge listing record to a GeoJSON Feature.
Geometry uses Latitude/Longitude fields from the RESO standard.

@param {object} listing — raw Bridge API record
@returns {GeoJSON Feature}

### `toMapMarker(listing)`

Convert a listing to a lightweight map-marker descriptor for the PMA
Leaflet map layer.  Returns an object the PMA map code can consume
directly to place a circle marker with a popup.

@param {object} listing
@returns {{ lat, lon, popup, icon }}
