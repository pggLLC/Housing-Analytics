'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');

function loadBrowserModule(rel, exportName, windowExtras) {
  const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const sandbox = { window: Object.assign({}, windowExtras || {}) };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: rel });
  return sandbox.window[exportName];
}

const Combined = loadBrowserModule('js/hna/combined-geo.js', 'HNACombinedGeo');
const Ownership = loadBrowserModule('js/hna/hna-ownership-need.js', 'HNAOwnershipNeed');

function loadRenderersDom() {
  const dom = new JSDOM('<!doctype html>' +
    '<section id="hnaDecisionStrip" hidden>' +
    '<a data-decision-key="need" href="#hnaScorecardPanel"><strong id="decisionNeedValue">—</strong><span id="decisionNeedRead">Loading</span></a>' +
    '<a data-decision-key="affordability" href="#statRentBurden"><strong id="decisionAffordabilityValue">—</strong><span id="decisionAffordabilityRead">Loading</span></a>' +
    '<a data-decision-key="production" href="#statUnitsNeed"><strong id="decisionProductionValue">—</strong><span id="decisionProductionRead">Loading</span></a>' +
    '<a data-decision-key="ownership" href="#affordable-ownership-need-section"><strong id="decisionOwnershipValue">—</strong><span id="decisionOwnershipRead">Loading</span></a>' +
    '<a data-decision-key="confidence" href="#hnaGapCoveragePanel"><strong id="decisionConfidenceValue">—</strong><span id="decisionConfidenceRead">Loading</span></a>' +
    '</section>' +
    '<div id="hnaBanner"></div><div id="geoContextPill"></div><div id="execNarrative"></div>' +
    '<div id="statPop"></div><div id="statPopSrc"></div><div id="statMhi"></div><div id="statMhiSrc"></div>' +
    '<div id="statHomeValue"></div><div id="statHomeValueSrc"></div><div id="statRent"></div><div id="statRentSrc"></div>' +
    '<div id="statTenure"></div><div id="statTenureSrc"></div><div id="statRentBurden"></div>' +
    '<div id="statIncomeNeed"></div><div id="statIncomeNeedNote"></div><div id="statCommute"></div><div id="statCommuteSrc"></div>' +
    '<div id="statBaseUnits"></div><div id="statBaseUnitsSrc"></div><div id="statUnitsNeed"></div><div id="statNetMig"></div>' +
    '<section id="hnaScorecardPanel"></section><section id="affordable-ownership-need-section"><div id="hnaAffordableOwnershipNeed"></div></section>' +
    '<div id="chasGapStatus"></div><div class="chart-box"><canvas id="chartChasGap"></canvas></div>' +
    '<div class="chart-box"><canvas id="chartMode"></canvas></div>');
  dom.window.HTMLCanvasElement.prototype.getContext = function () { return { canvas: this }; };
  const sandbox = {
    window: dom.window,
    document: dom.window.document,
    console,
    Chart: function Chart() { this.destroy = function () {}; },
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
  };
  sandbox.window.Chart = sandbox.Chart;
  sandbox.window.HNAState = { state: {}, els: { banner: dom.window.document.getElementById('hnaBanner') }, charts: {} };
  [
    'geoContextPill', 'statPop', 'statPopSrc', 'statMhi', 'statMhiSrc',
    'statHomeValue', 'statHomeValueSrc', 'statRent', 'statRentSrc',
    'statTenure', 'statRentBurden', 'statIncomeNeed', 'statIncomeNeedNote',
    'statCommute', 'statCommuteSrc', 'statBaseUnits', 'statBaseUnitsSrc',
    'statUnitsNeed', 'statNetMig',
  ].forEach(id => { sandbox.window.HNAState.els[id] = dom.window.document.getElementById(id); });
  sandbox.window.HNAUtils = {
    fmtMoney(n) { return Number(n).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }); },
    fmtNum(n) { return Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 }); },
    fmtPct(n) { return Number(n).toFixed(1) + '%'; },
    safeNum(n) { const value = Number(n); return Number.isFinite(value) ? value : null; },
    srcLink() { return 'fixture source'; },
    homeValueSourceText() { return 'fixture home-value source'; },
    rentBurden30Plus(profile) {
      const severe = Number(profile.DP04_0142PE);
      const moderate = Number(profile.DP04_0141PE);
      return (Number.isFinite(severe) ? severe : 0) + (Number.isFinite(moderate) ? moderate : 0);
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/hna/hna-renderers.js'), 'utf8'), sandbox, { filename: 'js/hna/hna-renderers.js' });
  return dom;
}

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
    homeValues: {
      '0800001': { value: 300000, source: 'fixture' },
      '0800002': { value: 600000, source: 'fixture' },
      '0800003': { value: null, confidence: 'missing' },
    },
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

