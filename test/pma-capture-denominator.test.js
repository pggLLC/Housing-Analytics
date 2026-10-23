'use strict';

// Every capture rate on the Market Analysis page says which renters it
// divides by (audit F3). With the CHFA-rule counts loaded there are two
// pools, as in a CHFA market study: existing affordable penetration divides
// by renters who qualify for any tax-credit tier (20-80% AMI); a proposed
// project's capture divides by renters who qualify for its own tiers. The
// simulator and the scenario table share the project pool. Without those
// counts all three share one denominator, as before.
//
// Found 2026-09-24: the headline and the simulator divided by CHAS
// LIHTC-eligible renters while showing the ACS renter total beside them, and
// the scenario table divided by the ACS total. For Fruita, 100 proposed units
// read 16.7% in the simulator and 10.1% in the scenario table.
//
// The rendered agreement (each displayed rate = its numerator / the
// denominator shown beside it, the same denominator on all three surfaces) is
// held in the browser by scripts/audit/core-rendered-smoke.mjs, which the
// site-audit workflow runs on every PR. This file holds the two pure pieces:
// which denominator is chosen, and that the scenario table divides by it.

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'js/market-analysis.js'), 'utf8');

let failures = 0;
function test(name, fn) {
  try { fn(); console.log('  ✓ ' + name); }
  catch (e) { failures += 1; console.log('  ✗ ' + name + ' — ' + e.message); }
}

// The page's own risk thresholds (market-analysis.js reads PMAScoring.RISK).
const { RISK } = require(path.join(ROOT, 'js/market-analysis-scoring.js'));

function extract(name) {
  const m = src.match(new RegExp('function ' + name + '\\([\\s\\S]*?\\n  \\}'));
  assert(m, name + '() is gone from js/market-analysis.js');
  return new Function('RISK', m[0] + '; return ' + name + ';')(RISK);
}

console.log('\nCapture rates share one denominator and name it');

const captureDenominator = extract('captureDenominator');
const simulateCapture = extract('simulateCapture');
const projectCaptureDenominator = new Function('RISK',
  src.match(/function captureDenominator\([\s\S]*?\n  \}/)[0] + ';' +
  src.match(/function projectCaptureDenominator\([\s\S]*?\n  \}/)[0] + '; return projectCaptureDenominator;')(RISK);

test('with CHFA-rule counts, penetration and project capture name their own CHFA pools', () => {
  const r = { captureDenominator: { value: 5000, source: 'chfa_qualified', tiers: [20, 80], project: { value: 1200, source: 'chfa_qualified', tiers: [60] } } };
  const pen = captureDenominator(r);
  const proj = projectCaptureDenominator(r);
  assert.strictEqual(pen.value, 5000);
  assert(/20\u201380% AMI/.test(pen.label) && /CHFA/.test(pen.label), 'penetration label: ' + pen.label);
  assert.strictEqual(proj.value, 1200);
  assert.strictEqual(proj.penetrationValue, 5000);
  assert(/60% AMI/.test(proj.label) && /CHFA/.test(proj.label), 'project label: ' + proj.label);
});

test('a real zero 60% pool stays zero, never the broader penetration pool', () => {
  const r = { captureDenominator: { value: 400, source: 'chfa_qualified', tiers: [20, 80], project: { value: 0, source: 'chfa_qualified', tiers: [60] } } };
  const proj = projectCaptureDenominator(r);
  assert.strictEqual(proj.value, 0);
  assert.strictEqual(proj.source, 'chfa_qualified');
  assert(/function _noQualifiedLine/.test(src) && /scenDen\.source === 'chfa_qualified' && !\(scenDen\.value > 0\)/.test(src),
    'the scenario table has no no-qualified-renters state');
});

test('a real zero 20-80% pool withholds the score, never borrows the CHAS or ACS pool', () => {
  const PMAScoring = require(path.join(ROOT, 'js/market-analysis-scoring.js'));
  const m = src.match(/function scoreCaptureRisk\([\s\S]*?\n  \}/);
  const scoreCaptureRisk = new Function('PMAScoring', m[0] + '; return scoreCaptureRisk;')(PMAScoring);
  const r = scoreCaptureRisk({ renter_hh: 900 }, 40, 0, { value: 0, source: 'chfa_qualified' });
  assert.strictEqual(r.score, null);
  assert.strictEqual(r.capture, null);
  assert.strictEqual(r.denominatorSource, 'chfa_qualified');
  assert(/qualify/.test(r.unavailableReason));
  const proj = projectCaptureDenominator({ captureDenominator: { value: 0, source: 'chfa_qualified', project: { value: 0, source: 'chfa_qualified', tiers: [60] } } });
  assert.strictEqual(proj.value, 0, 'the project pool is zero too');
});

test('a mixed-tier project shows each tier\'s own capture beside the overall rate', () => {
  const m = src.match(/function _tierCaptureLine\([\s\S]*?\n  \}/);
  assert(m, '_tierCaptureLine() is gone');
  const line = new Function(m[0] + '; return _tierCaptureLine;')();
  const html = line({ tiers: [30, 80], byTier: { 30: 200, 80: 1000 } }, { ami30: 99, ami80: 1 });
  assert(/30% AMI: 99 units \u00f7 200 renter HH = 49.5%/.test(html), html);
  assert(/80% AMI: 1 units \u00f7 1,000 renter HH = 0.1%/.test(html), html);
  assert.strictEqual(line({ tiers: [60], byTier: { 60: 500 } }, { ami60: 100 }), '', 'one tier needs no breakdown');
});

