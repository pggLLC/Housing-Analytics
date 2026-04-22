# `js/data-connectors/regrid-parcels.js`

js/data-connectors/regrid-parcels.js
Regrid parcel data connector for the PMA Parcel & Zoning layer.

When a Regrid API key is present (window.APP_CONFIG.REGRID_API_KEY), this
module fetches live parcel data from the Regrid v2 Parcels API, enabling
per-parcel multifamily suitability visualization.

When the key is absent, it falls back to the pre-built local file:
  data/market/parcel_aggregates_co.json

HOW TO ENABLE LIVE REGRID DATA:
  1. Obtain an API key at https://regrid.com/api
  2. Add REGRID_API_KEY to your GitHub repository secrets
  3. The deploy/generate workflows will inject it into js/config.js at
     build time (see scripts/inject-config.py).
  4. Alternatively, set window.APP_CONFIG.REGRID_API_KEY directly in
     js/config.js for local development (do NOT commit the key).

Regrid v2 API reference:
  https://developers.regrid.com/reference/parcels-endpoint
  GET https://app.regrid.com/api/v2/parcels/point
    ?lat=<lat>&lon=<lon>&radius=<miles>&token=<key>

Public API (window.RegridParcels):
  isAvailable()                             → boolean
  fetchParcels(bbox, options)               → Promise<Feature[]>
  fetchParcelsNearPoint(lat, lon, miles)    → Promise<Feature[]>
  classifyParcel(feature)                   → {mfCompatible, vacantOrUnderutilized, isPrivate}

All returned parcels are GeoJSON Features with a `properties` object
containing standardized fields (see FIELD_MAP below).

## Symbols

### `FIELD_MAP`

Map Regrid property fields to our internal schema.
Regrid field names vary by state; these are the Colorado standard fields.

### `_normalizeFeature(feature)`

Normalize a Regrid GeoJSON feature into our standard schema.

### `classifyParcel(feature)`

Classify a normalized parcel feature for MF suitability.
@param {object} feature — normalized GeoJSON Feature
@returns {{ mfCompatible: boolean, vacantOrUnderutilized: boolean, isPrivate: boolean, score: number }}

### `isAvailable()`

Returns true when a live Regrid API key is configured.

### `fetchParcelsNearPoint(lat, lon, miles)`

Fetch parcels near a point, using live Regrid API when key is set,
or the local fallback otherwise.

@param {number} lat
@param {number} lon
@param {number} [miles=5]
@returns {Promise<object[]>} GeoJSON Feature array

### `fetchParcels(bbox, options)`

Fetch parcels within a bounding box. When live API is available,
converts to a center-point query; otherwise uses local fallback.

@param {{ minLat, minLon, maxLat, maxLon }} bbox
@param {{ maxResults?: number }} [options]
@returns {Promise<object[]>}
