// test/chfa-pma-checklist.test.js
//
// Unit tests for js/chfa-pma-checklist.js
//
// Shims browser APIs (window, document, localStorage) so tests run in Node.js.
//
// Usage:
//   node test/chfa-pma-checklist.test.js
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

// ── Browser shims ─────────────────────────────────────────────────────────────

function makeLocalStorage() {
  const store = {};
  return {
    getItem:    (k)    => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
    setItem:    (k, v) => { store[k] = String(v); },
    removeItem: (k)    => { delete store[k]; },
    clear:      ()     => { Object.keys(store).forEach(k => delete store[k]); },
    _store:     store,
  };
}

// Minimal DOM element shim
function makeCheckbox(id, checked = false) {
  return {
    id,
    type:     'checkbox',
    checked,
    closest:  () => null,
    classList: { toggle: () => {}, add: () => {}, remove: () => {} },
    addEventListener: () => {},
  };
}

// Minimal document shim — getElementById returns null by default
const domElements = {};
const document = {
  getElementById:    (id)  => domElements[id] || null,
  querySelectorAll:  ()    => ({ forEach: () => {} }),
  addEventListener:  ()    => {},
  readyState:        'complete',
};

const window = { addEventListener: () => {} };

// Make globals available before loading the module
global.window     = window;
global.document   = document;
global.localStorage = makeLocalStorage();

// ── Load module ───────────────────────────────────────────────────────────────

// The module IIFE captures _activeGeoType/_activeGeoid in a closure that
// persists across all tests in this file. Tests that depend on the active
// geography must call initChfaChecklist explicitly to set it.
const CHFA = require(path.join(ROOT, 'js', 'chfa-pma-checklist.js'));

// ── Helper: reset localStorage between tests ──────────────────────────────────

