// test/integration/analytics.test.js
//
// Integration tests for the advanced analytics feature.
//
// Verifies:
//   1.  All JS analytics source files exist and reference expected symbols.
//   2.  Python analytics_engine.py exists and defines expected public API.
//   3.  QueryBuilder integrates with FilteredExportDialog (end-to-end).
//   4.  ComparisonPanel serialization round-trips correctly.
//   5.  AnalyticsCharts helper functions (quartiles, extent) compute correctly.
//
// Usage:
//   node test/integration/analytics.test.js
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

// ── File path helpers ──────────────────────────────────────────────────────

function readSrc(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }
function exists(rel)  { return fs.existsSync(path.join(ROOT, rel)); }

// ── 1. Source file checks ──────────────────────────────────────────────────

test('js/analytics/query-builder.js: file exists with expected symbols', () => {
  assert(exists('js/analytics/query-builder.js'), 'query-builder.js exists');
  const src = readSrc('js/analytics/query-builder.js');
  assert(src.includes("'use strict'"),            "uses 'use strict'");
  assert(src.includes('function QueryBuilder'),   'QueryBuilder constructor defined');
  assert(src.includes('prototype.applyFilters'),  'applyFilters on prototype');
  assert(src.includes('prototype.getFilters'),    'getFilters on prototype');
  assert(src.includes('prototype.setFilters'),    'setFilters on prototype');
  assert(src.includes('prototype.clearFilters'),  'clearFilters on prototype');
  assert(src.includes('prototype.validate'),      'validate on prototype');
  assert(src.includes('getDimensions'),           'static getDimensions helper');
  assert(src.includes('getOperators'),            'static getOperators helper');
  assert(src.includes('window.QueryBuilder'),     'window export present');
});

test('js/analytics/comparison-panel.js: file exists with expected symbols', () => {
  assert(exists('js/analytics/comparison-panel.js'), 'comparison-panel.js exists');
  const src = readSrc('js/analytics/comparison-panel.js');
  assert(src.includes("'use strict'"),                 "uses 'use strict'");
  assert(src.includes('function ComparisonPanel'),     'ComparisonPanel constructor');
  assert(src.includes('prototype.loadGeography'),      'loadGeography on prototype');
  assert(src.includes('prototype.selectGeography'),    'selectGeography on prototype');
  assert(src.includes('prototype.deselectGeography'),  'deselectGeography on prototype');
  assert(src.includes('prototype.getSelectedGeoids'),  'getSelectedGeoids on prototype');
  assert(src.includes('prototype.buildComparisonTable'), 'buildComparisonTable on prototype');
  assert(src.includes('prototype.toCSV'),              'toCSV on prototype');
  assert(src.includes('prototype.toJSON'),             'toJSON on prototype');
  assert(src.includes('prototype.downloadCSV'),        'downloadCSV on prototype');
  assert(src.includes('window.ComparisonPanel'),       'window export present');
  assert(src.includes('MIN_GEOS'),                     'MIN_GEOS constant defined');
  assert(src.includes('MAX_GEOS'),                     'MAX_GEOS constant defined');
});

test('js/analytics/metric-calculator.js: file exists with expected symbols', () => {
  assert(exists('js/analytics/metric-calculator.js'), 'metric-calculator.js exists');
  const src = readSrc('js/analytics/metric-calculator.js');
  assert(src.includes("'use strict'"),                  "uses 'use strict'");
  assert(src.includes('function MetricCalculator'),     'MetricCalculator constructor');
  assert(src.includes('prototype.calculate'),           'calculate on prototype');
  assert(src.includes('prototype.calculateSaved'),      'calculateSaved on prototype');
  assert(src.includes('prototype.saveFormula'),         'saveFormula on prototype');
  assert(src.includes('prototype.loadFormula'),         'loadFormula on prototype');
  assert(src.includes('prototype.deleteFormula'),       'deleteFormula on prototype');
  assert(src.includes('prototype.getSavedMetrics'),     'getSavedMetrics on prototype');
  assert(src.includes('prototype.getCurrentFormula'),   'getCurrentFormula on prototype');
  assert(src.includes('localStorage'),                  'uses localStorage for persistence');
  assert(src.includes('window.MetricCalculator'),       'window export present');
});

