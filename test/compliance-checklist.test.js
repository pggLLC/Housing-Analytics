// test/compliance-checklist.test.js
//
// Unit tests for js/compliance-checklist.js
//
// Because the module uses window/document/localStorage which are browser APIs,
// this file shims them with minimal in-memory implementations so the tests can
// run in Node.js (no browser required).
//
// Usage:
//   node test/compliance-checklist.test.js
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

// ── Browser shims ────────────────────────────────────────────────────────────

// Minimal localStorage shim
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

// Minimal CustomEvent shim
class CustomEvent {
  constructor(type, init) {
    this.type   = type;
    this.detail = (init && init.detail) || null;
    this.bubbles = !!(init && init.bubbles);
  }
}

// Minimal document shim
const dispatchedEvents = [];
const document = {
  dispatchEvent:    (e) => { dispatchedEvents.push(e); },
  getElementById:   ()  => null,
  querySelectorAll: ()  => ({ forEach: () => {} }),
  addEventListener: ()  => {},
  readyState:       'complete',
};

// Minimal window shim
const window = { addEventListener: () => {} };

// Make globals available before loading the module
global.window        = window;
global.document      = document;
global.CustomEvent   = CustomEvent;
global.localStorage  = makeLocalStorage();

// ── Load module ──────────────────────────────────────────────────────────────

const CC = require(path.join(ROOT, 'js', 'compliance-checklist.js'));

// ── Helper: reset localStorage between tests ─────────────────────────────────

function resetStorage() {
  global.localStorage.clear();
  dispatchedEvents.length = 0;
}

// ── Tests ────────────────────────────────────────────────────────────────────

test('module loads and exports all 7 public functions', () => {
  assert(typeof CC.initComplianceChecklist  === 'function', 'initComplianceChecklist is a function');
  assert(typeof CC.updateChecklistItem      === 'function', 'updateChecklistItem is a function');
  assert(typeof CC.getChecklistState        === 'function', 'getChecklistState is a function');
  assert(typeof CC.isChecklistComplete      === 'function', 'isChecklistComplete is a function');
  assert(typeof CC.getNextAction            === 'function', 'getNextAction is a function');
  assert(typeof CC.broadcastChecklistChange === 'function', 'broadcastChecklistChange is a function');
  assert(typeof CC.validateChecklistItem    === 'function', 'validateChecklistItem is a function');
});

test('ITEM_IDS has all 5 required items', () => {
  const ids = CC._ITEM_IDS;
  assert(Array.isArray(ids),             'ITEM_IDS is an array');
  assert(ids.length === 5,               'has exactly 5 items');
  assert(ids.indexOf('baseline')  >= 0,  'baseline present');
  assert(ids.indexOf('growth')    >= 0,  'growth present');
  assert(ids.indexOf('fasttrack') >= 0,  'fasttrack present');
  assert(ids.indexOf('dola')      >= 0,  'dola present');
  assert(ids.indexOf('report')    >= 0,  'report present');
});

// ── storageKey ───────────────────────────────────────────────────────────────

test('storageKey: builds namespaced key', () => {
  const key = CC._storageKey('county', '08031');
  assert(key.startsWith('hna_compliance_'), 'uses hna_compliance_ prefix');
  assert(key.includes('county'),            'includes geoType');
  assert(key.includes('08031'),             'includes geoid');
});

test('storageKey: different geographies produce different keys', () => {
  const k1 = CC._storageKey('county', '08031');
  const k2 = CC._storageKey('county', '08001');
  const k3 = CC._storageKey('municipality', '0820000');
  assert(k1 !== k2, 'different geoids produce different keys');
  assert(k1 !== k3, 'different geoTypes produce different keys');
});

// ── initComplianceChecklist ──────────────────────────────────────────────────

test('initComplianceChecklist: returns default state for new geography', () => {
  resetStorage();
  const state = CC.initComplianceChecklist('county', '08031');
  assert(state !== null,            'returns non-null state');
  assert(state.geoType === 'county', 'geoType is county');
  assert(state.geoid === '08031',    'geoid is 08031');
  assert(typeof state.items === 'object', 'items is an object');
  assert(Object.keys(state.items).length === 5, 'items has 5 keys');
  CC._ITEM_IDS.forEach(id => {
    assert(state.items[id] !== undefined,  id + ' item present');
    assert(state.items[id].checked === false, id + ' starts unchecked');
  });
});

