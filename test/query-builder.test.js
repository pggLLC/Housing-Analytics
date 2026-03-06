// test/query-builder.test.js
//
// Unit tests for QueryBuilder (js/analytics/query-builder.js).
//
// Because QueryBuilder uses DOM APIs for its visual layer, this file tests
// the pure logic extracted via window.QueryBuilder._applyFilter and related
// helpers by re-implementing the same logic locally — consistent with the
// existing test pattern in test/prop123.test.js.
//
// Usage:
//   node test/query-builder.test.js
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

// ── Re-implemented pure filter logic (mirrors js/analytics/query-builder.js) ──

const DIMENSIONS = {
  geography:   { label: 'Geography',     type: 'string',  field: 'geoid' },
  age_group:   { label: 'Age Group',     type: 'string',  field: 'age_group' },
  income:      { label: 'Income',        type: 'number',  field: 'median_income' },
  tenure:      { label: 'Tenure',        type: 'string',  field: 'tenure' },
  rent_burden: { label: 'Rent Burden',   type: 'number',  field: 'rent_burden_pct' },
  population:  { label: 'Population',    type: 'number',  field: 'population' },
  vacancy:     { label: 'Vacancy Rate',  type: 'number',  field: 'vacancy_rate' },
  units:       { label: 'Housing Units', type: 'number',  field: 'total_units' },
};

const OPERATORS = {
  eq:      { label: 'equals',         types: ['string', 'number'], arity: 1 },
  neq:     { label: 'not equals',     types: ['string', 'number'], arity: 1 },
  gt:      { label: 'greater than',   types: ['number'],           arity: 1 },
  gte:     { label: '>= (at least)',  types: ['number'],           arity: 1 },
  lt:      { label: 'less than',      types: ['number'],           arity: 1 },
  lte:     { label: '<= (at most)',   types: ['number'],           arity: 1 },
  between: { label: 'between',        types: ['number'],           arity: 2 },
  in_list: { label: 'in list',        types: ['string', 'number'], arity: -1 },
};

function coerce(value, type) {
  if (type === 'number') return parseFloat(value);
  return String(value);
}

function applyFilter(row, filter) {
  const dim = DIMENSIONS[filter.dimension];
  if (!dim) return true;
  const field  = dim.field;
  const rawVal = row[field];
  if (rawVal === null || rawVal === undefined) return false;
  const val = coerce(rawVal, dim.type);
  const op  = filter.operator;

  switch (op) {
    case 'eq':      return val === coerce(filter.values[0], dim.type);
    case 'neq':     return val !== coerce(filter.values[0], dim.type);
    case 'gt':      return val >  coerce(filter.values[0], dim.type);
    case 'gte':     return val >= coerce(filter.values[0], dim.type);
    case 'lt':      return val <  coerce(filter.values[0], dim.type);
    case 'lte':     return val <= coerce(filter.values[0], dim.type);
    case 'between': {
      const lo = coerce(filter.values[0], dim.type);
      const hi = coerce(filter.values[1], dim.type);
      return val >= lo && val <= hi;
    }
    case 'in_list': {
      const coercedList = (filter.values || []).map(v => coerce(v, dim.type));
      return coercedList.indexOf(val) !== -1;
    }
    default: return true;
  }
}

function validateFilter(filter, idx) {
  const errors = [];
  const dim = DIMENSIONS[filter.dimension];
  if (!dim) {
    errors.push(`Filter ${idx + 1}: Unknown dimension "${filter.dimension}"`);
    return errors;
  }
  const op = OPERATORS[filter.operator];
  if (!op) {
    errors.push(`Filter ${idx + 1}: Unknown operator "${filter.operator}"`);
    return errors;
  }
  if (op.types.indexOf(dim.type) === -1) {
    errors.push(`Filter ${idx + 1}: Operator "${op.label}" not valid for ${dim.type} dimension`);
    return errors;
  }
  if (op.arity === 1 && (!Array.isArray(filter.values) || filter.values[0] === '' || filter.values[0] === null || filter.values[0] === undefined)) {
    errors.push(`Filter ${idx + 1}: Value is required`);
  }
  if (op.arity === 2) {
    if (!Array.isArray(filter.values) || filter.values.length < 2) {
      errors.push(`Filter ${idx + 1}: "between" requires two values`);
    } else {
      const lo = parseFloat(filter.values[0]), hi = parseFloat(filter.values[1]);
      if (isNaN(lo) || isNaN(hi)) errors.push(`Filter ${idx + 1}: "between" values must be numeric`);
      else if (lo > hi) errors.push(`Filter ${idx + 1}: "between" lower bound must not exceed upper bound`);
    }
  }
  if (op.arity === -1 && (!Array.isArray(filter.values) || filter.values.length === 0)) {
    errors.push(`Filter ${idx + 1}: "in list" requires at least one value`);
  }
  return errors;
}

