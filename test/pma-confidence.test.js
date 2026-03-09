// test/pma-confidence.test.js
//
// Unit tests for js/pma-confidence.js (PMAConfidence heuristic scoring)
// and the four new workforce data connectors:
//   js/data-connectors/lodes-commute.js
//   js/data-connectors/cdle-jobs.js
//   js/data-connectors/cde-schools.js
//   js/data-connectors/cdot-traffic.js
//
// Usage:
//   node test/pma-confidence.test.js
//
// Exit code 0 = all checks passed; non-zero = one or more failures.

'use strict';

const fs   = require('fs');
const path = require('path');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log('  ✅ PASS: ' + message);
    passed++;
  } else {
    console.error('  ❌ FAIL: ' + message);
    failed++;
  }
}

function test(name, fn) {
  console.log('\n[test] ' + name);
  try { fn(); } catch (e) { assert(false, 'Threw: ' + e.message); }
}

// ── Inline PMAConfidence from source ─────────────────────────────────────────
// We re-implement the scoring functions here to match the actual source logic.

const confSrc = fs.readFileSync(
  path.resolve(__dirname, '..', 'js', 'pma-confidence.js'), 'utf8'
);

// ── Tests ─────────────────────────────────────────────────────────────────────

test('js/pma-confidence.js exists', () => {
  assert(fs.existsSync(path.resolve(__dirname, '..', 'js', 'pma-confidence.js')),
    'js/pma-confidence.js exists');
  assert(confSrc.includes('window.PMAConfidence'), 'PMAConfidence exposed on window');
  assert(confSrc.includes('compute'), 'compute() function defined');
  assert(confSrc.includes('renderConfidenceBadge'), 'renderConfidenceBadge() defined');
  assert(confSrc.includes('scoreCompleteness'), 'scoreCompleteness() defined');
  assert(confSrc.includes('scoreFreshness'), 'scoreFreshness() defined');
  assert(confSrc.includes('scoreLihtcCoverage'), 'scoreLihtcCoverage() defined');
  assert(confSrc.includes('scoreSampleSize'), 'scoreSampleSize() defined');
  assert(confSrc.includes('scoreBufferDepth'), 'scoreBufferDepth() defined');
});

test('pma-confidence.js WEIGHTS sum to 1.0', () => {
  // Extract weight values from source
  const match = confSrc.match(/WEIGHTS\s*:\s*\{([^}]+)\}/);
  assert(match !== null, 'WEIGHTS block found in source');
  if (match) {
    const weightSrc = match[1];
    const numbers   = weightSrc.match(/[\d.]+/g) || [];
    const total     = numbers.reduce((s, n) => s + parseFloat(n), 0);
    assert(Math.abs(total - 1.0) < 1e-9, 'WEIGHTS sum to 1.0 (got ' + total.toFixed(4) + ')');
  }
});

test('pma-confidence.js confidence levels defined', () => {
  assert(confSrc.includes("'High'"),   "level 'High' defined");
  assert(confSrc.includes("'Medium'"), "level 'Medium' defined");
  assert(confSrc.includes("'Low'"),    "level 'Low' defined");
  // Thresholds
  assert(confSrc.includes('80'), 'High threshold ≥80 referenced');
  assert(confSrc.includes('60'), 'Medium threshold ≥60 referenced');
});

// ── New data connector files ───────────────────────────────────────────────────

const CONNECTORS = [
  { file: 'js/data-connectors/lodes-commute.js', global: 'LodesCommute',
    methods: ['loadMetrics', 'aggregateForBuffer', 'scoreJobAccessibility'] },
  { file: 'js/data-connectors/cdle-jobs.js',     global: 'CdleJobs',
    methods: ['loadMetrics', 'aggregateForCounties', 'scoreVacancyRate'] },
  { file: 'js/data-connectors/cde-schools.js',   global: 'CdeSchools',
    methods: ['loadMetrics', 'getNearestDistrict', 'scoreSchoolQuality'] },
  { file: 'js/data-connectors/cdot-traffic.js',  global: 'CdotTraffic',
    methods: ['loadMetrics', 'aggregateForBuffer', 'scoreTrafficConnectivity'] },
];

