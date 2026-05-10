// test/hmda-trend-and-chas-badge.test.js
//
// Tests for two ship items in this PR:
//   #2 — Statewide HMDA YoY trend chart on economic-dashboard
//        (js/hmda-trend-chart.js + economic-dashboard.html)
//   #3 — Provenance badge on CHAS chart title
//        (js/hna/hna-renderers.js _setProvenanceBadge + housing-needs-assessment.html
//         #chasProvenanceBadge)
//
// Run: node test/hmda-trend-and-chas-badge.test.js

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

console.log('\n[test] HMDA trend chart module structure');
const hmdaSrc = readRel('js/hmda-trend-chart.js');
assert(/window\.HmdaTrendChart\s*=\s*\{/.test(hmdaSrc),
  'attaches HmdaTrendChart to window');
['init', 'render'].forEach((fn) => {
  assert(new RegExp('function\\s+' + fn + '\\s*\\(').test(hmdaSrc),
    'defines ' + fn + '() function');
});
['_drawChart', '_setText', '_setDelta', '_yoyPct', '_yoyPp', '_formatCompact'].forEach((fn) => {
  assert(new RegExp('function\\s+' + fn + '\\s*\\(').test(hmdaSrc),
    'defines internal helper ' + fn + '()');
});

console.log('\n[test] Path convention regression guard (PR #791)');
assert(!/baseData\s*\(\s*['"]data\//.test(hmdaSrc),
  'no path passed to baseData() starts with "data/"');
assert(/STATE_TRENDS_PATH\s*=\s*['"]hmda\//.test(hmdaSrc),
  'STATE_TRENDS_PATH starts with "hmda/" (relative to data/)');

console.log('\n[test] Economic-dashboard wires the HMDA trend section');
const econSrc = readRel('economic-dashboard.html');
assert(/hmda-trends-section/.test(econSrc),
  'economic-dashboard.html has #hmda-trends-section');
assert(/hmdaTrendOriginations/.test(econSrc),
  'has #hmdaTrendOriginations KPI placeholder');
assert(/hmdaTrendDenialRate/.test(econSrc),
  'has #hmdaTrendDenialRate KPI placeholder');
assert(/hmdaTrendMeanLoan/.test(econSrc),
  'has #hmdaTrendMeanLoan KPI placeholder');
assert(/hmdaTrendMultifamily/.test(econSrc),
  'has #hmdaTrendMultifamily KPI placeholder');
assert(/hmdaTrendOriginationsChart/.test(econSrc),
  'has 4 trend chart canvases (originations)');
assert(/hmdaTrendDenialChart/.test(econSrc),
  'has 4 trend chart canvases (denial)');
assert(/hmdaTrendMeanLoanChart/.test(econSrc),
  'has 4 trend chart canvases (mean loan)');
assert(/hmdaTrendMultifamilyChart/.test(econSrc),
  'has 4 trend chart canvases (multifamily)');
assert(/js\/hmda-trend-chart\.js/.test(econSrc),
  'economic-dashboard.html loads js/hmda-trend-chart.js');

console.log('\n[test] CHAS provenance badge (item #3)');
const renderersSrc = readRel('js/hna/hna-renderers.js');
assert(/_setProvenanceBadge/.test(renderersSrc),
  'hna-renderers.js defines _setProvenanceBadge()');
['tiger', 'county', 'county-approx'].forEach((state) => {
  assert(new RegExp("'" + state + "'").test(renderersSrc),
    '_setProvenanceBadge handles state: ' + state);
});
assert(/chasProvenanceBadge/.test(renderersSrc),
  'hna-renderers.js targets #chasProvenanceBadge element');

const hnaHtml = readRel('housing-needs-assessment.html');
assert(/id="chasProvenanceBadge"/.test(hnaHtml),
  'housing-needs-assessment.html has #chasProvenanceBadge span');

console.log('\n[test] CHAS renderer wires badge through all three paths');
assert(/_setProvenanceBadge\(['"]tiger['"]\)/.test(renderersSrc),
  'TIGER path sets badge to "tiger"');
assert(/_setProvenanceBadge\(['"]none['"]\)/.test(renderersSrc),
  '"no data" path sets badge to "none"');
assert(/_setProvenanceBadge\(isPlaceProxy/.test(renderersSrc),
  'fallback path distinguishes county vs county-approx via isPlaceProxy');

console.log('\n[test] Statewide HMDA data file shape');
const stateDoc = JSON.parse(readRel('data/hmda/co-state-trends.json'));
assert(stateDoc.years && Object.keys(stateDoc.years).length >= 5,
  'co-state-trends.json has ≥5 years');
const years = Object.keys(stateDoc.years).sort();
const latest = stateDoc.years[years[years.length - 1]];
assert(latest && typeof latest.originations === 'number' && latest.originations > 50000,
  'latest year has originations > 50K (CO sanity)');
assert(typeof latest.denial_rate === 'number' && latest.denial_rate > 0 && latest.denial_rate < 1,
  'latest year denial_rate in [0, 1]');
assert(latest.multifamily && typeof latest.multifamily.originations === 'number',
  'latest year has multifamily.originations');

console.log('\n=========================================');
console.log('Results: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed === 0 ? 0 : 1);
