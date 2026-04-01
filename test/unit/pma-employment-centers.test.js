// test/unit/pma-employment-centers.test.js
//
// Unit tests for js/pma-employment-centers.js
//
// Verifies:
//   1. Public API is fully exposed.
//   2. clusterByJobDensity — empty / null input returns [].
//   3. clusterByJobDensity — workplaces below minJobs threshold produce no cluster.
//   4. clusterByJobDensity — nearby workplaces are merged into one cluster.
//   5. clusterByJobDensity — distant workplaces produce separate clusters.
//   6. clusterByJobDensity — cluster cap enforces MAX_CENTERS (10).
//   7. clusterByJobDensity — dominantIndustry is assigned.
//   8. clusterByJobDensity — isAttractor flag set when jobCount >= minJobs×3.
//   9. identifyMajorCorridors — returns [] for fewer than 2 clusters.
//  10. identifyMajorCorridors — pairs within 5 miles become corridors.
//  11. identifyMajorCorridors — distant clusters are not paired.
//  12. mapCommutingFlowsToCenters — appends nearestCenter and distToCenter fields.
//  13. mapCommutingFlowsToCenters — handles empty centers / flows gracefully.
//  14. scoreEmploymentAccessibility — returns 50 when no centers.
//  15. scoreEmploymentAccessibility — collocated site scores near 100.
//  16. scoreEmploymentAccessibility — distant site scores low.
//  17. getEmploymentLayer — returns valid GeoJSON FeatureCollection.
//
// Usage: node test/unit/pma-employment-centers.test.js

'use strict';

const path = require('path');

// pma-employment-centers.js supports both window and module.exports
const PMAEmploymentCenters = require(path.join(__dirname, '../../js/pma-employment-centers.js'));

let passed = 0, failed = 0;

function assert(cond, msg) {
  if (cond) { console.log('  ✅ PASS:', msg); passed++; }
  else       { console.error('  ❌ FAIL:', msg); failed++; }
}

function test(name, fn) {
  console.log('\n[test]', name);
  try { fn(); }
  catch (e) { console.error('  ❌ FAIL: threw —', e.message); failed++; }
}

const EC = PMAEmploymentCenters;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

// Two workplaces very close together (Denver area, ~0.1 miles apart)
const CLOSE_WP = [
  { lat: 39.7392, lon: -104.9847, jobCount: 400,  industry: 'Healthcare' },
  { lat: 39.7400, lon: -104.9850, jobCount: 300,  industry: 'Healthcare' },
  { lat: 39.7395, lon: -104.9848, jobCount: 200,  industry: 'Finance' },
];

// Two workplaces far apart (~35 miles)
const FAR_WP = [
  { lat: 39.7392, lon: -104.9847, jobCount: 800, industry: 'Tech' },
  { lat: 39.3523, lon: -104.8689, jobCount: 600, industry: 'Retail' },
];

// ---------------------------------------------------------------------------
// 1. API exposure
// ---------------------------------------------------------------------------

test('PMAEmploymentCenters API is fully exposed', function () {
  assert(typeof EC === 'object',                                 'PMAEmploymentCenters is an object');
  assert(typeof EC.clusterByJobDensity          === 'function', 'clusterByJobDensity exported');
  assert(typeof EC.identifyMajorCorridors       === 'function', 'identifyMajorCorridors exported');
  assert(typeof EC.mapCommutingFlowsToCenters   === 'function', 'mapCommutingFlowsToCenters exported');
  assert(typeof EC.scoreEmploymentAccessibility === 'function', 'scoreEmploymentAccessibility exported');
  assert(typeof EC.getEmploymentLayer           === 'function', 'getEmploymentLayer exported');
});

// ---------------------------------------------------------------------------
// 2. clusterByJobDensity — empty / null input
// ---------------------------------------------------------------------------

test('clusterByJobDensity returns [] for null input', function () {
  assert(Array.isArray(EC.clusterByJobDensity(null)),   'null → []');
  assert(EC.clusterByJobDensity(null).length === 0,     'null → length 0');
  assert(Array.isArray(EC.clusterByJobDensity([])),     '[] → []');
  assert(EC.clusterByJobDensity([]).length === 0,       '[] → length 0');
});

