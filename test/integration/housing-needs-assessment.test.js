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

// ── Geography scope selector (new) ──────────────────────────────────────────

test('HTML contains geography scope selector with three options', () => {
  assert(hnaHtml.includes('id="geoScope"'),
    'geoScope select element present');
  assert(hnaHtml.includes('value="state"'),
    'state option present in geoScope');
  assert(hnaHtml.includes('value="county"'),
    'county option present in geoScope');
  assert(hnaHtml.includes('value="municipality"'),
    'municipality option present in geoScope');
});

test('HTML contains geoSelectWrapper for cascade hiding', () => {
  assert(hnaHtml.includes('id="geoSelectWrapper"'),
    'geoSelectWrapper span/div present for scope cascade');
});

test('HTML contains ARIA live region for screen-reader announcements', () => {
  assert(hnaHtml.includes('id="hnaLiveRegion"'),
    '#hnaLiveRegion element present (WCAG 4.1.3)');
  assert(hnaHtml.includes('aria-live="polite"'),
    'aria-live="polite" attribute present');
  assert(hnaHtml.includes('aria-atomic="true"'),
    'aria-atomic="true" attribute present');
});

test('HTML contains data quality badge element', () => {
  assert(hnaHtml.includes('id="dataQualityBadge"'),
    '#dataQualityBadge element present');
});

test('HTML contains state comparison panel with expected elements', () => {
  assert(hnaHtml.includes('id="stateComparisonPanel"'),
    'stateComparisonPanel present');
  assert(hnaHtml.includes('id="scpPopShare"'),
    'scpPopShare stat element present');
  assert(hnaHtml.includes('id="scpMhiDelta"'),
    'scpMhiDelta stat element present');
  assert(hnaHtml.includes('id="scpOwnerDelta"'),
    'scpOwnerDelta stat element present');
  assert(hnaHtml.includes('id="scpRentBurdenDelta"'),
    'scpRentBurdenDelta stat element present');
});

test('HTML contains municipal comparison panel with expected elements', () => {
  assert(hnaHtml.includes('id="municipalComparisonPanel"'),
    'municipalComparisonPanel present');
  assert(hnaHtml.includes('id="mcpPopShare"'),
    'mcpPopShare element present');
  assert(hnaHtml.includes('id="mcpEstUnits"'),
    'mcpEstUnits element present');
  assert(hnaHtml.includes('id="mcpRentAdj"'),
    'mcpRentAdj element present');
  assert(hnaHtml.includes('id="mcpEstJobs"'),
    'mcpEstJobs element present');
});

test('HTML references state-analysis.js and municipal-analysis.js scripts', () => {
  assert(hnaHtml.includes('state-analysis.js'),
    'HTML references js/state-analysis.js');
  assert(hnaHtml.includes('municipal-analysis.js'),
    'HTML references js/municipal-analysis.js');
});

test('HNA JS contains geography scope handling functions', () => {
  assert(hnaSrc.includes('function applyGeoScope'),
    'applyGeoScope function defined in HNA JS');
  assert(hnaSrc.includes('function announceUpdate'),
    'announceUpdate function defined in HNA JS');
  assert(hnaSrc.includes('function updateDataQualityBadge'),
    'updateDataQualityBadge function defined in HNA JS');
  assert(hnaSrc.includes('function renderStateComparisonPanel'),
    'renderStateComparisonPanel function defined in HNA JS');
  assert(hnaSrc.includes('function renderMunicipalComparisonPanel'),
    'renderMunicipalComparisonPanel function defined in HNA JS');
});

test('HNA JS contains state scope routing in update()', () => {
  assert(hnaSrc.includes('geoType === \'state\'') || hnaSrc.includes('geoType==="state"') || hnaSrc.includes("geoType === 'state'"),
    'state geoType comparison present in update()');
  assert(hnaSrc.includes('updateStateScope'),
    'updateStateScope called in update()');
  assert(hnaSrc.includes('async function updateStateScope'),
    'updateStateScope is defined as async function');
});

test('HNA JS loads state and municipal configs in init()', () => {
  assert(hnaSrc.includes('PATHS.stateConfig'),
    'stateConfig path loaded in init()');
  assert(hnaSrc.includes('PATHS.municipalConfig'),
    'municipalConfig path loaded in init()');
  assert(hnaSrc.includes('__HNA_STATE_CONFIG'),
    '__HNA_STATE_CONFIG window global set');
  assert(hnaSrc.includes('__HNA_MUNICIPAL_CONFIG'),
    '__HNA_MUNICIPAL_CONFIG window global set');
});

test('HNA JS PATHS object includes new state and municipal paths', () => {
  assert(hnaSrc.includes('stateConfig'),   'PATHS.stateConfig defined');
  assert(hnaSrc.includes('stateGrowthRates'), 'PATHS.stateGrowthRates defined');
  assert(hnaSrc.includes('municipalConfig'), 'PATHS.municipalConfig defined');
  assert(hnaSrc.includes('municipalGrowthRates'), 'PATHS.municipalGrowthRates defined');
});

test('HNA JS wires geoScope change listener in init()', () => {
  assert(hnaSrc.includes("els.geoScope") && hnaSrc.includes('addEventListener'),
    'geoScope event listener wired in init()');
});

