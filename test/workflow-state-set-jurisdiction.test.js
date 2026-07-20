'use strict';
/**
 * test/workflow-state-set-jurisdiction.test.js
 *
 * Regression for 2026-05-15 fix: WorkflowState.setJurisdiction silently
 * dropped the payload when no active project existed. setStep() warned
 * "setStep called with no active project" and returned, so the
 * jurisdiction step never persisted. Every downstream page
 * (housing-needs-assessment.html, etc.) then showed the
 * "Earlier Step Incomplete — Select Jurisdiction hasn't been
 * completed yet" banner even immediately after the user picked one,
 * and the geoSelect dropdown defaulted to State of Colorado instead
 * of the county the user chose.
 *
 * What it asserts:
 *   - setJurisdiction auto-creates a project when none is active
 *   - getJurisdiction returns the canonical geo tuple plus legacy fields
 *   - completedSteps after setJurisdiction includes 'jurisdiction'
 *   - isStepComplete('jurisdiction') is true
 *   - A subsequent setStep('hsa', ...) writes to the SAME project
 *     (i.e. only one project is auto-created)
 *
 * Run: node test/workflow-state-set-jurisdiction.test.js
 */

const { JSDOM } = require('jsdom');
const dom = new JSDOM('<!DOCTYPE html><body></body>', { url: 'http://localhost/' });
global.document         = dom.window.document;
global.window           = dom.window;
global.localStorage     = dom.window.localStorage;
global.sessionStorage   = dom.window.sessionStorage;
global.HTMLElement      = dom.window.HTMLElement;
global.CustomEvent      = dom.window.CustomEvent;

// Load core first, then api (api expects core globals to exist).
require('../js/workflow-state-core.js');
require('../js/workflow-state-api.js');

const WorkflowState = window.WorkflowState;

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { console.log('  ✅ PASS:', msg); passed++; }
  else       { console.error('  ❌ FAIL:', msg); failed++; }
}
function test(name, fn) {
  console.log('\n[test]', name);
  try { fn(); } catch (e) { console.error('  ❌ FAIL: threw —', e.message); failed++; }
}

function reset() {
  try { window.localStorage.clear(); } catch (_) {}
  try { window.sessionStorage.clear(); } catch (_) {}
  // Wipe in-memory active project too
  if (WorkflowState && WorkflowState._test_reset) WorkflowState._test_reset();
  // Fallback: re-evaluating the modules is heavy; instead poke the core's
  // setActiveProject(null) via the internal accessor if exposed.
  try { window._WorkflowStateCore && window._WorkflowStateCore.setActiveProject(null); } catch (_) {}
}

test('setJurisdiction auto-creates an active project when none exists', function () {
  reset();
  const before = WorkflowState.getActiveProject();
  WorkflowState.setJurisdiction({
    geoType: 'county',
    geoid: '08001',
    name: 'Adams County',
    countyFips: '08001',
    countyName: 'Adams County',
    fips: '08001',
    type: 'county',
  });
  const after = WorkflowState.getActiveProject();
  assert(after != null, 'getActiveProject() returns a project after setJurisdiction');
  assert(after && after.jurisdiction && after.jurisdiction.fips === '08001',
    'auto-created project carries the jurisdiction fips');
  // before may be null OR may have been autocreated by bootstrap migration;
  // the load-bearing claim is that after is non-null AND fips persisted.
  void before;
});

test('getJurisdiction returns the fips and name the caller set', function () {
  reset();
  WorkflowState.setJurisdiction({
    geoType: 'county',
    geoid: '08031',
    name: 'Denver County',
    countyFips: '08031',
    countyName: 'Denver County',
    fips: '08031',
    type: 'county',
  });
  const j = WorkflowState.getJurisdiction();
  assert(j.geoType === 'county', 'geoType persists as county');
  assert(j.geoid === '08031', 'geoid persists as 08031');
  assert(j.fips === '08031', 'fips persists as 08031');
  assert(j.name === 'Denver County', 'name persists as Denver County');
  assert(j.countyFips === '08031', 'countyFips persists as 08031');
  assert(j.countyName === 'Denver County', 'countyName persists as Denver County');
  assert(typeof j.completedAt === 'string' && j.completedAt.length > 0,
    'completedAt is set to a non-empty timestamp');
});