// ---------------------------------------------------------------------------
// 3. Workplaces below threshold produce no cluster
// ---------------------------------------------------------------------------

test('workplaces below minJobs produce no cluster', function () {
  const tiny = [
    { lat: 39.7392, lon: -104.9847, jobCount: 10, industry: 'Retail' },
    { lat: 39.7393, lon: -104.9848, jobCount: 10, industry: 'Retail' },
  ];
  const clusters = EC.clusterByJobDensity(tiny, 500);
  assert(clusters.length === 0, 'no cluster when jobCount < minJobs');
});

// ---------------------------------------------------------------------------
// 4. Nearby workplaces merge into one cluster
// ---------------------------------------------------------------------------

test('nearby workplaces (within CLUSTER_RADIUS_MILES) merge into one cluster', function () {
  const clusters = EC.clusterByJobDensity(CLOSE_WP, 100);
  assert(clusters.length === 1, 'produces exactly 1 cluster for closely spaced workplaces');
  assert(clusters[0].jobCount  === 900, 'merged jobCount = 400+300+200');
  assert(clusters[0].memberCount === 3, 'all 3 workplaces counted as members');
});

// ---------------------------------------------------------------------------
// 5. Distant workplaces produce separate clusters
// ---------------------------------------------------------------------------

test('distant workplaces produce separate clusters', function () {
  const clusters = EC.clusterByJobDensity(FAR_WP, 100);
  assert(clusters.length === 2, 'produces 2 clusters for distant workplaces');
  // Sorted descending by jobCount
  assert(clusters[0].jobCount >= clusters[1].jobCount, 'sorted descending by jobCount');
});

// ---------------------------------------------------------------------------
// 6. Cluster cap enforces MAX_CENTERS = 10
// ---------------------------------------------------------------------------

test('clusterByJobDensity caps output at 10 clusters', function () {
  // Generate 15 well-separated workplaces (spaced 1 degree of lat apart)
  const wps = [];
  for (let i = 0; i < 15; i++) {
    wps.push({ lat: 38 + i, lon: -104.0, jobCount: 600, industry: 'Mixed' });
  }
  const clusters = EC.clusterByJobDensity(wps, 100);
  assert(clusters.length <= 10, 'cluster count capped at 10 (got ' + clusters.length + ')');
});

// ---------------------------------------------------------------------------
// 7. dominantIndustry is assigned
// ---------------------------------------------------------------------------

test('dominantIndustry is set to the highest-job industry', function () {
  const wps = [
    { lat: 39.7392, lon: -104.9847, jobCount: 600, industry: 'Healthcare' },
    { lat: 39.7393, lon: -104.9848, jobCount: 300, industry: 'Finance' },
    { lat: 39.7394, lon: -104.9849, jobCount: 100, industry: 'Retail' },
  ];
  const clusters = EC.clusterByJobDensity(wps, 100);
  assert(clusters.length >= 1,                            'at least 1 cluster formed');
  assert(clusters[0].dominantIndustry === 'Healthcare',  'dominant industry is Healthcare (600 jobs)');
});

// ---------------------------------------------------------------------------
// 8. isAttractor flag
// ---------------------------------------------------------------------------

test('isAttractor is true when jobCount >= minJobs × 3', function () {
  const wps = [
    { lat: 39.7392, lon: -104.9847, jobCount: 1600, industry: 'Government' },
  ];
  const clusters = EC.clusterByJobDensity(wps, 500); // 1600 >= 500×3 = 1500
  assert(clusters.length === 1,         'cluster formed');
  assert(clusters[0].isAttractor === true, 'isAttractor = true when jobCount >= minJobs×3');
});

test('isAttractor is false when jobCount < minJobs × 3', function () {
  const wps = [
    { lat: 39.7392, lon: -104.9847, jobCount: 600, industry: 'Retail' },
  ];
  const clusters = EC.clusterByJobDensity(wps, 500); // 600 < 500×3 = 1500
  assert(clusters.length === 1,          'cluster formed');
  assert(clusters[0].isAttractor === false, 'isAttractor = false when jobCount < minJobs×3');
});

