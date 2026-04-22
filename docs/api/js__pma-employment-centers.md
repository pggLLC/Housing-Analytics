# `js/pma-employment-centers.js`

js/pma-employment-centers.js
Employment cluster identification from LODES workplace data.

Responsibilities:
 - clusterByJobDensity(workplaces, minClusterJobs) — spatial clustering
 - identifyMajorCorridors(clusters) — linear employment corridors
 - mapCommutingFlowsToCenters(centers, flows) — match flows to employers
 - scoreEmploymentAccessibility(siteLat, siteLon, centers) — weighted score
 - getEmploymentLayer() — GeoJSON layer for map display

Exposed as window.PMAEmploymentCenters.

## Symbols

### `clusterByJobDensity(workplaces, minJobs)`

Cluster workplace features by spatial proximity and job density.
Uses a greedy single-linkage approach appropriate for browser execution.

@param {Array}  workplaces      - Array of {lat, lon, jobCount, industry}
@param {number} [minJobs]       - Minimum jobs to form a cluster center
@returns {Array} clusters sorted by job count descending

### `identifyMajorCorridors(clusters)`

Identify linear employment corridors from cluster locations.
Corridors are pairs of high-density clusters within 5 miles of each other.

@param {Array} clusters - Output of clusterByJobDensity
@returns {Array} corridors with start/end center and combined job count

### `mapCommutingFlowsToCenters(centers, flows)`

Match commuting flows (origin zones) to nearest employment centers.
@param {Array} centers - Employment cluster array
@param {Array} flows   - Origin zone array from PMACommuting
@returns {Array} flows with added nearestCenter field

### `scoreEmploymentAccessibility(siteLat, siteLon, centers)`

Calculate a 0–100 employment accessibility score for a proposed site.
Weights nearby employment centers by job count and distance.

@param {number} siteLat
@param {number} siteLon
@param {Array}  centers
@returns {number} 0–100 score

### `getEmploymentLayer(centers)`

Build a GeoJSON FeatureCollection for the employment center map layer.
@param {Array} [centers]
@returns {object} GeoJSON FeatureCollection
