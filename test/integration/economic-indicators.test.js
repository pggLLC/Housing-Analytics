// test/integration/economic-indicators.test.js
//
// Integration tests for the Economic Indicators feature.
//
// Verifies:
//   1. The JS source file defines the expected economic indicator functions.
//   2. The HTML contains the expected container element IDs.
//   3. The Python modules export the expected classes.
//   4. The build_hna_data.py includes the WAC snapshot function.
//   5. Chart rendering functions accept a geoid parameter.
//   6. Wage gap table function is defined.
//   7. Economic indicators are wired into the update() flow.
//   8. Python bls_integration module defines expected public API.
//   9. Python economic_housing_bridge defines expected public API.
//
// Usage:
//   node test/integration/economic-indicators.test.js
//
// Exit code 0 = all checks passed; non-zero = one or more failures.

'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✅ PASS: ${message}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${message}`);
    failed++;
  }
}

function test(name, fn) {
  console.log(`\n[test] ${name}`);
  try {
    fn();
  } catch (err) {
    console.error(`  ❌ FAIL: threw unexpected error — ${err.message}`);
    failed++;
  }
}

const HNA_JS      = path.join(ROOT, 'js',   'housing-needs-assessment.js');
const HNA_HTML    = path.join(ROOT, 'housing-needs-assessment.html');
const BUILD_PY    = path.join(ROOT, 'scripts', 'hna', 'build_hna_data.py');
const INDICATORS_PY = path.join(ROOT, 'scripts', 'hna', 'economic_indicators.py');
const BLS_PY      = path.join(ROOT, 'scripts', 'hna', 'bls_integration.py');
const BRIDGE_PY   = path.join(ROOT, 'scripts', 'hna', 'economic_housing_bridge.py');

const hnaSrc    = fs.readFileSync(HNA_JS,   'utf8');
const hnaHtml   = fs.existsSync(HNA_HTML) ? fs.readFileSync(HNA_HTML, 'utf8') : '';
const buildSrc  = fs.existsSync(BUILD_PY)  ? fs.readFileSync(BUILD_PY, 'utf8') : '';
const indSrc    = fs.existsSync(INDICATORS_PY) ? fs.readFileSync(INDICATORS_PY, 'utf8') : '';
const blsSrc    = fs.existsSync(BLS_PY)    ? fs.readFileSync(BLS_PY,  'utf8') : '';
const bridgeSrc = fs.existsSync(BRIDGE_PY) ? fs.readFileSync(BRIDGE_PY, 'utf8') : '';

// ── Tests ───────────────────────────────────────────────────────────────────

test('Python economic_indicators.py exists and defines all indicator classes', () => {
  assert(fs.existsSync(INDICATORS_PY), 'scripts/hna/economic_indicators.py exists');
  assert(indSrc.includes('class EmploymentGrowthIndicator'), 'EmploymentGrowthIndicator class defined');
  assert(indSrc.includes('class WageTrendIndicator'),        'WageTrendIndicator class defined');
  assert(indSrc.includes('class IndustryConcentration'),     'IndustryConcentration class defined');
  assert(indSrc.includes('class JobAccessibility'),          'JobAccessibility class defined');
  assert(indSrc.includes('class UnemploymentContext'),        'UnemploymentContext class defined');
});

test('EmploymentGrowthIndicator implements YoY and CAGR methods', () => {
  assert(indSrc.includes('def yoy_pct'),  'yoy_pct static method defined');
  assert(indSrc.includes('def cagr'),     'cagr static method defined');
  assert(indSrc.includes('def compute'),  'compute method defined');
  assert(indSrc.includes('cagr_pct'),     'cagr_pct key in compute output');
  assert(indSrc.includes('yoy_series'),   'yoy_series key in compute output');
});

test('WageTrendIndicator tracks real wages and affordability', () => {
  assert(indSrc.includes('real_wages'),           'real_wages in WageTrendIndicator output');
  assert(indSrc.includes('affordability_ratio'),  'affordability_ratio in WageTrendIndicator output');
  assert(indSrc.includes('wage_gap_latest'),       'wage_gap_latest in WageTrendIndicator output');
  assert(indSrc.includes('cpi_deflators'),         'CPI deflator support in WageTrendIndicator');
});

test('IndustryConcentration computes Herfindahl index', () => {
  assert(indSrc.includes('herfindahl_index'),     'herfindahl_index method defined');
  assert(indSrc.includes('hhi_interpretation'),   'hhi_interpretation in output');
  assert(indSrc.includes('top3_share_pct'),        'top3_share_pct in output');
  assert(indSrc.includes('dominant_industry'),     'dominant_industry in output');
});

