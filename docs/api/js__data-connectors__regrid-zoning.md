# `js/data-connectors/regrid-zoning.js`

js/data-connectors/regrid-zoning.js

Regrid Parcel & Zoning API connector for authoritative parcel-level
zoning data. Provides multifamily/townhome suitability scoring based
on actual zoning codes, lot size, setbacks, and FAR.

Requires a Regrid API key (https://app.regrid.com/api/plans).
Set window.REGRID_API_KEY or pass key to init().

Falls back to OSM land-use proxy (landuse_zoning_proxy_co.geojson)
when no API key is configured.

Usage:
  <script src="js/data-connectors/regrid-zoning.js"></script>
  <script>
    RegridZoning.init({ apiKey: 'your-key' });
    RegridZoning.fetchParcels(lat, lon, radiusMiles).then(function(parcels) {
      // parcels = GeoJSON FeatureCollection with suitability scores
    });
  </script>

Zoning subtype mapping (from Regrid Standardized Zoning Schema):
  Residential → Single Family | Two Family | Multi Family | Mobile Home Park
  Commercial  → General Commercial | Office | Retail
  Mixed Use   → Mixed Use
  Industrial  → Light Industrial | Heavy Industrial

@see https://support.regrid.com/parcel-data/zoning-schema

## Symbols

### `_scoreSuitability(props)`

Score a parcel for multifamily / townhome development suitability.
Returns 0-100 composite score.

### `init(opts)`

Initialize the Regrid connector.
@param {Object} opts - { apiKey: string }

### `fetchParcels(lat, lon, radiusMiles)`

Fetch parcels within radius of a point.
Returns a Promise resolving to GeoJSON FeatureCollection with
mf_suitability scores on each feature.

@param {number} lat
@param {number} lon
@param {number} radiusMiles - Search radius in miles
@returns {Promise<Object>} GeoJSON FeatureCollection

### `_regridFetch(lat, lon, radiusMiles)`

Fetch from Regrid API v2 (requires API key).

### `_osmFallback(lat, lon, radiusMiles)`

OSM land-use proxy fallback (no API key needed).
Loads pre-built GeoJSON and filters to radius.

### `_filterByRadius(gj, lat, lon, radiusMiles)`

Filter GeoJSON features to those within radiusMiles of (lat, lon).

### `_haversine(lat1, lon1, lat2, lon2)`

Haversine distance in miles.

### `hasApiKey()`

Check if Regrid API key is configured.
@returns {boolean}

### `scoreSuitability(props)`

Get suitability score for a single parcel's properties.
Can be used externally for custom scoring.
@param {Object} props - Parcel properties
@returns {number} 0-100 suitability score
