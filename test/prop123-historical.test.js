// test/prop123-historical.test.js
//
// Unit tests for Phase 3 Prop 123 historical compliance tracking functions.
// Functions are re-implemented here (they live inside an IIFE in the browser JS
// and in the prop123-historical-tracker.js module) to validate correctness
// independently of the browser environment.
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

// ── Re-implemented helpers (mirror js/prop123-historical-tracker.js) ──────────

const PROP123_EFFECTIVE_YEAR = 2023;
const PROP123_GROWTH_RATE    = 0.03;
const DOLA_FILING_MONTH      = 1;   // January
const DOLA_FILING_DAY        = 31;

function calculateComplianceTrajectory(baseline, actuals, currentYear) {
  if (!Number.isFinite(baseline) || baseline <= 0) {
    return { onTrack: null, yearsAhead: 0, yearsOffTargetCount: 0, gapAtCurrentYear: 0, trendLine: [], targets: [] };
  }

  const startYear    = PROP123_EFFECTIVE_YEAR;
  const totalYears   = currentYear - startYear + 1;
  const targets      = [];
  const trendLine    = [];
  let yearsOffCount  = 0;
  let lastKnownActual = baseline;

  for (let i = 0; i < totalYears; i++) {
    const target = Math.round(baseline * Math.pow(1 + PROP123_GROWTH_RATE, i));
    targets.push(target);

    const actual = (actuals && i < actuals.length) ? actuals[i] : null;
    if (actual !== null && Number.isFinite(actual)) {
      lastKnownActual = actual;
      trendLine.push(actual);
      if (actual < target) yearsOffCount++;
    } else {
      trendLine.push(null);
    }
  }

  const latestTarget       = targets[totalYears - 1];
  const gapAtCurrentYear   = latestTarget - lastKnownActual;
  const onTrack            = gapAtCurrentYear <= 0;

  const yearsAhead = gapAtCurrentYear <= 0
    ? Math.floor(Math.log(lastKnownActual / latestTarget) / Math.log(1 + PROP123_GROWTH_RATE))
    : -Math.ceil(Math.log(latestTarget / lastKnownActual) / Math.log(1 + PROP123_GROWTH_RATE));

  return { onTrack, yearsAhead, yearsOffTargetCount: yearsOffCount, gapAtCurrentYear, trendLine, targets };
}

function getDolaFilingDeadlines() {
  const today = new Date();
  const year  = today.getFullYear();

  const deadlineThisYear = new Date(year, DOLA_FILING_MONTH - 1, DOLA_FILING_DAY);
  const isPastDeadline   = today > deadlineThisYear;

  const deadlineYear = isPastDeadline ? year + 1 : year;
  const filingYear   = deadlineYear - 1;
  const nextDeadline = new Date(deadlineYear, DOLA_FILING_MONTH - 1, DOLA_FILING_DAY);
  const msPerDay     = 1000 * 60 * 60 * 24;
  const daysUntil    = Math.ceil((nextDeadline - today) / msPerDay);

  const pad     = (n) => String(n).padStart(2, '0');
  const isoDate = `${deadlineYear}-${pad(DOLA_FILING_MONTH)}-${pad(DOLA_FILING_DAY)}`;

  return { nextDeadline: isoDate, filed: false, filingYear, daysUntilDeadline: daysUntil };
}

function calculateFastTrackTimeline(projectUnits, ami_pct, jurisdiction_type) {
  const units  = Number(projectUnits);
  const ami    = Number(ami_pct);

  const standardDays  = 270;
  const fastTrackDays = 60;

  const conditions = [];
  let eligible = true;

  if (!Number.isFinite(ami) || ami > 60) {
    eligible = false;
    conditions.push('Project must serve households at 60% AMI or below');
  } else {
    conditions.push('✅ 60% AMI or below — meets income targeting requirement');
  }

  if (!Number.isFinite(units) || units < 1) {
    eligible = false;
    conditions.push('At least 1 affordable unit required');
  } else {
    conditions.push(`✅ ${units} unit(s) proposed`);
  }

  const eligibleTypes = ['county', 'place'];
  if (!eligibleTypes.includes(jurisdiction_type)) {
    eligible = false;
    conditions.push('Jurisdiction must be a county or incorporated municipality with a filed commitment');
  } else {
    conditions.push('✅ Eligible jurisdiction type (' + jurisdiction_type + ')');
  }

  conditions.push('Must provide proper advance notice to DOLA (per statute)');
  conditions.push('Must comply with DOLA expedited process guidance');

  const savedDays   = standardDays - fastTrackDays;
  const savedMonths = Math.round(savedDays / 30);
  const savings     = savedMonths + ' month' + (savedMonths !== 1 ? 's' : '');

  return { standardDays, fastTrackDays, timelineSavings: savings, eligible, conditions };
}

