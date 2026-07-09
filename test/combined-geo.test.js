'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');

function loadBrowserModule(rel, exportName) {
  const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: rel });
  return sandbox.window[exportName];
}

const Combined = loadBrowserModule('js/hna/combined-geo.js', 'HNACombinedGeo');
const Ownership = loadBrowserModule('js/hna/hna-ownership-need.js', 'HNAOwnershipNeed');

function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
}

const liveDatasets = {
  placeChas: readJson('data/hna/place-chas.json'),
  countyChas: readJson('data/hna/chas_affordability_gap.json'),
  amiGapPlace: readJson('data/co_ami_gap_by_place.json'),
  amiGapCounty: readJson('data/co_ami_gap_by_county.json'),
  placeCountyLookup: readJson('data/hna/derived/place_county_lookup.json'),
  crossCountyPlaces: readJson('data/hna/cross-county-places.json'),
  aliases: readJson('data/hna/place-phantom-aliases.json'),
};

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log('  ✅ ' + name);
  } catch (err) {
    failed += 1;
    console.error('  ❌ ' + name);
    console.error('     ' + err.message);
  }
}

function walkNoBadValues(value, trail) {
  trail = trail || 'output';
  if (value === undefined) throw new Error(trail + ' is undefined');
  if (typeof value === 'number' && Number.isNaN(value)) throw new Error(trail + ' is NaN');
  if (Array.isArray(value)) value.forEach((v, i) => walkNoBadValues(v, trail + '[' + i + ']'));
  else if (value && typeof value === 'object') Object.keys(value).forEach(k => walkNoBadValues(value[k], trail + '.' + k));
}

function band(total, cb30, cb50) {
  return { total, cost_burdened_30pct: cb30, cost_burdened_50pct: cb50 };
}

function chasRecord(name, renterTotal, renterCb30, ownerTotal, ownerCb30) {
  return {
    name,
    summary: {
      total_renter_hh: renterTotal,
      total_owner_hh: ownerTotal,
      renter_cb30_count: renterCb30,
      renter_cb50_count: Math.round(renterCb30 / 2),
      owner_cb30_count: ownerCb30,
      owner_cb50_count: Math.round(ownerCb30 / 2),
    },
    renter_hh_by_ami: {
      lte30: band(renterTotal * 0.2, renterCb30 * 0.4, renterCb30 * 0.2),
      '31to50': band(renterTotal * 0.2, renterCb30 * 0.25, renterCb30 * 0.15),
      '51to80': band(renterTotal * 0.25, renterCb30 * 0.2, renterCb30 * 0.1),
      '81to100': band(renterTotal * 0.15, renterCb30 * 0.1, renterCb30 * 0.05),
      '100plus': band(renterTotal * 0.2, renterCb30 * 0.05, 0),
    },
    owner_hh_by_ami: {
      lte30: band(ownerTotal * 0.1, ownerCb30 * 0.3, ownerCb30 * 0.2),
      '31to50': band(ownerTotal * 0.15, ownerCb30 * 0.25, ownerCb30 * 0.15),
      '51to80': band(ownerTotal * 0.25, ownerCb30 * 0.2, ownerCb30 * 0.1),
      '81to100': band(ownerTotal * 0.2, ownerCb30 * 0.15, ownerCb30 * 0.05),
      '100plus': band(ownerTotal * 0.3, ownerCb30 * 0.1, 0),
    },
  };
}

