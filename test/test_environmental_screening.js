/**
 * test/test_environmental_screening.js
 * Unit tests for js/environmental-screening.js
 *
 * Usage:
 *   node test/test_environmental_screening.js
 *
 * Exit code 0 = all checks passed; non-zero = one or more failures.
 */
'use strict';

const path   = require('path');
const fs     = require('fs');
const module_ = require(path.resolve(__dirname, '..', 'js', 'environmental-screening'));

const floodGeoJSON = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'data', 'environmental', 'fema-flood-co.geojson'), 'utf8'));
const epaData      = require(path.resolve(__dirname, '..', 'data', 'environmental', 'epa-superfund-co.json'));

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log('  \u2705 PASS: ' + message);
    passed++;
  } else {
    console.error('  \u274c FAIL: ' + message);
    failed++;
  }
}

function test(name, fn) {
  console.log('\n[test] ' + name);
  try {
    fn();
  } catch (e) {
    console.error('  \u274c EXCEPTION: ' + e.message);
    failed++;
  }
}

/* ── Module exports ─────────────────────────────────────────────── */
test('Module exports', function () {
  assert(typeof module_ === 'object',            'module is an object');
  assert(typeof module_.load === 'function',     'exports load()');
  assert(typeof module_.assess === 'function',   'exports assess()');
  assert(typeof module_.isLoaded === 'function', 'exports isLoaded()');
  assert(typeof module_._distanceMiles === 'function', 'exports _distanceMiles for testing');
  assert(typeof module_._pointInRing === 'function',   'exports _pointInRing for testing');
  assert(typeof module_._aggregateRisk === 'function', 'exports _aggregateRisk for testing');
});

/* ── Distance calculation ────────────────────────────────────────── */
test('_distanceMiles: known reference points', function () {
  // Denver to Boulder ≈ 26 miles
  var d = module_._distanceMiles(39.7392, -104.9903, 40.0150, -105.2705);
  assert(d > 22 && d < 32, 'Denver to Boulder ~26 miles (got ' + d.toFixed(1) + ')');

  // Same point = 0
  var dZero = module_._distanceMiles(39.74, -104.99, 39.74, -104.99);
  assert(Math.abs(dZero) < 0.001, 'Same point = ~0 miles');

  // 1 mile north (≈0.0145°)
  var dOne = module_._distanceMiles(39.74, -104.99, 39.7545, -104.99);
  assert(dOne > 0.9 && dOne < 1.1, 'Approx 1 mile N (got ' + dOne.toFixed(3) + ')');
});

/* ── Point-in-ring ──────────────────────────────────────────────── */
test('_pointInRing: basic containment', function () {
  // Square ring: lon [-105, -104], lat [39, 40]
  var ring = [[-105, 39], [-104, 39], [-104, 40], [-105, 40], [-105, 39]];

  assert(module_._pointInRing(39.5, -104.5, ring),  'Center point inside ring');
  assert(!module_._pointInRing(40.5, -104.5, ring), 'Point above ring is outside');
  assert(!module_._pointInRing(38.5, -104.5, ring), 'Point below ring is outside');
  assert(!module_._pointInRing(39.5, -103.5, ring), 'Point to the right is outside');
  assert(!module_._pointInRing(39.5, -105.5, ring), 'Point to the left is outside');
});

/* ── Risk aggregation ────────────────────────────────────────────── */
test('_aggregateRisk: picks highest risk', function () {
  assert(module_._aggregateRisk(
    { riskLevel: 'low' }, { riskLevel: 'low' }, { riskLevel: 'low' }
  ) === 'low', 'all low → low');

  assert(module_._aggregateRisk(
    { riskLevel: 'high' }, { riskLevel: 'low' }, { riskLevel: 'low' }
  ) === 'high', 'flood=high → high');

  assert(module_._aggregateRisk(
    { riskLevel: 'low' }, { riskLevel: 'moderate' }, { riskLevel: 'low' }
  ) === 'moderate', 'hazmat=moderate → moderate');

  assert(module_._aggregateRisk(
    { riskLevel: 'moderate' }, { riskLevel: 'high' }, { riskLevel: 'low' }
  ) === 'high', 'hazmat=high beats moderate → high');
});

/* ── isLoaded before load ────────────────────────────────────────── */
test('isLoaded() before load()', function () {
  // Fresh require won't have loaded data yet (but prior tests may have called load)
  assert(typeof module_.isLoaded() === 'boolean', 'isLoaded returns boolean');
});

/* ── load() ─────────────────────────────────────────────────────── */
test('load() with flood + EPA data', function () {
  return module_.load(floodGeoJSON, epaData).then(function () {
    assert(module_.isLoaded() === true, 'isLoaded() is true after load()');
  });
});

/* ── assess(): invalid inputs ────────────────────────────────────── */
test('assess(): invalid coordinates', function () {
  module_.load(floodGeoJSON, epaData);
  var result = module_.assess(null, null);
  assert(result !== null && typeof result === 'object', 'returns object for null coords');
  assert(typeof result.riskBadge === 'string',          'riskBadge is string');
  assert(typeof result.overallRisk === 'string',        'overallRisk is string');
  assert(typeof result.narrative === 'string',          'narrative is string');

  var result2 = module_.assess('bad', 'input');
  assert(result2 !== null, 'returns object for string coords');
});