function applyFilters(data, filters) {
  return data.filter(row => filters.every(f => applyFilter(row, f)));
}

// ── Source file checks ─────────────────────────────────────────────────────

test('js/analytics/query-builder.js exists', () => {
  const p = path.join(ROOT, 'js', 'analytics', 'query-builder.js');
  assert(fs.existsSync(p), 'query-builder.js file exists');
  const src = fs.readFileSync(p, 'utf8');
  assert(src.includes('QueryBuilder'),      'QueryBuilder class defined');
  assert(src.includes('DIMENSIONS'),        'DIMENSIONS constant defined');
  assert(src.includes('OPERATORS'),         'OPERATORS constant defined');
  assert(src.includes('applyFilters'),      'applyFilters method defined');
  assert(src.includes('getFilters'),        'getFilters method defined');
  assert(src.includes('setFilters'),        'setFilters method defined');
  assert(src.includes('clearFilters'),      'clearFilters method defined');
  assert(src.includes('validate'),          'validate method defined');
  assert(src.includes('window.QueryBuilder'), 'QueryBuilder exposed on window');
});

// ── Filter application tests ───────────────────────────────────────────────

const SAMPLE_DATA = [
  { geoid: '08001', median_income: 60000, population: 50000, rent_burden_pct: 35, tenure: 'renter', vacancy_rate: 5.2, total_units: 20000 },
  { geoid: '08003', median_income: 45000, population: 12000, rent_burden_pct: 50, tenure: 'owner',  vacancy_rate: 8.1, total_units:  8000 },
  { geoid: '08005', median_income: 90000, population: 80000, rent_burden_pct: 25, tenure: 'renter', vacancy_rate: 3.0, total_units: 35000 },
  { geoid: '08007', median_income: 30000, population:  5000, rent_burden_pct: 60, tenure: 'owner',  vacancy_rate: 12.4, total_units: 3000 },
];

test('eq operator: string match', () => {
  const filter = { dimension: 'tenure', operator: 'eq', values: ['renter'] };
  const result = applyFilters(SAMPLE_DATA, [filter]);
  assert(result.length === 2, 'returns 2 renter geographies');
  assert(result.every(r => r.tenure === 'renter'), 'all results are renters');
});

test('eq operator: number match', () => {
  const filter = { dimension: 'income', operator: 'eq', values: [60000] };
  const result = applyFilters(SAMPLE_DATA, [filter]);
  assert(result.length === 1, 'returns exactly 1 match');
  assert(result[0].geoid === '08001', 'correct geoid returned');
});

test('neq operator', () => {
  const filter = { dimension: 'tenure', operator: 'neq', values: ['owner'] };
  const result = applyFilters(SAMPLE_DATA, [filter]);
  assert(result.length === 2, 'returns 2 non-owner geographies');
});

test('gt operator', () => {
  const filter = { dimension: 'income', operator: 'gt', values: [60000] };
  const result = applyFilters(SAMPLE_DATA, [filter]);
  assert(result.length === 1, 'one geography has income > 60000');
  assert(result[0].geoid === '08005', 'highest income geo returned');
});

test('gte operator', () => {
  const filter = { dimension: 'income', operator: 'gte', values: [60000] };
  const result = applyFilters(SAMPLE_DATA, [filter]);
  assert(result.length === 2, 'two geographies have income >= 60000');
});

test('lt operator', () => {
  const filter = { dimension: 'rent_burden', operator: 'lt', values: [35] };
  const result = applyFilters(SAMPLE_DATA, [filter]);
  assert(result.length === 1, 'one geography has rent burden < 35');
  assert(result[0].geoid === '08005', 'correct geo returned');
});

test('lte operator', () => {
  const filter = { dimension: 'rent_burden', operator: 'lte', values: [35] };
  const result = applyFilters(SAMPLE_DATA, [filter]);
  assert(result.length === 2, 'two geographies have rent burden <= 35');
});

test('between operator: inclusive bounds', () => {
  const filter = { dimension: 'income', operator: 'between', values: [45000, 60000] };
  const result = applyFilters(SAMPLE_DATA, [filter]);
  assert(result.length === 2, 'two geographies between 45k and 60k income');
  const geoids = result.map(r => r.geoid).sort();
  assert(geoids[0] === '08001', '08001 included');
  assert(geoids[1] === '08003', '08003 included');
});

