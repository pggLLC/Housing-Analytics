#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const cascade = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/hna/home-value-cascade.json'), 'utf8'));
const fruita = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/hna/summary/0828745.json'), 'utf8')).acsProfile;
const fruitaHomeValue = fruita.median_home_value || cascade.places['0828745'];
const affordabilityPanel = fs.readFileSync(path.join(ROOT, 'js/affordability-metrics-panel.js'), 'utf8');

assert.equal(fruitaHomeValue.source, 'zhvi', 'Fruita should use Zillow ZHVI as the display home value');
assert(fruitaHomeValue.value > fruita.DP04_0089E, 'Fruita ZHVI should be higher than stale ACS raw value');
assert(fruitaHomeValue.value > 450000 && fruitaHomeValue.value < 525000, 'Fruita ZHVI spot check should be around $486k');

const flags = cascade.review_flags && cascade.review_flags.zhvi_over_acs_ratio_gt_3 || [];
assert(flags.some((row) => row.geoid === '0803620' && row.ratio > 3), 'Aspen should be flagged as ZHVI/ACS > 3x');
assert.equal(cascade.meta.counts.total, 482, 'home-value cascade should cover all Colorado places in the public HNA set');

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
