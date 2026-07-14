#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const cascade = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/hna/home-value-cascade.json'), 'utf8'));
const fruita = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/hna/summary/0828745.json'), 'utf8')).acsProfile;
const fruitaHomeValue = fruita.median_home_value;
const affordabilityPanel = fs.readFileSync(path.join(ROOT, 'js/affordability-metrics-panel.js'), 'utf8');
const hnaUtils = fs.readFileSync(path.join(ROOT, 'js/hna/hna-utils.js'), 'utf8');
const hnaNarratives = fs.readFileSync(path.join(ROOT, 'js/hna/hna-narratives.js'), 'utf8');
const hnaRenderers = fs.readFileSync(path.join(ROOT, 'js/hna/hna-renderers.js'), 'utf8');
const hnaController = fs.readFileSync(path.join(ROOT, 'js/hna/hna-controller.js'), 'utf8');
const ownershipNeed = fs.readFileSync(path.join(ROOT, 'js/hna/hna-ownership-need.js'), 'utf8');

assert(fruitaHomeValue, 'Fruita summary should be stamped with median_home_value');
assert.equal(fruitaHomeValue.source, 'zhvi', 'Fruita should use Zillow ZHVI as the display home value');
assert(fruitaHomeValue.value > fruita.DP04_0089E, 'Fruita ZHVI should be higher than stale ACS raw value');
assert(fruitaHomeValue.value > 450000 && fruitaHomeValue.value < 525000, 'Fruita ZHVI spot check should be around $486k');
assert.deepStrictEqual(fruitaHomeValue, cascade.places['0828745'], 'Fruita summary display value should match committed cascade');

const flags = cascade.review_flags && cascade.review_flags.zhvi_over_acs_ratio_gt_3 || [];
assert(flags.some((row) => row.geoid === '0803620' && row.ratio > 3), 'Aspen should be flagged as ZHVI/ACS > 3x');
assert.equal(cascade.meta.counts.total, 482, 'home-value cascade should cover all Colorado places in the public HNA set');
assert.equal(cascade.meta.counts.counties.total, 64, 'home-value cascade should cover all Colorado counties');
assert.equal(cascade.meta.counts.counties.acs_raw, 64, 'county home values should be populated from committed ACS summaries when no county ZHVI CSV exists');

for (const geoid of ['08097', '08045']) {
  const row = cascade.counties && cascade.counties[geoid];
  const profile = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/hna/summary', `${geoid}.json`), 'utf8')).acsProfile;
  assert(row, `${geoid}: county cascade row should exist`);
  assert.equal(row.geography_level, 'county', `${geoid}: county cascade row should be labeled county`);
  assert.equal(row.source, 'acs_raw', `${geoid}: county cascade row should use ACS fallback in this repo state`);
  assert.equal(row.value, profile.DP04_0089E, `${geoid}: county cascade should match summary DP04_0089E`);
}

const adjustedSummaries = fs.readdirSync(path.join(ROOT, 'data/hna/summary'))
  .filter((file) => file.endsWith('.json'))
  .map((file) => JSON.parse(fs.readFileSync(path.join(ROOT, 'data/hna/summary', file), 'utf8')).acsProfile)
  .filter((profile) => profile && profile.median_home_value && profile.median_home_value.source === 'county_zhvi_adjusted');
assert(adjustedSummaries.length > 0, 'At least one low-confidence raw ACS place should inherit a county-adjusted value');
assert(
  adjustedSummaries.every((profile) => profile.median_home_value.acs_raw_value > 0 && profile.median_home_value.county_zhvi_to_acs_ratio > 0),
  'County-adjusted values should preserve raw ACS value and ratio provenance',
);

const suppressedSummaries = adjustedSummaries
  .filter((profile) => profile.median_home_value.suppress_income_to_own);
assert(suppressedSummaries.length > 0, 'Still implausible owner-value fallbacks should suppress income-to-own');

