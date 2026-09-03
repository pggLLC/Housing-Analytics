/**
 * test/test_public_land_overlay.js
 * Unit tests for js/public-land-overlay.js
 *
 * Usage:
 *   node test/test_public_land_overlay.js
 *
 * Exit code 0 = all checks passed; non-zero = one or more failures.
 */
'use strict';

const path    = require('path');
const fs      = require('fs');
const { JSDOM } = require('jsdom');
const overlay = require(path.resolve(__dirname, '..', 'js', 'public-land-overlay'));
const predictor = require(path.resolve(__dirname, '..', 'js', 'chfa-award-predictor'));
const data    = require(path.resolve(__dirname, '..', 'data', 'policy', 'county-ownership.json'));

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function dataWithVerifiedParcel(fips, index) {
  var fixture = clone(data);
  fixture.counties[fips].publicParcels[index || 0].evidence_status = 'verified_primary_record';
  return fixture;
}

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
  assert(typeof overlay === 'object',                    'module is an object');
  assert(typeof overlay.load === 'function',             'exports load()');
  assert(typeof overlay.assess === 'function',           'exports assess()');
  assert(typeof overlay.listCLTs === 'function',         'exports listCLTs()');
  assert(typeof overlay.isLoaded === 'function',         'exports isLoaded()');
  assert(typeof overlay._classifyOpportunity === 'function', 'exports _classifyOpportunity for testing');
});

/* ── _classifyOpportunity ───────────────────────────────────────── */
test('_classifyOpportunity: correct mapping', function () {
  assert(overlay._classifyOpportunity('housing-authority', false) === 'strong',  'housing-authority → strong');
  assert(overlay._classifyOpportunity('county', false) === 'strong',             'county → strong');
  assert(overlay._classifyOpportunity('municipal', false) === 'strong',          'municipal → strong');
  assert(overlay._classifyOpportunity('clt', false) === 'strong',               'clt → strong');
  assert(overlay._classifyOpportunity('private', true) === 'strong',            'private+CLT → strong');
  assert(overlay._classifyOpportunity('federal', false) === 'moderate',         'federal → moderate');
  assert(overlay._classifyOpportunity('tribal', false) === 'moderate',          'tribal → moderate');
  assert(overlay._classifyOpportunity('private', false) === 'none',             'private → none');
});

/* ── isLoaded before load ────────────────────────────────────────── */
test('isLoaded() before load()', function () {
  assert(typeof overlay.isLoaded() === 'boolean', 'isLoaded returns boolean');
});

/* ── load() ─────────────────────────────────────────────────────── */
test('load() with county data', function () {
  return overlay.load(data).then(function () {
    assert(overlay.isLoaded() === true, 'isLoaded() is true after load()');
  });
});

test('dataset declares curated 14-of-64 scope and absence semantics', function () {
  assert(data.meta.coverage_counties === 14, 'metadata declares 14 researched counties');
  assert(data.meta.statewide_counties === 64, 'metadata declares the 64-county statewide universe');
  assert(data.meta.coverage_type === 'curated', 'metadata labels coverage as curated');
  assert(data.meta.absence_means === 'not researched', 'metadata defines absence as not researched');
  var parcels = Object.values(data.counties).flatMap(function (county) { return county.publicParcels; });
  assert(parcels.length === 24, 'all 24 legacy parcel claims remain in the dataset');
  assert(parcels.every(function (parcel) { return parcel.evidence_status === 'generic_claim_no_parcel_evidence'; }), 'all 24 claims carry the quarantine evidence status');
  assert(data.meta.quarantined_parcel_count === 24, 'metadata records all 24 quarantined claims');
  assert(data.meta.verified_parcel_count === 0, 'metadata records zero verified parcel claims');
});