test('the 85% check counts tax-credit units only and cites the draft QAP, not the 2025-26 QAP', () => {
  assert(/simulateCapture\(simDen\.value, proposed, amiMix, result && result\.lihtcUnits, penPool\)/.test(src),
    'the simulator check does not use the tax-credit unit count');
  assert(/scenDen\.penetrationValue,\s*result\.lihtcUnits/.test(src), 'the scenario check does not use the tax-credit unit count');
  assert(!/QAP 2\.B|QAP section 2\.B/.test(src), 'the page still cites the 2025-26 QAP for the 85% line');
});

test('without CHFA-rule counts the project pool is the one denominator', () => {
  const r = { captureDenominator: { value: 598, source: 'chas_lihtc_eligible' } };
  assert.deepStrictEqual(projectCaptureDenominator(r), captureDenominator(r));
});

test('the CHFA 85% check counts existing + proposed units against the penetration pool', () => {
  const s = simulateCapture(1000, 100, { ami60: 100 }, 4000, 5000);
  assert.strictEqual(s.captureRate, 10);
  assert.strictEqual(s.penetrationRate, 82);
  assert.strictEqual(s.risk, 'Low');
  assert.strictEqual(simulateCapture(1000, 300, { ami60: 300 }, 4000, 5000).risk, 'High');
  const mixed = simulateCapture(1000, 300, { ami60: 100, ami110: 200 }, 4000, 5000);
  assert.strictEqual(mixed.penetrationRate, 82, 'workforce units above 80% AMI stay out of the 85% check');
  assert.strictEqual(mixed.captureRate, 30, 'the capture rate still counts every proposed unit');
});

test('the CHAS LIHTC-eligible count is the denominator when it exists, and says so', () => {
  const d = captureDenominator({ captureDenominator: { value: 598, source: 'chas_lihtc_eligible' }, acs: { renter_hh: 991 } });
  assert.strictEqual(d.value, 598);
  assert(/CHAS/.test(d.label) && /80% AMI/.test(d.label), 'the label does not name the CHAS <=80% AMI pool: ' + d.label);
});

test('without CHAS the all-renter fallback is labelled as all incomes, not as eligible renters', () => {
  const d = captureDenominator({ captureDenominator: { value: 991, source: 'acs_total_renter_hh' } });
  assert.strictEqual(d.value, 991);
  assert(/all incomes/.test(d.label) && !/eligible/i.test(d.label), 'fallback label: ' + d.label);
});

test('no renter count withholds the capture score instead of scoring capture against 1 household', () => {
  const PMAScoring = require(path.join(ROOT, 'js/market-analysis-scoring.js'));
  const m = src.match(/function scoreCaptureRisk\([\s\S]*?\n  \}/);
  assert(m, 'scoreCaptureRisk() is gone from js/market-analysis.js');
  const scoreCaptureRisk = new Function('PMAScoring', m[0] + '; return scoreCaptureRisk;')(PMAScoring);
  const none = scoreCaptureRisk({}, 40, 0, null);
  assert.strictEqual(none.score, null, 'score with no denominator: ' + none.score);
  assert.strictEqual(none.capture, null, 'capture with no denominator: ' + none.capture);
  assert(none.unavailable && /renter/.test(none.unavailableReason), 'says why it is withheld');
  const known = scoreCaptureRisk({ renter_hh: 1000 }, 40, 0, null);
  assert(Number.isFinite(known.score) && known.capture === 0.04, 'a real denominator still scores: ' + JSON.stringify(known));
});

test('a tract file with no generated stamp shows no date, never today', () => {
  assert(!/'Data as of ' \+ new Date\(\)/.test(src), 'the timestamp falls back to today');
  assert(/Data date unavailable/.test(src), 'the missing-date label is gone');
});

test('no renter count is no denominator, never the scoring placeholder of 1 or 0', () => {
  for (const cd of [{ value: 1, source: 'fallback_1' }, { value: 0, source: 'acs_total_renter_hh' }, { value: null, source: 'chas_lihtc_eligible' }, null]) {
    assert.strictEqual(captureDenominator({ captureDenominator: cd }), null, JSON.stringify(cd) + ' gave a denominator');
  }
});

test('the scenario table divides by the denominator it is given', () => {
  global.window = { PMAEngine: {
    computePma: () => ({ overall: 50, dimensions: { captureRisk: 50 }, flags: [] }),
    simulateCapture,
  } };
  const abs = path.join(ROOT, 'js/market-analysis-enhancements.js');
  delete require.cache[require.resolve(abs)];
  require(abs);
  const ENH = global.window.PMAEnhancements;
  assert(ENH && typeof ENH.generateScenarios === 'function', 'PMAEnhancements.generateScenarios is not exposed');
  const acs = { renter_hh: 991 };
  const list = ENH.defaultScenarios(100);
  const withDen = ENH.generateScenarios(acs, 0, list, 598);
  assert.strictEqual(withDen[0].captureRate, Math.round(100 / 598 * 1000) / 10,
    `baseline reads ${withDen[0].captureRate}%, not 100 / 598`);
  assert.strictEqual(withDen[0].captureRate, simulateCapture(598, 100, { ami60: 100 }).captureRate,
    'the scenario baseline and the simulator disagree for the same units and denominator');
  delete global.window;
});

console.log(failures ? `\n${failures} failure(s)` : '\nAll checks passed ✅');
process.exit(failures ? 1 : 0);