function fixtureDatasets() {
  return {
    aliases: { aliases: { '0999999': '0800001' } },
    placeCountyLookup: { places: { '0800001': '08001', '0800002': '08003', '0800003': '08005' } },
    crossCountyPlaces: { places: { '0800003': { all_counties: ['08005', '08007'] } } },
    placeChas: { places: {
      '0800001': chasRecord('A', 100, 80, 900, 90),
      '0800002': chasRecord('B', 900, 90, 100, 80),
      '0800003': chasRecord('Cross', 0, 0, 0, 0),
    } },
    countyChas: { counties: {
      '08009': chasRecord('Far County', 200, 40, 300, 50),
    } },
    amiGapPlace: { places: {
      '0800001': {
        households_le_ami_pct: { 30: 100, 40: 110, 50: 120, 60: 130, 70: 140, 80: 150, 100: 160 },
        units_priced_affordable_le_ami_pct: { 30: 80, 40: 130, 50: 150, 60: 151, 70: 152, 80: 153, 100: 154 },
      },
      '0800002': {
        households_le_ami_pct: { 30: 20, 40: 30, 50: 40, 60: 50, 70: 60, 80: 70, 100: 80 },
        units_priced_affordable_le_ami_pct: { 30: 10, 40: 20, 50: 30, 60: 40, 70: 50, 80: 60, 100: 70 },
      },
      '0800003': {
        households_le_ami_pct: { 30: 0, 40: 0, 50: 0, 60: 0, 70: 0, 80: 0, 100: 0 },
        units_priced_affordable_le_ami_pct: { 30: 0, 40: 0, 50: 0, 60: 0, 70: 0, 80: 0, 100: 0 },
      },
    } },
    amiGapCounty: { counties: [
      {
        fips: '08009',
        households_le_ami_pct: { 30: 5, 40: 10, 50: 15, 60: 20, 70: 25, 80: 30, 100: 35 },
        units_priced_affordable_le_ami_pct: { 30: 2, 40: 4, 50: 6, 60: 8, 70: 10, 80: 12, 100: 14 },
      },
    ] },
  };
}

console.log('Combined Geo — unit tests');

test('aggregation sums counts and re-derives shares instead of averaging shares', () => {
  const out = Combined.aggregate([
    { geoType: 'place', geoid: '0800001' },
    { geoType: 'place', geoid: '0800002' },
  ], fixtureDatasets());
  assert.equal(out.valid, true);
  assert.equal(out.pseudoChasRecord.summary.total_renter_hh, 1000);
  assert.equal(out.pseudoChasRecord.summary.renter_cb30_count, 170);
  assert.equal(out.pseudoChasRecord.summary.renter_cb30_share, 0.17);
  const wrongAverage = ((80 / 100) + (90 / 900)) / 2;
  assert.notEqual(out.pseudoChasRecord.summary.renter_cb30_share, wrongAverage);
});

test('AMI band totals sum across members', () => {
  const out = Combined.aggregate([
    { geoType: 'place', geoid: '0800001' },
    { geoType: 'place', geoid: '0800002' },
  ], fixtureDatasets());
  assert.equal(out.pseudoChasRecord.renter_hh_by_ami['51to80'].total, 250);
  assert.equal(out.pseudoChasRecord.owner_hh_by_ami['81to100'].total, 200);
});

test('per-band gap clamping yields monotonic cumulative gaps', () => {
  const out = Combined.aggregate([
    { geoType: 'place', geoid: '0800001' },
    { geoType: 'place', geoid: '0800002' },
  ], fixtureDatasets());
  const gaps = out.amiGapEntry.gap_units_minus_households_le_ami_pct;
  let prev = 0;
  for (const band of Combined.GAP_BANDS) {
    assert.ok(gaps[band] >= prev, 'gap at ' + band + ' should be monotonic');
    prev = gaps[band];
  }
  assert.ok(gaps['40'] >= 0);
});

test('overlap rejection catches place plus containing county', () => {
  const validation = Combined.validateCombo([
    { geoType: 'place', geoid: '0800001' },
    { geoType: 'county', geoid: '08001' },
  ], fixtureDatasets());
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.join(' ').includes('paired view'));
});

test('state and unknown members are rejected instead of coerced to places', () => {
  const validation = Combined.validateCombo([
    { geoType: 'state', geoid: '08' },
    { geoType: 'place', geoid: '0800001' },
  ], fixtureDatasets());
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.join(' ').includes('place, CDP, or county'));
});

test('overlap rejection catches cross-county place plus either county', () => {
  const validation = Combined.validateCombo([
    { geoType: 'place', geoid: '0803455' },
    { geoType: 'county', geoid: '08001' },
  ], liveDatasets);
  assert.equal(validation.valid, false);
});

test('phantom alias member resolves to canonical record', () => {
  const out = Combined.aggregate([
    { geoType: 'place', geoid: '0999999' },
    { geoType: 'place', geoid: '0800002' },
  ], fixtureDatasets());
  assert.equal(out.valid, true);
  assert.equal(out.members[0].geoid, '0800001');
  assert.equal(out.pseudoChasRecord.memberNames[0], 'A');
});

