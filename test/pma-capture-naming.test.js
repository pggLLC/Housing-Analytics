'use strict';

// Two different ratios, two names — the same two on screen and in exports.
//
// Found 2026-09-26: the Market Analysis headline "Capture rate (existing
// affordable)" divides EXISTING affordable units by qualified renter
// households (Denver: 48.7%) — penetration of the existing stock. The
// simulator's and scenario table's "Capture rate" divide only the PROPOSED
// project's units by the same households (100 units: 0.2%). One name for
// both made a 48.7% and a 0.2% read as the same measure.
//
// The names live once, in MEASURE_NAMES (js/market-analysis.js). This file
// pins agreement, not wording: the headline label in market-analysis.html,
// the methodology term, the simulator, the scenario table and both exports
// must use those names, and the two names must differ. Reword MEASURE_NAMES
// and the HTML together and this stays green; reword one and it fails.

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const maSrc = fs.readFileSync(path.join(ROOT, 'js/market-analysis.js'), 'utf8');
const enhSrc = fs.readFileSync(path.join(ROOT, 'js/market-analysis-enhancements.js'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'market-analysis.html'), 'utf8');

let failures = 0;
function test(name, fn) {
  try { fn(); console.log('  ✓ ' + name); }
  catch (e) { failures += 1; console.log('  ✗ ' + name + ' — ' + e.message); }
}

const m = maSrc.match(/var MEASURE_NAMES = \{\s*penetration:\s*'([^']+)',\s*capture:\s*'([^']+)'\s*\}/);
const NAMES = m ? { penetration: m[1], capture: m[2] } : null;
const norm = (s) => s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

console.log('\nExisting-affordable penetration and proposed-project capture are named apart');

test('MEASURE_NAMES defines two different names', () => {
  assert(NAMES, 'MEASURE_NAMES is gone from js/market-analysis.js');
  assert.notStrictEqual(NAMES.penetration.toLowerCase(), NAMES.capture.toLowerCase());
});

test('the headline label beside #pmaCaptureRate is the penetration name', () => {
  const card = html.match(/id="pmaCaptureRate"[^>]*>[^<]*<\/div>\s*<div class="pma-stat-label">([\s\S]*?)<\/div>/);
  assert(card, 'the headline card markup changed; this guard cannot find its label');
  assert.strictEqual(norm(card[1]), NAMES.penetration, 'headline label reads "' + norm(card[1]) + '"');
});

test('the methodology term for the headline ratio is the penetration name', () => {
  const dt = html.match(/<dt>([^<]+)<\/dt><dd>existing affordable units/);
  assert(dt, 'the methodology definition of the headline ratio is gone');
  assert.strictEqual(dt[1].trim(), NAMES.penetration);
});

test('the simulator and the scenario table label their ratio with the capture name', () => {
  const sim = maSrc.match(/function updateSimulator\([\s\S]*?\n  \}/)[0];
  const scen = maSrc.match(/function renderScenarios\([\s\S]*?\n  \}/)[0];
  for (const [where, src] of [['simulator', sim], ['scenario table', scen]]) {
    assert(/MEASURE_NAMES\.capture/.test(src), where + ' does not use MEASURE_NAMES.capture');
    assert(!/Capture [Rr]ate/.test(src), where + ' still shows a bare "Capture rate"');
  }
});

test('no surface on the page calls either ratio a bare "Capture rate"', () => {
  // The CHFA checklist item names the CHFA task, not a ratio on this page.
  const shown = html.replace(/<!--[\s\S]*?-->/g, '').replace(/aria-label="Capture rate calculated"|>Capture rate calculated/g, '');
  const hits = (shown.match(/>[^<]*\bCapture rate\b[^<]*</g) || []).filter((h) => !/Capture rate = proposed units/.test(h));
  assert.deepStrictEqual(hits, [], 'bare "Capture rate" on screen: ' + hits.join(' | '));
});

test('the JSON and CSV exports carry the penetration under its own name', () => {
  assert(/existingAffordablePenetration: \(function \(\) \{[\s\S]{0,300}name: MEASURE_NAMES\.penetration/.test(maSrc),
    'the JSON export does not name the headline ratio with MEASURE_NAMES.penetration');
  assert(/\['existing_affordable_penetration', /.test(maSrc), 'CSV key for the headline ratio changed');
  assert(!/\['capture_rate', /.test(maSrc), 'the CSV still calls the existing-units ratio capture_rate');
  assert(/existingAffordablePenetration: result\.capture/.test(enhSrc), 'the metadata export score block no longer names it');
});

test('scenario rows export the proposed-project capture under its own name', () => {
  global.window = { PMAEngine: {
    computePma: () => ({ overall: 50, dimensions: { captureRisk: 50 }, flags: [] }),
    simulateCapture: (den, units) => ({ captureRate: Math.round(units / den * 1000) / 10, risk: 'Low' }),
  } };
  const abs = path.join(ROOT, 'js/market-analysis-enhancements.js');
  delete require.cache[require.resolve(abs)];
  require(abs);
  const rows = global.window.PMAEnhancements.generateScenarios({ renter_hh: 991 }, 0, [{ proposedUnits: 100 }], 50000);
  delete global.window;
  assert.strictEqual(rows[0].proposedProjectCaptureRate, 0.2);
  assert(!('captureRate' in rows[0]), 'scenario rows still export an ambiguous captureRate');
});

console.log(failures ? `\n${failures} failure(s)` : '\nAll checks passed ✅');
process.exit(failures ? 1 : 0);