/* ── assess(): result schema ─────────────────────────────────────── */
test('assess(): result schema validation', function () {
  module_.load(floodGeoJSON, epaData);
  var result = module_.assess(39.74, -104.99, 1.0);

  // Top-level fields
  assert(typeof result.floodZone === 'object',         'floodZone is object');
  assert(typeof result.soil === 'object',              'soil is object');
  assert(typeof result.hazmat === 'object',            'hazmat is object');
  assert(typeof result.culturalHeritage === 'object',  'culturalHeritage is object');
  assert(typeof result.riskBadge === 'string',         'riskBadge is string');
  assert(typeof result.overallRisk === 'string',       'overallRisk is string');
  assert(typeof result.narrative === 'string',         'narrative is string');

  // Flood zone fields
  assert(typeof result.floodZone.zone === 'string',       'floodZone.zone is string');
  assert(typeof result.floodZone.riskLevel === 'string',  'floodZone.riskLevel is string');
  assert(typeof result.floodZone.sfha === 'boolean',      'floodZone.sfha is boolean');
  assert(typeof result.floodZone.year100Flood === 'boolean', 'floodZone.year100Flood is boolean');
  assert(typeof result.floodZone.narrative === 'string',  'floodZone.narrative is string');

  // Soil fields
  assert(typeof result.soil.stability === 'string',        'soil.stability is string');
  assert(typeof result.soil.liquefactionRisk === 'number', 'soil.liquefactionRisk is number');
  assert(typeof result.soil.riskLevel === 'string',        'soil.riskLevel is string');
  assert(typeof result.soil.narrative === 'string',        'soil.narrative is string');

  // Hazmat fields
  assert(typeof result.hazmat.superfundSites === 'number',    'hazmat.superfundSites is number');
  assert(typeof result.hazmat.brownfieldSites === 'number',   'hazmat.brownfieldSites is number');
  assert(typeof result.hazmat.riskLevel === 'string',         'hazmat.riskLevel is string');
  assert(typeof result.hazmat.narrative === 'string',         'hazmat.narrative is string');

  // Cultural heritage
  assert(typeof result.culturalHeritage.nhpd === 'boolean',      'culturalHeritage.nhpd is boolean');
  assert(typeof result.culturalHeritage.tribalLand === 'boolean', 'culturalHeritage.tribalLand is boolean');
});

/* ── assess(): risk badge values ─────────────────────────────────── */
test('assess(): riskBadge and overallRisk valid values', function () {
  module_.load(floodGeoJSON, epaData);
  var validBadges  = ['🟢 Low', '🟡 Moderate', '🔴 High', '⚪ Unknown'];
  var validRisks   = ['low', 'moderate', 'high'];

  var coords = [
    [39.74, -104.99],  // Denver (may be in flood zone)
    [40.58, -105.08],  // Ft Collins
    [38.83, -104.82],  // Colorado Springs
    [37.20, -107.88],  // Durango
    [40.01, -105.27]   // Boulder
  ];

  coords.forEach(function (c) {
    var r = module_.assess(c[0], c[1], 1.0);
    assert(validBadges.indexOf(r.riskBadge) !== -1,
      'riskBadge valid for [' + c[0] + ',' + c[1] + ']: ' + r.riskBadge);
    assert(validRisks.indexOf(r.overallRisk) !== -1,
      'overallRisk valid for [' + c[0] + ',' + c[1] + ']: ' + r.overallRisk);
  });
});

/* ── assess(): soil heuristics ──────────────────────────────────── */
test('assess(): soil stability by region', function () {
  module_.load(floodGeoJSON, epaData);
  var validStability = ['good', 'moderate', 'unknown'];

  // Front Range alluvial (Denver)
  var denver = module_.assess(39.74, -104.99);
  assert(validStability.indexOf(denver.soil.stability) !== -1,
    'Denver soil stability valid: ' + denver.soil.stability);
  assert(denver.soil.liquefactionRisk >= 0 && denver.soil.liquefactionRisk <= 1,
    'Denver liquefaction risk 0–1: ' + denver.soil.liquefactionRisk);

  // Mountain zone (Aspen area)
  var aspen = module_.assess(39.18, -106.82);
  assert(validStability.indexOf(aspen.soil.stability) !== -1,
    'Aspen soil stability valid: ' + aspen.soil.stability);
});

/* ── assess(): hazmat counts ─────────────────────────────────────── */
test('assess(): hazmat near known Superfund site', function () {
  module_.load(floodGeoJSON, epaData);
  // Rocky Mountain Arsenal: 39.8353, -104.8533
  var r = module_.assess(39.8353, -104.8533, 0.5);
  assert(r.hazmat.superfundSites >= 0, 'superfundSites is non-negative');
  assert(r.hazmat.brownfieldSites >= 0, 'brownfieldSites is non-negative');
});

/* ── assess(): buffer distance ───────────────────────────────────── */
test('assess(): larger buffer finds more sites', function () {
  module_.load(floodGeoJSON, epaData);
  // Adams County area, near Rocky Mountain Arsenal
  var small  = module_.assess(39.7392, -104.9903, 0.1);
  var large  = module_.assess(39.7392, -104.9903, 50.0);
  // At 50 mi we should find at least as many sites as at 0.1 mi
  assert(large.hazmat.superfundSites >= small.hazmat.superfundSites,
    'Larger buffer >= smaller buffer for superfund count');
});

/* ── assess(): narrative is non-empty ────────────────────────────── */
test('assess(): narrative is non-empty string', function () {
  module_.load(floodGeoJSON, epaData);
  var r = module_.assess(39.74, -104.99, 1.0);
  assert(r.narrative && r.narrative.length > 0, 'narrative is non-empty');
  assert(r.floodZone.narrative && r.floodZone.narrative.length > 0, 'floodZone.narrative is non-empty');
  assert(r.soil.narrative && r.soil.narrative.length > 0, 'soil.narrative is non-empty');
  assert(r.hazmat.narrative && r.hazmat.narrative.length > 0, 'hazmat.narrative is non-empty');
});

/* ── Summary ─────────────────────────────────────────────────────── */
console.log('\n' + '='.repeat(50));
console.log('Results: ' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) {
  process.exit(1);
}
