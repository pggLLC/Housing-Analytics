'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function readJson(rel) {
  return JSON.parse(read(rel));
}

function loadScript(rel) {
  require(path.join(ROOT, rel));
}

function money(n) {
  return '$' + Math.round(n).toLocaleString('en-US');
}

function setupDom() {
  const dom = new JSDOM('<!doctype html><body><main></main></body>', {
    url: 'http://127.0.0.1/housing-needs-assessment.html',
  });
  global.window = dom.window;
  global.document = dom.window.document;
  global.location = dom.window.location;
  global.MutationObserver = dom.window.MutationObserver;
  global.setTimeout = setTimeout;
  global.clearTimeout = clearTimeout;
  window.APP_CONFIG = {};
  window.HNAState = { state: {} };
  loadScript('js/hna/hna-utils.js');
  loadScript('js/hna/hna-ownership-need.js');
  loadScript('js/hna/hna-narratives.js');
  loadScript('js/hna/hna-section-takeaways.js');
  loadScript('js/components/housing-type-need.js');
  loadScript('js/hna/hna-comparison.js');
  return dom;
}

function profileFor(geoid) {
  const summary = readJson('data/hna/summary/' + geoid + '.json');
  const profile = Object.assign({}, summary.acsProfile);
  profile._geoType = summary.geo.type;
  profile._geoid = geoid;
  return profile;
}

function assertSurfaceUsesResolvedHomeValue(geoid, label) {
  const profile = profileFor(geoid);
  const info = window.HNAUtils.homeValueInfo(profile);
  assert(info && info.display, label + ' has a resolved cascade display value');
  assert.notEqual(profile.DP04_0089E, info.value, label + ' golden case raw ACS differs from resolved value');

  window.HNAState.state.lastProfile = profile;
  window.HNAState.state.lastLabel = label;
  window.HNAState.state.contextCounty = null;
  const ctx = window.HnaSectionTakeaways.gatherCtx();
  assert.equal(ctx.medianHome, info.value, label + ' takeaway context uses resolved home-value cascade');

  const homeTakeaway = window.HnaSectionTakeaways.takeaways['Home value'](ctx);
  const affordabilityTakeaway = window.HnaSectionTakeaways.takeaways['Homeownership affordability'](ctx);
  const narrative = window.HNANarratives.buildExecutiveSummary(profile, label);
  const htnAcs = window.HousingTypeNeed._extractAcs(profile);
  const comparisonHtml = window.HNAComparison._buildHomeownershipSection(
    { acsProfile: profile },
    { acsProfile: profile },
    { type: profile._geoType, geoid, name: label, metrics: {} },
    { type: profile._geoType, geoid, name: label, metrics: {} }
  );

  [homeTakeaway, narrative, comparisonHtml].forEach((html, idx) => {
    assert(html && html.includes(money(info.value)), label + ' surface #' + idx + ' renders resolved value ' + money(info.value));
    assert(!html.includes(money(profile.DP04_0089E)), label + ' surface #' + idx + ' does not render raw ACS value ' + money(profile.DP04_0089E));
  });
  assert(affordabilityTakeaway && !affordabilityTakeaway.includes(money(profile.DP04_0089E)), label + ' affordability takeaway does not render raw ACS value');
  assert.equal(htnAcs.medHomeVal, info.value, label + ' HousingTypeNeed uses resolved value for ownership-gap score input');
  assert.equal(window.HNAComparison._homeValueInfo(profile).value, info.value, label + ' comparison resolver returns cascade value');

  return { ctx, narrative, info, raw: profile.DP04_0089E };
}

console.log('\nMetric truth cross-surface tests');
console.log('='.repeat(50));

setupDom();

const fruita = assertSurfaceUsesResolvedHomeValue('0828745', 'Fruita');
assertSurfaceUsesResolvedHomeValue('0838535', 'Ignacio');

const expectedIncome = window.HNAOwnershipNeed.incomeNeededForHomeValue(fruita.info.value);
assert(expectedIncome > 0, 'PITI income helper computes a non-vacuous income');
const expectedIncomeText = money(expectedIncome);
const fruitaAffordability = window.HnaSectionTakeaways.takeaways['Homeownership affordability'](fruita.ctx);
assert(fruitaAffordability.includes(expectedIncomeText), 'takeaway income-needed uses PITI helper output');
assert(fruita.narrative.includes(expectedIncomeText), 'narrative income-needed matches takeaway PITI output');
assert(!fruitaAffordability.includes(money(Math.round(fruita.raw * 0.20))), 'takeaway does not render raw ACS x 0.20 income shortcut');
assert(!fruita.narrative.includes(money(Math.round(fruita.raw * 0.20))), 'narrative does not render raw ACS x 0.20 income shortcut');

const comparisonMetrics = window.HNAComparison._comparisonMetrics;
const vacancyMetric = comparisonMetrics.find((m) => m.id === 'vacancy_rate');
assert(vacancyMetric, 'comparison metrics include vacancy rate');
assert.equal(vacancyMetric.label, 'Adjusted Active-Market Vacancy Rate', 'comparison labels adjusted vacancy truthfully');

const censusGeoSrc = read('js/census-geo.js');
assert(censusGeoSrc.includes('Median home value — ACS estimate (may lag current market)'), 'raw ACS explorer labels home value as lagging ACS estimate');

const takeawaysSrc = read('js/hna/hna-section-takeaways.js');
const narrativesSrc = read('js/hna/hna-narratives.js');
const housingTypeSrc = read('js/components/housing-type-need.js');
const comparisonSrc = read('js/hna/hna-comparison.js');
[
  'ctx.medianHome   = _safeNum(p.DP04_0089E)',
  'Math.round(c.medianHome * 0.20)',
  'Math.round(ctx.medianHomeVal * 0.20)',
  'var medHomeVal = num(p.DP04_0089E);',
  'var homeValA = pA.DP04_0089E',
  'var homeValB = pB.DP04_0089E',
].forEach((needle) => {
  const haystack = takeawaysSrc + '\n' + narrativesSrc + '\n' + housingTypeSrc + '\n' + comparisonSrc;
  assert(!haystack.includes(needle), 'legacy raw/shortcut consumer remains absent: ' + needle);
});
assert(takeawaysSrc.includes('HNAOwnershipNeed.incomeNeededForHomeValue'), 'takeaways invoke HNAOwnershipNeed PITI income helper');
assert(narrativesSrc.includes('HNAOwnershipNeed.incomeNeededForHomeValue'), 'narratives invoke HNAOwnershipNeed PITI income helper');
assert(read('js/hna/hna-ownership-need.js').includes('maxAffordablePrice(hi, 1.00, assumptions)'), 'income helper derives from maxAffordablePrice');

console.log('  ✅ golden home-value and PITI affordability surfaces are aligned');
