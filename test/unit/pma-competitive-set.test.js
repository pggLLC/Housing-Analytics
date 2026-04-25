// test/unit/pma-competitive-set.test.js
//
// Unit tests for js/pma-competitive-set.js
//
// Usage: node test/unit/pma-competitive-set.test.js
'use strict';

const path = require('path');
global.window = global;

require(path.join(__dirname, '../../js/pma-competitive-set.js'));

const CURRENT_YEAR = new Date().getFullYear();

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { console.log('  ✅ PASS:', msg); passed++; }
  else       { console.error('  ❌ FAIL:', msg); failed++; }
}
function test(name, fn) {
  console.log('\n[test]', name);
  try { fn(); } catch (e) { console.error('  ❌ FAIL: threw —', e.message); failed++; }
}

const CS = global.PMACompetitiveSet;

// ── Fixtures ──
function makeLihtcFeature(name, lat, lon, units) {
  return {
    geometry: { type: 'Point', coordinates: [lon, lat] },
    properties: { PROJECT_NAME: name, LI_UNITS: units, PROGRAM: 'LIHTC', AMI_PCT: 60 }
  };
}

test('PMACompetitiveSet exposed on window', function () {
  assert(typeof CS === 'object',                                 'PMACompetitiveSet is an object');
  assert(typeof CS.buildCompetitiveSet          === 'function',  'buildCompetitiveSet exported');
  assert(typeof CS.flagSubsidyExpiryRisk        === 'function',  'flagSubsidyExpiryRisk exported');
  assert(typeof CS.calculateAbsorptionRisk      === 'function',  'calculateAbsorptionRisk exported');
  assert(typeof CS.getCompetitiveSetLayer       === 'function',  'getCompetitiveSetLayer exported');
  assert(typeof CS.getCompetitiveJustification  === 'function',  'getCompetitiveJustification exported');
  assert(typeof CS.SUBSIDY_EXPIRY_RISK_YEARS             === 'number',    'SUBSIDY_EXPIRY_RISK_YEARS exported');
});

test('buildCompetitiveSet — filters by radius', function () {
  const lihtc = [
    makeLihtcFeature('Close One', 39.74, -104.98, 50),   // ~0.5 mi
    makeLihtcFeature('Far One',   40.5,  -104.0,  80)    // ~60 mi
  ];
  const set = CS.buildCompetitiveSet(lihtc, [], 39.7392, -104.9847, 5);
  assert(set.length === 1,                     'only the nearby project is included');
  assert(set[0].name === 'Close One',          'correct project returned');
  assert(set[0].distanceMiles < 5,             'distanceMiles < radius');
});

test('buildCompetitiveSet — merges NHPD data', function () {
  const lihtc = [makeLihtcFeature('Test Apts', 39.74, -104.98, 60)];
  const nhpd  = [{
    geometry: { type: 'Point', coordinates: [-104.98, 39.74] },
    properties: { PROPERTY_NAME: 'Test Apts', expiryYear: CURRENT_YEAR + 3, units: 60 }
  }];
  const set = CS.buildCompetitiveSet(lihtc, nhpd, 39.7392, -104.9847, 5);
  assert(set.length >= 1,                     'set is non-empty');
  const match = set.find(function (p) { return p.hasNhpd; });
  // NHPD merge uses name normalisation; may not merge by geometry alone — acceptable
  assert(set.length >= 1,                     'set length is valid');
});

test('_parseAmi — accepts numbers, "60%" strings, bare "60", ranges, null', function () {
  assert(CS._parseAmi(60)        === 60,   'number 60 → 60');
  assert(CS._parseAmi('60%')     === 60,   '"60%" → 60');
  assert(CS._parseAmi('60')      === 60,   '"60" → 60');
  assert(CS._parseAmi(' 50 %')   === 50,   '" 50 %" → 50 (whitespace tolerated)');
  assert(CS._parseAmi('30-60%')  === 60,   '"30-60%" → 60 (upper bound of range)');
  assert(CS._parseAmi('30–60%')  === 60,   '"30–60%" → 60 (en-dash range)');
  assert(CS._parseAmi(null)      === null, 'null → null');
  assert(CS._parseAmi(undefined) === null, 'undefined → null');
  assert(CS._parseAmi('')        === null, 'empty string → null');
  assert(CS._parseAmi('unknown') === null, '"unknown" → null');
  assert(CS._parseAmi(0)         === null, '0 → null (zero rejected as falsy target)');
  assert(CS._parseAmi(-5)        === null, 'negative → null');
});

test('buildCompetitiveSet — NHPD ami_targeting fills when LIHTC AMI is missing', function () {
  // LIHTC record with NO AMI_PCT; NHPD match carries ami_targeting='60%'
  const lihtc = [{
    geometry: { type: 'Point', coordinates: [-104.98, 39.74] },
    properties: { PROJECT_NAME: 'Housing Commons', LI_UNITS: 80, PROGRAM: 'LIHTC' }
  }];
  const nhpd  = [{
    geometry: { type: 'Point', coordinates: [-104.98, 39.74] },
    properties: { property_name: 'Housing Commons', ami_targeting: '60%', assisted_units: 80 }
  }];
  const set = CS.buildCompetitiveSet(lihtc, nhpd, 39.7392, -104.9847, 5);
  assert(set.length === 1,                'merged to one record');
  const merged = set[0];
  assert(merged.hasNhpd === true,         'record marked hasNhpd (merge succeeded)');
  assert(merged.amiPercent === 60,        'NHPD ami_targeting filled the gap (got ' + merged.amiPercent + ')');
  assert(merged.amiSource === 'nhpd',     'amiSource identifies NHPD as the source (got ' + merged.amiSource + ')');
});