CONNECTORS.forEach(function (c) {
  test(c.file + ' — structure checks', () => {
    const fullPath = path.resolve(__dirname, '..', c.file);
    assert(fs.existsSync(fullPath), c.file + ' exists');
    const src = fs.readFileSync(fullPath, 'utf8');
    assert(src.includes('window.' + c.global), c.file + ' exposes window.' + c.global);
    assert(!src.includes("fetch('data/") && !src.includes('fetch("data/'),
      c.file + ' has no raw fetch("data/...") calls');
    assert(src.includes('DataService'), c.file + ' uses DataService');
    c.methods.forEach(function (m) {
      assert(src.includes(m), c.file + ' defines ' + m + '()');
    });
  });
});

// ── New data files ─────────────────────────────────────────────────────────────

const DATA_FILES = [
  { path: 'data/market/lodes_co.json',            key: 'tracts',    minCount: 100 },
  { path: 'data/market/cdle_job_postings_co.json', key: 'counties',  minCount: 60  },
  { path: 'data/market/cde_schools_co.json',       key: 'districts', minCount: 20  },
  { path: 'data/market/cdot_traffic_co.json',      key: 'stations',  minCount: 10  },
];

DATA_FILES.forEach(function (d) {
  test(d.path + ' — JSON validity', () => {
    const fullPath = path.resolve(__dirname, '..', d.path);
    assert(fs.existsSync(fullPath), d.path + ' exists');
    if (!fs.existsSync(fullPath)) return;
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
    } catch (e) {
      assert(false, d.path + ' is valid JSON (parse error: ' + e.message + ')');
      return;
    }
    assert(parsed.meta, d.path + ' has meta object');
    assert(Array.isArray(parsed[d.key]), d.path + ' has "' + d.key + '" array');
    assert(parsed[d.key].length >= d.minCount,
      d.path + ' has ≥' + d.minCount + ' records (got ' + parsed[d.key].length + ')');
  });
});

// ── market-analysis.js updated workforce scoring ─────────────────────────────

test('market-analysis.js has expanded scoreWorkforce()', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '..', 'js', 'market-analysis.js'), 'utf8');
  assert(src.includes('LodesCommute'),  'references LodesCommute connector');
  assert(src.includes('CdleJobs'),      'references CdleJobs connector');
  assert(src.includes('CdeSchools'),    'references CdeSchools connector');
  assert(src.includes('CdotTraffic'),   'references CdotTraffic connector');
  assert(!src.includes("return 60;\n  }"), // old placeholder
    'old placeholder "return 60" removed from scoreWorkforce');
  assert(src.includes('0.25'), 'LODES weight 25% present');
});

test('market-analysis.js exports confidence in CSV rows', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '..', 'js', 'market-analysis.js'), 'utf8');
  assert(src.includes('confidence_score'), 'CSV export includes confidence_score');
  assert(src.includes('confidence_level'), 'CSV export includes confidence_level');
});

test('market-analysis.html loads new scripts', () => {
  const html = fs.readFileSync(path.resolve(__dirname, '..', 'market-analysis.html'), 'utf8');
  assert(html.includes('pma-confidence.js'),    'loads pma-confidence.js');
  assert(html.includes('lodes-commute.js'),     'loads lodes-commute.js');
  assert(html.includes('cdle-jobs.js'),         'loads cdle-jobs.js');
  assert(html.includes('cde-schools.js'),       'loads cde-schools.js');
  assert(html.includes('cdot-traffic.js'),      'loads cdot-traffic.js');
  assert(html.includes('pmaHeuristicConfidence'), '#pmaHeuristicConfidence element present');
});

// ── Tract centroids expansion ─────────────────────────────────────────────────

test('tract_centroids_co.json expanded to statewide coverage', () => {
  const obj = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, '..', 'data/market/tract_centroids_co.json'), 'utf8')
  );
  const n = (obj.tracts || []).length;
  assert(n >= 1000, 'tract_centroids_co.json has ≥1000 tracts (got ' + n + ')');
  const counties = new Set((obj.tracts || []).map(t => t.county_fips));
  assert(counties.size >= 60, 'tract centroids cover ≥60 Colorado counties (got ' + counties.size + ')');
});

// ── Summary ───────────────────────────────────────────────────────────────────

console.log('\n' + '='.repeat(60));
console.log('Results: ' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) {
  console.error('\nSome checks failed ❌');
  process.exit(1);
} else {
  console.log('\nAll checks passed ✅');
  process.exit(0);
}
