#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');

function isOfficialFhfaUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' &&
      (parsed.hostname === 'fhfa.gov' || parsed.hostname === 'www.fhfa.gov');
  } catch (_) {
    return false;
  }
}

assert.equal(
  isOfficialFhfaUrl('https' + '://evil.com/?source=fhfa.gov'),
  false,
  'an FHFA hostname mentioned outside the authority component is not official provenance',
);
const cascade = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/hna/home-value-cascade.json'), 'utf8'));
const fruita = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/hna/summary/0828745.json'), 'utf8')).acsProfile;
const fruitaHomeValue = fruita.median_home_value;
const affordabilityPanel = fs.readFileSync(path.join(ROOT, 'js/affordability-metrics-panel.js'), 'utf8');
const hnaUtils = fs.readFileSync(path.join(ROOT, 'js/hna/hna-utils.js'), 'utf8');
const moneyFormatter = fs.readFileSync(path.join(ROOT, 'js/utils/format-money.js'), 'utf8');
const hnaNarratives = fs.readFileSync(path.join(ROOT, 'js/hna/hna-narratives.js'), 'utf8');
const hnaRenderers = fs.readFileSync(path.join(ROOT, 'js/hna/hna-renderers.js'), 'utf8');
const hnaController = fs.readFileSync(path.join(ROOT, 'js/hna/hna-controller.js'), 'utf8');
const ownershipNeed = fs.readFileSync(path.join(ROOT, 'js/hna/hna-ownership-need.js'), 'utf8');
const homeValueBuilder = fs.readFileSync(path.join(ROOT, 'scripts/hna/build_home_value_cascade.mjs'), 'utf8');

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
assert.equal(cascade.meta.counts.counties.fhfa_county_hpi_anchor, 64, 'county rows with FHFA coverage should carry FHFA HPI anchors');

for (const geoid of ['08097', '08045']) {
  const row = cascade.counties && cascade.counties[geoid];
  const profile = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/hna/summary', `${geoid}.json`), 'utf8')).acsProfile;
  assert(row, `${geoid}: county cascade row should exist`);
  assert.equal(row.geography_level, 'county', `${geoid}: county cascade row should be labeled county`);
  assert.equal(row.source, 'fhfa_county_hpi_anchor', `${geoid}: county cascade row should use the committed FHFA county anchor`);
  assert.equal(row.confidence, 'medium', `${geoid}: FHFA county anchor should upgrade confidence above raw ACS`);
  assert.equal(row.acs_raw_value, profile.DP04_0089E, `${geoid}: county cascade should retain the ACS dollar-value floor`);
  assert.notEqual(row.value, row.acs_raw_value, `${geoid}: FHFA county anchor should shift the ACS midpoint value toward current dollars`);
  assert(row.value > row.acs_raw_value, `${geoid}: spot-check county HPI adjustment should move the value upward`);
  assert.ok(row.fhfa_hpi && row.fhfa_hpi.source_level === 'fhfa_county_direct', `${geoid}: county cascade should carry direct FHFA HPI provenance`);
  assert.equal(row.fhfa_hpi.acs_midpoint_year, 2022, `${geoid}: adjustment should document the ACS 5-year midpoint`);
  assert(row.fhfa_hpi.adjustment_factor > 1, `${geoid}: adjustment factor should be non-vacuous`);
  assert(row.fhfa_hpi.adjustment_method.includes('10-year HPI CAGR'), `${geoid}: adjustment method should disclose the midpoint estimate`);
  assert.ok(isOfficialFhfaUrl(row.fhfa_hpi.source_url), `${geoid}: FHFA county source URL should use an exact official hostname`);
}

// Non-vacuity belongs on the SCAN, not on the defect.
//
// This used to assert `adjustedSummaries.length > 0` and
// `suppressedSummaries.length > 0` — at least one place must have needed a
// county fallback, and at least one must STILL be implausible afterwards.
// Both break if the underlying data improves, and the reflex when a test
// fails right after a data fix is to weaken the test. See #1743; the same
// shape made test:polymarket-resolved require a settled market to exist,
// which would have failed the fix for #1738.
//
// The floor is now on the population that was read. What replaces the
// "must exist" assertions is stronger than they were: the suppression RULE
// is checked in both directions against every profile carrying the inputs,
// so it holds at any population size, including zero.
const allProfiles = fs.readdirSync(path.join(ROOT, 'data/hna/summary'))
  .filter((file) => file.endsWith('.json'))
  .map((file) => JSON.parse(fs.readFileSync(path.join(ROOT, 'data/hna/summary', file), 'utf8')).acsProfile)
  .filter((profile) => profile && profile.median_home_value);