assert(hnaUtils.includes('function homeValueInfo'), 'HNA utils should expose the shared home-value cascade helper');
assert(/function homeValueInfo\(profile\) \{\n\s+return U\(\)\.homeValueInfo/.test(hnaRenderers), 'HNA renderers should delegate to the shared home-value cascade helper');
assert(/function renderAffordChart[\s\S]*homeValueInfo\(profile\)/.test(hnaRenderers), 'Affordability chart should use the home-value cascade helper');
assert(/function renderWageAffordability[\s\S]*homeValueInfo\(profile\)/.test(hnaRenderers), 'Wage affordability panel should use the home-value cascade helper');
assert(!/function renderAffordChart[\s\S]{0,900}safeNum\(profile\.DP04_0089E\) \|\| 0/.test(hnaRenderers), 'Affordability chart should not fall back to raw DP04 directly');
assert(!/function renderWageAffordability[\s\S]{0,900}profile && profile\.DP04_0089E/.test(hnaRenderers), 'Wage affordability panel should not read raw DP04 directly');
assert(/geoType === 'place' \|\| geoType === 'cdp' \|\| geoType === 'county'/.test(hnaController), 'Controller should lazy-load home-value cascade for county ownership views');
assert(/geoType === 'county'[\s\S]{0,220}homeValueData\.counties/.test(hnaRenderers), 'Ownership renderer should read county cascade rows before profile fallback');
assert(/Object\.assign\(\{ geography_level: 'county' \}, countyRec\)/.test(hnaRenderers), 'Ownership renderer should mark county home-value rows as county inputs');

const ownershipCtx = { window: {} };
vm.createContext(ownershipCtx);
vm.runInContext(ownershipNeed, ownershipCtx, { filename: 'js/hna/hna-ownership-need.js' });
const countyChas = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/hna/chas_affordability_gap.json'), 'utf8')).counties;
const countyAmiGapRows = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/co_ami_gap_by_county.json'), 'utf8')).counties;
function countyAmiGap(geoid) {
  return countyAmiGapRows.find((row) => row.fips === geoid);
}
for (const [geoid, label] of [['08097', 'Pitkin County'], ['08045', 'Garfield County']]) {
  const result = ownershipCtx.window.HNAOwnershipNeed.computeOwnershipNeed({
    geographyId: geoid,
    geographyName: label,
    geoLevel: 'county',
    countyChasEntry: countyChas[geoid],
    amiGapEntry: countyAmiGap(geoid),
    homeValueEntry: cascade.counties[geoid],
  });
  assert(result.affordabilityTest, `${label}: county ownership computation should render an affordability classification`);
  assert(['priced-out', 'stretch'].includes(result.affordabilityTest.classification), `${label}: resort-area county value should classify as priced-out or stretch`);
  assert.equal(result.affordabilityTest.medianHomeValue, cascade.counties[geoid].value, `${label}: computation should use the county cascade value`);
}

const context = {
  window: {},
  document: {
    readyState: 'loading',
    addEventListener() {},
    getElementById() { return null; },
  },
  fetch() {
    throw new Error('network should not be used by home-value agreement test');
  },
};
vm.createContext(context);
vm.runInContext(affordabilityPanel, context, { filename: 'js/affordability-metrics-panel.js' });

const panelMetric = context.window.AffordabilityMetrics.compute(fruita, fruita.DP04_0134E, { homeValue: fruitaHomeValue });
assert.equal(panelMetric.home_price, fruitaHomeValue.value, 'Income-to-buy calculation should use Fruita place ZHVI value');
assert.equal(panelMetric.home_price, cascade.places['0828745'].value, 'Panel home value should agree with home-value cascade');
assert.equal(panelMetric.home_value_source, 'zhvi', 'Panel should label Fruita home value as ZHVI');
assert.equal(panelMetric.home_value_as_of, fruitaHomeValue.as_of, 'Panel should preserve Fruita ZHVI as_of vintage');
assert(panelMetric.required_hhi_for_home > 0, 'Income-to-buy required HHI should compute from Fruita ZHVI');

function loadHnaSurfaceContext() {
  const ctx = {
    window: {},
    document: {
      readyState: 'loading',
      addEventListener() {},
      getElementById() { return null; },
    },
    location: { search: '' },
    URLSearchParams,
    fetch() {
      throw new Error('network should not be used by home-value narrative tests');
    },
  };
  ctx.window.window = ctx.window;
  ctx.window.document = ctx.document;
  ctx.window.location = ctx.location;
  ctx.window.URLSearchParams = URLSearchParams;
  vm.createContext(ctx);
  vm.runInContext(hnaUtils, ctx, { filename: 'js/hna/hna-utils.js' });
  vm.runInContext(hnaNarratives, ctx, { filename: 'js/hna/hna-narratives.js' });
  return ctx;
}

function assertNarrativeHomeValueAgreement(ctx, profile, label) {
  const info = ctx.window.HNAUtils.homeValueInfo(profile);
  const html = ctx.window.HNANarratives.buildExecutiveSummary(profile, label) || '';
  if (info.suppressIncomeToOwn) {
    assert(!html.includes('Median home value'), `${label}: suppressed home value should omit the home affordability sentence`);
    assert(!html.includes(ctx.window.HNAUtils.fmtMoney(info.value)), `${label}: suppressed home value should not surface the affordability value`);
    return;
  }
  assert(html.includes(ctx.window.HNAUtils.fmtMoney(info.value)), `${label}: narrative should use the shared home-value amount`);
  assert(html.includes(info.sourceText), `${label}: narrative should use the shared home-value source/vintage`);
  assert(!html.includes('ACS 2020–2024'), `${label}: narrative should not carry the old hard-coded ACS vintage`);
}

const surfaceCtx = loadHnaSurfaceContext();
const rawAcsProfile = {
  NAME: 'Raw ACS fixture',
  _geoType: 'place',
  _geoid: '0899999',
  _acsYear: 2024,
  DP04_0089E: 250000,
  DP04_0134E: 1250,
  DP03_0062E: 70000,
};
const zhviProfile = fruita;
const adjustedProfile = adjustedSummaries[0];
const suppressedProfile = suppressedSummaries[0];

assertNarrativeHomeValueAgreement(surfaceCtx, rawAcsProfile, 'raw ACS fixture');
assertNarrativeHomeValueAgreement(surfaceCtx, zhviProfile, 'Fruita ZHVI');
assertNarrativeHomeValueAgreement(surfaceCtx, adjustedProfile, adjustedProfile.NAME || 'county-adjusted fixture');
assertNarrativeHomeValueAgreement(surfaceCtx, suppressedProfile, suppressedProfile.NAME || 'suppressed fixture');
assert.equal(surfaceCtx.window.HNAUtils.homeValueInfo(rawAcsProfile).sourceText, 'ACS DP04_0089E · ACS 2024 5-year', 'Raw ACS source text should carry the field and ACS vintage');
assert.equal(surfaceCtx.window.HNAUtils.homeValueInfo(zhviProfile).sourceText, 'Zillow ZHVI city index · ' + fruitaHomeValue.as_of + ' · high', 'ZHVI source text should carry source, as_of, and confidence');

console.log('hna-home-value-cascade: ok');
