#!/usr/bin/env node
'use strict';
// The Deal Calculator's funding gap reaches the Housing Outcome Score.
//
// Found 2026-10-26 (Codex QA): "Save to Project" stored the gap only as the
// displayed text (outputs.gap, e.g. "$1,558,277"), while js/housing-outcome-score.js
// reads deal.results.gapPct. Nothing wrote results, so the score always listed
// "capital stack gap" as missing. Runs the real page: save, reopen in a fresh
// window, and the score's financial dimension. The gap must agree with the
// engine's own records, not with a number copied here.
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const { openPage, setField, sleep, close } = require('./helpers/deal-calculator-page.cjs');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  PASS ' + name); }
  catch (err) { failed++; console.error('  FAIL ' + name + '\n' + (err && err.stack || err)); }
}

// A second window that starts from the first one's saved storage, as a page
// opened later in the same browser would (jsdom windows do not share storage).
function reopen(from) {
  const dom = new JSDOM('<!doctype html><body></body>', { url: 'http://127.0.0.1/recommendation.html', runScripts: 'outside-only' });
  const w = dom.window;
  for (let i = 0; i < from.localStorage.length; i++) { const k = from.localStorage.key(i); w.localStorage.setItem(k, from.localStorage.getItem(k)); }
  w.eval(read('js/workflow-state-core.js'));
  w.eval(read('js/workflow-state-api.js'));
  w.eval(read('js/housing-outcome-score.js'));
  return w;
}

(async () => {
  console.log('Deal Calculator funding gap → saved deal step → Housing Outcome Score');

  await test('a saved deal carries the engine\'s gap, and a reopened score uses it', async () => {
    const p = await openPage('');
    p.w.WorkflowState.newProject('Invented gap handoff test'); // a jurisdiction pick makes one on the site
    setField(p, 'dc-county-select', '08045'); // Garfield: the invented example budget has a gap there
    await sleep(600);
    p.w.__DealCalc.recalculate();
    const rec = p.w.__DealCalc.getOutputRecords();
    const r = p.w.__DealCalc.getResult();
    assert.equal(typeof rec.fundingGap.value, 'number', 'non-vacuous: the engine works out a gap for this deal');
    assert(rec.fundingGap.value > 0, 'non-vacuous: the gap is above zero, so the score has something to weigh');
    p.d.getElementById('dcSaveBtn').click();
    const step = p.w.WorkflowState.getStep('deal');
    assert(step.results, 'the saved deal step has results');
    assert.equal(step.results.fundingGap, rec.fundingGap.value, 'the saved gap is the engine\'s, unrounded');
    assert.equal(step.results.totalDevelopmentCost, rec.totalDevelopmentCost.value);
    assert.equal(step.results.gapPct, r.gapPct * 100, 'gapPct is the engine\'s gap share of cost, in percent');
    assert(Math.abs(step.results.gapPct - 100 * step.results.fundingGap / step.results.totalDevelopmentCost) < 1e-9,
      'and it agrees with the saved gap and total cost');
    // The page's own score panel is drawn again with the saved gap.
    const onPage = p.w.HousingOutcomeScore.compute();
    assert.equal(onPage.dimensions.financialFeasibility.inputs.gapPct, step.results.gapPct);
    // Reopened later: the score reads the stored step.
    const w2 = reopen(p.w);
    const again = w2.WorkflowState.getStep('deal');
    assert.equal(again.results.gapPct, step.results.gapPct, 'the gap survives a reopen');
    const fin = w2.HousingOutcomeScore.compute().dimensions.financialFeasibility;
    assert.equal(fin.inputs.gapPct, step.results.gapPct, 'the reopened score uses the saved gap');
    assert(!(fin.inputs.missing || []).includes('capital stack gap'), 'the gap is no longer listed as missing: ' + (fin.inputs.missing || []).join(', '));
    assert.deepEqual(p.errors, []);
  });

  await test('a gap the engine cannot work out is saved as unknown with its reason, never 0', async () => {
    const p = await openPage('');
    p.w.WorkflowState.newProject('Invented gap handoff test, no county');
    p.w.__DealCalc.recalculate();
    const rec = p.w.__DealCalc.getOutputRecords();
    assert.equal(rec.fundingGap.value, null, 'non-vacuous: with no county the engine has no gap');
    p.d.getElementById('dcSaveBtn').click();
    const res = p.w.WorkflowState.getStep('deal').results;
    assert.equal(res.fundingGap, null);
    assert.equal(res.gapPct, null, 'an unknown gap is not a 0% gap');
    assert.equal(res.fundingGapReason, rec.fundingGap.unavailableReason, 'the engine\'s own reason is kept');
    const fin = reopen(p.w).HousingOutcomeScore.compute().dimensions.financialFeasibility;
    assert((fin.inputs.missing || []).includes('capital stack gap'), 'the score still says the gap is missing');
  });

  await test('switching a saved rental deal to for-sale clears its rental gap', async () => {
    const p = await openPage('');
    p.w.WorkflowState.newProject('Invented gap handoff test, mode switch');
    setField(p, 'dc-county-select', '08045');
    await sleep(600);
    p.w.__DealCalc.recalculate();
    p.d.getElementById('dcSaveBtn').click();
    assert.equal(typeof p.w.WorkflowState.getStep('deal').results.gapPct, 'number', 'non-vacuous: the rental save stored a gap');
    const own = p.d.getElementById('dc-mode-ownership');
    own.checked = true; own.dispatchEvent(new p.w.Event('change', { bubbles: true }));
    p.d.getElementById('dcSaveBtn').click();
    const step = p.w.WorkflowState.getStep('deal');
    assert.equal(step.dealMode, 'ownership', 'non-vacuous: the second save is the for-sale deal');
    assert.equal(step.results, null, 'the rental results are cleared');
    const fin = reopen(p.w).HousingOutcomeScore.compute().dimensions.financialFeasibility;
    assert.equal(fin.inputs.gapPct, undefined, 'the score does not use the rental gap');
  });

  close();
  console.log(passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
