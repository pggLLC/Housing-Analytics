// test/phase3-comparison-ideas.test.js
//
// Phase 3 / C1-C4 — validates the four comparison-review-inspired
// additions:
//   C1: js/affordability-metrics-panel.js   → colorado-deep-dive
//   C2: js/rent-vs-buy-breakeven.js         → deal-calculator
//   C3: js/methodology-explainer.js         → all three pages
//   C4: js/market-health-composite.js       → colorado-deep-dive
//
// Run: node test/phase3-comparison-ideas.test.js

'use strict';

const fs   = require('fs');
const path = require('path');

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) { console.log('  ✅ PASS: ' + msg); passed++; }
  else { console.error('  ❌ FAIL: ' + msg); failed++; }
}

function readRel(rel) {
  return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
}

console.log('\n[test] C1: Affordability metrics panel');
const c1 = readRel('js/affordability-metrics-panel.js');
assert(/window\.AffordabilityMetrics\s*=\s*\{/.test(c1),
  'attaches AffordabilityMetrics to window');
['init', 'compute', 'render'].forEach(fn => {
  assert(new RegExp('function\\s+' + fn + '\\s*\\(').test(c1),
    'defines ' + fn + '()');
});
assert(/price_to_income/.test(c1) && /price_to_rent/.test(c1),
  'computes P/I + P/R ratios');
assert(/MORTGAGE30US/.test(c1),
  'pulls current 30-yr rate from FRED MORTGAGE30US');
assert(!/baseData\s*\(\s*['"]data\//.test(c1),
  'path convention guard (no double-data/ prefix)');
const cddHtml = readRel('colorado-deep-dive.html');
assert(/id="affordabilityMetrics"/.test(cddHtml),
  'colorado-deep-dive has #affordabilityMetrics container');
assert(/affordability-metrics-panel\.js/.test(cddHtml),
  'colorado-deep-dive loads the panel script');

console.log('\n[test] C2: Rent vs Buy breakeven calculator');
const c2 = readRel('js/rent-vs-buy-breakeven.js');
assert(/window\.RentVsBuyBreakeven\s*=\s*\{/.test(c2),
  'attaches RentVsBuyBreakeven to window');
assert(/function\s+compute\s*\(/.test(c2),
  'defines compute()');
assert(/breakevenYear/.test(c2),
  'computes breakeven year');
assert(/principal|Math\.pow\(1 \+ monthlyRate, 360\)/.test(c2),
  'uses 30-year mortgage amortization');
assert(/LIHTC implication/i.test(c2),
  'surfaces LIHTC implication text in result');
const dcHtml = readRel('deal-calculator.html');
assert(/id="rvbCalculator"/.test(dcHtml),
  'deal-calculator has #rvbCalculator section');
['rvbHomePrice','rvbMonthlyRent','rvbMortgageRate','rvbDownPayment',
 'rvbPropTax','rvbMaint','rvbRentEsc','rvbHomeApp','rvbResult'].forEach(id => {
  assert(new RegExp('id="' + id + '"').test(dcHtml),
    'deal-calculator has #' + id);
});
assert(/rent-vs-buy-breakeven\.js/.test(dcHtml),
  'deal-calculator loads the breakeven script');

console.log('\n[test] C3: Methodology explainer');
const c3 = readRel('js/methodology-explainer.js');
assert(/window\.MethodologyExplainer\s*=\s*\{/.test(c3),
  'attaches MethodologyExplainer to window');
assert(/METHODOLOGY_REGISTRY\s*=/.test(c3),
  'has METHODOLOGY_REGISTRY');
['chas-cb','tiger-place-chas','cross-county-disclosure','pma-composite',
 'hmda-credit-access','prop123-baseline','tier-shares','rent-vs-buy',
 'affordability-ratios','market-health'].forEach(key => {
  assert(c3.includes("'" + key + "'"),
    'registry has key: ' + key);
});
assert(/data-methodology-key/.test(c3),
  'wires via [data-methodology-key] attribute');
assert(/MutationObserver/.test(c3),
  'auto-attaches to dynamically-added anchors via MutationObserver');
// HNA tag check
const hnaHtml = readRel('housing-needs-assessment.html');
assert(/data-methodology-key="chas-cb"/.test(hnaHtml),
  'HNA tags the CHAS chart heading');
assert(/methodology-explainer\.js/.test(hnaHtml),
  'HNA loads methodology-explainer');
assert(/methodology-explainer\.js/.test(cddHtml),
  'colorado-deep-dive loads methodology-explainer');
assert(/methodology-explainer\.js/.test(dcHtml),
  'deal-calculator loads methodology-explainer');

console.log('\n[test] C4: Market health composite');
const c4 = readRel('js/market-health-composite.js');
assert(/window\.MarketHealthComposite\s*=\s*\{/.test(c4),
  'attaches MarketHealthComposite to window');
assert(/computeAll/.test(c4),
  'has computeAll() function');
assert(/percentile/i.test(c4),
  'uses percentile-rank normalization');
assert(/composite\s*=\s*Math\.round/.test(c4),
  'rounds the composite to integer');
assert(/CO_COUNTY_NAMES_TO_FIPS/.test(c4),
  'maps county names to FIPS for HMDA cross-reference');
assert(/id="marketHealthComposite"/.test(cddHtml),
  'colorado-deep-dive has #marketHealthComposite');
assert(/market-health-composite\.js/.test(cddHtml),
  'colorado-deep-dive loads market-health-composite');
assert(/data-methodology-key="market-health"/.test(cddHtml),
  'market-health heading tagged with methodology key');

console.log('\n[test] Underlying data files exist + well-formed');
const indicators = JSON.parse(readRel('data/co-county-economic-indicators.json'));
assert(Array.isArray(Object.keys(indicators.counties)) && Object.keys(indicators.counties).length >= 60,
  '≥60 CO counties in indicators dataset');
const hmda = JSON.parse(readRel('data/hmda/co-county-aggregates.json'));
assert(Object.keys(hmda.counties).length === 64,
  '64 CO counties in HMDA dataset');

console.log('\n=========================================');
console.log('Results: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed === 0 ? 0 : 1);
