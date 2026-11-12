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
assert(/composite\s*=[^;]*Math\.round/.test(c4),
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

// C4 behaviour (independent QA/QC F02, 12 Nov 2026): a missing input stays missing. With any of the five inputs
// absent a county has no composite and says which inputs are missing; a failed HMDA feed leaves every county
// unscored; a measured 0 still scores. Runs the real module on invented counties.
const vm = require('vm');
function runC4(files) {
  const win = {
    DataService: { baseData: rel => rel, getJSON: url => (url in files && files[url] !== 503) ? Promise.resolve(files[url]) : Promise.reject(new Error('503 ' + url)) }
  };
  const doc = { readyState: 'complete', getElementById: () => null };
  vm.runInNewContext(c4, { window: win, document: doc, Number, Math, Object, Promise, String, Array });
  return win.MarketHealthComposite.init().then(() => ({ M: win.MarketHealthComposite, rows: win.MarketHealthComposite.computeAll() }));
}
const econ = (j, p, u) => ({ job_growth_5yr_pct: j, population_growth_5yr_pct: p, unemployment_rate: u });
const fixture = over => Object.assign({
  'co-county-economic-indicators.json': { counties: { Adams: econ(4, 3, 4.1), Alamosa: econ(1, 0.5, 5.2), Arapahoe: econ(2.5, 2, 3.9) } },
  'hmda/co-county-aggregates.json': { counties: {
    '08001': { years: { 2024: { originations: 9000, denial_rate: 0.12 } } },
    '08003': { years: { 2024: { originations: 300, denial_rate: 0.2 } } },
    '08005': { years: { 2024: { originations: 11000, denial_rate: 0.1 } } } } },
  'co-county-demographics.json': { counties: { Adams: { households: 180000 }, Alamosa: { households: 6500 }, Arapahoe: { households: 260000 } } }
}, over);
const byName = (rows, n) => rows.find(r => r.name === n);
const renderText = M => { const m = { innerHTML: '', querySelector: () => null, querySelectorAll: () => [] }; M.render(m); return m.innerHTML; };
const behaviour = [
  runC4(fixture({})).then(({ rows }) => {
    assert(rows.length === 3 && rows.every(r => Number.isInteger(r.composite) && r.composite >= 0 && r.composite <= 100),
      'C4 complete inputs: every county has a 0-100 composite');
  }),
  runC4(fixture({ 'hmda/co-county-aggregates.json': 503 })).then(({ M, rows }) => {
    assert(rows.every(r => r.composite == null), 'C4 HMDA feed failed: no county gets a numeric composite (' + rows.map(r => r.composite).join(',') + ')');
    assert(rows.every(r => r.missing.indexOf('denial rate') > -1 && r.missing.indexOf('mortgage originations per 1,000 households') > -1),
      'C4 HMDA feed failed: each county names the missing HMDA inputs');
    const html = renderText(M);
    assert(/did not load/.test(html) && /3 of 3 counties are not scored/.test(html), 'C4 HMDA feed failed: the table says so above the rows');
  }),
  runC4(fixture({ 'co-county-economic-indicators.json': { counties: { Adams: econ(4, 3, 4.1), Alamosa: econ(null, null, null), Arapahoe: econ(2.5, 2, 3.9) } } })).then(({ rows }) => {
    const a = byName(rows, 'Alamosa');
    assert(a.composite == null && a.jobGrowth === null && a.popGrowth === null && a.unempRate === null,
      'C4 missing economic fields: stay missing (not 0) and the county is not scored');
    assert(rows[rows.length - 1].name === 'Alamosa', 'C4 an unscored county sorts after the scored ones');
    assert(Number.isInteger(byName(rows, 'Adams').composite), 'C4 missing fields elsewhere leave other counties scored');
  }),
  ...[null, ''].map(v => runC4(fixture({ 'hmda/co-county-aggregates.json': { counties: {
    '08001': { years: { 2024: { originations: v, denial_rate: 0.12 } } },
    '08003': { years: { 2024: { originations: 0, denial_rate: 0.2 } } },
    '08005': { years: { 2024: { originations: 11000, denial_rate: 0.1 } } } } } })).then(({ rows }) => {
    const a = byName(rows, 'Adams'), z = byName(rows, 'Alamosa');
    assert(a.composite == null && a.origPer1k === null && a.missing.indexOf('mortgage originations per 1,000 households') > -1,
      'C4 originations ' + JSON.stringify(v) + ': missing, not a rate of 0, and the county is not scored');
    assert(z.origPer1k === 0 && Number.isInteger(z.composite), 'C4 measured 0 originations is a rate of 0 and still scores');
  })),
  runC4(fixture({ 'co-county-economic-indicators.json': { counties: { Adams: econ(4, 3, 4.1), Alamosa: econ(0, 0, 5.2), Arapahoe: econ(2.5, 2, 3.9) } } })).then(({ rows }) => {
    const a = byName(rows, 'Alamosa');
    assert(a.jobGrowth === 0 && a.popGrowth === 0 && Number.isInteger(a.composite), 'C4 a measured 0 is a value and still scores');
  })
];
// The footer cites the program that actually produces each column (Codex on #2792): read the producer,
// scripts/fetch_county_economic_indicators.py, for the function behind job_growth_5yr_pct and unemployment_rate
// and the BLS series it requests (LAUCN... is LAUS; ENU... would be QCEW), and the committed file's source line.
const producer = readRel('scripts/fetch_county_economic_indicators.py');
function programFor(field) {
  const v = (new RegExp('"' + field + '":\\s*(\\w+)\\.get\\(').exec(producer) || [])[1];
  const fn = v && (new RegExp(v + '\\s*=\\s*(\\w+)\\(').exec(producer) || [])[1];
  const body = fn ? producer.slice(producer.indexOf('def ' + fn + '('), producer.indexOf('\ndef ', producer.indexOf('def ' + fn + '(') + 1)) : '';
  return /f"LAUCN/.test(body) ? 'LAUS' : /ENU|\/cew\/|qcew/i.test(body) ? 'QCEW' : null;
}
const empProg = programFor('job_growth_5yr_pct'), urProg = programFor('unemployment_rate');
assert(empProg === 'LAUS' && urProg === 'LAUS', 'C4 producer: employed residents from ' + empProg + ', unemployment from ' + urProg);
assert(/BLS LAUS[^,]*employment/i.test(indicators.source || ''), 'C4 committed indicators file names LAUS employment as its source');
const footer = (/'Sources: ([\s\S]*?)<\/p>'/.exec(c4) || [])[1] || '';
const cites = prog => prog === 'LAUS' ? /BLS LAUS<\/a> \(employed residents/.test(footer) : /BLS QCEW<\/a> \(jobs/.test(footer);
assert(cites(empProg) && (empProg === 'QCEW' || !/QCEW|bls\.gov\/cew/.test(footer)),
  'C4 footer cites the program that produces employed residents (' + empProg + ')');
assert(!/QCEW/.test(cddHtml), 'colorado-deep-dive cites no QCEW series it does not use');

Promise.all(behaviour).catch(e => assert(false, 'C4 behaviour threw: ' + e.message)).then(() => {
  console.log('\n=========================================');
  console.log('Results: ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed === 0 ? 0 : 1);
});