test('availability map marks commuting unavailable and multi-county AMI limits listed', () => {
  const out = Combined.aggregate([
    { geoType: 'place', geoid: '0800001' },
    { geoType: 'place', geoid: '0800002' },
  ], fixtureDatasets());
  assert.equal(out.availability.commuting.available, false);
  assert.ok(out.availability.commuting.reason.includes('Not available for combined areas'));
  assert.equal(out.availability.amiLimits.available, false);
  assert.equal(out.availability.amiLimits.counties.length, 2);
});

test('mixed place plus non-overlapping county aggregates correctly', () => {
  const out = Combined.aggregate([
    { geoType: 'place', geoid: '0800001' },
    { geoType: 'county', geoid: '08009' },
  ], fixtureDatasets());
  assert.equal(out.valid, true);
  assert.equal(out.pseudoChasRecord.summary.total_renter_hh, 300);
  assert.equal(out.pseudoChasRecord.summary.total_owner_hh, 1200);
});

test('computeOwnershipNeed accepts aggregated pseudo-record and worst member quality propagates', () => {
  const datasets = fixtureDatasets();
  datasets.placeChas.places['0800002'].low_confidence = true;
  const out = Combined.aggregate([
    { geoType: 'place', geoid: '0800001' },
    { geoType: 'place', geoid: '0800002' },
  ], datasets);
  assert.equal(out.dataQuality, 'Medium');
  const ownership = Ownership.computeOwnershipNeed({
    chasEntry: out.pseudoChasRecord,
    geoLevel: 'combined',
    geographyName: 'Fixture combo',
    amiGapEntry: Object.assign({ ami_4person: 100000 }, out.amiGapEntry),
    homeValueEntry: { value: 400000, source: 'fixture' },
  });
  assert.ok(ownership.tenureMixRecommendation);
  walkNoBadValues(ownership);
});

test('zero-household member is tolerated without NaN or undefined', () => {
  const out = Combined.aggregate([
    { geoType: 'place', geoid: '0800001' },
    { geoType: 'place', geoid: '0800003' },
  ], fixtureDatasets());
  walkNoBadValues(out);
});



test('Mode B paired county view is non-aggregating place plus containing county', () => {
  const paired = Combined.buildPairedCountyView(
    { geoType: 'place', geoid: '0800001' },
    { geoType: 'county', geoid: '08009' },
    fixtureDatasets()
  );
  assert.equal(paired.valid, true);
  assert.equal(paired.mode, 'paired-county');
  assert.equal(paired.aggregation, 'none');
  assert.equal(paired.rows.length, 2);
  assert.equal(paired.rows[0].scope, 'selected jurisdiction');
  assert.equal(paired.rows[1].scope, 'containing county');
  assert.equal(paired.rows[0].total_renter_hh, 100);
  assert.equal(paired.rows[1].total_renter_hh, 200);
});

test('Mode B UI is mounted by controller without requiring template HTML edits', () => {
  const src = fs.readFileSync(path.join(ROOT, 'js/hna/hna-controller.js'), 'utf8');
  assert(src.includes('btnPairedCountyView'), 'controller creates Compare with County button');
  assert(src.includes('pairedCountyResult'), 'controller creates paired county result mount');
  assert(src.includes('buildPairedCountyView'), 'controller calls combined paired-view helper');
});

test('combined member cap is checked before mutation and success announcement', () => {
  const src = fs.readFileSync(path.join(ROOT, 'js/hna/hna-controller.js'), 'utf8');
  const fnStart = src.indexOf('function _addCurrentCombinedMember()');
  assert.ok(fnStart >= 0, 'controller exposes _addCurrentCombinedMember helper');
  const fnEnd = src.indexOf('\n  }\n\n\n  function _ensurePairedCountyView', fnStart);
  assert.ok(fnEnd > fnStart, 'test can isolate _addCurrentCombinedMember body');
  const body = src.slice(fnStart, fnEnd);
  const duplicateIdx = body.indexOf("if (list.some(m => (m.geoType + ':' + m.geoid) === key)) return;");
  const capIdx = body.indexOf('if (list.length >= 6)');
  const pushIdx = body.indexOf('list.push(member)');
  const assignIdx = body.indexOf('window.HNAState.state.combinedMembers = list;');
  const announceIdx = body.indexOf("window.__announceUpdate('Combined member added: ' + _labelForMember(member))");
  assert.ok(duplicateIdx >= 0, 'duplicates are rejected before mutation');
  assert.ok(capIdx >= 0, 'member cap guard exists');
  assert.ok(pushIdx >= 0, 'member push remains present');
  assert.ok(assignIdx >= 0, 'member list assignment remains present');
  assert.ok(announceIdx >= 0, 'success announcement remains present');
  assert.ok(duplicateIdx < pushIdx, 'duplicate guard runs before push');
  assert.ok(capIdx < pushIdx, 'cap guard runs before push');
  assert.ok(capIdx < announceIdx, 'cap guard runs before success announcement');
  assert.ok(body.includes("window.HNARenderers.setBanner('Combined areas support up to 6 members.', 'warn')"), 'cap warning is shown');
  assert.ok(!body.includes('list.slice(0, 6)'), '7th member is no longer pushed then truncated');
});