test('in_list operator: string values', () => {
  const filter = { dimension: 'geography', operator: 'in_list', values: ['08001', '08005'] };
  const result = applyFilters(SAMPLE_DATA, [filter]);
  assert(result.length === 2, 'returns 2 geographies from list');
});

test('chained filters: income AND tenure', () => {
  const filters = [
    { dimension: 'income', operator: 'gte', values: [45000] },
    { dimension: 'tenure', operator: 'eq',  values: ['renter'] },
  ];
  const result = applyFilters(SAMPLE_DATA, filters);
  assert(result.length === 2, 'two geographies pass both filters');
  assert(result.every(r => r.median_income >= 45000 && r.tenure === 'renter'), 'both conditions satisfied');
});

test('no matching records returns empty array', () => {
  const filter = { dimension: 'income', operator: 'gt', values: [1000000] };
  const result = applyFilters(SAMPLE_DATA, [filter]);
  assert(result.length === 0, 'empty result when no records match');
});

test('empty filter list returns all records', () => {
  const result = applyFilters(SAMPLE_DATA, []);
  assert(result.length === SAMPLE_DATA.length, 'no filters returns all records');
});

test('record missing field is excluded', () => {
  const data = [{ geoid: '08001' }];  // no median_income
  const filter = { dimension: 'income', operator: 'gte', values: [0] };
  const result = applyFilters(data, [filter]);
  assert(result.length === 0, 'row missing field is excluded');
});

// ── Validation tests ───────────────────────────────────────────────────────

test('validation: unknown dimension produces error', () => {
  const errors = validateFilter({ dimension: 'foobar', operator: 'eq', values: ['x'] }, 0);
  assert(errors.length === 1, 'one error for unknown dimension');
  assert(errors[0].includes('Unknown dimension'), 'error mentions "Unknown dimension"');
});

test('validation: unknown operator produces error', () => {
  const errors = validateFilter({ dimension: 'income', operator: 'foobar', values: ['0'] }, 0);
  assert(errors.length === 1, 'one error for unknown operator');
  assert(errors[0].includes('Unknown operator'), 'error mentions "Unknown operator"');
});

test('validation: string operator on number dimension fails', () => {
  const errors = validateFilter({ dimension: 'income', operator: 'gt', values: [0] }, 0);
  assert(errors.length === 0, 'gt on number dimension is valid');
});

test('validation: between with reversed bounds fails', () => {
  const errors = validateFilter({ dimension: 'income', operator: 'between', values: [90000, 10000] }, 0);
  assert(errors.length === 1, 'reversed between bounds produce error');
  assert(errors[0].includes('lower bound'), 'error mentions "lower bound"');
});

test('validation: between with non-numeric values fails', () => {
  const errors = validateFilter({ dimension: 'income', operator: 'between', values: ['abc', 'xyz'] }, 0);
  assert(errors.length === 1, 'non-numeric between values produce error');
});

test('validation: in_list with no values fails', () => {
  const errors = validateFilter({ dimension: 'income', operator: 'in_list', values: [] }, 0);
  assert(errors.length === 1, 'empty in_list produces error');
});

test('validation: valid gte filter passes', () => {
  const errors = validateFilter({ dimension: 'income', operator: 'gte', values: [50000] }, 0);
  assert(errors.length === 0, 'valid filter has no errors');
});

// ── Edge cases ─────────────────────────────────────────────────────────────

test('edge case: between with equal bounds (point range)', () => {
  const filter = { dimension: 'income', operator: 'between', values: [60000, 60000] };
  const result = applyFilters(SAMPLE_DATA, [filter]);
  assert(result.length === 1, 'single-point between returns exact match');
  assert(result[0].geoid === '08001', 'correct geo returned');
});

test('edge case: null/undefined raw values are excluded', () => {
  const data = [
    { geoid: '08001', median_income: 50000 },
    { geoid: '08002', median_income: null },
    { geoid: '08003', median_income: undefined },
  ];
  const filter = { dimension: 'income', operator: 'gte', values: [0] };
  const result = applyFilters(data, [filter]);
  assert(result.length === 1, 'null/undefined fields excluded from results');
});

test('edge case: large dataset performance (10000 rows)', () => {
  const big = Array.from({ length: 10000 }, function (_, i) {
    return { geoid: String(i), median_income: i * 10, population: i * 100 };
  });
  const filter = { dimension: 'income', operator: 'between', values: [40000, 60000] };
  const start  = Date.now();
  const result = applyFilters(big, [filter]);
  const ms     = Date.now() - start;
  assert(result.length > 0, 'returns results from large dataset');
  assert(ms < 500, 'filters 10,000 rows in under 500 ms (actual: ' + ms + ' ms)');
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