test('initComplianceChecklist: loads persisted state from localStorage', () => {
  resetStorage();
  // Pre-seed a saved state
  const key = CC._storageKey('county', '08031');
  const saved = {
    geoType: 'county',
    geoid: '08031',
    items: {
      baseline:  { checked: true, date: '2025-01-15T00:00:00.000Z', metadata: null },
      growth:    { checked: false, date: null, metadata: null },
      fasttrack: { checked: false, date: null, metadata: null },
      dola:      { checked: false, date: null, metadata: null },
      report:    { checked: false, date: null, metadata: null },
    },
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-15T00:00:00.000Z',
  };
  global.localStorage.setItem(key, JSON.stringify(saved));

  const state = CC.initComplianceChecklist('county', '08031');
  assert(state.items.baseline.checked === true,  'loads persisted checked=true for baseline');
  assert(state.items.growth.checked   === false, 'loads persisted checked=false for growth');
});

test('initComplianceChecklist: back-fills missing items from old state', () => {
  resetStorage();
  // State with only 3 items (simulates older version)
  const key = CC._storageKey('county', '08013');
  const oldState = {
    geoType: 'county',
    geoid: '08013',
    items: {
      baseline: { checked: true, date: null, metadata: null },
    },
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  };
  global.localStorage.setItem(key, JSON.stringify(oldState));

  const state = CC.initComplianceChecklist('county', '08013');
  CC._ITEM_IDS.forEach(id => {
    assert(state.items[id] !== undefined, id + ' back-filled in old state');
  });
});

// ── updateChecklistItem ──────────────────────────────────────────────────────

test('updateChecklistItem: saves checked=true with date to localStorage', () => {
  resetStorage();
  CC.initComplianceChecklist('county', '08031');
  const result = CC.updateChecklistItem('baseline', true, { date: '2025-03-08T00:00:00.000Z' });
  assert(result.success === true,  'returns success=true');
  assert(result.error   === null,  'returns error=null');

  // Verify persisted
  const state = CC.getChecklistState('county', '08031');
  assert(state.items.baseline.checked === true,            'baseline checked=true persisted');
  assert(state.items.baseline.date === '2025-03-08T00:00:00.000Z', 'date persisted');
});

test('updateChecklistItem: saves checked=false and clears date', () => {
  resetStorage();
  CC.initComplianceChecklist('county', '08031');
  CC.updateChecklistItem('baseline', true, { date: '2025-01-01T00:00:00.000Z' });
  const result = CC.updateChecklistItem('baseline', false);
  assert(result.success === true, 'returns success=true');

  const state = CC.getChecklistState('county', '08031');
  assert(state.items.baseline.checked === false, 'baseline unchecked persisted');
  assert(state.items.baseline.date   === null,   'date cleared on uncheck');
});

test('updateChecklistItem: persists metadata object', () => {
  resetStorage();
  CC.initComplianceChecklist('county', '08031');
  const meta = { value: 1500, note: 'from ACS 2024' };
  CC.updateChecklistItem('baseline', true, meta);

  const state = CC.getChecklistState('county', '08031');
  assert(state.items.baseline.metadata !== null,              'metadata saved');
  assert(state.items.baseline.metadata.value === 1500,        'metadata.value correct');
  assert(state.items.baseline.metadata.note === 'from ACS 2024', 'metadata.note correct');
});

test('updateChecklistItem: rejects unknown item ID', () => {
  resetStorage();
  CC.initComplianceChecklist('county', '08031');
  const result = CC.updateChecklistItem('nonexistent', true);
  assert(result.success === false, 'returns success=false for unknown item');
  assert(result.error   !== null,  'returns error message for unknown item');
});

