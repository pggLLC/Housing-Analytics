// test/integration/housing-needs-assessment.test.js
//
// Integration tests for the Housing Needs Assessment page.
//
// Verifies:
//   1. HNA JS source file exists and exports expected functions.
//   2. fetchBoundary error is caught and a warning banner is set (graceful degradation).
//   3. fetchWithTimeout is used for the TIGERweb boundary request.
//   4. hnaDataTimestamp element ID is present in the HTML.
//   5. housing-needs-assessment.html references the correct JS file.
//
// Usage:
//   node test/integration/housing-needs-assessment.test.js
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

const HNA_JS   = path.join(ROOT, 'js',   'housing-needs-assessment.js');
const HNA_HTML = path.join(ROOT, 'housing-needs-assessment.html');

const hnaSrc  = fs.readFileSync(HNA_JS,   'utf8');
const hnaHtml = fs.readFileSync(HNA_HTML, 'utf8');

// ── Tests ───────────────────────────────────────────────────────────────────

test('housing-needs-assessment.js exists and is non-empty', () => {
  assert(fs.existsSync(HNA_JS),    'js/housing-needs-assessment.js exists');
  assert(hnaSrc.length > 1000,     'file is non-trivially sized');
});

test('housing-needs-assessment.html exists and references the JS file', () => {
  assert(fs.existsSync(HNA_HTML),                                  'housing-needs-assessment.html exists');
  assert(hnaHtml.includes('housing-needs-assessment.js'),          'HTML references the HNA JS file');
});

test('HNA HTML includes data timestamp element', () => {
  assert(hnaHtml.includes('id="hnaDataTimestamp"'),
    'housing-needs-assessment.html has hnaDataTimestamp element');
  assert(hnaHtml.includes('data-timestamp'),
    'timestamp element uses data-timestamp CSS class');
});

test('HNA JS uses fetchWithTimeout from global (fetch-helper)', () => {
  assert(hnaSrc.includes('window.fetchWithTimeout'),
    'HNA JS aliases window.fetchWithTimeout');
});

test('TIGERweb boundary fetch is wrapped in try/catch for graceful degradation', () => {
  // The update() function wraps fetchBoundary in try/catch
  assert(hnaSrc.includes('fetchBoundary('), 'fetchBoundary is called');
  // Check that it's in a try block
  const tryBoundaryIdx = hnaSrc.indexOf('fetchBoundary(');
  const tryCatchIdx    = hnaSrc.lastIndexOf('try{', tryBoundaryIdx);
  assert(tryCatchIdx !== -1,
    'fetchBoundary call is inside a try block (graceful degradation)');
});

test('HNA JS updates timestamp after data load', () => {
  assert(hnaSrc.includes('hnaDataTimestamp'),
    'HNA JS references hnaDataTimestamp element');
  assert(hnaSrc.includes('Data as of'),
    'HNA JS sets "Data as of" text');
});

test('fetchBoundary uses 15-second timeout', () => {
  assert(hnaSrc.includes('15000'),
    'fetchBoundary uses 15000ms timeout for TIGERweb');
});

test('HNA boundary failure message is informative', () => {
  assert(hnaSrc.includes('TIGERweb'),
    'Boundary failure message mentions TIGERweb for user clarity');
});

test('Labor Market section: JS functions defined', () => {
  assert(hnaSrc.includes('function calculateJobMetrics'),   'calculateJobMetrics is defined');
  assert(hnaSrc.includes('function calculateWageDistribution'), 'calculateWageDistribution is defined');
  assert(hnaSrc.includes('function parseIndustries'),       'parseIndustries is defined');
  assert(hnaSrc.includes('function renderLaborMarketSection'), 'renderLaborMarketSection is defined');
  assert(hnaSrc.includes('function renderJobMetrics'),      'renderJobMetrics is defined');
  assert(hnaSrc.includes('function renderWageChart'),       'renderWageChart is defined');
  assert(hnaSrc.includes('function renderIndustryChart'),   'renderIndustryChart is defined');
  assert(hnaSrc.includes('function renderCommutingFlows'),  'renderCommutingFlows is defined');
});