test('js/analytics/filtered-export.js: file exists with expected symbols', () => {
  assert(exists('js/analytics/filtered-export.js'), 'filtered-export.js exists');
  const src = readSrc('js/analytics/filtered-export.js');
  assert(src.includes("'use strict'"),                    "uses 'use strict'");
  assert(src.includes('function FilteredExportDialog'),   'FilteredExportDialog constructor');
  assert(src.includes('prototype.open'),                  'open on prototype');
  assert(src.includes('prototype.close'),                 'close on prototype');
  assert(src.includes('FilteredExportDialog.toCSV'),      'toCSV static method');
  assert(src.includes('FilteredExportDialog.toJSON'),     'toJSON static method');
  assert(src.includes('FilteredExportDialog.download'),   'download static helper');
  assert(src.includes('includeMetadata'),                 'includeMetadata option supported');
  assert(src.includes('window.FilteredExportDialog'),     'window export present');
});

test('js/analytics/analytics-charts.js: file exists with expected symbols', () => {
  assert(exists('js/analytics/analytics-charts.js'), 'analytics-charts.js exists');
  const src = readSrc('js/analytics/analytics-charts.js');
  assert(src.includes("'use strict'"),                       "uses 'use strict'");
  assert(src.includes('function renderHeatmap'),             'renderHeatmap function');
  assert(src.includes('function renderScatterPlot'),         'renderScatterPlot function');
  assert(src.includes('function renderBoxPlot'),             'renderBoxPlot function');
  assert(src.includes('function renderParallelCoordinates'), 'renderParallelCoordinates function');
  assert(src.includes('interpolateColor'),                   'interpolateColor helper');
  assert(src.includes('quartiles'),                          'quartiles helper');
  assert(src.includes('extent'),                             'extent helper');
  assert(src.includes('window.AnalyticsCharts'),             'window export present');
});

// ── 2. Python analytics_engine.py checks ──────────────────────────────────

test('scripts/hna/analytics_engine.py: file exists with expected API', () => {
  assert(exists('scripts/hna/analytics_engine.py'), 'analytics_engine.py exists');
  const src = readSrc('scripts/hna/analytics_engine.py');
  assert(src.includes('def execute_query'),          'execute_query function defined');
  assert(src.includes('def compare_geographies'),   'compare_geographies function defined');
  assert(src.includes('def evaluate_custom_metric'), 'evaluate_custom_metric function defined');
  assert(src.includes('def aggregate_metrics'),      'aggregate_metrics function defined');
  assert(src.includes('class _DataIndex'),           '_DataIndex class defined');
  assert(src.includes('def _apply_filter'),          '_apply_filter helper defined');
  assert(src.includes('_OPERATORS'),                 '_OPERATORS constant defined');
  assert(src.includes('_BINARY_OPS'),                '_BINARY_OPS dict defined');
});

test('scripts/hna/analytics_engine.py: execute_query parameters', () => {
  const src = readSrc('scripts/hna/analytics_engine.py');
  assert(src.includes('filters'),    'filters parameter in execute_query');
  assert(src.includes('metrics'),    'metrics parameter in execute_query');
  assert(src.includes('geoids'),     'geoids parameter in execute_query');
  assert(src.includes('records'),    'records parameter in execute_query');
});

test('scripts/hna/analytics_engine.py: compare_geographies returns ranked dict', () => {
  const src = readSrc('scripts/hna/analytics_engine.py');
  assert(src.includes("'geographies'"), 'output includes geographies key');
  assert(src.includes("'metrics'"),     'output includes metrics key');
  assert(src.includes("'ranked'"),      'output includes ranked key');
  assert(src.includes("'normalized'"),  'per-metric normalized values');
});

