// test/analytics.test.js
//
// Unit tests for the advanced analytics modules:
//   - ComparisonPanel  (js/analytics/comparison-panel.js)
//   - MetricCalculator (js/analytics/metric-calculator.js)
//   - FilteredExportDialog (js/analytics/filtered-export.js)
//
// Pure logic is re-implemented here following the pattern in test/prop123.test.js.
//
// Usage:
//   node test/analytics.test.js
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

// ── Re-implement pure logic from comparison-panel.js ───────────────────────

const METRIC_DEFS = [
  { key: 'population',      label: 'Population',    format: 'integer',  higherIsBetter: true },
  { key: 'median_income',   label: 'Median Income', format: 'currency', higherIsBetter: true },
  { key: 'rent_burden_pct', label: 'Rent Burden %', format: 'percent',  higherIsBetter: false },
  { key: 'vacancy_rate',    label: 'Vacancy Rate %',format: 'percent',  higherIsBetter: null },
  { key: 'total_units',     label: 'Housing Units', format: 'integer',  higherIsBetter: true },
  { key: 'renter_pct',      label: 'Renter %',      format: 'percent',  higherIsBetter: null },
  { key: 'median_rent',     label: 'Median Rent',   format: 'currency', higherIsBetter: false },
  { key: 'employment',      label: 'Employment',    format: 'integer',  higherIsBetter: true },
];

function fmt(value, format) {
  if (value === null || value === undefined || (typeof value === 'number' && isNaN(value))) return '—';
  const n = parseFloat(value);
  switch (format) {
    case 'integer':  return Math.round(n).toLocaleString();
    case 'currency': return '$' + Math.round(n).toLocaleString();
    case 'percent':  return n.toFixed(1) + '%';
    default:         return String(value);
  }
}

function buildComparisonTable(geoData, geoLabels, selectedGeoids, metrics) {
  return METRIC_DEFS.filter(m => metrics.indexOf(m.key) !== -1).map(m => {
    const values = selectedGeoids.map(g => {
      const d = geoData[g] || {};
      return d[m.key] !== undefined ? d[m.key] : null;
    });
    return { metric: m.key, label: m.label, format: m.format, higherIsBetter: m.higherIsBetter, values };
  });
}

function toCSV(geoData, geoLabels, selectedGeoids) {
  const rows  = buildComparisonTable(geoData, geoLabels, selectedGeoids, METRIC_DEFS.map(m => m.key));
  const header = ['Metric'].concat(selectedGeoids.map(g => geoLabels[g] || g));
  const lines  = [header.join(',')];
  rows.forEach(row => {
    const cells = [row.label].concat(row.values.map(v => v === null ? '' : String(v)));
    lines.push(cells.join(','));
  });
  return lines.join('\n');
}

// ── Re-implement pure logic from metric-calculator.js ─────────────────────

const OPERANDS = {
  population:      { label: 'Population',  field: 'population' },
  median_income:   { label: 'Median Income', field: 'median_income' },
  median_rent:     { label: 'Median Rent',  field: 'median_rent' },
  total_units:     { label: 'Housing Units', field: 'total_units' },
  rent_burden_pct: { label: 'Rent Burden %', field: 'rent_burden_pct' },
};

const BINARY_OPS = {
  add:      { apply: (a, b) => a + b },
  subtract: { apply: (a, b) => a - b },
  multiply: { apply: (a, b) => a * b },
  divide:   { apply: (a, b) => b === 0 ? null : a / b },
  ratio:    { apply: (a, b) => b === 0 ? null : (a / b) * 100 },
};

function fieldValue(data, operandKey) {
  if (!data || !operandKey) return null;
  const def = OPERANDS[operandKey];
  if (!def) return null;
  const v = parseFloat(data[def.field]);
  return isNaN(v) ? null : v;
}

function calculateFormula(formula, data) {
  const a  = fieldValue(data, formula.leftOperand);
  const b  = fieldValue(data, formula.rightOperand);
  const op = BINARY_OPS[formula.operator];
  if (a === null || b === null || !op) return null;
  return op.apply(a, b);
}

// ── Re-implement pure logic from filtered-export.js ───────────────────────