test('combined alias resolution delegates to canonical PlaceChas helper when available', () => {
  const calls = [];
  const combined = loadBrowserModule('js/hna/combined-geo.js', 'HNACombinedGeo', {
    PlaceChas: {
      resolveAlias(geoid) {
        calls.push(geoid);
        return geoid === '0999999' ? '0800002' : geoid;
      },
    },
  });
  const out = combined.aggregate([
    { geoType: 'place', geoid: '0999999' },
    { geoType: 'place', geoid: '0800001' },
  ], fixtureDatasets());
  assert.deepEqual(calls, ['0999999', '0800001']);
  assert.equal(out.valid, true);
  assert.deepEqual(out.members.map(m => m.geoid), ['0800002', '0800001']);
  assert.equal(out.pseudoChasRecord.summary.total_renter_hh, 1000);
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

test('combined home value produces member range and household-weighted average', () => {
  const out = Combined.aggregate([
    { geoType: 'place', geoid: '0800001' },
    { geoType: 'place', geoid: '0800002' },
  ], fixtureDatasets());
  assert.equal(out.valid, true);
  assert.equal(out.medianMetrics.homeValue.available, true);
  assert.equal(out.medianMetrics.homeValue.min.value, 300000);
  assert.equal(out.medianMetrics.homeValue.max.value, 600000);
  assert.equal(out.medianMetrics.homeValue.weightedAverage, 450000);
  assert.equal(out.medianMetrics.homeValue.method, 'MODELED');
});

test('combined home value skips missing member values without using zero', () => {
  const out = Combined.aggregate([
    { geoType: 'place', geoid: '0800001' },
    { geoType: 'place', geoid: '0800003' },
  ], fixtureDatasets());
  assert.equal(out.valid, true);
  assert.equal(out.medianMetrics.homeValue.available, true);
  assert.equal(out.medianMetrics.homeValue.min.value, 300000);
  assert.equal(out.medianMetrics.homeValue.max.value, 300000);
  assert.equal(out.medianMetrics.homeValue.weightedAverage, 300000);
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
  const duplicateIdx = body.indexOf("if (list.some(m => (m.geoType + ':' + m.geoid) === key)) return false;");
  const capIdx = body.indexOf('if (list.length >= 6)');
  const pushIdx = body.indexOf('list.push(member)');
  const assignIdx = body.indexOf('window.HNAState.state.combinedMembers = list;');
  const announceIdx = body.indexOf("window.__announceUpdate('Combined member added: ' + _labelForMember(member))");
  const successReturnIdx = body.indexOf('return true;');
  assert.ok(duplicateIdx >= 0, 'duplicates are rejected before mutation');
  assert.ok(capIdx >= 0, 'member cap guard exists');
  assert.ok(pushIdx >= 0, 'member push remains present');
  assert.ok(assignIdx >= 0, 'member list assignment remains present');
  assert.ok(announceIdx >= 0, 'success announcement remains present');
  assert.ok(successReturnIdx > announceIdx, 'successful add reports true after announcement');
  assert.ok(duplicateIdx < pushIdx, 'duplicate guard runs before push');
  assert.ok(capIdx < pushIdx, 'cap guard runs before push');
  assert.ok(capIdx < announceIdx, 'cap guard runs before success announcement');
  assert.ok(body.includes("window.HNARenderers.setBanner('Combined areas support up to 6 members.', 'warn')"), 'cap warning is shown');
  assert.ok(body.includes("if (!member) {\n      window.HNARenderers.setBanner('Combined areas can include only places, CDPs, or counties. Select County or Incorporated Place (+ CDP) first.', 'warn');\n      return false;\n    }"), 'invalid selections reject without re-rendering');
  assert.ok(body.includes("if (list.some(m => (m.geoType + ':' + m.geoid) === key)) return false;"), 'duplicates reject without re-rendering');
  assert.ok(body.includes("if (list.length >= 6) {\n      window.HNARenderers.setBanner('Combined areas support up to 6 members.', 'warn');\n      return false;\n    }"), 'cap rejects without re-rendering');
  assert.ok(!body.includes('list.slice(0, 6)'), '7th member is no longer pushed then truncated');
});

test('combined home-value renderer uses computed metric instead of static placeholder', () => {
  const controller = fs.readFileSync(path.join(ROOT, 'js/hna/hna-controller.js'), 'utf8');
  const renderers = fs.readFileSync(path.join(ROOT, 'js/hna/hna-renderers.js'), 'utf8');
  const loadStart = controller.indexOf('async function _loadCombinedDatasets()');
  assert.ok(loadStart >= 0, 'combined dataset loader exists');
  const loadEnd = controller.indexOf('\n  }\n\n  async function updateCombined', loadStart);
  assert.ok(loadEnd > loadStart, 'test can isolate combined dataset loader body');
  const loadBody = controller.slice(loadStart, loadEnd);
  assert(loadBody.includes('] = await Promise.all(['), 'combined datasets are fetched concurrently');
  [
    "loadJson('data/hna/place-chas.json')",
    'loadJson(window.HNAUtils.PATHS.chasCostBurden)',
    "loadJson('data/co_ami_gap_by_place.json')",
    'loadJson(window.HNAUtils.PATHS.acsAmiGap)',
    "loadJson('data/hna/derived/place_county_lookup.json')",
    "loadJson('data/hna/cross-county-places.json')",
    "loadJson('data/hna/place-phantom-aliases.json')",
    "loadJson('data/hna/home-value-cascade.json')",
  ].forEach(expected => {
    assert(loadBody.includes(expected), 'combined loader includes ' + expected);
  });
  assert(loadBody.includes('homeValues: homeValueCascade && homeValueCascade.places'), 'combined datasets unwrap home-value cascade places');
  assert.equal((loadBody.match(/await loadJson/g) || []).length, 0, 'combined loader does not fetch datasets sequentially');
  const renderCombinedStart = renderers.indexOf('function renderCombinedAssessment(result)');
  assert.ok(renderCombinedStart >= 0, 'combined renderer exists');
  const renderCombinedEnd = renderers.indexOf('\n  }\n\n  window.HNARenderers', renderCombinedStart);
  assert.ok(renderCombinedEnd > renderCombinedStart, 'test can isolate combined renderer body');
  const renderCombinedBody = renderers.slice(renderCombinedStart, renderCombinedEnd);
  assert(renderers.includes('function _combinedSetTextMap(values)'), 'combined renderer has table-driven stat text helper');
  assert(renderCombinedBody.includes('_combinedSetTextMap({'), 'combined renderer uses table-driven stat text assignment');
  assert(renderers.includes('var COMBINED_UNAVAILABLE_CHART_IDS = ['), 'combined renderer uses explicit unavailable chart IDs');
  assert(!renderCombinedBody.includes("document.querySelectorAll('canvas[id^=\"chart\"]').forEach"), 'combined renderer no longer blanks every chart canvas');
  assert(renderCombinedBody.includes('_renderCombinedChasGapChart(rec);'), 'combined renderer preserves combined CHAS chart');
  assert(renderers.includes('var homeValueMetric = result.medianMetrics && result.medianMetrics.homeValue;'), 'renderer reads combined home-value metric');
  assert(renderers.includes("_combinedSetText('statHomeValue', homeRange + ' · avg ' + homeAvg);"), 'renderer displays range and weighted average');
  assert(renderers.includes("_combinedSetText('statHomeValue', 'Not available');"), 'renderer has unavailable fallback');
  assert(!renderers.includes("_combinedSetText('statHomeValue', 'Range / modeled average')"), 'static placeholder is removed');
});

test('combined home-value renderer paints range and average into stat card', () => {
  const dom = loadRenderersDom();
  dom.window.HNARenderers.renderCombinedAssessment({
    valid: true,
    label: 'Fixture combo',
    members: [{ geoid: '0800001' }, { geoid: '0800002' }],
    pseudoChasRecord: {
      summary: { total_renter_hh: 100, total_owner_hh: 100, renter_cb30_count: 25 },
      renter_hh_by_ami: {
        lte30: { cost_burdened_30pct: 20, cost_burdened_50pct: 10 },
        '31to50': { cost_burdened_30pct: 18, cost_burdened_50pct: 8 },
        '51to80': { cost_burdened_30pct: 14, cost_burdened_50pct: 4 },
        '81to100': { cost_burdened_30pct: 8, cost_burdened_50pct: 2 },
        '100plus': { cost_burdened_30pct: 4, cost_burdened_50pct: 1 },
      },
    },
    availability: { amiGap: { available: false }, amiLimits: { counties: [] } },
    medianMetrics: {
      homeValue: {
        available: true,
        min: { value: 300000 },
        max: { value: 600000 },
        weightedAverage: 450000,
        caveat: 'Fixture home-value caveat.',
      },
    },
  });
  assert.equal(dom.window.document.getElementById('statPop').textContent, 'Not available');
  assert.equal(dom.window.document.getElementById('statPopSrc').textContent, 'Combined areas do not have a direct ACS population profile in v1.');
  assert.equal(dom.window.document.getElementById('statMhi').textContent, 'Not available');
  assert.equal(dom.window.document.getElementById('statMhiSrc').textContent, 'Not available for combined areas — view members individually.');
  assert.equal(dom.window.document.getElementById('statHomeValue').textContent, '$300,000 - $600,000 · avg $450,000');
  assert.equal(dom.window.document.getElementById('statHomeValueSrc').textContent, 'Fixture home-value caveat.');
  assert.equal(dom.window.document.getElementById('statRent').textContent, 'Not available');
  assert.equal(dom.window.document.getElementById('statRentSrc').textContent, 'Not available for combined areas — view members individually.');
  assert.equal(dom.window.document.getElementById('statIncomeNeedNote').textContent, 'AMI limits are county-level; multi-county combos list counties separately.');
  assert.equal(dom.window.document.getElementById('statBaseUnitsSrc').textContent, 'Not available for combined areas — view members individually.');
  assert.equal(dom.window.document.getElementById('chartChasGap').style.display, '', 'combined CHAS chart remains visible');
  assert.equal(dom.window.document.getElementById('chasGapStatus').textContent, 'Source: combined HUD CHAS 2018-2022 member records · DERIVED.');
  assert.equal(dom.window.document.getElementById('chartMode').style.display, 'none', 'single-geography commute chart is marked unavailable');
  assert.ok(dom.window.document.getElementById('chartMode').parentElement.textContent.includes('Not available for combined areas'), 'single-geography chart gets unavailable note');
});

test('regional comparison renderer paints distinct digest values side by side', () => {
  const dom = loadRenderersDom();
  dom.window.HNARenderers.renderRegionalComparison({
    label: 'Fixture regional comparison',
    members: [
      {
        label: 'Garfield County',
        member: { geoType: 'county', geoid: '08045' },
        digest: { metrics: {
          pct_cost_burdened: { value: 34.8 },
          pct_ami_lte30: { value: 10.9 },
          pct_ami_31to50: { value: 9.2 },
          pct_ami_51to80: { value: 19.1 },
          pct_ami_gt80: { value: 60.8 },
          ownership_need_recommendation: { value: 'Ownership-supportive strategy' },
          ownership_need_rental_pressure_tier: { value: 'Moderate' },
          ownership_need_ownership_pressure_tier: { value: 'High' },
          ownership_need_ownership_fit_tier: { value: 'Very High' },
          ownership_need_affordability_classification: { value: 'priced-out' },
          pct_renters: { value: 30.4 },
          overcrowding_rate: { value: 2.0 },
          pct_housing_built_pre1970: { value: 14.1 },
          median_home_value: { value: 589000 },
          pct_no_hs_degree_25plus: { value: 10.6 },
          pct_single_parent_households: { value: 5.9 },
          pct_age_65_plus: { value: 14.8 },
        } },
      },
      {
        label: 'Aspen',
        member: { geoType: 'place', geoid: '0803620' },
        digest: { metrics: {
          pct_cost_burdened: { value: 67.6 },
          pct_ami_lte30: { value: 10.1 },
          pct_ami_31to50: { value: 10.5 },
          pct_ami_51to80: { value: 18.6 },
          pct_ami_gt80: { value: 60.8 },
          ownership_need_recommendation: { value: 'Rental + ownership mix' },
          ownership_need_rental_pressure_tier: { value: 'High' },
          ownership_need_ownership_pressure_tier: { value: 'Very High' },
          ownership_need_ownership_fit_tier: { value: 'High' },
          ownership_need_affordability_classification: { value: 'priced-out' },
          pct_renters: { value: 42.9 },
          overcrowding_rate: { value: 1.1 },
          pct_housing_built_pre1970: { value: 18.2 },
          median_home_value: { value: 2500000 },
          pct_no_hs_degree_25plus: { value: 1.2 },
          pct_single_parent_households: { value: 4.1 },
          pct_age_65_plus: { value: 17.4 },
        } },
      },
    ],
  });
  const html = dom.window.document.getElementById('execNarrative').innerHTML;
  assert.ok(html.includes('Garfield County'), 'renders first jurisdiction header');
  assert.ok(html.includes('Aspen'), 'renders second jurisdiction header');
  assert.ok(html.includes('34.8%'), 'renders Garfield cost burden');
  assert.ok(html.includes('67.6%'), 'renders Aspen cost burden');
  assert.ok(html.includes('$589,000'), 'renders Garfield home value');
  assert.ok(html.includes('$2,500,000'), 'renders Aspen home value');
  assert.ok(html.includes('Ownership Need'), 'renders ownership section');
  assert.ok(html.includes('Tenure strategy recommendation'), 'renders ownership recommendation row label');
  assert.ok(html.includes('Ownership-supportive strategy'), 'renders Garfield ownership recommendation');
  assert.ok(html.includes('Rental + ownership mix'), 'renders Aspen ownership recommendation');
  assert.ok(html.includes('Ownership fit tier'), 'renders ownership fit row label');
  assert.ok(html.includes('Very High'), 'renders ownership tier text values');
  assert.ok(html.includes('priced-out'), 'renders affordability classification text');
  assert.ok(html.includes('Side-by-side view only'), 'discloses non-aggregate mode');
  assert.equal(dom.window.document.getElementById('geoContextPill').textContent, 'Regional comparison: Garfield County + Aspen');
});

test('HNA executive decision strip mirrors detailed renderer values', () => {
  const dom = loadRenderersDom();
  const doc = dom.window.document;
  dom.window.HNAState.state.chasData = {
    counties: {
      '08009': {
        name: 'Fixture County',
        summary: {
          total_renter_hh: 600,
          total_owner_hh: 400,
          pct_renter_cb30: 0.52,
          pct_owner_cb30: 0.18,
          pct_renter_cb50: 0.28,
        },
        renter_hh_by_ami: {
          lte30: { total: 200 },
          '31to50': { total: 160 },
          '51to80': { total: 150 },
          '81to100': { total: 90 },
        },
      },
      '08011': {
        name: 'Peer County',
        summary: {
          total_renter_hh: 500,
          total_owner_hh: 500,
          pct_renter_cb30: 0.22,
          pct_owner_cb30: 0.1,
          pct_renter_cb50: 0.12,
        },
        renter_hh_by_ami: {
          lte30: { total: 80 },
          '31to50': { total: 140 },
          '51to80': { total: 160 },
          '81to100': { total: 120 },
        },
      },
    },
  };
  dom.window.HNAState.state.blsEconData = {
    counties: {
      'Fixture County': { affordability_index: 6.8 },
      'Peer County': { affordability_index: 3.4 },
    },
  };
  dom.window.HNARenderers.renderSnapshot({
    _acsYear: 2024,
    _acsSeries: 'ACS5',
    _geoType: 'county',
    _geoid: '08009',
    DP05_0001E: 1000,
    DP03_0062E: 75000,
    DP04_0134E: 1500,
    DP04_0047PE: 48,
    DP04_0141PE: 25,
    DP04_0142PE: 15,
  }, null, 'Fixture County', null);
  dom.window.HNARenderers.updateDecisionStrip({
    production: { value: '125', read: 'Gap remains', href: '#statUnitsNeed' },
  });
  doc.getElementById('statUnitsNeed').textContent = '125';
  dom.window.HNAOwnershipNeed = { computeOwnershipNeed() {} };
  dom.window.HNARenderers.renderAffordableOwnershipNeed({
    dataQuality: 'High',
    tenureMixRecommendation: 'Rental plus shared-equity ownership',
    recommendationDetail: 'Fixture recommendation detail.',
    renterCostBurdened: 240,
    severeRenterCostBurdened: 100,
    ownerCostBurdened: 90,
    severeOwnerCostBurdened: 40,
    moderateIncomeRenterHouseholds: 75,
    moderateIncomeOwnerCostBurdened: 25,
    existingRentalGap: 125,
    rentalPressure: { tier: 'High', inputs: { source: 'HUD CHAS', renterCostBurdenedShare: 0.4, severeRenterCostBurdenedShare: 0.17 } },
    ownershipPressure: { tier: 'Moderate', inputs: { ownerCostBurdenedShare: 0.23, moderateIncomeOwnerCostBurdenedShare: 0.06 } },
    ownershipFit: { tier: 'Moderate', inputs: { moderateIncomeRenterShare: 0.13 } },
    affordabilityTest: { medianHomeValue: 350000, classification: 'constrained', source: 'fixture home values' },
    caveats: [],
  });
  dom.window.HNARenderers.renderHnaScorecardPanel('08009');

  assert.equal(doc.getElementById('hnaDecisionStrip').hidden, false, 'decision strip is visible after real renderers populate it');
  assert.equal(doc.getElementById('decisionAffordabilityValue').textContent, doc.getElementById('statRentBurden').textContent, 'affordability tile mirrors rent-burden stat');
  assert.equal(doc.getElementById('decisionProductionValue').textContent, doc.getElementById('statUnitsNeed').textContent, 'production tile mirrors unit-need stat');
  assert.equal(doc.getElementById('decisionOwnershipValue').textContent, 'Rental plus shared-equity ownership', 'ownership tile mirrors ownership recommendation');
  assert.equal(doc.getElementById('decisionConfidenceValue').textContent, 'High', 'confidence tile mirrors ownership data-quality field');
  const needValue = doc.getElementById('decisionNeedValue').textContent;
  assert.match(needValue, /^\d+\/100$/, 'need tile renders scorecard composite');
  assert.ok(doc.getElementById('hnaScorecardPanel').textContent.includes(needValue.replace('/100', '')), 'scorecard panel contains same composite score');
});

test('ownership renderer surfaces single-family permit context without treating it as affordable supply', () => {
  const dom = loadRenderersDom();
  dom.window.HNAOwnershipNeed = { computeOwnershipNeed() {} };
  const result = {
    dataQuality: 'High',
    tenureMixRecommendation: 'Ownership-supportive strategy',
    recommendationDetail: 'Fixture recommendation detail.',
    renterCostBurdened: 240,
    severeRenterCostBurdened: 100,
    ownerCostBurdened: 90,
    severeOwnerCostBurdened: 40,
    moderateIncomeRenterHouseholds: 75,
    moderateIncomeOwnerCostBurdened: 25,
    existingRentalGap: 125,
    rentalPressure: { tier: 'Moderate', inputs: { source: 'HUD CHAS', renterCostBurdenedShare: 0.4, severeRenterCostBurdenedShare: 0.17 } },
    ownershipPressure: { tier: 'High', inputs: { ownerCostBurdenedShare: 0.23, moderateIncomeOwnerCostBurdenedShare: 0.06 } },
    ownershipFit: { tier: 'High', inputs: { moderateIncomeRenterShare: 0.13 } },
    affordabilityTest: { medianHomeValue: 350000, classification: 'priced-out', source: 'fixture home values' },
    caveats: [],
  };
  dom.window.HNARenderers.renderAffordableOwnershipNeed(result, {
    permitContext: {
      level: 'county',
      window: '2021-2025',
      sfAnnual: 51.8,
      mfAnnual: 25.2,
      totalAnnual: 77,
    },
  });
  const html = dom.window.document.getElementById('hnaAffordableOwnershipNeed').innerHTML;
  assert.ok(html.includes('Single-family permit pace'), 'renders SF permit context row');
  assert.ok(html.includes('52/yr'), 'rounds average annual SF permits for display');
  assert.ok(html.includes('2021-2025 avg'), 'shows BPS averaging window');
  assert.ok(html.includes('Census BPS'), 'labels BPS source');
  assert.ok(html.includes('CONTEXT'), 'marks permits as context');
  assert.ok(html.includes('not an affordable ownership count'), 'does not treat SF permits as affordable ownership supply');
  assert.ok(html.includes('purchase-readiness signal'), 'does not turn permits into buyer-readiness evidence');

  dom.window.HNARenderers.renderAffordableOwnershipNeed(result);
  const noPermitHtml = dom.window.document.getElementById('hnaAffordableOwnershipNeed').innerHTML;
  assert.equal(noPermitHtml.includes('Single-family permit pace'), false, 'does not fabricate permit context when BPS record is absent');
});

test('ownership renderer receives permits doc from controller state for ownership context', () => {
  const rendererSrc = fs.readFileSync(path.join(ROOT, 'js/hna/hna-renderers.js'), 'utf8');
  const controllerSrc = fs.readFileSync(path.join(ROOT, 'js/hna/hna-controller.js'), 'utf8');
  assert.ok(rendererSrc.includes('function _ownPermitContextForSelection'), 'renderer has ownership permit context helper');
  assert.ok(rendererSrc.includes('stateRef.permitsDoc'), 'renderer reads permits doc from HNA state');
  assert.ok(rendererSrc.includes('renderAffordableOwnershipNeed(result, { permitContext: permitContext })'), 'renderer passes permit context into ownership panel');
  assert.ok(controllerSrc.includes('ownershipPermitsPromise'), 'controller starts ownership permit load');
  assert.ok(controllerSrc.includes('window.HNAState.state.permitsDoc = data'), 'controller caches permits doc on HNA state');
  assert.ok(controllerSrc.includes('if (ownershipPermitsPromise) await ownershipPermitsPromise'), 'ownership render waits for permit context load');
});

test('combined add button preserves rejection warning by skipping update on false', () => {
  const src = fs.readFileSync(path.join(ROOT, 'js/hna/hna-controller.js'), 'utf8');
  const handlerStart = src.indexOf("window.HNAState.els.btnAddCombinedGeo?.addEventListener('click', () => {");
  assert.ok(handlerStart >= 0, 'add-combined button handler exists');
  const handlerEnd = src.indexOf('\n    });', handlerStart);
  assert.ok(handlerEnd > handlerStart, 'test can isolate add-combined button handler');
  const body = src.slice(handlerStart, handlerEnd);
  const addIdx = body.indexOf('const added = _addCurrentCombinedMember();');
  const guardIdx = body.indexOf('if (!added) return;');
  const syncIdx = body.indexOf('_syncCombinedPanel();');
  const updateIdx = body.indexOf('update();');
  assert.ok(addIdx >= 0, 'handler captures add result');
  assert.ok(guardIdx > addIdx, 'handler exits after rejected add');
  assert.ok(syncIdx > guardIdx, 'sync only runs after a successful add');
  assert.ok(updateIdx > guardIdx, 'update only runs after a successful add');
});

test('combined geos URL restore resolves member type from geo config before length fallback', () => {
  const src = fs.readFileSync(path.join(ROOT, 'js/hna/hna-controller.js'), 'utf8');
  const helperStart = src.indexOf('function _combinedMemberFromUrlGeoid(geoid)');
  assert.ok(helperStart >= 0, 'URL combined-member resolver exists');
  const helperEnd = src.indexOf('\n\n  function _addCurrentCombinedMember', helperStart);
  assert.ok(helperEnd > helperStart, 'test can isolate URL combined-member resolver');
  const helperBody = src.slice(helperStart, helperEnd);
  const countyIdx = helperBody.indexOf("hasGeoid(cfg.counties)");
  const cdpIdx = helperBody.indexOf("hasGeoid(cfg.cdps)");
  const placeIdx = helperBody.indexOf("hasGeoid(cfg.places)");
  const fallbackIdx = helperBody.indexOf("geoType: id.length === 5 ? 'county' : 'place'");
  assert.ok(countyIdx >= 0, 'resolver checks configured counties');
  assert.ok(cdpIdx >= 0, 'resolver checks configured CDPs');
  assert.ok(placeIdx >= 0, 'resolver checks configured places');
  assert.ok(countyIdx < fallbackIdx, 'county lookup runs before length fallback');
  assert.ok(cdpIdx < fallbackIdx, 'CDP lookup runs before length fallback');
  assert.ok(placeIdx < fallbackIdx, 'place lookup runs before length fallback');
  assert.ok(src.includes('window.HNAState.state.combinedMembers = parts.map(_combinedMemberFromUrlGeoid).slice(0, 6);'), '?geos restore uses resolver helper');
  assert.ok(!src.includes("parts.map(g => ({\n        geoType: String(g).length === 5 ? 'county' : 'place',"), '?geos restore no longer uses inline length-only inference');
});

test('combine toggle off resyncs current jurisdiction to WorkflowState', () => {
  const src = fs.readFileSync(path.join(ROOT, 'js/hna/hna-controller.js'), 'utf8');
  const handlerStart = src.indexOf("window.HNAState.els.combineGeosToggle?.addEventListener('change', () => {");
  assert.ok(handlerStart >= 0, 'combine toggle handler exists');
  const handlerEnd = src.indexOf('\n    });', handlerStart);
  assert.ok(handlerEnd > handlerStart, 'test can isolate combine toggle handler');
  const body = src.slice(handlerStart, handlerEnd);
  const panelIdx = body.indexOf('_syncCombinedPanel();');
  const addIdx = body.indexOf('if (window.HNAState.els.combineGeosToggle.checked) _addCurrentCombinedMember();');
  const syncIdx = body.indexOf('else _syncJurisdictionToWorkflowState();');
  const updateIdx = body.indexOf('update();');
  assert.ok(panelIdx >= 0, 'panel sync still runs on toggle change');
  assert.ok(addIdx > panelIdx, 'turning combine on still adds current member after panel sync');
  assert.ok(syncIdx > addIdx, 'turning combine off syncs WorkflowState instead of adding a member');
  assert.ok(updateIdx > syncIdx, 'update runs after WorkflowState is resynced');
});

test('regional comparison mode reuses combined picker but fetches member digests instead of aggregating', () => {
  const controller = fs.readFileSync(path.join(ROOT, 'js/hna/hna-controller.js'), 'utf8');
  const html = fs.readFileSync(path.join(ROOT, 'housing-needs-assessment.html'), 'utf8');
  assert.ok(html.includes('name="combinedGeoMode" value="blended" checked'), 'blended mode radio is present and default');
  assert.ok(html.includes('name="combinedGeoMode" value="regional"'), 'regional mode radio is present');
  assert.ok(controller.includes('function _combinedMode()'), 'controller reads combined mode');
  assert.ok(controller.includes("if (_combinedMode() === 'regional') await updateRegionalComparison(null);"), 'combined update branches to regional mode');
  assert.ok(controller.includes('else await updateCombined(null);'), 'blended update path remains intact');
  assert.ok(controller.includes("loadJson('data/hna/jurisdiction-metrics-digest/' + member.geoid + '.json')"), 'regional mode fetches member digest files');
  assert.ok(controller.includes('window.HNARenderers.renderRegionalComparison({'), 'regional mode calls dedicated renderer');
  assert.ok(controller.includes("url.searchParams.set('combinedMode', 'regional')"), 'regional mode persists URL mode');
  assert.ok(controller.includes("selection.geoType === 'regional-comparison'"), 'regional mode is guarded as a multi-jurisdiction selection');
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
  assert(src.includes('function _isMultiJurisdictionSelection(selection)'), 'multi-jurisdiction guard helper exists');
  assert(src.includes("selection.geoType === 'combined' || selection.geoType === 'regional-comparison'"), 'guard covers blended and regional modes');
  assert(src.includes('if (_isMultiJurisdictionSelection(cur)) return;'), 'moveend LIHTC refresh is gated for multi-jurisdiction selections');
  assert(src.includes('if (_isMultiJurisdictionSelection(selection))'), 'applyAssumptions exits for multi-jurisdiction selections');
  assert(src.includes('!_isMultiJurisdictionSelection(window.HNAState.state.current)'), 'beforeunload checklist broadcast skips multi-jurisdiction selections');
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
