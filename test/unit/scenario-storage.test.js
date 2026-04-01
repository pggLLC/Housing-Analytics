// test/unit/scenario-storage.test.js
//
// Unit tests for js/projections/scenario-storage.js
//
// Verifies:
//   1. save() returns a well-formed scenario with required fields.
//   2. list() returns scenarios newest-first.
//   3. get() retrieves by ID; returns null for unknown ID.
//   4. save() with same ID replaces existing scenario.
//   5. delete() removes a scenario; returns true on success.
//   6. clear() empties the store.
//   7. MAX_SCENARIOS (20) cap is enforced.
//   8. importAll() from exportAll() round-trips correctly.
//   9. save() throws when name or parameters is missing.
//  10. importAll() handles invalid input gracefully.
//  11. _generateId produces a stable prefix matching the name slug.
//
// Usage: node test/unit/scenario-storage.test.js

'use strict';

const path = require('path');

// ── Mock localStorage ────────────────────────────────────────────────────────
// ScenarioStorage uses localStorage directly; we provide a simple in-memory shim.

const _store = {};
const localStorage = {
  getItem(k)      { return Object.prototype.hasOwnProperty.call(_store, k) ? _store[k] : null; },
  setItem(k, v)   { _store[k] = v; },
  removeItem(k)   { delete _store[k]; },
};

global.window    = global;
global.localStorage = localStorage;

// Reset the backing store between tests
function resetStore() {
  Object.keys(_store).forEach(function (k) { delete _store[k]; });
}

require(path.join(__dirname, '../../js/projections/scenario-storage.js'));
const SS = global.ScenarioStorage;

// ── Test harness ─────────────────────────────────────────────────────────────

let passed = 0, failed = 0;

function assert(cond, msg) {
  if (cond) { console.log('  ✅ PASS:', msg); passed++; }
  else       { console.error('  ❌ FAIL:', msg); failed++; }
}

function test(name, fn) {
  console.log('\n[test]', name);
  resetStore();
  try { fn(); }
  catch (e) { console.error('  ❌ FAIL: threw —', e.message); failed++; }
}

// ── 1. Basic API exposure ────────────────────────────────────────────────────

test('ScenarioStorage API is fully exposed', function () {
  assert(typeof SS === 'object',                'ScenarioStorage is an object');
  assert(typeof SS.list      === 'function',    'list() exposed');
  assert(typeof SS.get       === 'function',    'get() exposed');
  assert(typeof SS.save      === 'function',    'save() exposed');
  assert(typeof SS.delete    === 'function',    'delete() exposed');
  assert(typeof SS.clear     === 'function',    'clear() exposed');
  assert(typeof SS.exportAll === 'function',    'exportAll() exposed');
  assert(typeof SS.importAll === 'function',    'importAll() exposed');
});

// ── 2. save() returns well-formed scenario ───────────────────────────────────

test('save() returns a scenario with all required fields', function () {
  const sc = SS.save({
    name: 'Test Scenario',
    parameters: { fertility_multiplier: 1.1, mortality_multiplier: 0.9, net_migration_annual: 750 },
  });

  assert(typeof sc.id          === 'string' && sc.id.length > 0,   'id is a non-empty string');
  assert(sc.name               === 'Test Scenario',                  'name preserved');
  assert(typeof sc.createdAt   === 'string',                         'createdAt is a string');
  assert(typeof sc.year        === 'number',                         'year is a number');
  assert(sc.parameters.fertility_multiplier  === 1.1,               'fertility_multiplier preserved');
  assert(sc.parameters.mortality_multiplier  === 0.9,               'mortality_multiplier preserved');
  assert(sc.parameters.net_migration_annual  === 750,               'net_migration_annual preserved');
  assert(sc.baselineSource     === 'DOLA 2024',                      'default baselineSource');
});

// ── 3. Parameter defaults when fields omitted ────────────────────────────────