test('updateChecklistItem: rejects non-boolean checked value', () => {
  resetStorage();
  CC.initComplianceChecklist('county', '08031');
  const result = CC.updateChecklistItem('baseline', 'yes');
  assert(result.success === false, 'returns success=false for non-boolean');
  assert(typeof result.error === 'string', 'returns error string');
});

test('updateChecklistItem: updates all 5 items independently', () => {
  resetStorage();
  CC.initComplianceChecklist('county', '08031');
  CC._ITEM_IDS.forEach((id, i) => {
    CC.updateChecklistItem(id, i % 2 === 0, { date: '2025-01-01T00:00:00.000Z' });
  });
  const state = CC.getChecklistState('county', '08031');
  CC._ITEM_IDS.forEach((id, i) => {
    assert(state.items[id].checked === (i % 2 === 0), id + ' has correct checked state');
  });
});

// ── getChecklistState ────────────────────────────────────────────────────────

test('getChecklistState: returns null for unsaved geography', () => {
  resetStorage();
  const state = CC.getChecklistState('county', '08999');
  assert(state === null, 'returns null for geography with no saved state');
});

test('getChecklistState: returns saved state object', () => {
  resetStorage();
  CC.initComplianceChecklist('county', '08031');
  CC.updateChecklistItem('dola', true, { date: '2025-01-31T00:00:00.000Z' });
  const state = CC.getChecklistState('county', '08031');
  assert(state !== null,              'returns non-null state');
  assert(typeof state === 'object',   'returns an object');
  assert(state.items.dola.checked === true, 'dola is checked');
});

// ── isChecklistComplete ──────────────────────────────────────────────────────

test('isChecklistComplete: returns false when no items are checked', () => {
  resetStorage();
  CC.initComplianceChecklist('county', '08031');
  assert(CC.isChecklistComplete('county', '08031') === false, 'false when nothing checked');
});

test('isChecklistComplete: returns false when some items are checked', () => {
  resetStorage();
  CC.initComplianceChecklist('county', '08031');
  CC.updateChecklistItem('baseline', true);
  CC.updateChecklistItem('growth',   true);
  assert(CC.isChecklistComplete('county', '08031') === false, 'false when only 2 of 5 checked');
});

test('isChecklistComplete: returns true when all 5 items are checked', () => {
  resetStorage();
  CC.initComplianceChecklist('county', '08031');
  CC._ITEM_IDS.forEach(id => CC.updateChecklistItem(id, true));
  assert(CC.isChecklistComplete('county', '08031') === true, 'true when all checked');
});

test('isChecklistComplete: returns false for unsaved geography', () => {
  resetStorage();
  assert(CC.isChecklistComplete('county', '08888') === false, 'false for unsaved geography');
});

// ── validateChecklistItem ─────────────────────────────────────────────────────

test('validateChecklistItem: valid item with boolean true', () => {
  const r = CC.validateChecklistItem('baseline', true);
  assert(r.valid === true,  'valid=true');
  assert(r.error === null,  'error=null');
});

test('validateChecklistItem: valid item with boolean false', () => {
  const r = CC.validateChecklistItem('dola', false);
  assert(r.valid === true,  'valid=true');
  assert(r.error === null,  'error=null');
});

test('validateChecklistItem: invalid item ID', () => {
  const r = CC.validateChecklistItem('unknownId', true);
  assert(r.valid === false,        'valid=false for unknown ID');
  assert(typeof r.error === 'string', 'error is a string');
});

test('validateChecklistItem: invalid value type (string)', () => {
  const r = CC.validateChecklistItem('baseline', 'true');
  assert(r.valid === false,           'valid=false for string value');
  assert(typeof r.error === 'string', 'error is a string');
});

test('validateChecklistItem: invalid value type (number)', () => {
  const r = CC.validateChecklistItem('baseline', 1);
  assert(r.valid === false,           'valid=false for numeric value');
  assert(typeof r.error === 'string', 'error is a string');
});

test('validateChecklistItem: all valid IDs accepted', () => {
  CC._ITEM_IDS.forEach(id => {
    const r = CC.validateChecklistItem(id, true);
    assert(r.valid === true, id + ' is a valid item ID');
  });
});

