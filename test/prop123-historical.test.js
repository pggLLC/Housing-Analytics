// test/prop123-historical.test.js
//
// Unit tests for Phase 3 Prop 123 historical compliance tracking functions.
// The browser modules are loaded in a vm sandbox (see loadBrowserModule), so
// the behavior tests below run the shipped functions.
//
// Usage:
//   node test/prop123-historical.test.js
//
// Exit code 0 = all checks passed; non-zero = one or more failures.

'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

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

// ── The real modules, loaded in a sandbox ─────────────────────────────────────
// Both are browser IIFEs that attach to window; vm runs them as the page does,
// so these tests exercise the shipped code rather than a copy of it.
const vm = require('vm');
function loadBrowserModule(rel, extra) {
  const ctx = Object.assign({ console, URLSearchParams, location: { search: '' } }, extra || {});
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, rel), 'utf8'), ctx, { filename: rel });
  return ctx;
}
const Tracker = loadBrowserModule('js/prop123-historical-tracker.js').Prop123Tracker;
const Utils   = loadBrowserModule('js/hna/hna-utils.js').HNAUtils;
const { calculateComplianceTrajectory, getDolaFilingDeadlines } = Tracker;
const { calculateFastTrackTimeline, generateComplianceReport } = Utils;

// ── Tests ──────────────────────────────────────────────────────────────────────
//
// C-04 (#1120) triage: the assertions below are SOURCE-GREP static contract
// checks (module defines its API surface and exposes window.Prop123Tracker),
// not behavior tests — a broken implementation with the right names still
// passes. Kept deliberately as existence guards. Retirement criteria: when
// prop123-historical-tracker.js gains a Node-safe dual-context export
// (pattern: js/deal-calculator-math.js / js/market-analysis-scoring.js),
// replace these with require()-based behavior tests of the real functions.

test('js/prop123-historical-tracker.js source file exists', () => {
  const p = path.join(ROOT, 'js', 'prop123-historical-tracker.js');
  assert(fs.existsSync(p), 'prop123-historical-tracker.js exists');
  const src = fs.readFileSync(p, 'utf8');
  assert(src.includes('getHistoricalAffordableData'),      'getHistoricalAffordableData defined');
  assert(src.includes('calculateComplianceTrajectory'),    'calculateComplianceTrajectory defined');
  assert(src.includes('getDolaFilingDeadlines'),           'getDolaFilingDeadlines defined');
  assert(src.includes('renderHistoricalComplianceChart'),  'renderHistoricalComplianceChart defined');
  assert(src.includes('renderDolaFilingStatus'),           'renderDolaFilingStatus defined');
  assert(src.includes('window.Prop123Tracker'),            'Prop123Tracker exposed on window');
});

test('HNA modules contain Phase 3 functions', () => {
  const src = [
    path.join(ROOT, 'js', 'hna', 'hna-utils.js'),
    path.join(ROOT, 'js', 'hna', 'hna-renderers.js'),
    path.join(ROOT, 'js', 'hna', 'hna-controller.js'),
  ].map(file => fs.readFileSync(file, 'utf8')).join('\n');
  assert(src.includes('calculateFastTrackTimeline'),       'calculateFastTrackTimeline defined');
  assert(src.includes('getJurisdictionComplianceStatus'),  'getJurisdictionComplianceStatus defined');
  assert(src.includes('generateComplianceReport'),         'generateComplianceReport defined');
  assert(src.includes('renderHistoricalSection'),          'renderHistoricalSection defined');
  assert(src.includes('renderFastTrackCalculatorSection'), 'renderFastTrackCalculatorSection defined');
  assert(src.includes('renderComplianceTable'),            'renderComplianceTable defined');
  assert(src.includes('window.__HNA_renderFastTrack'),     'renderFastTrack exposed on window');
  assert(src.includes('window.__HNA_generateComplianceReport'), 'generateComplianceReport exposed');
});