/* ── assess(): quarantined records ──────────────────────────────── */
test('assess(): a fully quarantined county is the same unknown state as an absent county', function () {
  overlay.load(data);
  var quarantined = overlay.assess(null, null, '08031');
  var absent = overlay.assess(null, null, '08003');
  assert(JSON.stringify(quarantined) === JSON.stringify(absent), 'Denver\'s quarantined records resolve identically to an absent county');
  assert(quarantined.coverageStatus === 'not_researched', 'fully quarantined county is not researched');
  assert(quarantined.ownership === null, 'quarantined claims yield no ownership');
  assert(quarantined.opportunity === null, 'quarantined claims yield no opportunity');
  assert(quarantined.financialBenefit.subsidy === null, 'quarantined claims yield no subsidy');
});

/* ── assess(): selectively verified parcel ─────────────────────── */
test('assess(): a hypothetical verified primary record retains its finding and benefit', function () {
  overlay.load(dataWithVerifiedParcel('08031', 0));
  var result = overlay.assess(null, null, '08031');
  assert(result.ownerType !== 'private',     'Denver ownerType is not private');
  assert(result.opportunity === 'strong',    'Denver opportunity is strong');
  assert(result.financialBenefit.subsidy === 400000, 'Denver retains its $400,000 municipal-owner benefit');
  assert(result.coverageStatus === 'researched', 'Denver is explicitly marked researched');
  assert(result.unavailableReason === null, 'Denver has no unavailable reason');
  overlay.load(data);
});

/* ── assess(): absent county is not researched ──────────────────── */
test('assess(): absent county does not fabricate private ownership or a zero benefit', function () {
  overlay.load(data);
  var result = overlay.assess(null, null, '08003');
  assert(result.coverageStatus === 'not_researched', 'Alamosa County is marked not researched');
  assert(result.coverageLabel === data.meta.absence_means, 'the dataset coverage label travels with the result');
  assert(result.unavailableReason === data.meta.absence_reason, 'the dataset reason travels with the result');
  assert(result.ownership === null, 'absence is not labelled private ownership');
  assert(result.ownerType === null, 'absence has no fabricated owner type');
  assert(result.opportunity === null, 'absence has no fabricated opportunity classification');
  assert(result.financialBenefit.subsidy === null, 'absence has no zero-dollar benefit figure');
});

function renderLandResult(land, award) {
  var dom = new JSDOM('<!doctype html><main><section id="card"></section><div id="lihtcConceptLiveRegion"></div></main>', {
    url: 'http://127.0.0.1/market-analysis.html',
    runScripts: 'outside-only'
  });
  dom.window.eval(fs.readFileSync(path.resolve(__dirname, '..', 'js', 'lihtc-concept-card-renderer.js'), 'utf8'));
  dom.window.LIHTCConceptCardRenderer.render(dom.window.document.getElementById('card'), {
    confidence: 'screening',
    recommendedExecution: 'Test',
    conceptType: 'family',
    keyRationale: []
  }, null, { publicLand: land, chfaCompetitiveness: award || null });
  return dom.window.document.getElementById('card').textContent.replace(/\s+/g, ' ').trim();
}

test('renderer: absent county shows the carried not-researched reason and no confident value', function () {
  overlay.load(data);
  var text = renderLandResult(overlay.assess(null, null, '08003'));
  assert(text.includes('Not researched'), 'absent county visibly renders Not researched');
  assert(text.includes(data.meta.absence_reason), 'renderer uses the reason carried with the result');
  assert(!text.includes('$'), 'absent county renders no dollar figure');
  assert(!text.includes('Private ownership'), 'absent county is not described as private ownership');
  assert(!text.includes('🔴 None'), 'absent county is not classified as no opportunity');
});

test('renderer: a hypothetical verified parcel still shows its owner and unchanged benefit', function () {
  overlay.load(dataWithVerifiedParcel('08031', 0));
  var text = renderLandResult(overlay.assess(null, null, '08031'));
  assert(text.includes('City & County of Denver'), 'present county renders its recorded parcel owner');
  assert(text.includes('$400K'), 'present county renders the unchanged $400,000 benefit');
  assert(text.includes('Strong'), 'present county retains its opportunity classification');
  overlay.load(data);
});

