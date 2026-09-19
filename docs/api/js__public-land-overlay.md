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
@property {string|null}  ownership      — owner name, or null when county coverage is unavailable
@property {string|null}  ownerType      — 'county'|'municipal'|'housing-authority'|'clt'|'federal'|'tribal'|'private', or null when unavailable
@property {boolean|null} isCLT          — true if CLT organization present in county, or null when unavailable
@property {string|null}  cltName        — CLT org name if present
@property {boolean|null} isFederal      — federal land flag, or null when unavailable
@property {boolean|null} isTribal       — tribal land flag, or null when unavailable
@property {string|null}  opportunity    — 'strong'|'moderate'|'none', or null when unavailable
@property {string}       narrative      — human-readable summary
@property {string}       coverageStatus — 'researched'|'not_researched'
@property {string}       coverageLabel — display label carried with the coverage state
@property {string|null}  unavailableReason — reason carried with unavailable data
@property {Object}       financialBenefit — { subsidy, explanation }; values null when unavailable

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