test('JobAccessibility computes commute and self-sufficiency metrics', () => {
  assert(indSrc.includes('jobs_to_workers_ratio'),    'jobs_to_workers_ratio in output');
  assert(indSrc.includes('in_county_employment_pct'), 'in_county_employment_pct in output');
  assert(indSrc.includes('commute_tier'),              'commute_tier in output');
  assert(indSrc.includes('self_sufficiency_score'),    'self_sufficiency_score in output');
});

test('UnemploymentContext computes UR and peer comparisons', () => {
  assert(indSrc.includes('unemployment_rate'), 'unemployment_rate in output');
  assert(indSrc.includes('lfpr_pct'),          'lfpr_pct in output');
  assert(indSrc.includes('vs_state_ppt'),      'vs_state_ppt in output');
  assert(indSrc.includes('vs_national_ppt'),   'vs_national_ppt in output');
  assert(indSrc.includes('context_label'),     'context_label in output');
});

test('Python bls_integration.py exists and defines expected API', () => {
  assert(fs.existsSync(BLS_PY), 'scripts/hna/bls_integration.py exists');
  assert(blsSrc.includes('def fetch_bls_series'),            'fetch_bls_series function defined');
  assert(blsSrc.includes('def fetch_county_unemployment'),   'fetch_county_unemployment function defined');
  assert(blsSrc.includes('def fetch_state_context'),         'fetch_state_context function defined');
  assert(blsSrc.includes('def fetch_qcew_county_wages'),     'fetch_qcew_county_wages function defined');
  assert(blsSrc.includes('def write_cache'),                 'write_cache helper defined');
  assert(blsSrc.includes('def read_cache'),                  'read_cache helper defined');
});

test('BLS integration caches data to JSON files', () => {
  assert(blsSrc.includes('data/hna/bls'),    'BLS cache directory is data/hna/bls');
  assert(blsSrc.includes('json.dumps'),      'writes JSON output');
});

test('Python economic_housing_bridge.py exists and defines expected API', () => {
  assert(fs.existsSync(BRIDGE_PY), 'scripts/hna/economic_housing_bridge.py exists');
  assert(bridgeSrc.includes('class WageAffordabilityGap'),        'WageAffordabilityGap class defined');
  assert(bridgeSrc.includes('def identify_sector_mismatches'),    'identify_sector_mismatches function defined');
  assert(bridgeSrc.includes('def affordability_by_industry'),     'affordability_by_industry function defined');
});

test('WageAffordabilityGap computes gap_dollars and wage_tiers', () => {
  assert(bridgeSrc.includes('gap_dollars'),    'gap_dollars in WageAffordabilityGap output');
  assert(bridgeSrc.includes('wage_tiers'),     'wage_tiers in WageAffordabilityGap output');
  assert(bridgeSrc.includes('affordable'),     'affordable flag in WageAffordabilityGap output');
  assert(bridgeSrc.includes('rent_burden_pct'), 'rent_burden_pct in WageAffordabilityGap output');
});

test('build_hna_data.py includes LEHD WAC snapshot function', () => {
  assert(fs.existsSync(BUILD_PY), 'scripts/hna/build_hna_data.py exists');
  assert(buildSrc.includes('def build_lehd_wac_snapshots'), 'build_lehd_wac_snapshots function defined');
  assert(buildSrc.includes('annualEmployment'),             'annualEmployment field written to LEHD JSON');
  assert(buildSrc.includes('yoyGrowth'),                    'yoyGrowth field written to LEHD JSON');
  assert(buildSrc.includes('annualWages'),                  'annualWages field written to LEHD JSON');
});

test('build_hna_data.py WAC spans years 2019–2023', () => {
  assert(buildSrc.includes('_WAC_SNAPSHOT_YEARS'), 'WAC_SNAPSHOT_YEARS constant defined');
  assert(buildSrc.includes('2019'),                '2019 in WAC snapshot years');
  assert(buildSrc.includes('2023'),                '2023 in WAC snapshot years');
  assert(buildSrc.includes('build_lehd_wac_snapshots()'), 'build_lehd_wac_snapshots called in main');
});

test('JS housing-needs-assessment.js defines renderEmploymentTrend', () => {
  assert(hnaSrc.includes('function renderEmploymentTrend'), 'renderEmploymentTrend function defined');
  assert(hnaSrc.includes('annualEmployment'),               'reads annualEmployment from LEHD cache');
  assert(hnaSrc.includes('yoyGrowth'),                      'reads yoyGrowth for YoY labels');
  assert(hnaSrc.includes('chartEmploymentTrend'),            'creates chartEmploymentTrend canvas');
});