test('setJurisdiction preserves place/CDP identity while keeping legacy fields', function () {
  reset();
  WorkflowState.setJurisdiction({
    geoType: 'cdp',
    geoid: '0800320',
    name: 'Acres Green (CDP)',
    countyFips: '08035',
    countyName: 'Douglas County',
    fips: '08035',
    type: 'city',
    displayName: 'Acres Green (CDP)',
    placeGeoid: '0800320',
  });
  const j = WorkflowState.getJurisdiction();
  assert(j.geoType === 'cdp', 'authoritative geoType preserves CDP');
  assert(j.geoid === '0800320', 'authoritative geoid preserves CDP GEOID');
  assert(j.name === 'Acres Green (CDP)', 'authoritative name is the CDP name');
  assert(j.countyFips === '08035', 'containing county FIPS persists separately');
  assert(j.countyName === 'Douglas County', 'containing county name persists separately');
  assert(j.type === 'city', 'legacy type remains populated for back-compat');
  assert(j.placeGeoid === '0800320', 'legacy placeGeoid remains populated');
});

test('setJurisdiction warns when place/CDP county context is missing', function () {
  reset();
  const originalWarn = window.console.warn;
  const warnings = [];
  window.console.warn = function () {
    warnings.push(Array.prototype.join.call(arguments, ' '));
  };
  try {
    WorkflowState.setJurisdiction({
      geoType: 'place',
      geoid: '0812345',
      name: 'Some Town',
      countyFips: null,
      countyName: null,
      fips: null,
      type: 'city',
      displayName: 'Some Town',
      placeGeoid: '0812345',
    });
  } finally {
    window.console.warn = originalWarn;
  }
  const j = WorkflowState.getJurisdiction();
  assert(j.geoType === 'place', 'place write still stores a place tuple');
  assert(j.countyFips === null, 'missing county context remains null instead of being fabricated');
  assert(warnings.some(function (msg) {
    return msg.indexOf('Missing county context') !== -1 && msg.indexOf('0812345') !== -1;
  }), 'missing place county context triggers a named console.warn');
});

test('legacy city payload coerces into canonical place tuple', function () {
  reset();
  WorkflowState.setJurisdiction({
    type: 'city',
    placeGeoid: '0812345',
    fips: '08059',
    displayName: 'Some Town',
    name: 'Boulder',
  });
  const j = WorkflowState.getJurisdiction();
  assert(j.geoType === 'place', 'legacy type=city coerces to geoType place');
  assert(j.geoid === '0812345', 'legacy placeGeoid becomes canonical geoid');
  assert(j.countyFips === '08059', 'legacy county fips becomes canonical countyFips');
  assert(j.placeGeoid === '0812345', 'legacy placeGeoid remains populated');
});

test('explicit geoType city coerces to place (not dropped to null)', function () {
  reset();
  // A caller passing geoType:'city' directly must land on canonical 'place' —
  // without the city/town coercion in _geoTypeFromLegacy this normalizes to
  // null and the tuple silently loses its geography type.
  WorkflowState.setJurisdiction({
    geoType: 'city',
    geoid: '0812345',
    name: 'Some Town',
    countyFips: '08059',
    countyName: 'Boulder',
  });
  const j = WorkflowState.getJurisdiction();
  assert(j.geoType === 'place', 'explicit geoType city coerces to canonical place');
  assert(j.geoid === '0812345', 'geoid survives coercion');
  assert(j.countyFips === '08059', 'county context survives coercion');
});

test('jurisdiction step counts as complete after setJurisdiction', function () {
  reset();
  WorkflowState.setJurisdiction({
    geoType: 'county', geoid: '08013', name: 'Boulder County',
    countyFips: '08013', countyName: 'Boulder County', fips: '08013', type: 'county',
  });
  const p = WorkflowState.getProgress();
  assert(p.completedSteps.indexOf('jurisdiction') !== -1,
    'completedSteps includes "jurisdiction"');
  assert(p.completedCount >= 1, 'completedCount >= 1');
  assert(WorkflowState.isStepComplete('jurisdiction') === true,
    'isStepComplete("jurisdiction") returns true');
});

test('only one project is auto-created; subsequent setStep writes to it', function () {
  reset();
  WorkflowState.setJurisdiction({
    geoType: 'county', geoid: '08041', name: 'El Paso County',
    countyFips: '08041', countyName: 'El Paso County', fips: '08041', type: 'county',
  });
  const pid1 = WorkflowState.getActiveProject()._meta.projectId;
  // Simulate finishing the HSA step
  WorkflowState.setStep('hsa', { completedAt: new Date().toISOString() });
  const pid2 = WorkflowState.getActiveProject()._meta.projectId;
  assert(pid1 === pid2, 'project ID is stable across setStep calls (no duplicate auto-create)');
  const p = WorkflowState.getProgress();
  assert(p.completedSteps.indexOf('jurisdiction') !== -1 &&
         p.completedSteps.indexOf('hsa') !== -1,
    'both jurisdiction and hsa steps are tracked on the same project');
});

console.log('\n=========================================');
console.log('Results: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed === 0 ? 0 : 1);