test('combined AMI-gap rendering gates on availability flag', () => {
  const src = fs.readFileSync(path.join(ROOT, 'js/hna/hna-renderers.js'), 'utf8');
  assert(src.includes('result.availability && result.availability.amiGap && result.availability.amiGap.available'), 'renderCombinedAssessment reads availability.amiGap.available');
  assert(src.includes('Not available — one or more members missing AMI-gap data'), 'missing AMI gap message is rendered');
  assert(src.includes("_combinedSetText('statGap' + band, 'Not available')"), 'statGap fields are masked when unavailable');
  assert(src.includes("_combinedSetText('statTierGap' + band, 'Not available')"), 'statTierGap fields are masked when unavailable');
});

test('combined export reads current combined result instead of stale single-geography state', () => {
  const src = fs.readFileSync(path.join(ROOT, 'js/hna/hna-export.js'), 'utf8');
  assert(src.includes('function _metricsFromCombinedResult'), 'combined export metrics helper exists');
  assert(src.includes("current && current.geoType === 'combined' ? current.combinedResult : null"), 'buildReportData reads current.combinedResult');
  assert(src.includes("_chas_source: 'combined'"), 'combined CHAS source is exported');
  assert(src.includes("_ami_gap_source: result.availability && result.availability.amiGap"), 'combined AMI gap source honors availability');
});

test('ownership need labels combined areas as combined CHAS', () => {
  const out = Combined.aggregate([
    { geoType: 'place', geoid: '0800001' },
    { geoType: 'place', geoid: '0800002' },
  ], fixtureDatasets());
  const ownership = Ownership.computeOwnershipNeed({
    chasEntry: out.pseudoChasRecord,
    geoLevel: 'combined',
    geographyName: 'Fixture combo',
    amiGapEntry: Object.assign({ ami_4person: 100000 }, out.amiGapEntry),
    homeValueEntry: { value: 400000, source: 'fixture' },
  });
  assert.equal(ownership.rentalPressure.inputs.source, 'combined-CHAS');
  assert.equal(ownership.ownershipPressure.inputs.source, 'combined-CHAS');
  assert.equal(ownership.ownershipFit.inputs.source, 'combined-CHAS');
});

test('combined geoType is guarded at projection, map, and checklist call sites', () => {
  const src = fs.readFileSync(path.join(ROOT, 'js/hna/hna-controller.js'), 'utf8');
  assert(src.includes("selection && selection.geoType === 'combined'"), 'applyAssumptions exits for combined selections');
  assert(src.includes("if (cur.geoType === 'combined') return;"), 'moveend LIHTC refresh is gated for combined selections');
  assert(src.includes("window.HNAState.state.current.geoType !== 'combined'"), 'beforeunload checklist broadcast skips combined selections');
});

test('preset config members resolve against registry and validate', () => {
  const registry = readJson('data/hna/geography-registry.json').geographies;
  const byGeoid = new Map(registry.map(g => [g.geoid, g]));
  const presets = readJson('data/hna/combined-regions.json');
  assert.ok(Array.isArray(presets.regions) && presets.regions.length >= 4);
  for (const region of presets.regions) {
    for (const member of region.members) {
      assert.ok(byGeoid.has(member.geoid), `${region.id} member ${member.geoid} resolves`);
    }
    const validation = Combined.validateCombo(region.members, liveDatasets);
    assert.equal(validation.valid, true, region.id + ': ' + validation.errors.join('; '));
  }
});

if (failed) {
  console.error(`\nCombined Geo: ${passed} passed, ${failed} failed`);
  process.exit(1);
}

console.log(`\nCombined Geo: ${passed} passed, 0 failed`);