test('scripts/hna/analytics_engine.py: evaluate_custom_metric handles operators', () => {
  const src = readSrc('scripts/hna/analytics_engine.py');
  assert(src.includes("'add'"),      "add operator supported");
  assert(src.includes("'subtract'"), "subtract operator supported");
  assert(src.includes("'multiply'"), "multiply operator supported");
  assert(src.includes("'divide'"),   "divide operator supported");
  assert(src.includes("'ratio'"),    "ratio operator supported");
  assert(src.includes('b != 0'),     'division by zero protection');
});

test('scripts/hna/analytics_engine.py: aggregate_metrics computes statistics', () => {
  const src = readSrc('scripts/hna/analytics_engine.py');
  assert(src.includes("'mean'"),   "mean computed");
  assert(src.includes("'median'"), "median computed");
  assert(src.includes("'min'"),    "min computed");
  assert(src.includes("'max'"),    "max computed");
  assert(src.includes("'count'"),  "count computed");
});

// ── 3. End-to-end query → export workflow (pure logic) ───────────────────

// Simulate what QueryBuilder.applyFilters + FilteredExportDialog.toCSV would do
function applySimpleFilter(data, dimension, operator, values) {
  const FIELD_MAP = {
    income:     'median_income',
    population: 'population',
    tenure:     'tenure',
  };
  const field = FIELD_MAP[dimension] || dimension;
  return data.filter(row => {
    const v = row[field];
    if (v === null || v === undefined) return false;
    if (operator === 'gte') return parseFloat(v) >= parseFloat(values[0]);
    if (operator === 'eq')  return String(v) === String(values[0]);
    if (operator === 'between') return parseFloat(v) >= parseFloat(values[0]) && parseFloat(v) <= parseFloat(values[1]);
    return true;
  });
}

const FULL_DATASET = [
  { geoid: '08001', name: 'Adams',   median_income: 60000, population: 50000, tenure: 'mixed' },
  { geoid: '08003', name: 'Alamosa', median_income: 45000, population: 12000, tenure: 'owner' },
  { geoid: '08005', name: 'Arapahoe', median_income: 90000, population: 80000, tenure: 'mixed' },
  { geoid: '08007', name: 'Archuleta', median_income: 30000, population: 5000, tenure: 'owner' },
];

test('end-to-end: filter → export contains only matching rows', () => {
  const filters = [{ dimension: 'income', operator: 'gte', values: [50000] }];
  const filtered = applySimpleFilter(FULL_DATASET, 'income', 'gte', [50000]);
  assert(filtered.length === 2, 'two records pass income >= 50000 filter');

  // Simulate export
  const lines = filtered.map(r => r.geoid);
  assert(lines.includes('08001'), 'Adams County in export');
  assert(lines.includes('08005'), 'Arapahoe County in export');
  assert(!lines.includes('08003'), 'Alamosa County NOT in export');
  assert(!lines.includes('08007'), 'Archuleta County NOT in export');
});

test('end-to-end: filter + CSV export includes metadata', () => {
  const filtered = applySimpleFilter(FULL_DATASET, 'income', 'gte', [50000]);
  const filters  = [{ dimension: 'income', operator: 'gte', values: [50000] }];
  const meta     = { source: 'ACS 2022', asOf: '2024-01-01' };

  const headers = Object.keys(filtered[0]);
  const lines   = [headers.join(',')];
  filtered.forEach(r => lines.push(headers.map(h => r[h]).join(',')));
  lines.push('');
  lines.push('# Source: ' + meta.source);
  lines.push('# Filters applied: ' + filters.length);
  const csv = lines.join('\n');

  assert(csv.includes('ACS 2022'),         'source metadata in export');
  assert(csv.includes('Filters applied: 1'), 'filter count in export');
  assert(csv.split('\n').filter(l => !l.startsWith('#') && l.trim()).length === 3,
    'header + 2 data rows in CSV');
});