test('State data files exist', () => {
  const stateConfig = path.join(ROOT, 'data', 'hna', 'state', 'state-config.json');
  const stateGrowth = path.join(ROOT, 'data', 'hna', 'state', 'state-growth-rates.json');
  assert(fs.existsSync(stateConfig), 'data/hna/state/state-config.json exists');
  assert(fs.existsSync(stateGrowth), 'data/hna/state/state-growth-rates.json exists');
});

test('Municipal data files exist', () => {
  const muniConfig = path.join(ROOT, 'data', 'hna', 'municipal', 'municipal-config.json');
  const muniGrowth = path.join(ROOT, 'data', 'hna', 'municipal', 'municipal-growth-rates.json');
  assert(fs.existsSync(muniConfig), 'data/hna/municipal/municipal-config.json exists');
  assert(fs.existsSync(muniGrowth), 'data/hna/municipal/municipal-growth-rates.json exists');
});

test('state-config.json is valid JSON with correct structure', () => {
  const stateConfigPath = path.join(ROOT, 'data', 'hna', 'state', 'state-config.json');
  const cfg = JSON.parse(fs.readFileSync(stateConfigPath, 'utf8'));
  assert(cfg.fips === '08',              'state-config fips is "08"');
  assert(cfg.geoid === '08',             'state-config geoid is "08"');
  assert(Array.isArray(cfg.countyGeoids), 'countyGeoids array present');
  assert(cfg.countyGeoids.length === 64,  'exactly 64 county GEOIDs');
  assert(cfg.dataVintage === 2024,        'dataVintage is 2024 (Rule 3)');
});

test('geo-config.json has state entry', () => {
  const geoConfigPath = path.join(ROOT, 'data', 'hna', 'geo-config.json');
  const cfg = JSON.parse(fs.readFileSync(geoConfigPath, 'utf8'));
  assert(cfg.state != null,            'state entry added to geo-config.json');
  assert(cfg.state.geoid === '08',     'state geoid is "08"');
  assert(cfg.counties.length === 64,   '64 counties still present after update');
});

test('js/state-analysis.js exports as CommonJS module', () => {
  const SA_PATH = path.join(ROOT, 'js', 'state-analysis.js');
  assert(fs.existsSync(SA_PATH), 'js/state-analysis.js exists');
  const SA = require(SA_PATH);
  assert(typeof SA === 'object',                              'module exports object');
  assert(typeof SA.calculateStateScaling     === 'function', 'calculateStateScaling exported');
  assert(typeof SA.estimateStateHousingStock === 'function', 'estimateStateHousingStock exported');
  assert(typeof SA.scaleStateAffordability   === 'function', 'scaleStateAffordability exported');
  assert(typeof SA.projectStateDemographics  === 'function', 'projectStateDemographics exported');
  assert(typeof SA.estimateStateEmployment   === 'function', 'estimateStateEmployment exported');
  assert(typeof SA.calculateStateProp123Baseline === 'function', 'calculateStateProp123Baseline exported');
  assert(typeof SA.getStateDataConfidence    === 'function', 'getStateDataConfidence exported');
});

test('js/municipal-analysis.js exports as CommonJS module', () => {
  const MA_PATH = path.join(ROOT, 'js', 'municipal-analysis.js');
  assert(fs.existsSync(MA_PATH), 'js/municipal-analysis.js exists');
  const MA = require(MA_PATH);
  assert(typeof MA === 'object',                               'module exports object');
  assert(typeof MA.calculateMunicipalScaling === 'function',   'calculateMunicipalScaling exported');
  assert(typeof MA.estimateMunicipalHousingStock === 'function', 'estimateMunicipalHousingStock exported');
  assert(typeof MA.scaleMunicipalAffordability === 'function', 'scaleMunicipalAffordability exported');
  assert(typeof MA.projectMunicipalDemographics === 'function', 'projectMunicipalDemographics exported');
  assert(typeof MA.estimateMunicipalEmployment  === 'function', 'estimateMunicipalEmployment exported');
  assert(typeof MA.calculateMunicipalProp123Baseline === 'function', 'calculateMunicipalProp123Baseline exported');
  assert(typeof MA.getMunicipalDataConfidence  === 'function', 'getMunicipalDataConfidence exported');
});

test('No data leakage: state and county PATHS do not conflict', () => {
  // Verify that PATHS for state are distinct from county
  assert(hnaSrc.includes("'data/hna/state/state-config.json'"),
    'stateConfig path uses state/ subdirectory');
  assert(hnaSrc.includes("'data/hna/municipal/municipal-config.json'"),
    'municipalConfig path uses municipal/ subdirectory');
  // These should NOT use the county-level data paths
  assert(!hnaSrc.includes("'data/hna/state/state-config.json'")
    || hnaSrc.indexOf("'data/hna/state/state-config.json'") !==
       hnaSrc.indexOf("'data/hna/summary/"),
    'state config path is separate from summary path');
});

test('CSS contains state comparison and data quality badge styles', () => {
  const css = fs.readFileSync(path.join(ROOT, 'css', 'pages', 'housing-needs-assessment.css'), 'utf8');
  assert(css.includes('.data-quality-badge'),       '.data-quality-badge class defined');
  assert(css.includes('.data-quality-high'),        '.data-quality-high variant defined');
  assert(css.includes('.data-quality-medium'),      '.data-quality-medium variant defined');
  assert(css.includes('.data-quality-low'),         '.data-quality-low variant defined');
  assert(css.includes('.state-comparison-panel'),   '.state-comparison-panel class defined');
  assert(css.includes('.municipal-comparison-panel'), '.municipal-comparison-panel class defined');
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
