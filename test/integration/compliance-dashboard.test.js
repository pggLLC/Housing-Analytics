// test/integration/compliance-dashboard.test.js
//
// Integration tests for the Phase 3 Compliance Dashboard page and its supporting files.
//
// Verifies:
//   1. compliance-dashboard.html exists and has required structural elements.
//   2. CSS file exists with required selectors.
//   3. JS tracker file exposes required functions.
//   4. HNA JS file has Phase 3 helper functions.
//   5. Python scripts exist with required function signatures.
//
// Usage:
//   node test/integration/compliance-dashboard.test.js
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

// ── File paths ────────────────────────────────────────────────────────────────
const DASH_HTML = path.join(ROOT, 'compliance-dashboard.html');
const DASH_CSS  = path.join(ROOT, 'css', 'pages', 'compliance-dashboard.css');
const TRACKER   = path.join(ROOT, 'js',  'prop123-historical-tracker.js');
const HNA_JS    = path.join(ROOT, 'js',  'housing-needs-assessment.js');
const HNA_HTML  = path.join(ROOT, 'housing-needs-assessment.html');
const GEN_PY    = path.join(ROOT, 'scripts', 'generate_tract_centroids.py');
const WAC_PY    = path.join(ROOT, 'scripts', 'hna', 'parse_lehd_wac.py');
const WF_YAML   = path.join(ROOT, '.github', 'workflows', 'build-hna-data.yml');

// ── Tests ─────────────────────────────────────────────────────────────────────

test('compliance-dashboard.html: file exists and is non-trivially sized', () => {
  assert(fs.existsSync(DASH_HTML), 'compliance-dashboard.html exists');
  const src = fs.readFileSync(DASH_HTML, 'utf8');
  assert(src.length > 2000, 'file is non-trivially sized');
});

test('compliance-dashboard.html: has DOCTYPE, lang, viewport', () => {
  const src = fs.readFileSync(DASH_HTML, 'utf8');
  assert(src.startsWith('<!DOCTYPE html>'),          'has DOCTYPE html declaration');
  assert(src.includes('<html lang="en">'),            'html element has lang="en"');
  assert(src.includes('name="viewport"'),             'viewport meta tag present');
  assert(src.includes('id="main-content"'),           'main content anchor present');
  assert(src.includes('class="skip-link"'),           'skip-link for accessibility');
});

test('compliance-dashboard.html: includes required CSS', () => {
  const src = fs.readFileSync(DASH_HTML, 'utf8');
  assert(src.includes('css/site-theme.css'),           'site-theme.css linked');
  assert(src.includes('css/pages/compliance-dashboard.css'), 'compliance-dashboard.css linked');
});

test('compliance-dashboard.html: table structure', () => {
  const src = fs.readFileSync(DASH_HTML, 'utf8');
  assert(src.includes('id="cdTable"'),            'main table present');
  assert(src.includes('id="cdTableBody"'),        'table body present');
  assert(src.includes('data-col="name"'),         'name column sortable');
  assert(src.includes('data-col="status"'),       'status column sortable');
  assert(src.includes('data-col="baseline"'),     'baseline column sortable');
  assert(src.includes('aria-label="Prop 123 jurisdiction compliance"'), 'table aria-label');
});

test('compliance-dashboard.html: KPI strip', () => {
  const src = fs.readFileSync(DASH_HTML, 'utf8');
  assert(src.includes('id="kpiTotal"'),    'kpiTotal present');
  assert(src.includes('id="kpiOnTrack"'),  'kpiOnTrack present');
  assert(src.includes('id="kpiAtRisk"'),   'kpiAtRisk present');
  assert(src.includes('id="kpiOffTrack"'), 'kpiOffTrack present');
  assert(src.includes('id="kpiNoData"'),   'kpiNoData present');
});

test('compliance-dashboard.html: filter + export controls', () => {
  const src = fs.readFileSync(DASH_HTML, 'utf8');
  assert(src.includes('id="cdFilterStatus"'), 'status filter present');
  assert(src.includes('id="cdFilterType"'),   'type filter present');
  assert(src.includes('id="cdSearch"'),       'search input present');
  assert(src.includes('id="cdExportBtn"'),    'export button present');
});