function generateComplianceReport(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return '';

  const headers = ['geoid', 'name', 'population', 'baseline', 'current', 'target', 'pct_complete', 'status', 'last_filed'];
  const escape  = (v) => {
    const s = String(v == null ? '' : v);
    return s.includes(',') || s.includes('"') || s.includes('\n')
      ? '"' + s.replace(/"/g, '""') + '"'
      : s;
  };

  const lines = [headers.join(',')];
  rows.forEach((r) => {
    lines.push([
      r.geoid, r.name, r.population,
      r.baseline, r.current, r.target,
      r.pctComplete, r.status, r.lastFiled,
    ].map(escape).join(','));
  });
  return lines.join('\n');
}

// ── Tests ──────────────────────────────────────────────────────────────────────

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

test('housing-needs-assessment.js contains Phase 3 functions', () => {
  const src = fs.readFileSync(path.join(ROOT, 'js', 'housing-needs-assessment.js'), 'utf8');
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
  assert(html.includes('compliance-dashboard.html'),       'Compliance dashboard link present');
});

test('compliance-dashboard.html exists and has required elements', () => {
  const p = path.join(ROOT, 'compliance-dashboard.html');
  assert(fs.existsSync(p), 'compliance-dashboard.html exists');
  const html = fs.readFileSync(p, 'utf8');
  assert(html.includes('id="cdTable"'),         'cd-table present');
  assert(html.includes('id="cdTableBody"'),     'cd-table-body present');
  assert(html.includes('id="cdExportBtn"'),     'export button present');
  assert(html.includes('id="cdFilterStatus"'),  'status filter present');
  assert(html.includes('id="kpiTotal"'),        'KPI total present');
  assert(html.includes('id="kpiOnTrack"'),      'KPI on-track present');
  assert(html.includes('data-col='),            'sortable column attributes present');
});

test('css/pages/compliance-dashboard.css exists and has required classes', () => {
  const p = path.join(ROOT, 'css', 'pages', 'compliance-dashboard.css');
  assert(fs.existsSync(p), 'compliance-dashboard.css exists');
  const css = fs.readFileSync(p, 'utf8');
  assert(css.includes('.cd-kpi-strip'),      '.cd-kpi-strip defined');
  assert(css.includes('.cd-table'),          '.cd-table defined');
  assert(css.includes('.cd-badge'),          '.cd-badge defined');
  assert(css.includes('.cd-badge-on-track'), '.cd-badge-on-track defined');
  assert(css.includes('.cd-export-btn'),     '.cd-export-btn defined');
  assert(css.includes('[data-theme="dark"]'), 'dark mode styles present');
});

test('calculateComplianceTrajectory: on-track baseline 1000', () => {
  // Baseline 1000 → on-track at year 1 (actual = 1030)
  const result = calculateComplianceTrajectory(1000, [1000, 1030], 2024);
  assert(result.targets[0] === 1000,  'year 0 target = 1000');
  assert(result.targets[1] === 1030,  'year 1 target = 1030 (3%)');
  assert(result.onTrack    === true,   'on-track: actual >= target');
  assert(result.trendLine[0] === 1000, 'trendLine[0] = 1000');
  assert(result.trendLine[1] === 1030, 'trendLine[1] = 1030');
  assert(result.yearsOffTargetCount === 0, 'no years off target');
});

test('calculateComplianceTrajectory: off-track scenario', () => {
  // Baseline 1000; actuals 1000 → 1000 → 1025 (need 1061 by 2025)
  const result = calculateComplianceTrajectory(1000, [1000, 1000, 1025], 2025);
  assert(result.onTrack === false, 'off-track: actual < target');
  assert(result.gapAtCurrentYear > 0, 'gap is positive (behind)');
  // target at year 2 (2025) = round(1000 * 1.03^2) = round(1060.9) = 1061
  assert(result.targets[2] === 1061, 'year 2 target = 1061');
  assert(result.gapAtCurrentYear === 1061 - 1025, 'gap = 36 units');
  assert(result.yearsOffTargetCount === 2, 'two years off target (year 1: 1000 < 1030; year 2: 1025 < 1061)');
});

test('calculateComplianceTrajectory: null baseline returns safe defaults', () => {
  const r = calculateComplianceTrajectory(null, [], 2025);
  assert(r.onTrack  === null, 'null baseline → onTrack = null');
  assert(r.targets.length === 0, 'empty targets');
  assert(r.trendLine.length === 0, 'empty trendLine');
});

test('calculateComplianceTrajectory: missing actuals treated as null', () => {
  // Only one actual provided for year 2023; 2024 and 2025 are unknown
  const result = calculateComplianceTrajectory(500, [500], 2025);
  assert(result.trendLine[0] === 500,  'year 0 actual = 500');
  assert(result.trendLine[1] === null, 'year 1 actual = null (unknown)');
  assert(result.trendLine[2] === null, 'year 2 actual = null (unknown)');
  // last known actual = 500, but target for 2025 = round(500 * 1.03^2) = round(530.45) = 530
  assert(result.gapAtCurrentYear === 30, 'gap = 530 - 500 = 30');
});

test('getDolaFilingDeadlines: deadline is Jan 31', () => {
  const info = getDolaFilingDeadlines();
  assert(info.nextDeadline.endsWith('-01-31'), 'deadline is January 31');
  assert(typeof info.filingYear === 'number', 'filingYear is a number');
  assert(info.filed === false, 'filed is always false (runtime has no registry)');
  assert(Number.isFinite(info.daysUntilDeadline), 'daysUntilDeadline is finite');
});

test('getDolaFilingDeadlines: filing year is current or prior year', () => {
  const info      = getDolaFilingDeadlines();
  const thisYear  = new Date().getFullYear();
  const today     = new Date();
  const deadlineThisYear = new Date(thisYear, 0, 31);   // Jan 31 this year
  const isPast    = today > deadlineThisYear;

  if (isPast) {
    assert(info.filingYear === thisYear, 'past Jan 31: filing year = current year');
  } else {
    assert(info.filingYear === thisYear - 1, 'before Jan 31: filing year = previous year');
  }
});

test('calculateFastTrackTimeline: eligible project (60% AMI, county)', () => {
  const r = calculateFastTrackTimeline(20, 60, 'county');
  assert(r.eligible === true, '20 units, 60% AMI, county → eligible');
  assert(r.standardDays  === 270, 'standard = 270 days');
  assert(r.fastTrackDays === 60,  'fast-track = 60 days');
  const savedMonths = Math.round((270 - 60) / 30);
  assert(r.timelineSavings === savedMonths + ' months', 'savings = ~7 months');
  assert(r.conditions.some(c => c.startsWith('✅ 60%')), 'AMI condition met');
});

test('calculateFastTrackTimeline: ineligible — too high AMI', () => {
  const r = calculateFastTrackTimeline(10, 80, 'place');
  assert(r.eligible === false, '80% AMI → not eligible');
  assert(r.conditions.some(c => c.includes('60% AMI')), 'AMI condition listed');
});

test('calculateFastTrackTimeline: ineligible — CDP type', () => {
  const r = calculateFastTrackTimeline(5, 50, 'cdp');
  assert(r.eligible === false, 'CDP type → not eligible');
});

test('calculateFastTrackTimeline: ineligible — zero units', () => {
  const r = calculateFastTrackTimeline(0, 60, 'county');
  assert(r.eligible === false, '0 units → not eligible');
});

test('calculateFastTrackTimeline: fast-track is always faster than standard', () => {
  [['county', 60], ['place', 40], ['county', 30]].forEach(([jt, ami]) => {
    const r = calculateFastTrackTimeline(10, ami, jt);
    assert(r.fastTrackDays < r.standardDays, `fast-track (${r.fastTrackDays}) < standard (${r.standardDays}) for ${jt}/${ami}%`);
  });
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