assert(allProfiles.length > 400,
  `only ${allProfiles.length} summaries carry a median_home_value; the scan is vacuous`);

const adjustedSummaries = allProfiles
  .filter((profile) => profile.median_home_value.source === 'county_zhvi_adjusted');
assert(
  adjustedSummaries.every((profile) => profile.median_home_value.acs_raw_value > 0 && profile.median_home_value.county_zhvi_to_acs_ratio > 0),
  'County-adjusted values should preserve raw ACS value and ratio provenance',
);

// scripts/hna/stamp_home_value_cascade.mjs suppresses income-to-own when an
// acs_raw or county_zhvi_adjusted value is under 10x annual median gross
// rent. Checked both ways: everything suppressed must meet the rule, and
// nothing that meets the rule may escape it.
const PRICE_TO_ANNUAL_RENT_FLOOR = 10;
const cascadeSourced = allProfiles
  .filter((p) => ['acs_raw', 'county_zhvi_adjusted'].includes(p.median_home_value.source))
  .filter((p) => Number(p.median_home_value.value) > 0 && Number(p.DP04_0134E) > 0);
assert(cascadeSourced.length > 0,
  'no cascade-sourced profile carries both a value and a rent; the suppression rule cannot be checked');

const ratioOf = (p) => Number(p.median_home_value.value) / (Number(p.DP04_0134E) * 12);
const wronglySuppressed = cascadeSourced
  .filter((p) => p.median_home_value.suppress_income_to_own && ratioOf(p) >= PRICE_TO_ANNUAL_RENT_FLOOR)
  .map((p) => `${p.median_home_value.value}/${p.DP04_0134E}`);
assert.deepEqual(wronglySuppressed.slice(0, 5), [],
  `${wronglySuppressed.length} profiles suppress income-to-own while at or above ${PRICE_TO_ANNUAL_RENT_FLOOR}x annual rent`);

const wronglyPublished = cascadeSourced
  .filter((p) => !p.median_home_value.suppress_income_to_own && ratioOf(p) < PRICE_TO_ANNUAL_RENT_FLOOR)
  .map((p) => `${p.median_home_value.value}/${p.DP04_0134E}`);
assert.deepEqual(wronglyPublished.slice(0, 5), [],
  `${wronglyPublished.length} profiles are below ${PRICE_TO_ANNUAL_RENT_FLOOR}x annual rent but still publish income-to-own`);

const suppressedSummaries = adjustedSummaries
  .filter((profile) => profile.median_home_value.suppress_income_to_own);