test('housing-needs-assessment.html contains Phase 3 elements', () => {
  const html = fs.readFileSync(path.join(ROOT, 'housing-needs-assessment.html'), 'utf8');
  assert(html.includes('id="prop123HistoricalContent"'),   'Historical content container present');
  assert(html.includes('id="chartProp123Historical"'),     'Historical chart canvas present');
  assert(html.includes('id="prop123DolaFiling"'),          'DOLA filing badge container present');
  assert(html.includes('id="fastTrackCalculator"'),        'Fast-track calculator container present');
  assert(html.includes('id="prop123HistoricalStatus"'),    'Historical status element present');
  assert(html.includes('id="ftResult"'),                   'Fast-track result container present');
  assert(html.includes('prop123-historical-tracker.js'),   'Historical tracker script referenced');
  // The "View full compliance dashboard →" CTA is gone. It pointed at
  // compliance-dashboard.html, retired in #1349, whose redirect target
  // (data-review-hub.html, the Data Trust Center) contains no Prop 123 or
  // compliance content at all — so repointing it would have kept a link while
  // breaking its promise. The material it advertised now lives inline in
  // #prop123-section on this very page, which is where the reader already is.
  assert(!html.includes('compliance-dashboard.html'),
    'no link to the retired redirect stub');
  assert(!/View full compliance dashboard/.test(html),
    'the dead compliance-dashboard CTA is removed, not repointed at an unrelated page');
  assert(html.includes('id="prop123-section"'),
    'the Prop 123 section that superseded the dashboard is present');
});

