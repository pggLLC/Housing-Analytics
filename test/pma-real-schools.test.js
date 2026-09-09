// test/pma-real-schools.test.js
//
// Guard: the PMA schools dimension must run on real data, and must not invent
// a performance score it does not have.
//
// Two failures were live before #1541's fix, and they compounded:
//
//   1. js/data-service-portable.js fetched an ArcGIS layer that had been
//      removed — the host answers with 527 services, none school-related — and
//      swallowed the failure in a .catch returning empty arrays. Every PMA run
//      scored the schools dimension on nothing while pma-justification.js
//      still cited "ED Attendance Boundaries + NCES" as a source of the run.
//
//   2. PERFORMANCE_UNKNOWN = 50 stood in wherever a performance measure was
//      missing. Wiring in real school locations would have made that constant
//      reachable for the first time — and NCES CCD School Locations carries no
//      performance measure at all, so every run would have reported a
//      confident "average performance score: 50/100" that was measured from
//      nothing. See AGENTS.md, "An unmeasurable quantity is null, never 0",
//      and #1480 for the class.
//
// The second is why this test spends most of its assertions on absence.
//
// Run: node test/pma-real-schools.test.js

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const GEOJSON = path.join(ROOT, 'data/market/schools_co.geojson');
let failures = 0;
const check = (fn, msg) => {
  try { fn(); console.log('  ✅ ' + msg); }
  catch (e) { failures++; console.error('  ❌ ' + msg + '\n     ' + e.message); }
};

console.log('\n[test] PMA schools run on real NCES data');

// ── The data itself is real and present ───────────────────────────────────
const gj = JSON.parse(fs.readFileSync(GEOJSON, 'utf8'));
check(() => assert.ok(gj.features.length > 1500,
  `expected >1500 schools, got ${gj.features.length}`),
  `data/market/schools_co.geojson carries ${gj.features.length} real schools`);
check(() => assert.match(String(gj.meta && gj.meta.source), /NCES/i),
  'the file declares its NCES provenance');

// ── The dead endpoint is gone ─────────────────────────────────────────────
const dsSrc = fs.readFileSync(path.join(ROOT, 'js/data-service-portable.js'), 'utf8');
check(() => assert.ok(!/Public_School_Location_201819/.test(dsSrc)),
  'the removed ArcGIS school layer is no longer fetched');
check(() => assert.ok(/schools_co\.geojson/.test(dsSrc)),
  'the data service loads the committed NCES file instead');

// ── It actually returns schools for a real Colorado bbox ──────────────────
const dom = new JSDOM('<!doctype html><html><body></body></html>',
  { runScripts: 'outside-only', url: 'http://127.0.0.1/market-analysis.html' });
dom.window.APP_CONFIG = {};
dom.window.safeFetchJSON = (p) => {
  const f = path.join(ROOT, String(p).split(/[?#]/)[0]);
  return fs.promises.readFile(f, 'utf8').then(JSON.parse);
};
dom.window.eval(dsSrc);

const DENVER = { minLat: 39.60, maxLat: 39.80, minLon: -105.10, maxLon: -104.80 };

dom.window.DataService.fetchSchoolBoundaries(DENVER).then((res) => {
  check(() => assert.ok(res.schools.length > 50,
    `expected >50 schools in the Denver bbox, got ${res.schools.length}`),
    `a real Denver bbox returns ${res.schools.length} schools`);
  check(() => assert.ok(res.schools.every(s =>
      s.lat >= DENVER.minLat && s.lat <= DENVER.maxLat &&
      s.lon >= DENVER.minLon && s.lon <= DENVER.maxLon)),
    'every returned school actually falls inside the bounding box');
  check(() => assert.ok(res.schools.some(s => s.name && s.ncesId)),
    'schools carry a real name and NCES id, not placeholders');

  // The honest-absence half.
  check(() => assert.ok(res.schools.every(s => s.performanceScore === null)),
    'no school arrives with an invented performance score');
  // Length, not deepStrictEqual: the array comes from the jsdom realm, so its
  // prototype differs and deepStrictEqual fails on identity, not contents.
  check(() => assert.strictEqual(res.schoolDistricts.length, 0),
    'schoolDistricts is empty — these are points, not attendance boundaries');

  // ── Downstream must not fabricate either ───────────────────────────────
  const S = require(path.join(ROOT, 'js/pma-schools.js'));
  const polygon = { type: 'Polygon', coordinates: [[
    [-105.05, 39.65], [-104.85, 39.65], [-104.85, 39.78], [-105.05, 39.78], [-105.05, 39.65]
  ]] };
  const aligned = S.alignPMAWithSchools(polygon, res.schools);

  check(() => assert.ok(aligned.districtCount > 0,
    `expected schools to align, got ${aligned.districtCount}`),
    `alignment finds ${aligned.districtCount} schools near the PMA`);
  check(() => assert.strictEqual(aligned.averagePerformanceScore, null,
    'average performance must be null when nothing measured it'),
    'averagePerformanceScore is null, not 50');
  check(() => assert.ok(/not scored/i.test(aligned.alignmentRationale)),
    'the rationale says performance is not scored, rather than printing a number');
  check(() => assert.ok(!/\b50\/100\b/.test(aligned.alignmentRationale)),
    'the rationale never states a 50/100 average');

  const j = S.getSchoolJustification();
  check(() => assert.strictEqual(j.averagePerformanceScore, null),
    'the audit-trail record carries null performance');
  check(() => assert.ok(String(j.performanceUnavailableReason).length > 20),
    'and carries the reason it is absent, per the house unavailableReason pattern');

  // Proximity still scores — absence of performance must not zero the dimension.
  const score = S.scoreSchoolAccessibility(39.70, -104.95, res.schools);
  check(() => assert.ok(score !== null && score > 0,
    `expected a proximity score, got ${score}`),
    `accessibility still scores on proximity alone (${score})`);
  check(() => assert.strictEqual(j.accessibilityScore !== undefined, true),
    'accessibilityScore is reported');

  // ── The citation must describe what is actually loaded ─────────────────
  const just = fs.readFileSync(path.join(ROOT, 'js/pma-justification.js'), 'utf8');
  check(() => assert.ok(!/ED Attendance Boundaries/.test(just)),
    'the run no longer cites attendance boundaries it cannot fetch');
  check(() => assert.ok(/NCES CCD School Locations/.test(just)),
    'it cites the source it actually reads');

  if (failures) {
    console.error(`\n[test] PMA real schools: ${failures} FAILED`);
    process.exit(1);
  }
  console.log('[test] PMA real schools: PASS');
}).catch((e) => { console.error(e); process.exit(1); });