function toCSVExport(data, filters, meta) {
  if (!Array.isArray(data) || data.length === 0) return '';
  const headers = Object.keys(data[0]);
  const rows = [headers.join(',')];
  data.forEach(row => {
    const cells = headers.map(h => {
      const v = row[h];
      if (v === null || v === undefined) return '';
      let s = String(v);
      if (s.indexOf(',') !== -1 || s.indexOf('"') !== -1 || s.indexOf('\n') !== -1) {
        s = '"' + s.replace(/"/g, '""') + '"';
      }
      return s;
    });
    rows.push(cells.join(','));
  });
  if (meta && (meta.source || meta.asOf)) {
    rows.push('');
    rows.push('# Source: ' + (meta.source || 'unknown'));
    rows.push('# As of: ' + (meta.asOf || 'unknown'));
  }
  if (filters && filters.length > 0) {
    rows.push('# Filters applied: ' + filters.length);
  }
  return rows.join('\n');
}

function toJSONExport(data, filters, meta) {
  const out = { data: data || [], count: (data || []).length, exported: new Date().toISOString() };
  if (filters && filters.length > 0) {
    out.filters_applied = filters.map(f => ({ dimension: f.dimension, operator: f.operator, values: f.values }));
  }
  if (meta) out.metadata = meta;
  return JSON.stringify(out, null, 2);
}

// ── Source file checks ─────────────────────────────────────────────────────

test('js/analytics/comparison-panel.js exists and has required exports', () => {
  const p = path.join(ROOT, 'js', 'analytics', 'comparison-panel.js');
  assert(fs.existsSync(p), 'comparison-panel.js exists');
  const src = fs.readFileSync(p, 'utf8');
  assert(src.includes('ComparisonPanel'),           'ComparisonPanel class defined');
  assert(src.includes('loadGeography'),             'loadGeography method defined');
  assert(src.includes('selectGeography'),           'selectGeography method defined');
  assert(src.includes('deselectGeography'),         'deselectGeography method defined');
  assert(src.includes('buildComparisonTable'),      'buildComparisonTable method defined');
  assert(src.includes('toCSV'),                     'toCSV method defined');
  assert(src.includes('toJSON'),                    'toJSON method defined');
  assert(src.includes('downloadCSV'),               'downloadCSV method defined');
  assert(src.includes('window.ComparisonPanel'),    'ComparisonPanel exposed on window');
});

test('js/analytics/metric-calculator.js exists and has required exports', () => {
  const p = path.join(ROOT, 'js', 'analytics', 'metric-calculator.js');
  assert(fs.existsSync(p), 'metric-calculator.js exists');
  const src = fs.readFileSync(p, 'utf8');
  assert(src.includes('MetricCalculator'),          'MetricCalculator class defined');
  assert(src.includes('calculate'),                 'calculate method defined');
  assert(src.includes('saveFormula'),               'saveFormula method defined');
  assert(src.includes('loadFormula'),               'loadFormula method defined');
  assert(src.includes('deleteFormula'),             'deleteFormula method defined');
  assert(src.includes('getSavedMetrics'),           'getSavedMetrics method defined');
  assert(src.includes('BINARY_OPS'),                'BINARY_OPS defined');
  assert(src.includes('OPERANDS'),                  'OPERANDS defined');
  assert(src.includes('window.MetricCalculator'),   'MetricCalculator exposed on window');
});

test('js/analytics/filtered-export.js exists and has required exports', () => {
  const p = path.join(ROOT, 'js', 'analytics', 'filtered-export.js');
  assert(fs.existsSync(p), 'filtered-export.js exists');
  const src = fs.readFileSync(p, 'utf8');
  assert(src.includes('FilteredExportDialog'),      'FilteredExportDialog class defined');
  assert(src.includes('toCSV'),                     'toCSV static method defined');
  assert(src.includes('toJSON'),                    'toJSON static method defined');
  assert(src.includes('download'),                  'download helper defined');
  assert(src.includes('open'),                      'open method defined');
  assert(src.includes('close'),                     'close method defined');
  assert(src.includes('window.FilteredExportDialog'), 'FilteredExportDialog exposed on window');
});

test('js/analytics/analytics-charts.js exists and has required exports', () => {
  const p = path.join(ROOT, 'js', 'analytics', 'analytics-charts.js');
  assert(fs.existsSync(p), 'analytics-charts.js exists');
  const src = fs.readFileSync(p, 'utf8');
  assert(src.includes('renderHeatmap'),             'renderHeatmap function defined');
  assert(src.includes('renderScatterPlot'),         'renderScatterPlot function defined');
  assert(src.includes('renderBoxPlot'),             'renderBoxPlot function defined');
  assert(src.includes('renderParallelCoordinates'), 'renderParallelCoordinates function defined');
  assert(src.includes('AnalyticsCharts'),           'AnalyticsCharts namespace exposed');
  assert(src.includes('window.AnalyticsCharts'),    'AnalyticsCharts exposed on window');
});

// ── ComparisonPanel logic tests ────────────────────────────────────────────

const GEO_DATA = {
  '08001': { population: 50000, median_income: 60000, rent_burden_pct: 35, median_rent: 1200, employment: 22000 },
  '08003': { population: 12000, median_income: 45000, rent_burden_pct: 50, median_rent: 1500, employment:  5000 },
  '08005': { population: 80000, median_income: 90000, rent_burden_pct: 25, median_rent:  900, employment: 40000 },
};
const GEO_LABELS = { '08001': 'Adams County', '08003': 'Alamosa County', '08005': 'Arapahoe County' };

test('buildComparisonTable returns correct row structure', () => {
  const selected = ['08001', '08003'];
  const rows = buildComparisonTable(GEO_DATA, GEO_LABELS, selected, ['population', 'median_income', 'rent_burden_pct']);
  assert(rows.length === 3, 'three metric rows returned');
  assert(rows[0].metric === 'population', 'first metric is population');
  assert(rows[0].values.length === 2, 'two values per row');
  assert(rows[0].values[0] === 50000, 'first geo population correct');
  assert(rows[0].values[1] === 12000, 'second geo population correct');
});

test('buildComparisonTable: null for missing metric in geography', () => {
  const geoMissing = { '08001': { population: 50000 }, '08003': {} };
  const rows = buildComparisonTable(geoMissing, GEO_LABELS, ['08001', '08003'], ['population', 'median_income']);
  const incomeRow = rows.find(r => r.metric === 'median_income');
  assert(incomeRow !== undefined, 'income row present');
  assert(incomeRow.values[1] === null, 'null for missing value');
});

test('toCSV: produces valid CSV with header row', () => {
  const csv = toCSV(GEO_DATA, GEO_LABELS, ['08001', '08003']);
  const lines = csv.split('\n');
  assert(lines.length > 1, 'CSV has multiple lines');
  assert(lines[0].startsWith('Metric,'), 'first line is header starting with "Metric,"');
  assert(lines[0].includes('Adams County'), 'header includes geo label');
  assert(lines[0].includes('Alamosa County'), 'header includes second geo label');
});

test('toCSV: data rows contain metric values', () => {
  const csv = toCSV(GEO_DATA, GEO_LABELS, ['08001', '08003']);
  assert(csv.includes('Population'), 'CSV contains Population row');
  assert(csv.includes('Median Income'), 'CSV contains Median Income row');
});

test('fmt: formats integer values', () => {
  assert(fmt(50000, 'integer') === '50,000', 'integer formatted with comma');
  assert(fmt(null, 'integer')  === '—',      'null → em dash');
  assert(fmt(0, 'integer')     === '0',      'zero formatted as 0');
});

test('fmt: formats currency values', () => {
  assert(fmt(60000, 'currency').startsWith('$'), 'currency starts with $');
  assert(fmt(undefined, 'currency') === '—',     'undefined → em dash');
});

test('fmt: formats percent values', () => {
  assert(fmt(35, 'percent')  === '35.0%', 'percent formatted with 1 decimal');
  assert(fmt(35.5, 'percent') === '35.5%', 'decimal percent correct');
});

// ── MetricCalculator logic tests ───────────────────────────────────────────

const DATA_RECORD = { population: 50000, median_income: 60000, median_rent: 1200, total_units: 20000, rent_burden_pct: 35 };

test('calculateFormula: divide operator', () => {
  const result = calculateFormula({ leftOperand: 'median_rent', operator: 'divide', rightOperand: 'median_income' }, DATA_RECORD);
  assert(result !== null, 'result is non-null');
  assert(Math.abs(result - (1200 / 60000)) < 1e-10, 'divide result is correct');
});

test('calculateFormula: ratio operator (* 100)', () => {
  const result = calculateFormula({ leftOperand: 'median_rent', operator: 'ratio', rightOperand: 'median_income' }, DATA_RECORD);
  assert(result !== null, 'result is non-null');
  assert(Math.abs(result - (1200 / 60000 * 100)) < 1e-10, 'ratio result correct (× 100)');
});

test('calculateFormula: add operator', () => {
  const result = calculateFormula({ leftOperand: 'median_income', operator: 'add', rightOperand: 'median_rent' }, DATA_RECORD);
  assert(result === 61200, 'add result correct');
});

test('calculateFormula: subtract operator', () => {
  const result = calculateFormula({ leftOperand: 'median_income', operator: 'subtract', rightOperand: 'median_rent' }, DATA_RECORD);
  assert(result === 58800, 'subtract result correct');
});

test('calculateFormula: multiply operator', () => {
  const result = calculateFormula({ leftOperand: 'median_rent', operator: 'multiply', rightOperand: 'total_units' }, DATA_RECORD);
  assert(result === 1200 * 20000, 'multiply result correct');
});

test('calculateFormula: divide by zero returns null', () => {
  const data = { median_rent: 1200, median_income: 0 };
  const result = calculateFormula({ leftOperand: 'median_rent', operator: 'divide', rightOperand: 'median_income' }, data);
  assert(result === null, 'divide by zero returns null');
});

test('calculateFormula: missing operand returns null', () => {
  const partial = { median_income: 60000 };  // no median_rent
  const result = calculateFormula({ leftOperand: 'median_rent', operator: 'divide', rightOperand: 'median_income' }, partial);
  assert(result === null, 'missing field returns null');
});

test('fieldValue: returns numeric value for existing field', () => {
  const v = fieldValue(DATA_RECORD, 'median_income');
  assert(v === 60000, 'fieldValue returns correct number');
});

test('fieldValue: returns null for missing operand key', () => {
  const v = fieldValue(DATA_RECORD, 'nonexistent_key');
  assert(v === null, 'unknown operand returns null');
});

test('fieldValue: returns null for null data', () => {
  const v = fieldValue(null, 'median_income');
  assert(v === null, 'null data returns null');
});

// ── FilteredExportDialog logic tests ──────────────────────────────────────

const EXPORT_DATA = [
  { geoid: '08001', name: 'Adams',   income: 60000, tenure: 'renter' },
  { geoid: '08003', name: 'Alamosa', income: 45000, tenure: 'owner'  },
];
const EXPORT_FILTERS = [
  { dimension: 'tenure', operator: 'eq', values: ['renter'] },
];
const EXPORT_META = { source: 'ACS 5-Year 2022', asOf: '2024-01-01' };

test('toCSVExport: produces valid CSV', () => {
  const csv = toCSVExport(EXPORT_DATA, EXPORT_FILTERS, EXPORT_META);
  const lines = csv.split('\n').filter(l => !l.startsWith('#') && l.trim());
  assert(lines.length === 3, 'header + 2 data rows');
  assert(lines[0].includes('geoid'), 'header includes "geoid"');
  assert(lines[0].includes('income'), 'header includes "income"');
  assert(csv.includes('ACS 5-Year 2022'), 'metadata source included');
  assert(csv.includes('Filters applied: 1'), 'filter count included');
});

test('toCSVExport: escapes commas and quotes in values', () => {
  const data = [{ geoid: '08001', name: 'Adams, CO', notes: 'Has "quotes"' }];
  const csv = toCSVExport(data, [], {});
  assert(csv.includes('"Adams, CO"'), 'comma in value is quoted');
  assert(csv.includes('"Has ""quotes"""'), 'double quotes escaped');
});

test('toCSVExport: empty data returns empty string', () => {
  const csv = toCSVExport([], [], {});
  assert(csv === '', 'empty data returns empty string');
});

test('toJSONExport: produces valid JSON with correct structure', () => {
  const json = toJSONExport(EXPORT_DATA, EXPORT_FILTERS, EXPORT_META);
  const parsed = JSON.parse(json);
  assert(parsed.data.length === 2,                    'data array has 2 records');
  assert(parsed.count === 2,                          'count is 2');
  assert(typeof parsed.exported === 'string',         'exported timestamp is a string');
  assert(Array.isArray(parsed.filters_applied),       'filters_applied is an array');
  assert(parsed.filters_applied.length === 1,         'one filter included');
  assert(parsed.metadata.source === 'ACS 5-Year 2022', 'metadata source present');
});

test('toJSONExport: no filters omits filters_applied', () => {
  const json = toJSONExport(EXPORT_DATA, [], {});
  const parsed = JSON.parse(json);
  assert(parsed.filters_applied === undefined, 'filters_applied omitted when no filters');
});

test('toJSONExport: null data is handled', () => {
  const json = toJSONExport(null, [], null);
  const parsed = JSON.parse(json);
  assert(parsed.count === 0, 'null data results in count 0');
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