// ---------------------------------------------------------------------------
// 9. identifyMajorCorridors — fewer than 2 clusters
// ---------------------------------------------------------------------------

test('identifyMajorCorridors returns [] with 0 or 1 cluster', function () {
  assert(EC.identifyMajorCorridors([]).length === 0,  '0 clusters → []');
  const single = [{ id:'ec-1', lat:39.7, lon:-105, jobCount:800, dominantIndustry:'Tech' }];
  assert(EC.identifyMajorCorridors(single).length === 0, '1 cluster → []');
});

// ---------------------------------------------------------------------------
// 10. identifyMajorCorridors — clusters within 5 miles form a corridor
// ---------------------------------------------------------------------------

test('identifyMajorCorridors pairs clusters within 5 miles', function () {
  // Two clusters ~1 mile apart (Denver area)
  const clusters = [
    { id: 'ec-1', lat: 39.7392, lon: -104.9847, jobCount: 800, dominantIndustry: 'Tech' },
    { id: 'ec-2', lat: 39.7490, lon: -104.9800, jobCount: 600, dominantIndustry: 'Finance' },
  ];
  const corridors = EC.identifyMajorCorridors(clusters);
  assert(corridors.length === 1,                         'exactly 1 corridor formed');
  assert(corridors[0].from === 'ec-1',                   'corridor from ec-1');
  assert(corridors[0].to   === 'ec-2',                   'corridor to ec-2');
  assert(corridors[0].totalJobs === 1400,                'totalJobs = 800 + 600');
  assert(corridors[0].distMiles < 5,                     'distMiles < 5');
});

// ---------------------------------------------------------------------------
// 11. identifyMajorCorridors — distant clusters not paired
// ---------------------------------------------------------------------------

test('identifyMajorCorridors excludes clusters > 5 miles apart', function () {
  // Two clusters ~35 miles apart
  const clusters = [
    { id: 'ec-1', lat: 39.7392, lon: -104.9847, jobCount: 800, dominantIndustry: 'Tech' },
    { id: 'ec-2', lat: 39.3523, lon: -104.8689, jobCount: 600, dominantIndustry: 'Retail' },
  ];
  const corridors = EC.identifyMajorCorridors(clusters);
  assert(corridors.length === 0, 'no corridor for distant clusters (>5 miles)');
});

// ---------------------------------------------------------------------------
// 12. mapCommutingFlowsToCenters — appends fields
// ---------------------------------------------------------------------------

test('mapCommutingFlowsToCenters appends nearestCenter and distToCenter', function () {
  const centers = [
    { id: 'ec-1', lat: 39.7392, lon: -104.9847, jobCount: 800 },
    { id: 'ec-2', lat: 40.0150, lon: -105.2705, jobCount: 500 },
  ];
  const flows = [
    { lat: 39.7400, lon: -104.9860, workers: 50 }, // close to ec-1
    { lat: 40.0100, lon: -105.2700, workers: 30 }, // close to ec-2
  ];
  const result = EC.mapCommutingFlowsToCenters(centers, flows);
  assert(result.length === 2,                        'returns same number of flow records');
  assert(result[0].nearestCenter === 'ec-1',         'flow[0] nearest to ec-1');
  assert(typeof result[0].distToCenter === 'number', 'distToCenter is a number');
  assert(result[1].nearestCenter === 'ec-2',         'flow[1] nearest to ec-2');
  // Original fields preserved
  assert(result[0].workers === 50,                   'original workers field preserved');
});

// ---------------------------------------------------------------------------
// 13. mapCommutingFlowsToCenters — graceful empty handling
// ---------------------------------------------------------------------------

test('mapCommutingFlowsToCenters handles empty inputs gracefully', function () {
  const flows = [{ lat: 39.7, lon: -105, workers: 10 }];
  const resultNoCenters = EC.mapCommutingFlowsToCenters([], flows);
  assert(Array.isArray(resultNoCenters), 'returns array with no centers');

  const resultNoFlows = EC.mapCommutingFlowsToCenters(
    [{ id: 'ec-1', lat: 39.7, lon: -105, jobCount: 800 }], []
  );
  assert(Array.isArray(resultNoFlows) && resultNoFlows.length === 0,
    'returns [] with no flows');
});

