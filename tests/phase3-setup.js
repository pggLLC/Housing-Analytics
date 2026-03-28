/**
 * tests/phase3-setup.js
 * Phase 3 Test Harness Initialization — COHO Analytics (Epic #446)
 *
 * Validates that all Phase 3 modules are loadable and expose the correct
 * public API surface before the main test suites run. Acts as a smoke-level
 * pre-check so module-not-found errors surface immediately with a clear message.
 *
 * Modules checked:
 *   - js/legislative-tracker.js        (Epic #444)
 *   - js/lihtc-deal-predictor.js       (Epic #445 base)
 *   - js/lihtc-deal-predictor-enhanced.js (Epic #445 Phase 3)
 *   - js/data-quality-monitor.js       (Epic #447)
 *   - js/data-quality-check.js         (Epic #447 batch)
 *
 * Usage:
 *   node tests/phase3-setup.js
 *
 * Exit code 0 — all checks passed.
 * Exit code 1 — one or more checks failed.
 */

'use strict';

const path = require('path');
const ROOT  = path.resolve(__dirname, '..');

let passed = 0;
let failed = 0;

/* ── Helpers ──────────────────────────────────────────────────────────────── */

function ok(cond, msg) {
  if (cond) {
    console.log('  ✅ PASS: ' + msg);
    passed++;
  } else {
    console.error('  ❌ FAIL: ' + msg);
    failed++;
  }
}

function section(title) {
  console.log('\n── ' + title + ' ──');
}

function loadModule(rel) {
  try {
    return require(path.join(ROOT, rel));
  } catch (e) {
    return null;
  }
}

/* ── Module load checks ───────────────────────────────────────────────────── */

section('Epic #444 — Legislative Tracker');
(function () {
  var mod = loadModule('js/legislative-tracker.js');
  ok(mod !== null,                              'legislative-tracker.js loads without error');
  ok(typeof mod === 'object',                   'exports an object');
  ok(typeof mod.getAllBills === 'function',      'getAllBills() is a function');
  ok(typeof mod.getBill === 'function',         'getBill() is a function');
  ok(typeof mod.getBillsByTag === 'function',   'getBillsByTag() is a function');
  ok(typeof mod.getMarketImpactSummary === 'function', 'getMarketImpactSummary() is a function');
  ok(typeof mod.getCraTractTargeting === 'function',   'getCraTractTargeting() is a function');
  ok(typeof mod.STAGES === 'object',            'STAGES constant exported');

  if (mod) {
    var bills = mod.getAllBills();
    ok(Array.isArray(bills),                    'getAllBills() returns an array');
    ok(bills.length >= 3,                       'at least 3 bills tracked');
    ok(bills.every(function (b) { return b.id && b.title && b.stage; }),
       'every bill has id, title, stage');
  }
}());

section('Epic #445 — LIHTC Deal Predictor (base)');
(function () {
  var mod = loadModule('js/lihtc-deal-predictor.js');
  ok(mod !== null,                              'lihtc-deal-predictor.js loads without error');
  ok(typeof mod === 'object',                   'exports an object');
  ok(typeof mod.predictConcept === 'function',  'predictConcept() is a function');
  ok(typeof mod.predict === 'function',         'predict() (legacy) is a function');

  if (mod) {
    var result = mod.predictConcept({ proposedUnits: 60, isQct: true });
    ok(result && typeof result === 'object',    'predictConcept() returns an object');
    ok(typeof result.recommendedExecution === 'string', 'recommendedExecution is a string');
    ok(['9%', '4%', 'Either'].includes(result.recommendedExecution),
       'recommendedExecution is a valid value');
    ok(typeof result.conceptType === 'string',  'conceptType is a string');
    ok(typeof result.confidence === 'string',   'confidence is a string');
    ok(Array.isArray(result.keyRationale),      'keyRationale is an array');
    ok(Array.isArray(result.keyRisks),          'keyRisks is an array');
    ok(Array.isArray(result.caveats),           'caveats is an array');
  }
}());

section('Epic #445 — LIHTC Deal Predictor Enhanced (Phase 3)');
(function () {
  var mod = loadModule('js/lihtc-deal-predictor-enhanced.js');
  ok(mod !== null,                              'lihtc-deal-predictor-enhanced.js loads without error');
  ok(typeof mod === 'object',                   'exports an object');
  ok(typeof mod.predictEnhanced === 'function', 'predictEnhanced() is a function');
  ok(typeof mod.evaluateScenarios === 'function', 'evaluateScenarios() is a function');
  ok(typeof mod.VERSION === 'string',           'VERSION is a string');

  if (mod) {
    var result = mod.predictEnhanced({
      geoid:            '08013',
      pmaScore:         75,
      pmaConfidence:    'high',
      proposedUnits:    80,
      ami30UnitsNeeded: 40,
      ami50UnitsNeeded: 20,
      isQct:            false
    });
    ok(result && typeof result === 'object',    'predictEnhanced() returns an object');
    ok(result.base && typeof result.base === 'object', 'result.base is present');
    ok(result.enhanced && typeof result.enhanced === 'object', 'result.enhanced is present');
    ok(typeof result.summary === 'string',      'result.summary is a string');

    var enh = result.enhanced;
    ok(enh.pmaSignals && typeof enh.pmaSignals === 'object',
       'enhanced.pmaSignals is present');
    ok(enh.affordabilityGapSignals && typeof enh.affordabilityGapSignals === 'object',
       'enhanced.affordabilityGapSignals is present');
    ok(enh.legislativeContext && typeof enh.legislativeContext === 'object',
       'enhanced.legislativeContext is present');

    var pma = enh.pmaSignals;
    ok(['strong', 'adequate', 'marginal', 'weak', 'unknown'].includes(pma.tier),
       'pmaSignals.tier is a valid value');

    var gap = enh.affordabilityGapSignals;
    ok(['deep-affordable', 'mixed-affordability', 'moderate-affordable'].includes(gap.targeting),
       'affordabilityGapSignals.targeting is a valid value');

    // Scenario batch
    var scenarios = mod.evaluateScenarios([
      { label: 'A', pmaScore: 80 },
      { label: 'B', pmaScore: 30 }
    ]);
    ok(Array.isArray(scenarios),                'evaluateScenarios() returns an array');
    ok(scenarios.length === 2,                  'evaluateScenarios() returns correct count');
    ok(scenarios[0].label === 'A',             'first scenario has correct label');
  }
}());

