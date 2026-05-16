'use strict';
/**
 * test/hna-deep-dive-batch2.test.js
 *
 * Regression for 2026-05-16 HNA deep-dive batch 2. Eight more bugs the
 * user surfaced after batch 1 landed and the page started showing real
 * data. Each verified live in the preview browser before commit.
 *
 * Bugs in scope:
 *   1. FMR year was bumped to FY2026 (which HUD hasn't published) —
 *      every UI label that quoted FY2025 was now wrong. Reverted to
 *      FY2025 in financial-constants.js.
 *   2. chartTenure used hard-coded slate+amber from PR #809 — user
 *      asked for theme palette consistency. Switched to c1 + c4.
 *   3. chartLehd expected lehd.flows[] (yearly array) but the cache
 *      ships scalar within/inflow/outflow. Render as 3-bar snapshot.
 *   4. chartPyramid + chartSenior expected cohorts[] but the DOLA
 *      cache ships parallel arrays ages[]/male[]/female[] (single
 *      year of age). Bin into 5-year cohorts at render time.
 *   5. chartOwnerCostBurden read DP04_0113E..DP04_0117E (count fields,
 *      not all valid in 2023) — switched to the SMOCAPI PE codes
 *      DP04_0111PE..DP04_0115PE that fetchAcsExtended actually pulls.
 *   6. LIHTC info-panel <ul class="lihtc-list"> bullets sat outside
 *      the card — no CSS. Added padding-left.
 *   7. jobMetrics + econIndicatorCards rendered .metric cards (with
 *      grid-column: span 4) inside a parent that uses a 3-col grid
 *      meant for .metric-card — children stacked vertically. Output
 *      .metric-card so they lay out horizontally per the CSS.
 *
 * Run: node test/hna-deep-dive-batch2.test.js
 */

const fs   = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { console.log('  ✅ PASS:', msg); passed++; }
  else       { console.error('  ❌ FAIL:', msg); failed++; }
}

const root  = path.join(__dirname, '..');
const consts = fs.readFileSync(path.join(root, 'js/config/financial-constants.js'), 'utf8');
const rend   = fs.readFileSync(path.join(root, 'js/hna/hna-renderers.js'), 'utf8');
const theme  = fs.readFileSync(path.join(root, 'css/site-theme.css'), 'utf8');

console.log('\n[test] #1 hudFmrYear is FY2025');
assert(/hudFmrYear:\s*['"]FY2025['"]/.test(consts),
  'financial-constants.hudFmrYear is FY2025 (FY2026 not yet published)');
assert(!/hudFmrYear:\s*['"]FY2026['"]/.test(consts),
  'no lingering FY2026 reference for hudFmrYear');

console.log('\n[test] #2 chartTenure uses theme palette (c1 + c4)');
// Restrict to the chartTenure block to avoid colliding with other charts
// that use c1/c4. The doughnut is rendered after the comment about
// theme palette tokens.
const tenureBlock = rend.match(
  /chartTenure[\s\S]*?backgroundColor:\s*\[([^\]]*)\]/
);
assert(tenureBlock != null, 'chartTenure block found with backgroundColor');
if (tenureBlock) {
  const colors = tenureBlock[1];
  assert(/t\.c1/.test(colors), 'uses t.c1 (theme blue/sky)');
  assert(/t\.c4/.test(colors), 'uses t.c4 (theme amber/brown)');
  assert(!/#334155/.test(colors), 'no longer hard-codes slate-700');
  assert(!/#f59e0b/.test(colors), 'no longer hard-codes amber-500');
}

console.log('\n[test] #3 chartLehd renders scalar within/inflow/outflow');
const lehdBody = rend.match(/function renderLehd\([\s\S]*?\n  \}/);
assert(lehdBody != null, 'renderLehd() found');
if (lehdBody) {
  const body = lehdBody[0];
  assert(/lehd\.within/.test(body), 'reads lehd.within (scalar)');
  assert(/lehd\.inflow/.test(body),  'reads lehd.inflow (scalar)');
  assert(/lehd\.outflow/.test(body), 'reads lehd.outflow (scalar)');
  assert(/Live & work in area|Inflow.*commute|Outflow.*commute/i.test(body),
    'labels describe the 3-flow snapshot');
}

console.log('\n[test] #4 renderDolaPyramid handles ages[]/male[]/female[] shape');
const dolaBody = rend.match(/function renderDolaPyramid\(dola\)\s*\{[\s\S]*?\n  \}/);
assert(dolaBody != null, 'renderDolaPyramid() found');
if (dolaBody) {
  const body = dolaBody[0];
  assert(/dola\.male|Array\.isArray\(dola\.male\)/.test(body),
    'reads dola.male as an array');
  assert(/dola\.female|Array\.isArray\(dola\.female\)/.test(body),
    'reads dola.female as an array');
  assert(/COHORTS|cohort/i.test(body),
    'bins into 5-year cohorts at render time');
}

console.log('\n[test] #5 chartOwnerCostBurden uses ACS 2023 PE codes');
const ownerBody = rend.match(/function renderOwnerCostBurdenChart\([\s\S]*?\n  \}/);
assert(ownerBody != null, 'renderOwnerCostBurdenChart() found');
if (ownerBody) {
  const body = ownerBody[0].replace(/\/\/[^\n]*/g, '');  // strip comments
  ['DP04_0111PE','DP04_0112PE','DP04_0113PE','DP04_0114PE','DP04_0115PE'].forEach(c => {
    assert(body.includes(c), 'uses ' + c);
  });
  ['DP04_0113E','DP04_0114E','DP04_0115E','DP04_0116E','DP04_0117E'].forEach(c => {
    assert(!body.includes(c),
      'legacy count code ' + c + ' no longer referenced in executable code');
  });
}

console.log('\n[test] #6 LIHTC info panel has CSS padding');
const lihtcCss = theme.match(/\.lihtc-list\s*\{([\s\S]*?)\}/);
assert(lihtcCss != null, '.lihtc-list block exists in site-theme.css');
if (lihtcCss) {
  assert(/padding-left\s*:/.test(lihtcCss[1]),
    'sets padding-left so bullets stay inside the card');
}

console.log('\n[test] #7 KPI cards use .metric-card markup');
// Both renderLaborMarketSection (jobMetrics) and renderEconomicIndicators
// must emit .metric-card / .mc-label / .mc-value markup so they lay out
// horizontally via the existing .metric-cards grid CSS.
const noComments = rend
  .replace(/\/\/[^\n]*/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '');
const metricCardEmits = (noComments.match(/class="metric-card"/g) || []).length;
assert(metricCardEmits >= 2,
  'at least two renderers emit .metric-card markup (jobMetrics + econIndicatorCards)');
assert(!/class="metric"><h3>/.test(noComments),
  'old .metric><h3> markup is fully replaced in executable code');

console.log('\n=========================================');
console.log('Results: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed === 0 ? 0 : 1);