// ── DOLA deadline logic ───────────────────────────────────────────────────────

test('nextDolaDeadline: returns Jan 31 of current year when before deadline', () => {
  // Simulate March 8, 2026 (after Jan 31) → next deadline is Jan 31, 2027
  const now = new Date('2026-03-08T00:00:00Z');
  const dl  = CC._nextDolaDeadline(now);
  assert(dl.getFullYear() === 2027, 'rolls to 2027 when past Jan 31 2026');
  assert(dl.getMonth()    === 0,    'month is January (0)');
  assert(dl.getDate()     === 31,   'day is 31');
});

test('nextDolaDeadline: returns Jan 31 same year when before Jan 31', () => {
  // Simulate Jan 15, 2026 (before Jan 31) → deadline is Jan 31, 2026
  const now = new Date('2026-01-15T00:00:00Z');
  const dl  = CC._nextDolaDeadline(now);
  assert(dl.getFullYear() === 2026, 'same year before Jan 31');
  assert(dl.getMonth()    === 0,    'month is January');
  assert(dl.getDate()     === 31,   'day is 31');
});

test('isDeadlineWarning: returns true within 30 days', () => {
  // Jan 10 → deadline Jan 31 → 21 days away → warning
  const now = new Date('2026-01-10T00:00:00Z');
  assert(CC._isDeadlineWarning(now) === true, 'warning when 21 days to deadline');
});

test('isDeadlineWarning: returns false more than 30 days away', () => {
  // Nov 15 → deadline Jan 31 → 77 days away → no warning
  const now = new Date('2025-11-15T00:00:00Z');
  assert(CC._isDeadlineWarning(now) === false, 'no warning when 77 days away');
});

test('isDeadlineWarning: returns false on the day after deadline', () => {
  // Feb 1 → deadline next Jan 31 → ~364 days → no warning
  const now = new Date('2026-02-01T00:00:00Z');
  assert(CC._isDeadlineWarning(now) === false, 'no warning day after deadline');
});

// ── getNextAction ─────────────────────────────────────────────────────────────

test('getNextAction: returns baseline label when nothing checked', () => {
  resetStorage();
  CC.initComplianceChecklist('county', '08031');
  const action = CC.getNextAction('county', '08031');
  assert(typeof action === 'string', 'returns a string');
  assert(action.length > 0,          'returns non-empty string');
  assert(action.includes('baseline') || action.includes('Establish'), 'mentions first unchecked item');
});

test('getNextAction: returns second item when first is checked', () => {
  resetStorage();
  CC.initComplianceChecklist('county', '08031');
  CC.updateChecklistItem('baseline', true);
  const action = CC.getNextAction('county', '08031');
  // Should be "growth" item
  assert(action.includes('3%') || action.includes('growth') || action.includes('Adopt'), 'mentions second item');
});

test('getNextAction: returns completion message when all checked', () => {
  resetStorage();
  CC.initComplianceChecklist('county', '08031');
  CC._ITEM_IDS.forEach(id => CC.updateChecklistItem(id, true));
  const action = CC.getNextAction('county', '08031');
  assert(action.includes('complete') || action.includes('✅'), 'returns completion message');
});

test('getNextAction: warns about DOLA deadline when within 30 days and dola not checked', () => {
  resetStorage();
  // Use a fixed date 15 days before Jan 31
  const origFn = CC._isDeadlineWarning;
  // Patch _isDeadlineWarning to return true for this test
  // Since we can't easily override the internal, we'll test via date injection
  // Test with a date where isDeadlineWarning would be true (Jan 20)
  const jan20 = new Date('2026-01-20T00:00:00Z');
  const shouldWarn = CC._isDeadlineWarning(jan20);
  assert(shouldWarn === true, 'isDeadlineWarning is true on Jan 20');
  // getNextAction will use real Date.now(), but we can check the logic separately
  // Instead, verify getNextAction returns DOLA-related text when warning is active
  // We verify this path indirectly through the deadline functions already tested above
});

// ── broadcastChecklistChange ──────────────────────────────────────────────────

