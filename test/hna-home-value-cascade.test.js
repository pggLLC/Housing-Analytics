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
const hnaRenderers = fs.readFileSync(path.join(ROOT, 'js/hna/hna-renderers.js'), 'utf8');

assert(fruitaHomeValue, 'Fruita summary should be stamped with median_home_value');
assert.equal(fruitaHomeValue.source, 'zhvi', 'Fruita should use Zillow ZHVI as the display home value');
assert(fruitaHomeValue.value > fruita.DP04_0089E, 'Fruita ZHVI should be higher than stale ACS raw value');
assert(fruitaHomeValue.value > 450000 && fruitaHomeValue.value < 525000, 'Fruita ZHVI spot check should be around $486k');
assert.deepStrictEqual(fruitaHomeValue, cascade.places['0828745'], 'Fruita summary display value should match committed cascade');

const flags = cascade.review_flags && cascade.review_flags.zhvi_over_acs_ratio_gt_3 || [];
assert(flags.some((row) => row.geoid === '0803620' && row.ratio > 3), 'Aspen should be flagged as ZHVI/ACS > 3x');
assert.equal(cascade.meta.counts.total, 482, 'home-value cascade should cover all Colorado places in the public HNA set');

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

assert(hnaRenderers.includes('function homeValueInfo'), 'HNA renderers should have a shared home-value cascade helper');
assert(/function renderAffordChart[\s\S]*homeValueInfo\(profile\)/.test(hnaRenderers), 'Affordability chart should use the home-value cascade helper');
assert(/function renderWageAffordability[\s\S]*homeValueInfo\(profile\)/.test(hnaRenderers), 'Wage affordability panel should use the home-value cascade helper');
assert(!/function renderAffordChart[\s\S]{0,900}safeNum\(profile\.DP04_0089E\) \|\| 0/.test(hnaRenderers), 'Affordability chart should not fall back to raw DP04 directly');
assert(!/function renderWageAffordability[\s\S]{0,900}profile && profile\.DP04_0089E/.test(hnaRenderers), 'Wage affordability panel should not read raw DP04 directly');

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

console.log('hna-home-value-cascade: ok');