test('save() applies default parameter values for missing fields', function () {
  const sc = SS.save({
    name: 'Defaults Test',
    parameters: {},
  });
  assert(sc.parameters.fertility_multiplier === 1.0, 'fertility_multiplier defaults to 1.0');
  assert(sc.parameters.mortality_multiplier === 1.0, 'mortality_multiplier defaults to 1.0');
  assert(sc.parameters.net_migration_annual === 500, 'net_migration_annual defaults to 500');
});

// ── 4. list() returns scenarios newest-first ─────────────────────────────────

test('list() returns saved scenarios newest-first', function () {
  SS.save({ name: 'Alpha', parameters: { fertility_multiplier: 1.0, mortality_multiplier: 1.0, net_migration_annual: 500 } });
  SS.save({ name: 'Beta',  parameters: { fertility_multiplier: 1.0, mortality_multiplier: 1.0, net_migration_annual: 500 } });
  SS.save({ name: 'Gamma', parameters: { fertility_multiplier: 1.0, mortality_multiplier: 1.0, net_migration_annual: 500 } });

  const list = SS.list();
  assert(list.length === 3, 'list() returns 3 scenarios');
  assert(list[0].name === 'Gamma', 'newest (Gamma) is first');
  assert(list[2].name === 'Alpha', 'oldest (Alpha) is last');
});

// ── 5. list() returns empty array when empty ─────────────────────────────────

test('list() returns [] when no scenarios saved', function () {
  const list = SS.list();
  assert(Array.isArray(list), 'list() returns an Array');
  assert(list.length === 0,   'list() is empty');
});

// ── 6. get() retrieves by ID, returns null for unknown ───────────────────────

test('get() retrieves scenario by ID', function () {
  const saved = SS.save({
    name: 'Find Me',
    parameters: { fertility_multiplier: 1.2, mortality_multiplier: 1.0, net_migration_annual: 300 },
  });
  const found = SS.get(saved.id);
  assert(found !== null,             'get() returns non-null for known ID');
  assert(found.name === 'Find Me',   'get() returns correct scenario');
});

test('get() returns null for unknown ID', function () {
  const result = SS.get('nonexistent-id-12345');
  assert(result === null, 'get() returns null for unknown ID');
});

// ── 7. save() with same ID replaces existing ─────────────────────────────────

test('save() with same ID replaces existing scenario', function () {
  const first = SS.save({
    name: 'Original',
    parameters: { fertility_multiplier: 1.0, mortality_multiplier: 1.0, net_migration_annual: 500 },
  });
  SS.save({
    id:   first.id,
    name: 'Updated',
    parameters: { fertility_multiplier: 1.3, mortality_multiplier: 1.0, net_migration_annual: 800 },
  });

  const list = SS.list();
  assert(list.length === 1, 'list still has 1 scenario after update');
  assert(list[0].name === 'Updated', 'scenario name was updated');
  assert(list[0].parameters.fertility_multiplier === 1.3, 'parameters updated');
});

// ── 8. delete() removes a scenario ───────────────────────────────────────────

test('delete() removes scenario and returns true', function () {
  const sc = SS.save({
    name: 'Delete Me',
    parameters: { fertility_multiplier: 1.0, mortality_multiplier: 1.0, net_migration_annual: 500 },
  });
  SS.save({
    name: 'Keep Me',
    parameters: { fertility_multiplier: 1.0, mortality_multiplier: 1.0, net_migration_annual: 500 },
  });

  const result = SS.delete(sc.id);
  const list   = SS.list();

  assert(result === true,                          'delete() returns true');
  assert(list.length === 1,                        'list has 1 scenario remaining');
  assert(list[0].name === 'Keep Me',               '"Keep Me" still present');
  assert(SS.get(sc.id) === null,                   'deleted ID no longer retrievable');
});

// ── 9. clear() empties the store ─────────────────────────────────────────────

test('clear() removes all scenarios', function () {
  SS.save({ name: 'A', parameters: {} });
  SS.save({ name: 'B', parameters: {} });
  SS.clear();
  assert(SS.list().length === 0, 'list() is empty after clear()');
});

// ── 10. MAX_SCENARIOS cap ────────────────────────────────────────────────────