section('Epic #447 — Data Quality Monitor');
(function () {
  var mod = loadModule('js/data-quality-monitor.js');
  ok(mod !== null,                              'data-quality-monitor.js loads without error');
  ok(typeof mod === 'object',                   'exports an object');
  ok(typeof mod.start === 'function',           'start() is a function');
  ok(typeof mod.stop === 'function',            'stop() is a function');
  ok(typeof mod.getStatus === 'function',       'getStatus() is a function');
  ok(typeof mod.getHistory === 'function',      'getHistory() is a function');
  ok(typeof mod.renderDashboard === 'function', 'renderDashboard() is a function');
  ok(typeof mod.STATE === 'object',             'STATE constants exported');

  if (mod) {
    ok(mod.STATE.HEALTHY === 'healthy',         'STATE.HEALTHY is "healthy"');
    ok(mod.STATE.DEGRADED === 'degraded',       'STATE.DEGRADED is "degraded"');
    ok(mod.STATE.ERROR === 'error',             'STATE.ERROR is "error"');

    var status = mod.getStatus();
    ok(status && typeof status === 'object',    'getStatus() returns an object');

    var history = mod.getHistory('chfa-lihtc');
    ok(Array.isArray(history),                  'getHistory() returns an array');

    ok(Array.isArray(mod.MONITORED_DATASETS),   'MONITORED_DATASETS is an array');
    ok(mod.MONITORED_DATASETS.length >= 4,      'at least 4 datasets monitored');

    // Verify renderDashboard doesn't throw with null input
    var threw = false;
    try { mod.renderDashboard(null); } catch (_) { threw = true; }
    ok(!threw,                                  'renderDashboard(null) does not throw');
  }
}());

section('Epic #447 — Data Quality Check (batch)');
(function () {
  var mod = loadModule('js/data-quality-check.js');
  // data-quality-check.js uses `window` directly (browser-only IIFE).
  // In Node it will throw "window is not defined" — that is expected behaviour.
  // We just verify the file exists on disk; the runtime is validated by ci-checks.yml.
  var fs = require('fs');
  var exists = fs.existsSync(path.join(ROOT, 'js/data-quality-check.js'));
  ok(exists, 'data-quality-check.js file exists on disk');
  ok(mod === null, 'data-quality-check.js is browser-only (throws in Node — expected)');
}());

/* ── Data file pre-checks ─────────────────────────────────────────────────── */

section('Required Phase 3 data files');
(function () {
  var fs   = require('fs');
  var files = [
    'data/chfa-lihtc.json',
    'data/co_ami_gap_by_county.json',
    'data/hud-fmr-income-limits.json',
    'data/manifest.json',
    'data/fred-data.json'
  ];

  files.forEach(function (f) {
    var abs = path.join(ROOT, f);
    var exists = fs.existsSync(abs);
    ok(exists, f + ' exists');
    if (exists) {
      var valid = false;
      try { JSON.parse(fs.readFileSync(abs, 'utf8')); valid = true; } catch (_) {}
      ok(valid, f + ' is valid JSON');
    }
  });

  // Verify hud-fmr has 64 counties
  var fmrPath = path.join(ROOT, 'data/hud-fmr-income-limits.json');
  if (fs.existsSync(fmrPath)) {
    var fmr = JSON.parse(fs.readFileSync(fmrPath, 'utf8'));
    var counties = fmr.counties || fmr;
    var count = Array.isArray(counties) ? counties.length : Object.keys(counties).length;
    ok(count >= 64, 'hud-fmr-income-limits.json has 64 county entries (got ' + count + ')');
  }
}());

/* ── HTML integration checks ─────────────────────────────────────────────── */

section('HTML integration: housing-legislation-2026.html');
(function () {
  var fs   = require('fs');
  var html = '';
  var htmlPath = path.join(ROOT, 'housing-legislation-2026.html');
  if (fs.existsSync(htmlPath)) {
    html = fs.readFileSync(htmlPath, 'utf8');
  }

  ok(html.length > 0,                          'housing-legislation-2026.html exists and is non-empty');
  ok(html.includes('legislative-tracker.js'),  'housing-legislation-2026.html loads legislative-tracker.js');
  ok(html.includes('aria-live'),               'housing-legislation-2026.html has aria-live region');
  ok(html.includes('id="main-content"'),       'housing-legislation-2026.html has main-content landmark');
}());

/* ── Results ──────────────────────────────────────────────────────────────── */

console.log('\n' + '═'.repeat(60));
console.log('Phase 3 Setup Check: ' + passed + ' passed, ' + failed + ' failed');
console.log('═'.repeat(60));

if (failed > 0) {
  console.error('\nPhase 3 setup incomplete — fix the failures above before running the full test suite.');
  process.exit(1);
}

console.log('\nAll Phase 3 modules are correctly initialized. ✅');
console.log('Run the full test suites:');
console.log('  node test/test_legislative_tracker.js');
console.log('  node test/test_lihtc_deal_predictor.js');
console.log('  npm run test:ci');
