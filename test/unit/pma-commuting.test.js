// test/unit/pma-commuting.test.js
//
// Unit tests for js/pma-commuting.js
//
// Usage: node test/unit/pma-commuting.test.js
'use strict';

const path = require('path');

// ── Minimal window shim ──
global.window = global;

require(path.join(__dirname, '../../js/pma-commuting.js'));

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { console.log('  ✅ PASS:', msg); passed++; }
  else       { console.error('  ❌ FAIL:', msg); failed++; }
}
const tests = [];
function test(name, fn) { tests.push([name, fn]); }

const C = global.PMACommuting;

test('PMACommuting exposed on window', function () {
  assert(typeof C === 'object' && C !== null, 'PMACommuting is an object');
  assert(typeof C.fetchLODESWorkplaces      === 'function', 'fetchLODESWorkplaces exported');
  assert(typeof C.analyzeCommutingFlows     === 'function', 'analyzeCommutingFlows exported');
  assert(typeof C.generateCommutingBoundary === 'function', 'generateCommutingBoundary exported');
  assert(typeof C.getJustificationData      === 'function', 'getJustificationData exported');
});

test('analyzeCommutingFlows — empty input', function () {
  const r = C.analyzeCommutingFlows([]);
  assert(r.originZones.length === 0,  'empty workplaces → 0 origin zones');
  assert(r.totalWorkers === 0,        'empty workplaces → 0 workers');
  assert(r.captureRate === null,      'empty workplaces → unavailable capture');
  assert(!!r.captureUnavailableReason, 'unavailable capture has a reason');
});

test('analyzeCommutingFlows — with workplaces', function () {
  const wps = [];
  for (let i = 0; i < 20; i++) {
    wps.push({ lat: 39.7 + i * 0.01, lon: -104.9 + i * 0.01,
               jobCount: 100 + i * 10, tractId: 'tract-' + i });
  }
  const r = C.analyzeCommutingFlows(wps);
  assert(r.originZones.length > 0,   'non-empty workplaces → origin zones');
  assert(r.totalWorkers > 0,         'totalWorkers > 0');
  assert(r.captureRate >= 0 && r.captureRate <= 1, 'captureRate in [0,1]');
});

test('generateCommutingBoundary — fallback with fewer than 3 zones', function () {
  const r = C.generateCommutingBoundary(39.7392, -104.9847, { originZones: [] });
  assert(r.boundary !== null,          'returns a boundary even for 0 zones');
  assert(r.fallback === true,          'fallback flag set');
  assert(r.boundary.type === 'Polygon','boundary is a GeoJSON Polygon');
});

test('generateCommutingBoundary — convex hull with 5+ zones', function () {
  const zones = [];
  for (let i = 0; i < 8; i++) {
    zones.push({ lat: 39.7 + i * 0.05, lon: -104.9 + i * 0.04,
                 tractId: 'z-' + i, estimatedWorkers: 200 });
  }
  const r = C.generateCommutingBoundary(39.7392, -104.9847, { originZones: zones });
  assert(r.fallback !== true,          'not a fallback when enough zones');
  assert(r.boundary.type === 'Polygon','convex hull is a GeoJSON Polygon');
  const ring = r.boundary.coordinates[0];
  assert(ring[0][0] === ring[ring.length-1][0] && ring[0][1] === ring[ring.length-1][1],
    'polygon ring is closed');
});

test('_buildCirclePolygon — produces closed GeoJSON polygon', function () {
  const poly = C._buildCirclePolygon(39.7, -104.9, 5, 16);
  assert(poly.type === 'Polygon',            'type is Polygon');
  const ring = poly.coordinates[0];
  assert(ring.length === 17,                 '16 sides + closing point = 17 coords');
  assert(ring[0][0] === ring[16][0],         'ring is closed (lon)');
  assert(ring[0][1] === ring[16][1],         'ring is closed (lat)');
});

test('fetchLODESWorkplaces — returns Promise resolving to {workplaces, commutingFlows}', function () {
  const p = C.fetchLODESWorkplaces(39.7, -104.9, 5);
  assert(typeof p.then === 'function', 'returns a Promise');
  // Resolved synchronously (no proxy configured → immediate stub)
  return p.then(function (r) {
    assert(Array.isArray(r.workplaces),      'workplaces is an Array');
    assert(Array.isArray(r.commutingFlows),  'commutingFlows is an Array');
  });
});