test('predictor: quarantined is unknown and partial, never verified no opportunity', function () {
  overlay.load(data);
  var land = overlay.assess(null, null, '08031');
  var prediction = predictor.predict({ conceptType: 'family' }, { publicLandAssessment: land });
  assert(prediction.publicLandAssessment.status === 'unknown', 'quarantined parcel yields predictor unknown');
  assert(prediction.publicLandAssessment.status !== 'verified_no_opportunity', 'quarantine never becomes verified no opportunity');
  assert(prediction.scoreCompleteness === 'partial', 'quarantined input marks the composite partial');
  assert(prediction.scoreDisclosure.includes(data.meta.absence_reason), 'the unknown reason travels with the composite');
  var text = renderLandResult(land, prediction);
  assert(text.includes('partial estimate'), 'rendered composite is visibly partial');
  assert(text.includes(data.meta.absence_reason), 'rendered composite shows the carried reason');
});

test('predictor: a hypothetical verified parcel selectively retains the 2.5-point award', function () {
  overlay.load(dataWithVerifiedParcel('08031', 0));
  var strong = predictor.predict({ conceptType: 'family' }, { publicLandAssessment: overlay.assess(null, null, '08031') });
  var verifiedNone = predictor.predict({ conceptType: 'family' }, { publicLandAssessment: { coverageStatus: 'researched', opportunity: 'none' } });
  assert(strong.publicLandAssessment.status === 'strong', 'verified parcel reaches strong status');
  assert(strong.factors.localSupport.value - verifiedNone.factors.localSupport.value === 2.5, 'verified parcel retains the exact 2.5-point award');
  overlay.load(data);
});

/* ── assess(): legacy single-arg call ──────────────────────────── */
test('assess(): legacy single-arg call assess("08013")', function () {
  overlay.load(data);
  var result = overlay.assess('08013');
  assert(typeof result === 'object',         'returns object for legacy call');
  assert(result.ownership === null, 'legacy call preserves quarantine');
  assert(result.coverageStatus === 'not_researched', 'legacy call preserves unknown status');
});

/* ── assess(): FIPS padding ─────────────────────────────────────── */
test('assess(): FIPS codes get padded correctly', function () {
  overlay.load(data);
  // 8013 without leading zero
  var result = overlay.assess(null, null, '8013');
  assert(typeof result === 'object',         'accepts unpadded FIPS');
});

/* ── assess(): financial benefit by owner type ──────────────────── */
test('assess(): financial benefit > 0 only for verified public owners', function () {
  var fixture = clone(data);
  var publicFips = ['08031', '08013', '08001', '08069'];
  publicFips.forEach(function (fips) { fixture.counties[fips].publicParcels[0].evidence_status = 'verified_primary_record'; });
  overlay.load(fixture);
  publicFips.forEach(function (fips) {
    var r = overlay.assess(null, null, fips);
    assert(r.financialBenefit.subsidy > 0,
      fips + ' financial benefit > 0 (' + r.ownerType + ')');
  });
  overlay.load(data);
});

/* ── listCLTs() ─────────────────────────────────────────────────── */
test('listCLTs(): returns array of CLT objects', function () {
  overlay.load(data);
  var clts = overlay.listCLTs();

  assert(Array.isArray(clts),   'listCLTs returns array');
  assert(clts.length > 0,       'listCLTs returns at least one CLT');

  clts.forEach(function (clt) {
    assert(typeof clt.county === 'string', 'CLT has county string');
    assert(typeof clt.fips === 'string',   'CLT has fips string');
    assert(typeof clt.name === 'string',   'CLT has name string');
    assert(typeof clt.type === 'string',   'CLT has type string');
  });
});

/* ── load(): empty data graceful handling ───────────────────────── */
test('load(): handles null gracefully', function () {
  var fresh = require(path.resolve(__dirname, '..', 'js', 'public-land-overlay'));
  // Reload module reference — call load with null
  return fresh.load(null).then(function () {
    var r = fresh.assess(null, null, '08031');
    assert(typeof r === 'object', 'returns object even with null data');
  });
});

/* ── Summary ─────────────────────────────────────────────────────── */
console.log('\n' + '='.repeat(50));
console.log('Results: ' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) {
  process.exit(1);
}