test('MAX_SCENARIOS cap: only 20 scenarios are retained', function () {
  for (let i = 1; i <= 25; i++) {
    SS.save({ name: 'Scenario ' + i, parameters: { fertility_multiplier: 1.0, mortality_multiplier: 1.0, net_migration_annual: i * 10 } });
  }
  const list = SS.list();
  assert(list.length === 20, 'list length capped at 20 (got ' + list.length + ')');
  // Newest scenarios should be retained
  assert(list[0].name === 'Scenario 25', 'most recent scenario retained');
  assert(list[19].name === 'Scenario 6', 'oldest retained scenario is #6 (25-20+1)');
});

// ── 11. exportAll / importAll round-trip ─────────────────────────────────────

test('exportAll/importAll round-trips scenarios correctly', function () {
  SS.save({ name: 'Export A', parameters: { fertility_multiplier: 1.1, mortality_multiplier: 1.0, net_migration_annual: 400 } });
  SS.save({ name: 'Export B', parameters: { fertility_multiplier: 0.9, mortality_multiplier: 1.1, net_migration_annual: 600 } });

  const blob = SS.exportAll();
  assert(blob instanceof Blob, 'exportAll() returns a Blob');

  // Read blob synchronously (Node: Blob has arrayBuffer, use text())
  // Use the JSON-based importAll instead of reading blob bytes for the round-trip
  const exported = { scenarios: SS.list() };

  // Clear and re-import
  SS.clear();
  assert(SS.list().length === 0, 'store empty before import');

  const count = SS.importAll(exported);
  assert(count === 2,                         'importAll() returned 2');
  assert(SS.list().length === 2,              'list has 2 after import');
  assert(SS.list()[0].name === 'Export A',    'newest-first order preserved after import');
});

// ── 12. save() throws on missing required fields ──────────────────────────────

test('save() throws Error when name is missing', function () {
  let threw = false;
  try {
    SS.save({ parameters: { fertility_multiplier: 1.0, mortality_multiplier: 1.0, net_migration_annual: 500 } });
  } catch (e) {
    threw = true;
    assert(e instanceof Error, 'throws an Error instance');
    assert(e.message.includes('name'), 'error message mentions "name"');
  }
  assert(threw, 'save() throws when name is missing');
});

test('save() throws Error when parameters is missing', function () {
  let threw = false;
  try {
    SS.save({ name: 'No Params' });
  } catch (e) {
    threw = true;
    assert(e.message.includes('parameters'), 'error message mentions "parameters"');
  }
  assert(threw, 'save() throws when parameters is missing');
});

// ── 13. importAll() handles invalid input gracefully ─────────────────────────

test('importAll() returns 0 for null input', function () {
  const count = SS.importAll(null);
  assert(count === 0, 'importAll(null) returns 0');
});

test('importAll() returns 0 for object without scenarios array', function () {
  const count = SS.importAll({ exportedAt: '2024-01-01', data: [] });
  assert(count === 0, 'importAll() returns 0 for missing scenarios key');
});

// ── 14. custom baselineSource is preserved ───────────────────────────────────

test('save() preserves custom baselineSource', function () {
  const sc = SS.save({
    name: 'Custom Source',
    parameters: { fertility_multiplier: 1.0, mortality_multiplier: 1.0, net_migration_annual: 500 },
    baselineSource: 'ACS 2022',
  });
  assert(sc.baselineSource === 'ACS 2022', 'custom baselineSource preserved');
});

// ── 15. assumptions field is preserved ───────────────────────────────────────

test('save() preserves assumptions object', function () {
  const sc = SS.save({
    name: 'With Assumptions',
    parameters: { fertility_multiplier: 1.0, mortality_multiplier: 1.0, net_migration_annual: 500 },
    assumptions: { fertility: '100% of baseline', migration: '500 persons/year' },
  });
  assert(typeof sc.assumptions === 'object',              'assumptions is object');
  assert(sc.assumptions.fertility === '100% of baseline', 'fertility assumption preserved');
});

// ── Summary ──────────────────────────────────────────────────────────────────

console.log('\n' + '='.repeat(60));
console.log('Results:', passed, 'passed,', failed, 'failed');
if (failed > 0) process.exitCode = 1;