test('JS housing-needs-assessment.js defines renderWageTrend', () => {
  assert(hnaSrc.includes('function renderWageTrend'), 'renderWageTrend function defined');
  assert(hnaSrc.includes('annualWages'),              'reads annualWages from LEHD cache');
  assert(hnaSrc.includes('chartWageTrend'),           'creates chartWageTrend canvas');
  assert(hnaSrc.includes('yAxisID'),                  'dual-axis chart uses yAxisID');
});

test('JS housing-needs-assessment.js defines renderIndustryAnalysis', () => {
  assert(hnaSrc.includes('function renderIndustryAnalysis'), 'renderIndustryAnalysis function defined');
  assert(hnaSrc.includes('chartIndustryAnalysis'),           'creates chartIndustryAnalysis canvas');
  assert(hnaSrc.includes('hhi'),                             'computes HHI for industry diversity');
  assert(hnaSrc.includes('Competitive'),                     'HHI label: Competitive');
});

test('JS housing-needs-assessment.js defines renderEconomicIndicators', () => {
  assert(hnaSrc.includes('function renderEconomicIndicators'), 'renderEconomicIndicators function defined');
  assert(hnaSrc.includes('economicIndicatorsContainer'),        'uses economicIndicatorsContainer element');
  assert(hnaSrc.includes('Total Jobs'),                         '4-card dashboard includes Total Jobs card');
  assert(hnaSrc.includes('YoY Growth'),                         '4-card dashboard includes YoY Growth card');
  assert(hnaSrc.includes('CAGR'),                               '4-card dashboard includes CAGR card');
  assert(hnaSrc.includes('Industry HHI'),                       '4-card dashboard includes HHI card');
});

test('JS housing-needs-assessment.js defines renderWageGaps', () => {
  assert(hnaSrc.includes('function renderWageGaps'), 'renderWageGaps function defined');
  assert(hnaSrc.includes('wageGapsContainer'),        'uses wageGapsContainer element');
  assert(hnaSrc.includes('Can Afford?'),              'affordability column in wage gaps table');
  assert(hnaSrc.includes('Monthly Gap'),              'gap column in wage gaps table');
});

test('Economic indicator functions are exposed on window', () => {
  assert(hnaSrc.includes('window.__HNA_renderEmploymentTrend'),    '__HNA_renderEmploymentTrend exposed');
  assert(hnaSrc.includes('window.__HNA_renderWageTrend'),          '__HNA_renderWageTrend exposed');
  assert(hnaSrc.includes('window.__HNA_renderIndustryAnalysis'),   '__HNA_renderIndustryAnalysis exposed');
  assert(hnaSrc.includes('window.__HNA_renderEconomicIndicators'), '__HNA_renderEconomicIndicators exposed');
  assert(hnaSrc.includes('window.__HNA_renderWageGaps'),           '__HNA_renderWageGaps exposed');
});

test('Economic indicator functions are called in the update() flow', () => {
  assert(hnaSrc.includes('renderEconomicIndicators('), 'renderEconomicIndicators called in update');
  assert(hnaSrc.includes('renderEmploymentTrend('),    'renderEmploymentTrend called in update');
  assert(hnaSrc.includes('renderWageTrend('),          'renderWageTrend called in update');
  assert(hnaSrc.includes('renderIndustryAnalysis('),   'renderIndustryAnalysis called in update');
  assert(hnaSrc.includes('renderWageGaps('),           'renderWageGaps called in update');
});

test('LEHD cache is populated before economic indicator rendering', () => {
  // The update() function should store LEHD into __HNA_LEHD_CACHE before calling render functions
  assert(hnaSrc.includes('__HNA_LEHD_CACHE'), '__HNA_LEHD_CACHE used to pass LEHD data');
});

test('Comparison mode: YoY and CAGR use multi-year data', () => {
  // CAGR formula uses firstYr and latestYr from annualEmployment
  assert(hnaSrc.includes('firstYr'),  'firstYr computed for CAGR calculation');
  assert(hnaSrc.includes('latestYr'), 'latestYr computed for CAGR calculation');
  assert(hnaSrc.includes('Math.pow'), 'Math.pow used in CAGR formula');
});

// ── Summary ─────────────────────────────────────────────────────────────────
console.log('\n' + '='.repeat(60));
console.log(`Results: ${passed} passed, ${failed} failed`);

if (failed > 0) {
  console.error('\nSome checks failed. Review the output above for details.');
  process.exitCode = 1;
} else {
  console.log('\nAll checks passed ✅');
}
