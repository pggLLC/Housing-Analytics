# `js/public-land-overlay.js`

js/public-land-overlay.js
Public Lands & CLT Overlay — Phase 2.1

Detects public land ownership and Community Land Trust (CLT) presence
for a site (lat/lon or county FIPS), using preloaded county assessor data.
Estimates financial benefit of public land deals for affordable housing.

Non-goals:
  - Does NOT perform real-time GIS queries (data is preloaded)
  - Does NOT guarantee ownership — verify with county assessor
  - Does NOT assess zoning or entitlement status

Usage:
  PublicLandOverlay.load(countyOwnershipData).then(function () {
    var result = PublicLandOverlay.assess('08013');
    // or: PublicLandOverlay.assess(null, '08013');
  });

Exposed as window.PublicLandOverlay (browser) and module.exports (Node).

@typedef {Object} LandAssessResult
@property {string}       ownership      — owner name or 'Private'
@property {string}       ownerType      — 'county'|'municipal'|'housing-authority'|'clt'|'federal'|'tribal'|'private'
@property {boolean}      isCLT          — true if CLT organization present in county
@property {string|null}  cltName        — CLT org name if present
@property {boolean}      isFederal      — federal land flag
@property {boolean}      isTribal       — tribal land flag
@property {string}       opportunity    — 'strong'|'moderate'|'none'
@property {string}       narrative      — human-readable summary
@property {Object}       financialBenefit — { subsidy, explanation }

## Symbols

### `load(countyOwnershipData)`

Load county ownership data.
@param {Object} countyOwnershipData — parsed county-ownership.json content
@returns {Promise<void>}

### `assess(lat, lon, countyFips)`

Assess public land opportunity for a county.

@param {number|null}  lat           - Latitude (reserved for future parcel-level lookup)
@param {number|null}  lon           - Longitude (reserved for future parcel-level lookup)
@param {string}       countyFips    - 5-digit county FIPS code (e.g. '08013')
@returns {LandAssessResult}

### `isLoaded()`

Returns true if data has been loaded via load().
@returns {boolean}

### `listCLTs()`

List all CLT organizations across loaded counties.
@returns {Array<Object>} array of { county, fips, name, type, contactUrl }