test('getJustificationData — shape', function () {
  const d = C.getJustificationData();
  assert(typeof d === 'object',                       'returns an object');
  assert(typeof d.lodesWorkplaces   === 'number',     'lodesWorkplaces is a number');
  assert(Array.isArray(d.residentOriginZones),        'residentOriginZones is an Array');
  assert(d.captureRate === null, 'a boundary without a measured flow result has no capture rate');
});

test('empty analysis clears a previous measured flow from boundary and audit consumers', function () {
  C.analyzeCommutingFlows([{ lat: 39.7, lon: -104.9, jobCount: 100, tractId: 'known' }]);
  assert(C.getJustificationData().captureRate === 1, 'positive denominator yields a measured capture');
  const empty = C.analyzeCommutingFlows([]);
  const boundary = C.generateCommutingBoundary(39.7, -104.9, empty);
  const audit = C.getJustificationData();
  assert(boundary.captureRate === null, 'fallback boundary does not inherit prior capture');
  assert(audit.captureRate === null, 'audit capture is unavailable after empty response');
  assert(audit.lodesWorkplaces === 0 && audit.residentOriginZones.length === 0,
    'audit clears previous workplace and origin evidence');
  assert(audit.captureUnavailableReason === empty.captureUnavailableReason,
    'audit carries the resolver reason');
});

test('zero workers is an undefined ratio, not a measured zero capture', function () {
  const r = C.analyzeCommutingFlows([{ lat: 39.7, lon: -104.9, jobCount: 0, tractId: 'empty' }]);
  assert(r.totalWorkers === 0, 'reported zero workers stays zero');
  assert(r.captureRate === null, 'zero denominator makes capture unavailable');
  assert(!!r.captureUnavailableReason, 'zero denominator has a reason');
});

test('boundary consumer preserves an explicitly measured zero capture', function () {
  const boundary = C.generateCommutingBoundary(39.7, -104.9,
    { originZones: [], totalWorkers: 100, captureRate: 0 });
  assert(boundary.captureRate === 0, 'known denominator and no captured workers preserve zero');
  assert(boundary.captureUnavailableReason === null, 'measured zero has no absence reason');
  assert(C.getJustificationData().totalWorkers === 100, 'audit retains the denominator supporting measured zero');
  const unknown = C.generateCommutingBoundary(39.7, -104.9,
    { originZones: [], totalWorkers: 0, captureRate: 0 });
  assert(unknown.captureRate === null, 'boundary consumer rejects a legacy zero with no positive denominator');
});

test('real runner propagates unmeasured capture through narrative and audit consumers', async function () {
  require(path.join(__dirname, '../../js/pma-justification.js'));
  require(path.join(__dirname, '../../js/pma-analysis-runner.js'));
  global.DataService = { fetchLODES: () => Promise.resolve({ workplaces: [] }) };
  for (const method of ['tract', 'buffer', 'commuting', 'hybrid']) {
    const run = await new Promise((resolve, reject) => {
      global.PMAAnalysisRunner.run(39.7, -104.9, { method, tractGeoids: ['08031000100'] })
        .on('complete', resolve).on('error', reject);
    });
    assert(run._analysisResults.commuting.captureRate === null, method + ': producer uses null');
    assert(run.commuting.captureRate === null, method + ': synthesized run preserves null');
    assert(run.justification.narrative.includes(run.commuting.captureUnavailableReason),
      method + ': narrative carries the producer reason');
    assert(!/\b0\s*%/.test(run.justification.narrative), method + ': no fabricated zero-percent capture');
    assert(run.pmaSupportSummary.commuteSupport === null, method + ': absence creates no commute support score');
    const exported = JSON.parse(global.PMAJustification.exportToJSON(run));
    assert(exported.commuting.captureRate === null, method + ': audit exports unavailable capture');
  }
  delete global.DataService;
});

// Await asynchronous cases too: their assertions must precede the summary.
(async () => {
  for (const [name, fn] of tests) {
    console.log('\n[test]', name);
    try { await fn(); } catch (e) { console.error('  ❌ FAIL: threw —', e.message); failed++; }
  }
  console.log('\n' + '='.repeat(50));
  console.log('Results:', passed, 'passed,', failed, 'failed');
  if (failed > 0) process.exitCode = 1;
})();
