'use strict';

// Housing Outcome Score — an unmeasured input is excluded, never scored 0.
//
// Found on main 2026-09-26: with no market analysis run, the Deal Calculator's
// Housing Outcome Score panel read "0 / Grade F / High confidence / 75% of
// workflow data available" and "Strongest: policy alignment (0)". Two
// coercions made the zero: `_n(v, fallback)` ended in `(fallback || 0)`, so
// `_n(pmaScore, null)` returned a site score of 0; and WorkflowState's market
// step defaulted qctFlag/ddaFlag to `false`, so an unchecked designation read
// as "not in a QCT or DDA" and scored policy alignment 0 with data "available".
// The panel also rendered in ownership mode, where a LIHTC score does not apply
// (PC-2).
//
// Everything here runs the shipped code: the real WorkflowState defaults, the
// real scorer, the real renderer inside the real page.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

let failures = 0;
function test(name, fn) {
  try { fn(); console.log('  ✓ ' + name); }
  catch (e) { failures += 1; console.log('  ✗ ' + name + ' — ' + e.message); }
}

console.log('\nHousing Outcome Score — absence');
console.log('='.repeat(62));

// A window with the real WorkflowState and the scorer. `market` overrides the
// stored market step; everything else is the shipped default.
function scorerWindow(steps) {
  const dom = new JSDOM('<!doctype html><body></body>', { url: 'http://127.0.0.1/deal-calculator.html', runScripts: 'outside-only' });
  const w = dom.window;
  w.eval(read('js/workflow-state-core.js'));
  w.eval(read('js/workflow-state-api.js'));
  assert(w.WorkflowState && typeof w.WorkflowState.getStep === 'function', 'WorkflowState did not load');
  if (steps) w.WorkflowState.newProject('HOS absence test');
  Object.keys(steps || {}).forEach((k) => w.WorkflowState.setStep(k, steps[k]));
  w.eval(read('js/housing-outcome-score.js'));
  return w;
}

/* ── The default workflow: no market analysis run ──────────────────────── */

test('the WorkflowState market default does not claim a QCT/DDA designation', () => {
  const w = scorerWindow();
  const market = w.WorkflowState.getStep('market');
  assert.strictEqual(market.pmaScore, null, 'fixture: pmaScore default is not null');
  assert.strictEqual(market.qctFlag, null, 'qctFlag defaults to ' + market.qctFlag + ', not null (unknown)');
  assert.strictEqual(market.ddaFlag, null, 'ddaFlag defaults to ' + market.ddaFlag + ', not null (unknown)');
});

test('no market analysis → score unavailable with a reason, not 0 / Grade F / High', () => {
  const w = scorerWindow();
  const r = w.HousingOutcomeScore.compute();
  assert.strictEqual(r.score, null, 'score is ' + r.score);
  assert.strictEqual(r.grade, null, 'grade is ' + r.grade);
  assert.strictEqual(r.available, false);
  assert.match(r.unavailableReason || '', /market analysis/i);
  assert.notStrictEqual(r.confidence, 'high');
  assert.doesNotMatch(r.summary, /Grade F|\(0\)/, 'summary: ' + r.summary);
  // Nothing on the default workflow is measured, so nothing is scored.
  Object.keys(r.dimensions).forEach((k) => {
    assert.strictEqual(r.dimensions[k].available, false, k + ' is marked available with no inputs');
    assert.notStrictEqual(r.dimensions[k].score, 0, k + ' scored 0 with no inputs');
  });
  assert(r.dataComplete < 50, 'coverage reads ' + r.dataComplete + '% with nothing measured');
});

/* ── Partial workflow ──────────────────────────────────────────────────── */

test('partial → missing inputs are excluded from the score and disclosed', () => {
  // Market analysis run (site score, access), designation unknown, nothing else.
  const w = scorerWindow({ market: { pmaScore: 70, dimensions: { access: 60 } } });
  const r = w.HousingOutcomeScore.compute();
  assert.strictEqual(r.available, true, 'a run market analysis should give a score: ' + r.unavailableReason);
  // Policy has no known input — it is excluded, not scored 0.
  assert.strictEqual(r.dimensions.policyAlignment.available, false, 'policy alignment scored from unknown flags');
  assert.strictEqual(r.dimensions.policyAlignment.score, null);
  // Finance: site score only (70). Site: access only (60). Weighted 0.3 / 0.2.
  assert.strictEqual(r.dimensions.financialFeasibility.score, 70);
  assert.strictEqual(r.dimensions.siteQuality.score, 60);
  assert.strictEqual(r.score, Math.round((70 * 0.3 + 60 * 0.2) / 0.5));
  ['QCT designation', 'deal confidence', 'feasibility score', 'housing-need coverage'].forEach((m) =>
    assert(r.missingInputs.includes(m), 'missing input not disclosed: ' + m + ' (got ' + r.missingInputs.join(', ') + ')'));
  assert.match(r.summary, /Not measured, excluded from the score/);
  assert.strictEqual(r.dataComplete, Math.round((2 / 11) * 100), 'coverage counts measured inputs');
  assert.strictEqual(r.confidence, 'low');
});