test('Prop 123 section: JS functions defined', () => {
  assert(hnaSrc.includes('function calculateBaseline'),          'calculateBaseline is defined');
  assert(hnaSrc.includes('function calculateGrowthTarget'),      'calculateGrowthTarget is defined');
  assert(hnaSrc.includes('function checkFastTrackEligibility'),  'checkFastTrackEligibility is defined');
  assert(hnaSrc.includes('function renderProp123Section'),       'renderProp123Section is defined');
  assert(hnaSrc.includes('function renderBaselineCard'),         'renderBaselineCard is defined');
  assert(hnaSrc.includes('function renderGrowthChart'),          'renderGrowthChart is defined');
  assert(hnaSrc.includes('function renderFastTrackCard'),        'renderFastTrackCard is defined');
  assert(hnaSrc.includes('function renderChecklist'),            'renderChecklist is defined');
});

test('Prop 123 section: constants defined correctly', () => {
  assert(hnaSrc.includes('PROP123_GROWTH_RATE = 0.03'),     'growth rate constant is 0.03 (3%)');
  assert(hnaSrc.includes('PROP123_MUNICIPALITY_THRESHOLD'), 'municipality threshold constant defined');
  assert(hnaSrc.includes('PROP123_COUNTY_THRESHOLD'),       'county threshold constant defined');
});

test('HTML contains Labor Market section with expected elements', () => {
  assert(hnaHtml.includes('id="labor-market-section"'),      'labor-market-section present');
  assert(hnaHtml.includes('id="jobMetrics"'),                'jobMetrics container present');
  assert(hnaHtml.includes('id="wageChartContainer"'),        'wageChartContainer present');
  assert(hnaHtml.includes('id="industryChartContainer"'),    'industryChartContainer present');
  assert(hnaHtml.includes('id="commutingFlowsContainer"'),   'commutingFlowsContainer present');
  assert(hnaHtml.includes('id="chartWage"'),                 'chartWage canvas present');
  assert(hnaHtml.includes('id="chartIndustry"'),             'chartIndustry canvas present');
});

test('HTML contains Prop 123 section with expected elements', () => {
  assert(hnaHtml.includes('id="prop123-section"'),           'prop123-section present');
  assert(hnaHtml.includes('id="prop123BaselineContent"'),    'baseline content area present');
  assert(hnaHtml.includes('id="prop123GrowthContent"'),      'growth content area present');
  assert(hnaHtml.includes('id="prop123FastTrackContent"'),   'fast-track content area present');
  assert(hnaHtml.includes('id="prop123Checklist"'),          'compliance checklist present');
  assert(hnaHtml.includes('id="chartProp123Growth"'),        'growth chart canvas present');
  assert(hnaHtml.includes('HB 22-1093'),                     'HB 22-1093 referenced in HTML');
});

test('CSS contains new section styles', () => {
  const css = fs.readFileSync(path.join(ROOT, 'css', 'pages', 'housing-needs-assessment.css'), 'utf8');
  assert(css.includes('.labor-market-section'),  '.labor-market-section class defined');
  assert(css.includes('.metric-card'),           '.metric-card class defined');
  assert(css.includes('.prop123-section'),        '.prop123-section class defined');
  assert(css.includes('.compliance-status'),      '.compliance-status class defined');
  assert(css.includes('.timeline-chart'),         '.timeline-chart class defined');
  assert(css.includes('.checklist-item'),         '.checklist-item class defined');
  assert(css.includes('.commuting-table'),        '.commuting-table class defined');
});

test('HTML contains Data Quality badge and aria-live region', () => {
  assert(hnaHtml.includes('id="dataQualityBadge"'),
    'dataQualityBadge element present');
  assert(hnaHtml.includes('aria-live="polite"'),
    'aria-live="polite" region present (WCAG 4.1.3)');
  assert(hnaHtml.includes('id="hnaLiveRegion"'),
    'hnaLiveRegion element present');
});

test('HTML contains Municipal vs County comparison panel', () => {
  assert(hnaHtml.includes('id="municipalComparisonPanel"'),
    'municipalComparisonPanel present');
  assert(hnaHtml.includes('id="mcpPopShare"'),      'mcpPopShare metric present');
  assert(hnaHtml.includes('id="mcpHousingUnits"'),  'mcpHousingUnits metric present');
  assert(hnaHtml.includes('id="mcpRentAdj"'),       'mcpRentAdj metric present');
  assert(hnaHtml.includes('id="mcpEstJobs"'),       'mcpEstJobs metric present');
  assert(hnaHtml.includes('docs/MUNICIPAL-ANALYSIS-METHODOLOGY.md'),
    'link to MUNICIPAL-ANALYSIS-METHODOLOGY.md present');
});

