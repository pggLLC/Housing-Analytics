# `js/pma-barriers.js`

js/pma-barriers.js
Natural and manmade barrier analysis for PMA polygon refinement.

Responsibilities:
 - fetchUSGSHydrology(boundingBox) — water bodies and stream network
 - fetchNLCDLandCover(boundingBox) — land cover classification from NLCD
 - fetchStateHighways(boundingBox) — major highway barrier identification
 - subtractBarriers(pmaPolygon, barriers) — refine boundary by exclusion
 - getBarrierSummary() — audit-ready metrics on excluded areas

Exposed as window.PMABarriers.
Uses DataService when available; degrades gracefully with empty barrier sets.

## Symbols

### `_inBbox(lat, lon, bbox)`

Test whether a point {lat, lon} falls within a simple bounding-box polygon
approximation. Used for barrier exclusion scoring.
@param {number} lat
@param {number} lon
@param {{minLat,minLon,maxLat,maxLon}} bbox
@returns {boolean}

### `fetchUSGSHydrology(boundingBox)`

Fetch USGS National Map hydrology (water bodies and streams) within bbox.
@param {{minLat,minLon,maxLat,maxLon}} boundingBox
@returns {Promise<{waterBodies: Array, streams: Array}>}

### `fetchNLCDLandCover(boundingBox)`

Fetch NLCD land cover classification raster summary within bbox.
@param {{minLat,minLon,maxLat,maxLon}} boundingBox
@returns {Promise<{landCover: Array, classifications: Array}>}

### `fetchStateHighways(boundingBox)`

Fetch state DOT highway data within bbox.
@param {{minLat,minLon,maxLat,maxLon}} boundingBox
@returns {Promise<{highways: Array, majorRoutes: Array}>}

### `subtractBarriers(pmaPolygon, barriers)`

Classify barrier features and compute estimated exclusion percentages.

@param {object} pmaPolygon  - GeoJSON Polygon geometry for the candidate PMA
@param {{waterBodies:Array, highways:Array, landCover:Array}} barriers
@returns {{refinedBoundary: object, excludedAreas: object, barrierFeatures: Array}}

### `getBarrierSummary()`

Return audit-ready barrier exclusion metrics.
@returns {object}

### `MIN_BARRIER_AADT`

Minimum AADT (Annual Average Daily Traffic) to qualify as a significant
barrier. Below this threshold, roads are not considered barriers to
market area continuity.

### `_segmentsIntersect(x1, y1, x2, y2, x3, y3, x4, y4)`

Test whether two line segments intersect using the cross-product method.
Returns true if segment (p1→p2) crosses segment (p3→p4).

### `_extractBarrierSegments(features)`

Extract line segments from barrier GeoJSON features.
Only includes highways with AADT >= MIN_BARRIER_AADT and all water bodies.
@param {Array} features - barrier features from natural_barriers_co.geojson
@returns {Array} [{x1,y1,x2,y2}]

### `identifyExcludedTracts(siteLat, siteLon, tractCentroids, barrierFeatures)`

Identify census tracts that are "behind" a significant barrier
relative to the site location. A tract is excluded if any major
barrier segment intersects the straight line from the site to
the tract centroid.

This is a practical approximation: it does NOT clip the PMA polygon
(which would require turf.js), but instead removes tracts from the
ACS aggregation that are on the far side of a highway or water body.

@param {number} siteLat
@param {number} siteLon
@param {Array}  tractCentroids - [{geoid, lat, lon}]
@param {Array}  barrierFeatures - GeoJSON features from natural_barriers_co.geojson
@returns {Array} GEOIDs of excluded tracts