test('compliance-dashboard.html is retired and redirects to the Data Trust Center', () => {
  // The page was decommissioned in #1349 ("Clean up orphan pages") and is now a
  // redirect stub. This block used to assert its table, KPI strip and sortable
  // columns; those are gone on purpose, so asserting them was testing a removed
  // feature. What is worth holding is that the retirement stays well-formed --
  // a redirect stub that loses its target is a dead end for anyone with the old
  // URL bookmarked.
  const p = path.join(ROOT, 'compliance-dashboard.html');
  assert(fs.existsSync(p), 'compliance-dashboard.html still exists as a redirect stub');
  const html = fs.readFileSync(p, 'utf8');
  assert(/http-equiv="refresh"[^>]*data-review-hub\.html/.test(html),
    'meta refresh points at data-review-hub.html');
  assert(/rel="canonical"[^>]*data-review-hub\.html/.test(html),
    'canonical points at data-review-hub.html');
  assert(/location\.replace\(['"]data-review-hub\.html['"]\)/.test(html),
    'script fallback redirects too, for clients that ignore meta refresh');
  assert(fs.existsSync(path.join(ROOT, 'data-review-hub.html')),
    'the redirect target exists');
  assert(!/id="cdTable"/.test(html),
    'the retired dashboard markup is not resurrected without updating this test');
});

// The css/pages/compliance-dashboard.css block was removed with the stylesheet.
// compliance-dashboard.html was retired in #1349 and is a redirect stub that
// loads no stylesheet, so those 244 lines could not reach a viewer.

// The 2024–2026 goal is 3% of the baseline per year in new or newly
// affordable homes — simple, not compound — and stops at 2026, because
// HB26-1313 sets later goals from building permits (C.R.S. § 29-32-105(1)).
test('calculateComplianceTrajectory: on-track baseline 1000', () => {
  const result = calculateComplianceTrajectory(1000, [1000, 1030], 2024);
  assert(result.targets[0] === 1000,  'year 0 target = 1000');
  assert(result.targets[1] === 1030,  'year 1 target = 1030 (3% of baseline)');
  assert(result.onTrack    === true,   'on-track: actual >= target');
  assert(result.trendLine[1] === 1030, 'trendLine[1] = 1030');
  assert(result.yearsOffTargetCount === 0, 'no years off target');
});

test('calculateComplianceTrajectory: the goal is simple, not compound', () => {
  const result = calculateComplianceTrajectory(1000, [1000, 1000, 1025], 2025);
  assert(result.targets[2] === 1060, 'year 2 target = 1060 (6% of baseline, not 1.03^2)');
  assert(result.onTrack === false, 'off-track: actual < target');
  assert(result.gapAtCurrentYear === 1060 - 1025, 'gap = 35 units');
  assert(result.yearsOffTargetCount === 2, 'two years off target');
  assert(result.yearsAhead === -2, 'behind by two years of the goal (35 units at 30 a year)');
});

test('calculateComplianceTrajectory: no goal is projected past 2026', () => {
  const result = calculateComplianceTrajectory(1000, [1000], 2028);
  assert(result.targets.length === 4, 'targets cover 2023–2026 only: ' + result.targets.length);
  assert(result.targets[3] === 1090, '2026 target = 1090 (9% over the cycle)');
});

test('calculateComplianceTrajectory: null baseline returns safe defaults', () => {
  const r = calculateComplianceTrajectory(null, [], 2025);
  assert(r.onTrack  === null, 'null baseline → onTrack = null');
  assert(r.targets.length === 0, 'empty targets');
});

test('calculateComplianceTrajectory: missing actuals treated as null', () => {
  const result = calculateComplianceTrajectory(500, [500], 2025);
  assert(result.trendLine[1] === null, 'year 1 actual = null (unknown)');
  assert(result.gapAtCurrentYear === 30, 'gap = 530 - 500 = 30');
});

test('getDolaFilingDeadlines: commitments are due November 1, as the checklist says', () => {
  const CC = require(path.join(ROOT, 'js', 'compliance-checklist.js'));
  const oct = getDolaFilingDeadlines(new Date(2026, 9, 18));
  assert(oct.nextDeadline === '2026-11-01', 'Oct 18, 2026 → due 2026-11-01: ' + oct.nextDeadline);
  assert(oct.filingYear === 2027, 'that filing covers the cycle from 2027');
  assert(oct.daysUntilDeadline === 14, '14 days to go: ' + oct.daysUntilDeadline);
  const cc = CC._nextDolaDeadline(new Date(2026, 9, 18));
  assert(cc.getMonth() + 1 === Number(oct.nextDeadline.slice(5, 7)) && cc.getDate() === Number(oct.nextDeadline.slice(8)),
    'the checklist module and the tracker badge give the same deadline');
  const nov = getDolaFilingDeadlines(new Date(2026, 10, 2));
  assert(nov.nextDeadline === '2027-11-01' && nov.filingYear === 2028, 'after Nov 1, 2026 → due 2027-11-01, covering 2028 on');
  assert(getDolaFilingDeadlines(new Date(2026, 10, 1, 15)).nextDeadline === '2026-11-01', 'no rollover on Nov 1 itself');
  assert(oct.filed === false, 'filed is always false (runtime has no registry)');
});

test('calculateFastTrackTimeline: qualifies when at least half the homes are affordable', () => {
  const r = calculateFastTrackTimeline(20, 10, 'county');
  assert(r.eligible === true, '10 of 20 affordable → qualifies');
  assert(r.fastTrackDays === 90, 'decision within 90 calendar days, § 29-32-105(2)(a)');
  assert(r.standardDays === null && r.timelineSavings === null,
    'no standard review time or savings figure: the law sets none');
});

test('calculateFastTrackTimeline: under half affordable does not qualify', () => {
  const r = calculateFastTrackTimeline(20, 9, 'place');
  assert(r.eligible === false, '9 of 20 affordable → does not qualify');
  assert(r.conditions.some(c => c.includes('at least half')), 'says why');
});

test('calculateFastTrackTimeline: a CDP project qualifies under its county', () => {
  const r = calculateFastTrackTimeline(5, 5, 'cdp');
  assert(r.eligible === true, 'CDP projects are not excluded');
  assert(r.conditions.some(c => /county reviews/.test(c)), 'the county reviews it');
});

test('calculateFastTrackTimeline: missing inputs give no verdict', () => {
  assert(calculateFastTrackTimeline(0, 0, 'county').eligible === null, '0 homes → null, not a verdict');
  assert(calculateFastTrackTimeline(10, NaN, 'county').eligible === null, 'no affordable count → null');
  assert(calculateFastTrackTimeline(10, 11, 'county').eligible === null, 'more affordable than total → null');
});

test('generateComplianceReport: produces valid CSV', () => {
  const rows = [
    { geoid:'08077', name:'Mesa County', population:155000, baseline:8200, current:8450, target:8446, pctComplete:100, status:'on-track', lastFiled:null },
    { geoid:'08031', name:'Denver County', population:715000, baseline:52000, current:49000, target:53560, pctComplete:92, status:'off-track', lastFiled:null },
  ];
  const csv = generateComplianceReport(rows);
  assert(csv.length > 0, 'CSV is non-empty');
  const lines = csv.split('\n');
  assert(lines.length === 3, '2 data rows + 1 header = 3 lines');
  assert(lines[0] === 'geoid,name,population,baseline,current,target,pct_complete,status,last_filed', 'header row is correct');
  assert(lines[1].startsWith('08077,'), 'row 1 starts with Mesa County geoid');
  assert(lines[1].includes('on-track'), 'row 1 includes status');
  assert(lines[2].includes('off-track'), 'row 2 includes status');
});

test('generateComplianceReport: escapes commas and quotes in values', () => {
  const rows = [
    { geoid:'08001', name:'County, Colorado', population:1000, baseline:100, current:103, target:103, pctComplete:100, status:'on-track', lastFiled:null },
    { geoid:'08002', name:'Say "Hi"', population:2000, baseline:200, current:200, target:206, pctComplete:97, status:'at-risk', lastFiled:null },
  ];
  const csv = generateComplianceReport(rows);
  assert(csv.includes('"County, Colorado"'), 'name with comma is quoted');
  assert(csv.includes('"Say ""Hi"""'), 'name with quotes is double-escaped');
});

test('generateComplianceReport: empty input returns empty string', () => {
  assert(generateComplianceReport([])   === '', 'empty array → ""');
  assert(generateComplianceReport(null) === '', 'null → ""');
});

test('scripts/generate_tract_centroids.py exists', () => {
  const p = path.join(ROOT, 'scripts', 'generate_tract_centroids.py');
  assert(fs.existsSync(p), 'generate_tract_centroids.py exists');
  const src = fs.readFileSync(p, 'utf8');
  assert(src.includes('def build('), 'build function defined');
  assert(src.includes('validate_tract'), 'validate_tract defined');
  assert(src.includes('compute_centroid'), 'compute_centroid defined');
  assert(src.includes('tract-centroids.json'), 'outputs tract-centroids.json');
  assert(src.includes('fetch_all_co_tracts'), 'fetch_all_co_tracts defined');
});

test('scripts/hna/parse_lehd_wac.py exists', () => {
  const p = path.join(ROOT, 'scripts', 'hna', 'parse_lehd_wac.py');
  assert(fs.existsSync(p), 'parse_lehd_wac.py exists');
  const src = fs.readFileSync(p, 'utf8');
  assert(src.includes('def parse_wac_csv('), 'parse_wac_csv defined');
  assert(src.includes('def aggregate_by_county('), 'aggregate_by_county defined');
  assert(src.includes('def build_county_record('), 'build_county_record defined');
  assert(src.includes('def validate_county_row('), 'validate_county_row defined');
  assert(src.includes('historicalYears'), 'historicalYears in output schema');
  assert(src.includes('yoyGrowth'), 'yoyGrowth in output schema');
});

// ── Summary ──────────────────────────────────────────────────────────────────
console.log('\n' + '='.repeat(60));
console.log(`Results: ${passed} passed, ${failed} failed`);

if (failed > 0) {
  console.error('\nSome checks failed. Review the output above for details.');
  process.exitCode = 1;
} else {
  console.log('\nAll checks passed ✅');
}