test('compliance-dashboard.html: inline JS contains sorting + CSV export logic', () => {
  const src = fs.readFileSync(DASH_HTML, 'utf8');
  assert(src.includes('getSorted('),          'getSorted function present');
  assert(src.includes('getFiltered('),        'getFiltered function present');
  assert(src.includes('renderTable('),        'renderTable function present');
  assert(src.includes('setupExport('),        'setupExport function present');
  assert(src.includes('URL.createObjectURL'), 'CSV blob download logic present');
  assert(src.includes('text/csv'),            'CSV mime type present');
});

test('css/pages/compliance-dashboard.css: file exists with required selectors', () => {
  assert(fs.existsSync(DASH_CSS), 'compliance-dashboard.css exists');
  const css = fs.readFileSync(DASH_CSS, 'utf8');
  assert(css.includes('.compliance-dashboard-main'), '.compliance-dashboard-main defined');
  assert(css.includes('.cd-kpi-strip'),          '.cd-kpi-strip defined');
  assert(css.includes('.cd-kpi-card'),           '.cd-kpi-card defined');
  assert(css.includes('.cd-table'),              '.cd-table defined');
  assert(css.includes('.cd-table-wrapper'),      '.cd-table-wrapper defined');
  assert(css.includes('.cd-badge'),              '.cd-badge defined');
  assert(css.includes('.cd-badge-on-track'),     '.cd-badge-on-track defined');
  assert(css.includes('.cd-badge-at-risk'),      '.cd-badge-at-risk defined');
  assert(css.includes('.cd-badge-off-track'),    '.cd-badge-off-track defined');
  assert(css.includes('.cd-export-btn'),         '.cd-export-btn defined');
  assert(css.includes('.cd-controls'),           '.cd-controls defined');
  assert(css.includes('[data-theme="dark"]'),    'dark mode styles present');
  assert(css.includes('@media'),                 'responsive media query present');
});

test('js/prop123-historical-tracker.js: file exists with required exports', () => {
  assert(fs.existsSync(TRACKER), 'prop123-historical-tracker.js exists');
  const src = fs.readFileSync(TRACKER, 'utf8');
  assert(src.includes('getHistoricalAffordableData'),      'getHistoricalAffordableData exported');
  assert(src.includes('calculateComplianceTrajectory'),    'calculateComplianceTrajectory exported');
  assert(src.includes('getDolaFilingDeadlines'),           'getDolaFilingDeadlines exported');
  assert(src.includes('renderHistoricalComplianceChart'),  'renderHistoricalComplianceChart exported');
  assert(src.includes('renderDolaFilingStatus'),           'renderDolaFilingStatus exported');
  assert(src.includes('PROP123_EFFECTIVE_YEAR'),           'PROP123_EFFECTIVE_YEAR constant present');
  assert(src.includes('PROP123_GROWTH_RATE'),              'PROP123_GROWTH_RATE constant present');
  assert(src.includes('window.Prop123Tracker'),            'window.Prop123Tracker exposed');
});

test('js/prop123-historical-tracker.js: uses IIFE pattern consistent with codebase', () => {
  const src = fs.readFileSync(TRACKER, 'utf8');
  assert(src.includes('(function'),              'contains IIFE pattern');
  assert(src.trimEnd().endsWith('})();'),        'ends with IIFE invocation');
  assert(src.includes("'use strict'"),           "uses 'use strict'");
});

test('js/housing-needs-assessment.js: Phase 3 functions defined', () => {
  assert(fs.existsSync(HNA_JS), 'housing-needs-assessment.js exists');
  const src = fs.readFileSync(HNA_JS, 'utf8');
  assert(src.includes('function calculateFastTrackTimeline('),   'calculateFastTrackTimeline defined');
  assert(src.includes('function getJurisdictionComplianceStatus('), 'getJurisdictionComplianceStatus defined');
  assert(src.includes('function generateComplianceReport('),     'generateComplianceReport defined');
  assert(src.includes('function renderHistoricalSection('),      'renderHistoricalSection defined');
  assert(src.includes('function renderFastTrackCalculatorSection('), 'renderFastTrackCalculatorSection defined');
  assert(src.includes('function renderComplianceTable('),        'renderComplianceTable defined');
});

test('js/housing-needs-assessment.js: Phase 3 constants and exposures', () => {
  const src = fs.readFileSync(HNA_JS, 'utf8');
  assert(src.includes('window.__HNA_renderFastTrack'),           '__HNA_renderFastTrack exposed');
  assert(src.includes('window.__HNA_generateComplianceReport'),  '__HNA_generateComplianceReport exposed');
  assert(src.includes('window.__HNA_getJurisdictionCompliance'), '__HNA_getJurisdictionCompliance exposed');
  assert(src.includes('window.__HNA_calculateFastTrackTimeline'),'__HNA_calculateFastTrackTimeline exposed');
});