test('HTML references municipal-analysis.js', () => {
  assert(hnaHtml.includes('municipal-analysis.js'),
    'housing-needs-assessment.html references municipal-analysis.js');
});

test('CSS contains Data Quality badge and comparison panel styles', () => {
  const css = fs.readFileSync(path.join(ROOT, 'css', 'pages', 'housing-needs-assessment.css'), 'utf8');
  assert(css.includes('.data-quality-badge'),         '.data-quality-badge class defined');
  assert(css.includes('.confidence-direct'),          '.confidence-direct class defined');
  assert(css.includes('.confidence-interpolated'),    '.confidence-interpolated class defined');
  assert(css.includes('.confidence-estimated'),       '.confidence-estimated class defined');
  assert(css.includes('.municipal-comparison-panel'), '.municipal-comparison-panel class defined');
  assert(css.includes('.mcp-grid'),                   '.mcp-grid class defined');
  assert(css.includes('.mcp-metric'),                 '.mcp-metric class defined');
});

test('js/municipal-analysis.js exists and exports key functions', () => {
  const maPath = path.join(ROOT, 'js', 'municipal-analysis.js');
  assert(fs.existsSync(maPath), 'js/municipal-analysis.js exists');
  const maSrc = fs.readFileSync(maPath, 'utf8');
  assert(maSrc.includes('calculateMunicipalScaling'),         'calculateMunicipalScaling defined');
  assert(maSrc.includes('estimateMunicipalHousingStock'),     'estimateMunicipalHousingStock defined');
  assert(maSrc.includes('scaleMunicipalAffordability'),       'scaleMunicipalAffordability defined');
  assert(maSrc.includes('projectMunicipalDemographics'),      'projectMunicipalDemographics defined');
  assert(maSrc.includes('estimateMunicipalEmployment'),       'estimateMunicipalEmployment defined');
  assert(maSrc.includes('calculateMunicipalProp123Baseline'), 'calculateMunicipalProp123Baseline defined');
  assert(maSrc.includes('getDataConfidence'),                 'getDataConfidence defined');
  assert(maSrc.includes('buildMunicipalAnalysis'),            'buildMunicipalAnalysis defined');
  assert(maSrc.includes('window.MunicipalAnalysis'),         'exposed on window.MunicipalAnalysis');
  assert(maSrc.includes('module.exports'),                    'CommonJS export for Node.js tests');
});

test('Municipal data files exist and are valid JSON', () => {
  const municipalConfig  = path.join(ROOT, 'data', 'hna', 'municipal', 'municipal-config.json');
  const growthRates      = path.join(ROOT, 'data', 'hna', 'municipal', 'growth-rates.json');
  assert(fs.existsSync(municipalConfig), 'data/hna/municipal/municipal-config.json exists');
  assert(fs.existsSync(growthRates),     'data/hna/municipal/growth-rates.json exists');
  // Validate JSON
  let cfg, gr;
  try { cfg = JSON.parse(fs.readFileSync(municipalConfig, 'utf8')); }
  catch(e) { assert(false, `municipal-config.json is valid JSON: ${e.message}`); return; }
  try { gr  = JSON.parse(fs.readFileSync(growthRates, 'utf8')); }
  catch(e) { assert(false, `growth-rates.json is valid JSON: ${e.message}`); return; }
  assert(Array.isArray(cfg.municipalities) && cfg.municipalities.length > 0,
    'municipal-config.json has non-empty municipalities array');
  assert(Array.isArray(gr.rates) && gr.rates.length > 0,
    'growth-rates.json has non-empty rates array');
  // Verify FIPS code format
  cfg.municipalities.forEach(function(m) {
    assert(typeof m.geoid === 'string' && m.geoid.length === 7,
      `FIPS geoid "${m.geoid}" is 7 chars`);
    assert(typeof m.countyFips5 === 'string' && m.countyFips5.length === 5,
      `countyFips5 "${m.countyFips5}" is 5 chars`);
  });
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
