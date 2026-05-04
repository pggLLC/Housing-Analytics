# `js/market-analysis.js`

js/market-analysis.js
Public Market Analysis (PMA) scoring engine.

Responsibilities:
 - Leaflet map initialization & site marker placement
 - PMA circular buffer calculation via Haversine distance
 - ACS tract metric aggregation within buffer
 - HUD LIHTC project filtering & counting
 - 5-dimension weighted PMA scoring:
     Demand (30%), Capture Risk (25%), Rent Pressure (15%),
     Land/Supply (15%), Workforce (15%)
 - CHFA-style capture-rate simulator
 - JSON + CSV export utilities

Data loaded via DataService.getJSON() — no hardcoded fetch() calls.

## Symbols

### `_getCountyAmi(countyFips)`

Get county-specific 4-person AMI from HudFmr connector. Returns null
if the county FIPS can't be resolved or HudFmr hasn't loaded — callers
must handle the null case explicitly rather than relying on a statewide
substitute (see scoreRentPressure / workforce scorer for the pattern).
@param {string|null} countyFips - 5-digit county FIPS code
@returns {number|null} 4-person AMI in dollars, or null if unresolved

### `tractInBuffer(t, lat, lon, miles)`

Returns true when the circular buffer (centre lat/lon, radius in miles)
overlaps the tract.  When the tract carries a bounding-box derived from
the original polygon geometry we use a circle-bbox intersection test,
which correctly captures tracts that straddle the buffer boundary even
when their centroid lies just outside the radius.  Without a bbox we
fall back to the legacy centroid-distance check.

bbox format: [minLon, minLat, maxLon, maxLat]

### `computeCoverage()`

Compute statewide tract coverage vs. expected Colorado tract count.
@returns {{ loaded: number, expected: number, pct: number, isProductionReady: boolean, label: string }}

### `scoreRentPressure(acs, countyAmi)`

Score rent pressure: how far market rents exceed 60% AMI affordable threshold.

IMPORTANT: If countyAmi is not provided (e.g. county FIPS couldn't be
resolved from buffer tracts, or HudFmr data hasn't loaded), this returns
`unavailable: true` with score=null rather than silently substituting a
statewide AMI. CO AMI varies from ~$52k (rural counties) to ~$124k
(Denver MSA) — the statewide $95k default was systematically wrong by
±30% for most CO counties and could invert the rent-pressure signal
(flagging affordable markets as pressured, or vice versa) in the
direction that matters most for LIHTC decisions. Surfacing unavailable
is more honest than fabricating a number.

@param {Object} acs - Aggregated ACS tract metrics
@param {number} [countyAmi] - County-specific 4-person AMI
@returns {{ score: number|null, ratio: number, amiUsed: number|null, amiSource: string, unavailable: boolean }}

### `scoreMarketTightness(acs)`

Market tightness score based on vacancy rate.
NOTE: This measures how fully-occupied the existing housing stock is.
It does NOT measure land availability for new construction.
Low vacancy = tight market = strong demand signal.
@param {Object} acs
@returns {number} 0-100 score

### `_scoreWorkforceWithCoverage(acs, lat, lon, bufTracts, countyAmi)`

Internal workforce scorer that also returns data-coverage metadata.
@private

### `_computeLihtcRecency(nearbyFeatures)`

Compute LIHTC recency context from nearby features. A market with its
last allocation in 2018 reads very differently from one last funded
in 2024 — CHFA geographic-distribution scoring and competitive
saturation both depend on this temporal signal, which prior PMA
scoring ignored entirely.

@param {Array} nearbyFeatures - LIHTC GeoJSON features from lihtcInBuffer
@returns {{mostRecentYear:number|null, yearsSince:number|null, recentAllocations5yr:number, activityLevel:string, note:string|null}}

### `_wireAddressSearch()`

Wire up the "Find a Colorado address" input/button to the free US
Census Geocoder. Picks the first match, validates it's in Colorado
(STATE=08), then fires the existing placeSiteMarker + runAnalysis
flow — same code path as a map click.

### `_refreshIsochroneRings(lat, lon)`

Build the walking + biking concentric-ring overlay around (lat, lon).

Rings are computed as straight-line buffers (matching how CHFA QAP
scoring works for transit/amenity proximity points) — not network
isochrones. A future enhancement could fetch real network-aware
isochrones from OSRM or Valhalla and cache per-site, but for screening
the straight-line approximation is what reviewers actually use.

Honors the #pmaIsochroneToggle checkbox: rings are only added to the
map when checked, but the layer is built either way so toggling on/off
is instant.

### `_highlightTodTransit(lat, lon, radiusM)`

Find transit stops within ½ mile and render as highlighted markers.
Also counts them for the TOD score panel.

### `generatePmaPolygon(lat, lon, method, bufferMiles)`

Generate a PMA polygon using one of three methods:
  "buffer"    – legacy circular buffer (existing behaviour)
  "commuting" – LEHD/LODES commuting-flow polygon via PMACommuting
  "hybrid"    – commuting polygon further constrained by schools + transit

@param {number} lat
@param {number} lon
@param {string} [method]      - "buffer" | "commuting" | "hybrid" (default: "buffer")
@param {number} [bufferMiles] - radius for buffer method (default: 5)
@returns {Promise<{polygon: object|null, method: string, captureRate: number}>}
