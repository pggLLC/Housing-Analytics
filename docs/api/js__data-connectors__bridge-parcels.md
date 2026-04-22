# `js/data-connectors/bridge-parcels.js`

js/data-connectors/bridge-parcels.js
Bridge Data Output — Public Data connector for parcels & assessments.

Uses Bridge's NO-AUTH public endpoints:
  GET https://api.bridgedataoutput.com/api/v2/pub/parcels
  GET https://api.bridgedataoutput.com/api/v2/pub/assessments
  GET https://api.bridgedataoutput.com/api/v2/pub/transactions

These endpoints require your Browser Token as `access_token` query param.
No dataset code is needed — `pub` is a universal dataset.

HOW TO ENABLE:
  1. Register at https://bridgedataoutput.com and copy your Browser Token
  2. Open the Data Quality Dashboard and paste the token into
     "Bridge Interactive Browser Token" — it will be saved to localStorage
     and loaded into window.APP_CONFIG.BRIDGE_BROWSER_TOKEN on every page.

Public API (window.BridgeParcels):
  isAvailable()                              → boolean
  fetchParcelsNearPoint(lat, lon, miles)     → Promise<Feature[]>
  fetchAssessmentsNearPoint(lat, lon, miles) → Promise<object[]>
  fetchTransactionsNearPoint(lat, lon, miles)→ Promise<object[]>
  classifyParcel(feature)                    → {mfCompatible, vacant, isPrivate, score}

All GeoJSON features use our normalized internal schema so they are
drop-in replacements for RegridParcels.fetchParcelsNearPoint().

Bridge API reference:
  https://bridgedataoutput.com/docs/explorer/public-data

## Symbols

### `_nearParams(lat, lon, miles)`

Build a rough bounding-box string for Bridge's `near` filter.
Bridge supports: near=lat,lon&nearDistance=<miles>

### `_normalizeParcel(rec)`

Convert a Bridge /pub/parcels record into our internal GeoJSON Feature.
Bridge field names for public parcels come from the ATTOM / county data
standard. Adjust the map below if Bridge changes their schema.

### `fetchParcelsNearPoint(lat, lon, miles)`

Fetch parcels near a point.
Returns normalized GeoJSON Feature array — compatible with RegridParcels.

@param {number} lat
@param {number} lon
@param {number} [miles=1]
@returns {Promise<object[]>}

### `fetchAssessmentsNearPoint(lat, lon, miles)`

Fetch raw assessment records near a point.
@param {number} lat
@param {number} lon
@param {number} [miles=1]
@returns {Promise<object[]>}  Raw Bridge records

### `fetchTransactionsNearPoint(lat, lon, miles)`

Fetch recent deed/sales transactions near a point.
Useful for comparable-sales data without MLS access.

@param {number} lat
@param {number} lon
@param {number} [miles=1]
@returns {Promise<object[]>}  Raw Bridge records