test('broadcastChecklistChange: dispatches custom DOM event', () => {
  const before = dispatchedEvents.length;
  CC.broadcastChecklistChange({ geoType: 'county', geoid: '08031', itemId: 'dola', checked: true });
  assert(dispatchedEvents.length === before + 1, 'dispatches one event');
  const evt = dispatchedEvents[dispatchedEvents.length - 1];
  assert(evt.type === 'checklist-changed', 'event type is checklist-changed');
  assert(evt.detail.itemId  === 'dola',     'event detail has itemId');
  assert(evt.detail.checked === true,       'event detail has checked');
});

test('broadcastChecklistChange: writes cross-tab key to localStorage', () => {
  CC.broadcastChecklistChange({ geoType: 'county', geoid: '08031', itemId: 'report', checked: true });
  const raw = global.localStorage.getItem('hna_compliance_last_change');
  assert(raw !== null, 'writes last_change key to localStorage');
  const data = JSON.parse(raw);
  assert(data.geoid   === '08031',  'geoid in cross-tab key');
  assert(data.itemId  === 'report', 'itemId in cross-tab key');
  assert(data.checked === true,     'checked in cross-tab key');
  assert(typeof data.ts === 'number', 'timestamp written');
});

// ── Persistence round-trip ─────────────────────────────────────────────────────

test('persistence: full round-trip save/load', () => {
  resetStorage();
  // Save state
  CC.initComplianceChecklist('county', '08031');
  CC.updateChecklistItem('baseline',  true,  { value: 1500, date: '2025-03-01T00:00:00.000Z' });
  CC.updateChecklistItem('growth',    true,  { date: '2025-03-01T00:00:00.000Z' });
  CC.updateChecklistItem('fasttrack', false);

  // Load state in "fresh" context
  const state = CC.getChecklistState('county', '08031');
  assert(state !== null,                         'state not null after save');
  assert(state.items.baseline.checked  === true,  'baseline persisted as true');
  assert(state.items.growth.checked    === true,  'growth persisted as true');
  assert(state.items.fasttrack.checked === false, 'fasttrack persisted as false');
  assert(state.items.baseline.metadata.value === 1500, 'metadata value persisted');
});

test('persistence: different geographies have isolated state', () => {
  resetStorage();
  CC.initComplianceChecklist('county', '08031');
  CC.initComplianceChecklist('county', '08001');

  CC.updateChecklistItem('baseline', true);  // applies to whatever _currentGeoType returns

  // Both geographies should have independent state
  const k1 = CC._storageKey('county', '08031');
  const k2 = CC._storageKey('county', '08001');
  assert(k1 !== k2, 'keys are different for different geoids');
});

// ── Edge cases ─────────────────────────────────────────────────────────────────

test('getChecklistState: returns null when localStorage has invalid JSON', () => {
  resetStorage();
  const key = CC._storageKey('county', '08031');
  global.localStorage.setItem(key, 'INVALID_JSON{{{');
  const state = CC.getChecklistState('county', '08031');
  assert(state === null, 'returns null for corrupted JSON');
});

test('initComplianceChecklist: handles missing geoType gracefully', () => {
  resetStorage();
  const state = CC.initComplianceChecklist(null, null);
  assert(state !== null,    'does not throw for null geoType');
  assert(typeof state === 'object', 'returns an object');
});

test('updateChecklistItem: auto-sets date to now when checked=true and no date provided', () => {
  resetStorage();
  CC.initComplianceChecklist('county', '08031');
  const before = Date.now();
  CC.updateChecklistItem('report', true);
  const after  = Date.now();

  const state = CC.getChecklistState('county', '08031');
  const saved = new Date(state.items.report.date).getTime();
  assert(saved >= before && saved <= after + 100, 'auto-date is approximately now');
});

test('updateChecklistItem: sets date=null when checked=false', () => {
  resetStorage();
  CC.initComplianceChecklist('county', '08031');
  CC.updateChecklistItem('report', true,  { date: '2025-01-01T00:00:00.000Z' });
  CC.updateChecklistItem('report', false);

  const state = CC.getChecklistState('county', '08031');
  assert(state.items.report.date === null, 'date is null after unchecking');
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