test('a known "not in a QCT" is still a measured no, unlike an unknown one', () => {
  const known = scorerWindow({ market: { pmaScore: 70, qctFlag: false, ddaFlag: false } }).HousingOutcomeScore.compute();
  assert.strictEqual(known.dimensions.policyAlignment.available, true);
  assert.strictEqual(known.dimensions.policyAlignment.score, 0);
  // A missing policy component is dropped from the denominator, not counted as zero points.
  const withFastTrack = scorerWindow({ market: { pmaScore: 70, qctFlag: true } }).HousingOutcomeScore
    .compute({ prop123FastTrack: true });
  assert.strictEqual(withFastTrack.dimensions.policyAlignment.score, 100,
    'QCT yes + fast-track yes, the rest unknown, scored ' + withFastTrack.dimensions.policyAlignment.score);
});

/* ── Complete workflow: present values unchanged ───────────────────────── */

// Expected values computed from js/housing-outcome-score.js on main before
// this change (66 / C / high / 100%, dimensions 62 / 72 / 68 / 65).
const COMPLETE = {
  hnsFit: { coveragePct: 62, alignment: 'good' },
  qct: true, dda: false,
  scorecard: { has_inclusionary_zoning: true, has_housing_authority: true, has_land_bank: false,
    has_density_bonus: true, prop123_participant: true, has_housing_trust_fund: false,
    has_affordable_housing_plan: true },
  prop123FastTrack: true,
  siteScore: 71, dealConfidence: 'medium', gapPct: 8,
  accessScore: 66, feasibilityScore: 58, marketScore: 74,
};

test('complete workflow → same score as before the change', () => {
  const r = scorerWindow().HousingOutcomeScore.compute(COMPLETE);
  assert.strictEqual(r.score, 66);
  assert.strictEqual(r.grade, 'C');
  assert.strictEqual(r.confidence, 'high');
  assert.strictEqual(r.dataComplete, 100);
  assert.deepStrictEqual(Object.keys(r.dimensions).map((k) => r.dimensions[k].score), [62, 72, 68, 65]);
});

/* ── The panel, in the real page ───────────────────────────────────────── */

const pageSrc = read('deal-calculator.html');
const dom = new JSDOM(pageSrc, { url: 'http://127.0.0.1/deal-calculator.html', runScripts: 'outside-only' });
global.document = dom.window.document;
global.window = dom.window;
global.HTMLElement = dom.window.HTMLElement;
global.Event = dom.window.Event;
window.DealCalculatorMath = require('../js/deal-calculator-math.js');
require('../js/hna/hna-ownership-need.js');
require('../js/hna/ownership-resale.js');
require('../js/deal-calculator.js');
window.eval(read('js/workflow-state-core.js'));
window.eval(read('js/workflow-state-api.js'));
window.eval(read('js/housing-outcome-score.js'));
window.eval(read('js/components/hos-renderer.js'));
document.dispatchEvent(new Event('DOMContentLoaded', { bubbles: true }));
const $ = (id) => document.getElementById(id);

function setMode(mode) {
  const radio = $('dc-mode-' + mode);
  assert(radio, 'deal-mode radio ' + mode + ' renders');
  radio.checked = true;
  radio.dispatchEvent(new Event('change', { bubbles: true }));
}

test('panel with no market analysis: "Unavailable" and the reason, no 0 / Grade F / High', () => {
  setMode('rental');
  $('hosScoreValue').textContent = '—';
  window.HOSRenderer.render();
  const panel = $('hosPanel').textContent.replace(/\s+/g, ' ');
  assert.strictEqual($('hosScoreValue').textContent, 'Unavailable', 'score shows ' + $('hosScoreValue').textContent);
  assert.match($('hosGrade').textContent, /market analysis/i);
  assert.doesNotMatch(panel, /Grade F|High confidence|\(0\)/, 'panel: ' + panel.slice(0, 300));
  assert(!$('hosPanel').closest('[hidden]'), 'the panel is hidden in rental mode');
});

test('ownership mode: the LIHTC Housing Outcome Score panel is not shown', () => {
  setMode('ownership');
  assert($('hosPanel').closest('[hidden]'), 'the Housing Outcome Score panel is visible in ownership mode');
  $('hosScoreValue').textContent = 'sentinel';
  window.HOSRenderer.render();
  assert.strictEqual($('hosScoreValue').textContent, 'sentinel', 'the renderer computed the score in ownership mode');
  setMode('rental');
  assert(!$('hosPanel').closest('[hidden]'), 'the panel did not come back in rental mode');
});

console.log('');
if (failures) {
  console.log(failures + ' failure(s)');
  process.exit(1);
}
console.log('All Housing Outcome Score absence checks passed.');
process.exit(0);