// ---------------------------------------------------------------------------
// 14. scoreEmploymentAccessibility — no centers returns 50
// ---------------------------------------------------------------------------

test('scoreEmploymentAccessibility returns 50 when no centers available', function () {
  const score = EC.scoreEmploymentAccessibility(39.7392, -104.9847, []);
  assert(score === 50, 'returns neutral 50 with empty centers array');
});

// ---------------------------------------------------------------------------
// 15. scoreEmploymentAccessibility — site collocated scores high
// ---------------------------------------------------------------------------

test('scoreEmploymentAccessibility scores high when site is at employment center', function () {
  const centers = [
    { id: 'ec-1', lat: 39.7392, lon: -104.9847, jobCount: 8000 },
    { id: 'ec-2', lat: 40.0150, lon: -105.2705, jobCount: 2000 },
  ];
  // Site is right on top of ec-1 (distance ≈ 0)
  const score = EC.scoreEmploymentAccessibility(39.7392, -104.9847, centers);
  assert(score >= 80, 'collocated site scores >= 80 (got ' + score + ')');
  assert(score <= 100, 'score <= 100');
});

// ---------------------------------------------------------------------------
// 16. scoreEmploymentAccessibility — distant site scores lower
// ---------------------------------------------------------------------------

test('scoreEmploymentAccessibility scores lower for distant site', function () {
  const centers = [
    { id: 'ec-1', lat: 39.7392, lon: -104.9847, jobCount: 1000 },
  ];
  // Site ~100 miles away
  const near = EC.scoreEmploymentAccessibility(39.7392, -104.9847, centers);
  const far  = EC.scoreEmploymentAccessibility(38.8339, -104.8214, centers); // ~60 miles
  assert(near > far, 'nearby site scores higher than distant site (' + near + ' > ' + far + ')');
});

// ---------------------------------------------------------------------------
// 17. getEmploymentLayer — valid GeoJSON
// ---------------------------------------------------------------------------

test('getEmploymentLayer returns a valid GeoJSON FeatureCollection', function () {
  const centers = [
    { id: 'ec-1', lat: 39.7392, lon: -104.9847, jobCount: 800, dominantIndustry: 'Tech', isAttractor: true, memberCount: 3 },
    { id: 'ec-2', lat: 40.0150, lon: -105.2705, jobCount: 500, dominantIndustry: 'Retail', isAttractor: false, memberCount: 1 },
  ];
  const layer = EC.getEmploymentLayer(centers);

  assert(layer.type === 'FeatureCollection',       'type is FeatureCollection');
  assert(Array.isArray(layer.features),            'features is an Array');
  assert(layer.features.length === 2,              'two features match two centers');

  const f = layer.features[0];
  assert(f.type === 'Feature',                     'feature type is Feature');
  assert(f.geometry.type === 'Point',              'geometry is Point');
  assert(Array.isArray(f.geometry.coordinates) && f.geometry.coordinates.length === 2,
    'coordinates has 2 elements [lon, lat]');
  assert(f.geometry.coordinates[0] === -104.9847,  'lon is correct');
  assert(f.geometry.coordinates[1] === 39.7392,    'lat is correct');
  assert(f.properties.id === 'ec-1',               'properties.id correct');
  assert(f.properties.jobCount === 800,            'properties.jobCount correct');
  assert(f.properties.isAttractor === true,        'properties.isAttractor correct');
});

test('getEmploymentLayer returns empty FeatureCollection for empty centers', function () {
  const layer = EC.getEmploymentLayer([]);
  assert(layer.type === 'FeatureCollection', 'type is FeatureCollection');
  assert(layer.features.length === 0,        'no features for empty centers');
});

// ---------------------------------------------------------------------------

console.log('\n' + '='.repeat(60));
console.log('Results:', passed, 'passed,', failed, 'failed');
if (failed > 0) process.exitCode = 1;