function resetStorage() {
  global.localStorage.clear();
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test('module loads and exports all public functions', () => {
  assert(typeof CHFA.initChfaChecklist       === 'function', 'initChfaChecklist is a function');
  assert(typeof CHFA.saveChfaState           === 'function', 'saveChfaState is a function');
  assert(typeof CHFA.getChfaState            === 'function', 'getChfaState is a function');
  assert(typeof CHFA.isChfaChecklistComplete === 'function', 'isChfaChecklistComplete is a function');
  assert(typeof CHFA.updateProgress          === 'function', 'updateProgress is a function');
});

test('ITEM_IDS has all 8 required items', () => {
  const ids = CHFA._ITEM_IDS;
  assert(Array.isArray(ids),                'ITEM_IDS is an array');
  assert(ids.length === 8,                  'has exactly 8 items');
  assert(ids.indexOf('tracts')      >= 0,   'tracts present');
  assert(ids.indexOf('analyst')     >= 0,   'analyst present');
  assert(ids.indexOf('approval')    >= 0,   'approval present');
  assert(ids.indexOf('demand')      >= 0,   'demand present');
  assert(ids.indexOf('capture')     >= 0,   'capture present');
  assert(ids.indexOf('competitive') >= 0,   'competitive present');
  assert(ids.indexOf('rents')       >= 0,   'rents present');
  assert(ids.indexOf('absorption')  >= 0,   'absorption present');
});

// ── storageKey ────────────────────────────────────────────────────────────────

test('storageKey: builds namespaced key', () => {
  const key = CHFA._storageKey('county', '08031');
  assert(key.startsWith('hna_chfa_'), 'uses hna_chfa_ prefix');
  assert(key.includes('county'),      'includes geoType');
  assert(key.includes('08031'),       'includes geoid');
});

test('storageKey: always includes both geoType and geoid', () => {
  const key = CHFA._storageKey('county', '08031');
  assert(key === 'hna_chfa_county_08031', 'key is hna_chfa_county_08031');
});

test('storageKey: different geographies produce different keys', () => {
  const k1 = CHFA._storageKey('county', '08031');
  const k2 = CHFA._storageKey('county', '08001');
  const k3 = CHFA._storageKey('municipality', '0820000');
  assert(k1 !== k2, 'different geoids produce different keys');
  assert(k1 !== k3, 'different geoTypes produce different keys');
});

test('storageKey: defaults geoType to county when falsy', () => {
  const key = CHFA._storageKey(null, '08031');
  assert(key.includes('county'), 'defaults to county for null geoType');
});

test('storageKey: handles empty geoid', () => {
  const key = CHFA._storageKey('county', '');
  assert(key === 'hna_chfa_county_', 'empty geoid produces trailing underscore');
});

// ── initChfaChecklist ─────────────────────────────────────────────────────────

test('initChfaChecklist: returns default state for new geography', () => {
  resetStorage();
  const state = CHFA.initChfaChecklist('county', '08031');
  assert(state !== null,             'returns non-null state');
  assert(state.geoType === 'county', 'geoType is county');
  assert(state.geoid === '08031',    'geoid is 08031');
  assert(typeof state.items === 'object', 'items is an object');
  CHFA._ITEM_IDS.forEach(id => {
    assert(id in state.items,         `${id} present in items`);
    assert(state.items[id] === false, `${id} starts unchecked (false)`);
  });
});

test('initChfaChecklist: loads persisted state from localStorage', () => {
  resetStorage();
  const key   = CHFA._storageKey('county', '08013');
  const saved = {
    geoType: 'county',
    geoid:   '08013',
    items: {
      tracts:      true,
      analyst:     false,
      approval:    false,
      demand:      false,
      capture:     false,
      competitive: false,
      rents:       false,
      absorption:  false,
    },
  };
  global.localStorage.setItem(key, JSON.stringify(saved));

  const state = CHFA.initChfaChecklist('county', '08013');
  assert(state.items.tracts   === true,  'loads persisted checked=true for tracts');
  assert(state.items.analyst  === false, 'loads persisted checked=false for analyst');
});

test('initChfaChecklist: back-fills missing items from partial saved state', () => {
  resetStorage();
  const key = CHFA._storageKey('county', '08001');
  // Simulate old state with only some items
  const partial = {
    geoType: 'county',
    geoid:   '08001',
    items: { tracts: true },
  };
  global.localStorage.setItem(key, JSON.stringify(partial));

  const state = CHFA.initChfaChecklist('county', '08001');
  CHFA._ITEM_IDS.forEach(id => {
    assert(id in state.items, `${id} back-filled from partial state`);
  });
  assert(state.items.tracts === true, 'existing tracts=true preserved');
});

test('initChfaChecklist: updates active geography tracking', () => {
  resetStorage();
  CHFA.initChfaChecklist('county', '08031');
  assert(CHFA._getActiveGeoType() === 'county', 'active geoType set to county');
  assert(CHFA._getActiveGeoid()   === '08031',  'active geoid set to 08031');
});

test('initChfaChecklist: switches active geography correctly', () => {
  resetStorage();
  CHFA.initChfaChecklist('county', '08031');
  CHFA.initChfaChecklist('county', '08013');
  assert(CHFA._getActiveGeoType() === 'county', 'geoType updated to county');
  assert(CHFA._getActiveGeoid()   === '08013',  'geoid updated to 08013');
});

test('initChfaChecklist: handles null/undefined gracefully', () => {
  resetStorage();
  const state = CHFA.initChfaChecklist(null, null);
  assert(state !== null,          'does not throw for null inputs');
  assert(typeof state === 'object', 'returns an object');
  assert(state.geoType === 'county', 'defaults geoType to county');
});

// ── saveChfaState / getChfaState ──────────────────────────────────────────────

test('getChfaState: returns null when no state saved', () => {
  resetStorage();
  const state = CHFA.getChfaState('county', '08099');
  assert(state === null, 'returns null for unsaved geography');
});

test('getChfaState: returns null for corrupted JSON', () => {
  resetStorage();
  const key = CHFA._storageKey('county', '08031');
  global.localStorage.setItem(key, 'INVALID_JSON{{{');
  const state = CHFA.getChfaState('county', '08031');
  assert(state === null, 'returns null for corrupted JSON');
});

test('saveChfaState: no-op when both geoType and geoid are falsy', () => {
  resetStorage();
  // Should not throw and should write nothing
  CHFA.saveChfaState('', '');
  const keys = Object.keys(global.localStorage._store);
  assert(keys.length === 0, 'nothing written to localStorage for empty geo');
});

// ── isChfaChecklistComplete ───────────────────────────────────────────────────

test('isChfaChecklistComplete: returns false when no state saved', () => {
  resetStorage();
  assert(CHFA.isChfaChecklistComplete('county', '08099') === false,
    'returns false for unsaved geography');
});

test('isChfaChecklistComplete: returns false when not all items checked', () => {
  resetStorage();
  const key = CHFA._storageKey('county', '08031');
  const items = {};
  CHFA._ITEM_IDS.forEach(id => { items[id] = false; });
  items.tracts = true; // only one checked
  global.localStorage.setItem(key, JSON.stringify({ geoType: 'county', geoid: '08031', items }));
  assert(CHFA.isChfaChecklistComplete('county', '08031') === false,
    'returns false when only some items checked');
});

test('isChfaChecklistComplete: returns true when all items checked', () => {
  resetStorage();
  const key = CHFA._storageKey('county', '08031');
  const items = {};
  CHFA._ITEM_IDS.forEach(id => { items[id] = true; });
  global.localStorage.setItem(key, JSON.stringify({ geoType: 'county', geoid: '08031', items }));
  assert(CHFA.isChfaChecklistComplete('county', '08031') === true,
    'returns true when all items checked');
});

// ── State isolation ───────────────────────────────────────────────────────────

test('different geographies have isolated state', () => {
  resetStorage();
  const k1 = CHFA._storageKey('county', '08031');
  const k2 = CHFA._storageKey('county', '08001');
  assert(k1 !== k2, 'keys are different for different geoids');

  // Save state for first geography
  const items1 = {};
  CHFA._ITEM_IDS.forEach(id => { items1[id] = false; });
  items1.tracts = true;
  global.localStorage.setItem(k1, JSON.stringify({ geoType: 'county', geoid: '08031', items: items1 }));

  // Save state for second geography (all false)
  const items2 = {};
  CHFA._ITEM_IDS.forEach(id => { items2[id] = false; });
  global.localStorage.setItem(k2, JSON.stringify({ geoType: 'county', geoid: '08001', items: items2 }));

  const state1 = CHFA.getChfaState('county', '08031');
  const state2 = CHFA.getChfaState('county', '08001');
  assert(state1.items.tracts === true,  'county 08031 has tracts=true');
  assert(state2.items.tracts === false, 'county 08001 has tracts=false (isolated)');
});

// ── ITEM_LABELS ───────────────────────────────────────────────────────────────

test('ITEM_LABELS has a label for every item ID', () => {
  CHFA._ITEM_IDS.forEach(id => {
    assert(typeof CHFA._ITEM_LABELS[id] === 'string', `${id} has a label`);
    assert(CHFA._ITEM_LABELS[id].length > 0,          `${id} label is non-empty`);
  });
});

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n${'='.repeat(60)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed === 0) {
  console.log('\nAll checks passed ✅');
} else {
  console.log('\nSome checks failed. Review the output above for details.');
  process.exit(1);
}