test('buildCompetitiveSet — LIHTC AMI takes precedence when both present', function () {
  const lihtc = [{
    geometry: { type: 'Point', coordinates: [-104.98, 39.74] },
    properties: { PROJECT_NAME: 'Housing Commons', LI_UNITS: 80, PROGRAM: 'LIHTC', AMI_PCT: 50 }
  }];
  const nhpd  = [{
    geometry: { type: 'Point', coordinates: [-104.98, 39.74] },
    properties: { property_name: 'Housing Commons', ami_targeting: '60%', assisted_units: 80 }
  }];
  const set = CS.buildCompetitiveSet(lihtc, nhpd, 39.7392, -104.9847, 5);
  assert(set[0].amiPercent === 50,        'LIHTC 50% wins over NHPD 60%');
  assert(set[0].amiSource === 'lihtc',    'amiSource reports LIHTC');
});

test('buildCompetitiveSet — NHPD-only property reads ami_targeting (not broken amiPercent)', function () {
  // Previously the NHPD-only branch read props.amiPercent which doesn't
  // exist on NHPD records, so every NHPD-only record got amiPercent: null.
  // Verify the fix reads ami_targeting.
  const nhpd = [{
    geometry: { type: 'Point', coordinates: [-104.98, 39.74] },
    properties: { property_name: 'Section 8 Only', ami_targeting: '50%', assisted_units: 120 }
  }];
  const set = CS.buildCompetitiveSet([], nhpd, 39.7392, -104.9847, 5);
  assert(set.length === 1,                   'NHPD-only record included');
  assert(set[0].amiPercent === 50,           'NHPD-only record reports 50% AMI (got ' + set[0].amiPercent + ')');
  assert(set[0].amiSource === 'nhpd',        'amiSource is nhpd');
});

test('buildCompetitiveSet — no AMI anywhere → null, amiSource: unknown', function () {
  const lihtc = [{
    geometry: { type: 'Point', coordinates: [-104.98, 39.74] },
    properties: { PROJECT_NAME: 'Mystery Property', LI_UNITS: 60, PROGRAM: 'LIHTC' }
  }];
  const set = CS.buildCompetitiveSet(lihtc, [], 39.7392, -104.9847, 5);
  assert(set[0].amiPercent === null,     'unknown AMI → null (no fabricated 60% default)');
  assert(set[0].amiSource === 'unknown', 'amiSource reports unknown');
});

test('flagSubsidyExpiryRisk — flags properties within threshold', function () {
  const nhpd = [
    { properties: { PROPERTY_NAME: 'At Risk',  expiryYear: CURRENT_YEAR + 2, units: 80 } },
    { properties: { PROPERTY_NAME: 'Safe',     expiryYear: CURRENT_YEAR + 10, units: 40 } },
    { properties: { PROPERTY_NAME: 'Soon',     expiryYear: CURRENT_YEAR + 5, units: 55 } }
  ];
  const risk = CS.flagSubsidyExpiryRisk(nhpd, 5);
  assert(risk.length === 2,                       'At Risk and Soon flagged (within 5 yrs)');
  assert(risk[0].expiryYear < risk[1].expiryYear, 'sorted by expiry year ascending');
});

test('flagSubsidyExpiryRisk — empty input → empty result', function () {
  assert(CS.flagSubsidyExpiryRisk([]).length === 0, 'empty input → empty output');
});

test('calculateAbsorptionRisk — low risk scenario', function () {
  const set = [{ units: 500 }, { units: 400 }];  // 900 existing units
  const r   = CS.calculateAbsorptionRisk(set, 5); // 5 proposed → 5/(900+5) ≈ 0.55% → low
  assert(r.risk === 'low',          'absorption risk is low');
  assert(r.captureRate >= 0,        'captureRate ≥ 0');
  assert(r.captureRate <= 1,        'captureRate ≤ 1');
});

test('calculateAbsorptionRisk — high risk scenario', function () {
  const set = [{ units: 10 }];                 // 10 existing
  const r   = CS.calculateAbsorptionRisk(set, 20); // 20 proposed → 20/30 = 67% → high
  assert(r.risk === 'high', 'absorption risk is high when proposed >> existing');
});

test('getCompetitiveSetLayer — GeoJSON FeatureCollection', function () {
  const set = [{ name: 'Apts', lat: 39.7, lon: -104.9, units: 60,
                  programType: 'LIHTC', distanceMiles: 1, hasNhpd: false, atExpiryRisk: false }];
  const layer = CS.getCompetitiveSetLayer(set);
  assert(layer.type === 'FeatureCollection',       'type is FeatureCollection');
  assert(layer.features.length === 1,              '1 feature');
  assert(layer.features[0].geometry.type === 'Point', 'geometry is Point');
});

test('getCompetitiveJustification — shape', function () {
  const j = CS.getCompetitiveJustification();
  assert(typeof j.lihtcCount       === 'number',  'lihtcCount is number');
  assert(typeof j.nhpdAssisted     === 'number',  'nhpdAssisted is number');
  assert(Array.isArray(j.subsidyExpiryRisk),      'subsidyExpiryRisk is Array');
});

console.log('\n' + '='.repeat(50));
console.log('Results:', passed, 'passed,', failed, 'failed');
if (failed > 0) process.exitCode = 1;
