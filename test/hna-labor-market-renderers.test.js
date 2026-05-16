'use strict';
/**
 * test/hna-labor-market-renderers.test.js
 *
 * Regression for 2026-05-16 deep-dive batch 2. The Labor Market section
 * (chartWage, chartIndustry, jobMetrics) and Economic Indicators panel
 * (chartEmploymentTrend, chartWageTrend, chartIndustryAnalysis,
 * Wage Gaps, econIndicatorCards) were either:
 *   - stubs that found their canvas and returned, or
 *   - the existing trend renderer read from `state.lehdData`, a slot
 *     that was never populated (data lives in `__HNA_LEHD_CACHE` and
 *     is keyed by geoid).
 *
 * What this test asserts (source-grep):
 *   - Each of the 6 renderers is no longer a stub — it consumes lehd
 *     data and renders a chart or placeholder.
 *   - renderEmploymentTrend reads `__HNA_LEHD_CACHE` (the cache the
 *     controller actually populates), not `state.lehdData`.
 *   - renderEmploymentTrend / renderWageTrend handle the
 *     `{year: count}` dict shape that lives in the cache files
 *     (previous code did `.map(d => d.year)` on a dict — would render
 *     `["0","1","2",…]` if it didn't return early).
 *   - renderWageGaps injects a canvas into wageGapsContainer because
 *     the HTML container ships empty (no canvas).
 *
 * Run: node test/hna-labor-market-renderers.test.js
 */

const fs   = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { console.log('  ✅ PASS:', msg); passed++; }
  else       { console.error('  ❌ FAIL:', msg); failed++; }
}

const src = fs.readFileSync(
  path.join(__dirname, '..', 'js/hna/hna-renderers.js'),
  'utf8'
);

// Helper: extract a function body by name. Stops at the next top-level
// "function " declaration (renderers.js uses one-per-line declarations
// at the same indent so this is reliable).
function fnBody(name) {
  const re = new RegExp(
    'function\\s+' + name + '\\s*\\([\\s\\S]*?\\)\\s*\\{([\\s\\S]*?)\\n  \\}\\n',
    'm'
  );
  const m = src.match(re);
  return m ? m[1] : null;
}

console.log('\n[test] renderers are no longer stubs');
['renderLaborMarketSection',
 'renderEmploymentTrend',
 'renderWageTrend',
 'renderIndustryAnalysis',
 'renderEconomicIndicators',
 'renderWageGaps'].forEach(function (name) {
  const body = fnBody(name);
  assert(body != null && /makeChart|innerHTML|appendChild|metric/.test(body),
    name + '() does real work (makeChart / DOM write)');
});

console.log('\n[test] cache source is correct');
const srcNoComments = src
  .replace(/\/\/[^\n]*/g, '')           // strip line comments
  .replace(/\/\*[\s\S]*?\*\//g, '');    // strip block comments
assert(/__HNA_LEHD_CACHE/.test(srcNoComments),
  'renderers reference window.__HNA_LEHD_CACHE (where the controller puts the data)');
assert(!/state\.lehdData/.test(srcNoComments),
  'no lingering reads of state.lehdData in executable code (the slot that was never populated)');

console.log('\n[test] annualEmployment + annualWages handled as dicts');
const empBody = fnBody('renderEmploymentTrend') || '';
assert(/Object\.keys\(ae\)/.test(empBody) || /Object\.keys\([^)]*annualEmployment/.test(empBody),
  'renderEmploymentTrend treats annualEmployment as a {year: count} dict');
const wageBody = fnBody('renderWageTrend') || '';
assert(/Object\.keys\(aw\)/.test(wageBody) || /Object\.keys\([^)]*annualWages/.test(wageBody),
  'renderWageTrend treats annualWages as a {year: {low,medium,high}} dict');

console.log('\n[test] renderWageGaps injects a canvas into the empty container');
const wgBody = fnBody('renderWageGaps') || '';
assert(/wageGapsContainer/.test(wgBody),
  'renderWageGaps looks up #wageGapsContainer');
assert(/createElement\(['"]canvas/.test(wgBody),
  'renderWageGaps creates a <canvas> element');
assert(/chartWageGaps/.test(wgBody),
  'the injected canvas has id="chartWageGaps"');

console.log('\n=========================================');
console.log('Results: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed === 0 ? 0 : 1);