test('housing-needs-assessment.html: Phase 3 elements', () => {
  assert(fs.existsSync(HNA_HTML), 'housing-needs-assessment.html exists');
  const html = fs.readFileSync(HNA_HTML, 'utf8');
  assert(html.includes('id="prop123HistoricalContent"'),  'historical content area present');
  assert(html.includes('id="chartProp123Historical"'),    'historical chart canvas present');
  assert(html.includes('id="prop123DolaFiling"'),         'DOLA filing badge container present');
  assert(html.includes('id="fastTrackCalculator"'),       'fast-track calculator present');
  assert(html.includes('id="prop123HistoricalStatus"'),   'compliance status element present');
  assert(html.includes('id="ftUnits"'),                   'fast-track units input present');
  assert(html.includes('id="ftAmi"'),                     'fast-track AMI input present');
  assert(html.includes('id="ftGeoType"'),                 'fast-track geo type select present');
  assert(html.includes('id="ftResult"'),                  'fast-track result container present');
  assert(html.includes('prop123-historical-tracker.js'),  'tracker script tag present');
  assert(html.includes('compliance-dashboard.html'),      'compliance dashboard link present');
});

test('scripts/generate_tract_centroids.py: Python script structure', () => {
  assert(fs.existsSync(GEN_PY), 'generate_tract_centroids.py exists');
  const src = fs.readFileSync(GEN_PY, 'utf8');
  assert(src.includes('#!/usr/bin/env python3'),    'shebang present');
  assert(src.includes('def build()'),               'build() function defined');
  assert(src.includes('def validate_tract('),       'validate_tract() defined');
  assert(src.includes('def compute_centroid('),     'compute_centroid() defined');
  assert(src.includes('def fetch_all_co_tracts()'), 'fetch_all_co_tracts() defined');
  assert(src.includes('tract-centroids.json'),      'outputs Phase 3 format file');
  assert(src.includes('tract_centroids_co.json'),   'outputs PMA engine format file');
  assert(src.includes('CO_LAT_MIN'),                'Colorado bounds validation defined');
  assert(src.includes('CO_LON_MIN'),                'Colorado bounds validation defined');
});

test('scripts/hna/parse_lehd_wac.py: Python script structure', () => {
  assert(fs.existsSync(WAC_PY), 'parse_lehd_wac.py exists');
  const src = fs.readFileSync(WAC_PY, 'utf8');
  assert(src.includes('#!/usr/bin/env python3'),         'shebang present');
  assert(src.includes('def parse_wac_csv('),             'parse_wac_csv() defined');
  assert(src.includes('def aggregate_by_county('),       'aggregate_by_county() defined');
  assert(src.includes('def build_county_record('),       'build_county_record() defined');
  assert(src.includes('def validate_county_row('),       'validate_county_row() defined');
  assert(src.includes('def build()'),                    'build() function defined');
  assert(src.includes('historicalYears'),                'historicalYears in output');
  assert(src.includes('historicalTotals'),               'historicalTotals in output');
  assert(src.includes('yoyGrowth'),                      'yoyGrowth in output');
  assert(src.includes('LODES_BASE'),                     'LODES base URL defined');
  assert(src.includes('INDUSTRY_COLS'),                  'INDUSTRY_COLS dictionary defined');
  assert(src.includes('WAGE_COLS'),                      'WAGE_COLS dictionary defined');
  assert(src.includes('CNS01'),                          'CNS industry columns referenced');
  assert(src.includes('CE01'),                           'CE wage columns referenced');
});

test('.github/workflows/build-hna-data.yml: updated with Phase 3 steps', () => {
  assert(fs.existsSync(WF_YAML), 'build-hna-data.yml exists');
  const yml = fs.readFileSync(WF_YAML, 'utf8');
  assert(yml.includes('generate_tract_centroids.py'), 'tract centroid step present');
  assert(yml.includes('parse_lehd_wac.py'),           'LEHD WAC parse step present');
});

// ── Summary ───────────────────────────────────────────────────────────────────
console.log('\n' + '='.repeat(60));
console.log(`Results: ${passed} passed, ${failed} failed`);

if (failed > 0) {
  console.error('\nSome checks failed. Review the output above for details.');
  process.exitCode = 1;
} else {
  console.log('\nAll checks passed ✅');
}