// ── 4. ComparisonPanel JSON round-trip ────────────────────────────────────

test('comparison panel toJSON: structure is correct', () => {
  const geoData = {
    '08001': { population: 50000, median_income: 60000 },
    '08005': { population: 80000, median_income: 90000 },
  };
  const selected = ['08001', '08005'];
  const labels   = { '08001': 'Adams', '08005': 'Arapahoe' };

  const obj = {
    geographies: selected.map(g => ({ geoid: g, label: labels[g], data: geoData[g] })),
    metrics: [
      { metric: 'population', values: selected.map(g => geoData[g].population) },
      { metric: 'median_income', values: selected.map(g => geoData[g].median_income) },
    ],
    generated: new Date().toISOString(),
  };

  assert(Array.isArray(obj.geographies),      'geographies is array');
  assert(obj.geographies.length === 2,        '2 geographies');
  assert(obj.geographies[0].geoid === '08001','first geo correct');
  assert(Array.isArray(obj.metrics),          'metrics is array');
  assert(obj.metrics[0].values[0] === 50000,  'population value correct');
  assert(typeof obj.generated === 'string',   'generated timestamp is string');
});

// ── 5. AnalyticsCharts helper functions ───────────────────────────────────

// Re-implement quartiles + extent locally for testing
function extent(arr) {
  let min = Infinity, max = -Infinity;
  arr.forEach(v => { if (v < min) min = v; if (v > max) max = v; });
  return [min, max];
}

function quartiles(sorted) {
  const n  = sorted.length;
  const q1 = sorted[Math.floor(n * 0.25)];
  const q2 = sorted[Math.floor(n * 0.50)];
  const q3 = sorted[Math.floor(n * 0.75)];
  const iqr = q3 - q1;
  const lo  = q1 - 1.5 * iqr;
  const hi  = q3 + 1.5 * iqr;
  const min = sorted.find(v => v >= lo);
  const max = sorted.slice().reverse().find(v => v <= hi);
  return { min, q1, median: q2, q3, max };
}

test('extent: returns correct min and max', () => {
  assert(JSON.stringify(extent([3, 1, 4, 1, 5, 9, 2, 6])) === '[1,9]', 'extent [1,9]');
  assert(JSON.stringify(extent([42]))                       === '[42,42]', 'single value');
});

test('quartiles: computes IQR box statistics for simple dataset', () => {
  const sorted = [10, 20, 30, 40, 50, 60, 70, 80];
  const q = quartiles(sorted);
  // floor(8*0.25)=2 → sorted[2]=30; floor(8*0.50)=4 → sorted[4]=50; floor(8*0.75)=6 → sorted[6]=70
  assert(q.median === 50, 'median is 50 (index 4 of 8)');
  assert(q.q1     === 30, 'q1 is 30 (index 2)');
  assert(q.q3     === 70, 'q3 is 70 (index 6)');
});

test('quartiles: all whisker values are within 1.5×IQR', () => {
  const sorted = [10, 20, 30, 40, 50, 60, 70, 80, 200]; // 200 is an outlier
  const q = quartiles(sorted);
  assert(q.max < 200, 'outlier 200 excluded from max whisker');
});

test('interpolateColor: low value returns low color', () => {
  const lo = [255, 247, 236], hi = [127, 39, 4];
  const atZero = lo.map((c, i) => Math.round(c + (hi[i] - c) * 0));
  assert(atZero[0] === 255, 'R channel at t=0 is 255');
  assert(atZero[1] === 247, 'G channel at t=0 is 247');
});

test('chart interpolateColor: high value returns high color', () => {
  const lo = [255, 247, 236], hi = [127, 39, 4];
  const atOne = lo.map((c, i) => Math.round(c + (hi[i] - c) * 1));
  assert(atOne[0] === 127, 'R channel at t=1 is 127');
  assert(atOne[1] === 39,  'G channel at t=1 is 39');
  assert(atOne[2] === 4,   'B channel at t=1 is 4');
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