assert(hnaUtils.includes('function homeValueInfo'), 'HNA utils should expose the shared home-value cascade helper');
assert(/function homeValueInfo\(profile\) \{\n\s+return U\(\)\.homeValueInfo/.test(hnaRenderers), 'HNA renderers should delegate to the shared home-value cascade helper');
assert(/function renderAffordChart[\s\S]*homeValueInfo\(profile\)/.test(hnaRenderers), 'Affordability chart should use the home-value cascade helper');
assert(/function renderWageAffordability[\s\S]*homeValueInfo\(profile\)/.test(hnaRenderers), 'Wage affordability panel should use the home-value cascade helper');
assert(/statIncomeNeedSrc[\s\S]*homeValueSourceText[\s\S]*Freddie Mac PMMS/.test(hnaRenderers), 'Income-needed sublabel should consume shared homeValueInfo sourceText plus PMMS assumptions');
assert(!/ACS DP04_0089E median home value · <a href="https:\/\/www\.freddiemac\.com\/pmms"/.test(fs.readFileSync(path.join(ROOT, 'housing-needs-assessment.html'), 'utf8')), 'Income-needed card must not carry the old hard-coded ACS home-value source label');
assert(!/function renderAffordChart[\s\S]{0,900}safeNum\(profile\.DP04_0089E\) \|\| 0/.test(hnaRenderers), 'Affordability chart should not fall back to raw DP04 directly');
assert(!/function renderWageAffordability[\s\S]{0,900}profile && profile\.DP04_0089E/.test(hnaRenderers), 'Wage affordability panel should not read raw DP04 directly');
assert(/geoType === 'place' \|\| geoType === 'cdp' \|\| geoType === 'county'/.test(hnaController), 'Controller should lazy-load home-value cascade for county ownership views');
assert(/geoType === 'county'[\s\S]{0,220}homeValueData\.counties/.test(hnaRenderers), 'Ownership renderer should read county cascade rows before profile fallback');
assert(/Object\.assign\(\{ geography_level: 'county' \}, countyRec\)/.test(hnaRenderers), 'Ownership renderer should mark county home-value rows as county inputs');
assert(hnaUtils.includes("display.source === 'fhfa_county_hpi_anchor'"), 'HNA utils should label FHFA county HPI anchors');
assert(hnaRenderers.includes('ownerValueSupplyProfile: profile'), 'Ownership renderer should pass the loaded ACS profile for B25075 owner-value supply');
assert(ownershipNeed.includes('function ownerValueSupplySeries'), 'Ownership module should expose B25075 owner-value supply');
assert(homeValueBuilder.includes("data', 'market', 'fhfa_hpi_subcounty_co.json"), 'home-value cascade builder should consume the committed FHFA sub-county HPI artifact');

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
  assert.equal(cascade.counties[geoid].source, 'fhfa_county_hpi_anchor', `${label}: county cascade should use FHFA-primary owner decision C1 default`);
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
  vm.runInContext(moneyFormatter, ctx, { filename: 'js/utils/format-money.js' });
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
// Constructed, not harvested. These used to be adjustedSummaries[0] and
// suppressedSummaries[0] — a production row borrowed as a fixture — which is
// the real reason the `length > 0` assertions above could not simply be
// deleted: an empty array makes [0] undefined and the narrative checks throw.
//
// So the behaviour is exercised against fixtures built here, the way
// rawAcsProfile and the Fruita ZHVI profile already are, and production data
// is checked separately for rule compliance further up. Both survive the data
// improving until no place needs a fallback at all.
const adjustedProfile = {
  NAME: 'County-adjusted fixture',
  _geoType: 'place',
  _geoid: '0899998',
  _acsYear: 2024,
  DP04_0134E: 1400,
  DP03_0062E: 68000,
  median_home_value: {
    value: 420000,
    source: 'county_zhvi_adjusted',
    confidence: 'low',
    as_of: '2026-06',
    acs_raw_value: 180000,
    county_zhvi_to_acs_ratio: 2.3333,
    adjustment_note: 'fixture',
  },
};
// Below 10x annual gross rent (1400 * 12 * 10 = 168,000), so the cascade's
// own rule says income-to-own must be suppressed.
const suppressedProfile = {
  NAME: 'Suppressed fixture',
  _geoType: 'place',
  _geoid: '0899997',
  _acsYear: 2024,
  DP04_0134E: 1400,
  DP03_0062E: 68000,
  median_home_value: {
    value: 120000,
    source: 'county_zhvi_adjusted',
    confidence: 'low',
    as_of: '2026-06',
    acs_raw_value: 90000,
    county_zhvi_to_acs_ratio: 1.3333,
    suppress_income_to_own: true,
    suppress_reason: 'fixture',
  },
};
assert(suppressedProfile.median_home_value.value
  < suppressedProfile.DP04_0134E * 12 * PRICE_TO_ANNUAL_RENT_FLOOR,
  'the suppressed fixture must actually satisfy the suppression rule it stands for');

assertNarrativeHomeValueAgreement(surfaceCtx, rawAcsProfile, 'raw ACS fixture');
assertNarrativeHomeValueAgreement(surfaceCtx, zhviProfile, 'Fruita ZHVI');
assertNarrativeHomeValueAgreement(surfaceCtx, adjustedProfile, adjustedProfile.NAME || 'county-adjusted fixture');
assertNarrativeHomeValueAgreement(surfaceCtx, suppressedProfile, suppressedProfile.NAME || 'suppressed fixture');
assert.equal(surfaceCtx.window.HNAUtils.homeValueInfo(rawAcsProfile).sourceText, 'ACS DP04_0089E · ACS 2024 5-year', 'Raw ACS source text should carry the field and ACS vintage');
assert.equal(surfaceCtx.window.HNAUtils.homeValueInfo(zhviProfile).sourceText, 'Zillow ZHVI city index · ' + fruitaHomeValue.as_of + ' · high', 'ZHVI source text should carry source, as_of, and confidence');

console.log('hna-home-value-cascade: ok');
