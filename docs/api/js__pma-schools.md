# `js/pma-schools.js`

js/pma-schools.js
School district boundary integration for PMA delineation.

Responsibilities:
 - fetchSchoolBoundaries(boundingBox) — ED attendance boundaries + NCES metrics
 - alignPMAWithSchools(pmaPolygon, schoolDistricts) — boundary alignment
 - scoreSchoolAccessibility(siteLat, siteLon, schools) — 0–100 score
 - getSchoolLayer() — GeoJSON layer with performance overlay
 - getSchoolJustification() — audit-ready school data summary

School catchment area alignment is a key resident draw factor for
family-size affordable housing projects.

Exposed as window.PMASchools.

## Symbols

### `fetchSchoolBoundaries(boundingBox)`

Fetch school attendance boundaries and NCES performance metrics.
@param {{minLat,minLon,maxLat,maxLon}} boundingBox
@returns {Promise<{schoolDistricts: Array, schools: Array}>}

### `alignPMAWithSchools(pmaPolygon, schoolDistricts)`

Align PMA boundary with school catchment areas.
Returns a list of school districts that overlap the PMA polygon,
annotated with performance metrics.

@param {object} pmaPolygon      - GeoJSON Polygon geometry
@param {Array}  schoolDistricts - Array from fetchSchoolBoundaries
@returns {{alignedDistricts: Array, alignmentRationale: string, districtCount: number}}

### `scoreSchoolAccessibility(siteLat, siteLon, schools)`

Calculate a 0–100 school accessibility score for a proposed site.
Weighs proximity (60 %) and performance (40 %).

@param {number} siteLat
@param {number} siteLon
@param {Array}  schools  - Array of school objects with lat, lon, performanceScore
@returns {number} 0–100

### `getSchoolLayer(schools)`

Build a GeoJSON FeatureCollection for the school layer map display.
@param {Array} [schools]
@returns {object} GeoJSON FeatureCollection

### `getSchoolJustification()`

Export school integration data for ScoreRun audit trail.
@returns {object}
