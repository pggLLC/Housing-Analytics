#!/usr/bin/env node
'use strict';
// #2160 on the real Deal Calculator page (jsdom, page scripts in order). The
// page's figures must agree with js/deal-cost-basis.js and the rules file, not
// with numbers copied here. The prefilled budget is the module's INVENTED example.
const assert = require('node:assert/strict');
const { openPage, setField, close } = require('./helpers/deal-calculator-page.cjs');
const cb = require('../js/deal-cost-basis.js');
const rules = require('../data/policy/lihtc-underwriting-rules.json');

const money = (n) => '$' + Math.round(n).toLocaleString('en-US');
const text = (p, id) => p.d.getElementById(id).textContent.trim();
let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  PASS ' + name); }
  catch (err) { failed++; console.error('  FAIL ' + name + '\n' + (err && err.stack || err)); }
}

(async () => {
  console.log('Deal Calculator itemized costs and credit figures (#2160)');
  await test('the default page shows the example budget, its basis and the three credit figures', async () => {
    const p = await openPage('');
    const tdc = +p.d.getElementById('dc-tdc').value;
    const summary = cb.summarizeCosts(cb.exampleLines(), tdc);
    assert.equal(text(p, 'dc-cb-itemized'), money(summary.itemized));
    assert.equal(text(p, 'dc-cb-eligible-cost'), money(summary.eligible));
    assert.equal(text(p, 'dc-cb-not-itemized'), money(summary.notItemized));
    assert.equal(text(p, 'dc-cb-contract'), money(summary.contract));
    assert.equal(text(p, 'dc-r-basis'), money(summary.eligible), 'every default unit is restricted, so qualified basis = cost in basis');
    assert.equal(text(p, 'dc-cb-capacity'), money(summary.eligible * 0.09));
    assert.equal(text(p, 'dc-cb-requested'), 'Not entered');
    assert.equal(text(p, 'dc-cb-awarded'), 'Not entered');
    assert.match(text(p, 'dc-cost-example-note'), /invented example budget/i);
    assert.match(text(p, 'dc-cb-fee-tests'), /within CHFA's 12% limit/);
    assert.deepEqual(p.errors, []);
  });

  await test('the boost needs a designation and evidence; the cap limits capacity and says why', async () => {
    const p = await openPage('');
    const before = text(p, 'dc-r-basis');
    setField(p, 'dc-boost-designation', 'qct');
    assert.equal(text(p, 'dc-r-basis'), before, 'a designation without evidence does not boost');
    assert.match(text(p, 'dc-cb-detail'), /Add the evidence/);
    setField(p, 'dc-boost-evidence', 'Invented: HUD QCT map printout');
    const boosted = cb.summarizeCosts(cb.exampleLines(), 20000000).eligible * rules.rules.basis_boost.multiplier;
    assert.equal(text(p, 'dc-r-basis'), money(boosted));
    assert(boosted * 0.09 > rules.rules.credit_cap_federal_9pct.annual_cap, 'non-vacuous: the boosted credit is above the cap');
    assert.equal(text(p, 'dc-cb-capacity'), money(rules.rules.credit_cap_federal_9pct.annual_cap));
    assert.match(text(p, 'dc-cb-credit-note'), /Capped at \$1,800,000/);
    setField(p, 'dc-credit-requested', 1700000);
    setField(p, 'dc-credit-awarded', 1600000);
    assert.equal(text(p, 'dc-cb-requested'), '$1,700,000');
    assert.equal(text(p, 'dc-cb-awarded'), '$1,600,000');
    assert.equal(text(p, 'dc-r-credits'), '$1,600,000', 'equity uses the award');
    setField(p, 'dc-boost-designation', 'none');
    assert.match(text(p, 'dc-cb-detail'), /No QCT, DDA, SADDA or CHFA designation selected/);
  });

  await test('editing cost lines moves basis; itemizing above the total blocks it with a reason', async () => {
    const p = await openPage('');
    const land = p.d.getElementById('dc-cost-land-basis');
    assert.equal(land.disabled, true, 'land offers no basis choice');
    assert.equal(p.d.getElementById('dc-cost-reserves-basis').disabled, true, 'reserves offer no basis choice');
    setField(p, 'dc-cost-permits-basis', 'ineligible');
    assert.equal(text(p, 'dc-cb-eligible-cost'), money(cb.summarizeCosts(cb.exampleLines(), 20000000).eligible - 400000));
    setField(p, 'dc-cost-structures', 11400000);
    assert.match(text(p, 'dc-cb-cost-reason'), /more than Total Development Cost/);
    assert.match(text(p, 'dc-r-basis'), /Unavailable|—/);
    p.d.getElementById('dc-cost-use-total').click();
    assert.equal(p.d.getElementById('dc-tdc').value, '21000000');
    assert.equal(text(p, 'dc-cb-not-itemized'), '$0');
  });

  await test('a grant counts against basis only when it contains federal money', async () => {
    const p = await openPage('');
    const before = text(p, 'dc-r-basis');
    const row = p.d.querySelector('[data-tranche-id]');
    const amount = row.querySelector('.dc-tr-amount');
    amount.value = '500000'; amount.dispatchEvent(new p.w.Event('input', { bubbles: true }));
    const grant = row.querySelector('.dc-tr-mode[value="grant"]');
    grant.checked = true; grant.dispatchEvent(new p.w.Event('change', { bubbles: true }));
    const fed = p.d.querySelector('[data-tranche-id] .dc-tr-fed');
    fed.value = 'nonfederal'; fed.dispatchEvent(new p.w.Event('change', { bubbles: true }));
    assert.equal(text(p, 'dc-r-basis'), before, 'a grant with no federal money leaves basis alone');
    fed.value = 'federal'; fed.dispatchEvent(new p.w.Event('change', { bubbles: true }));
    assert.equal(text(p, 'dc-r-basis'), money(cb.summarizeCosts(cb.exampleLines(), 20000000).eligible - 500000));
    fed.value = ''; fed.dispatchEvent(new p.w.Event('change', { bubbles: true }));
    assert.match(text(p, 'dc-r-basis'), /federal money/);
  });

  await test('a 4% deal names its state credit application, and each application has its own limit', async () => {
    const p = await openPage('');
    setField(p, 'dc-rate-4', true);
    assert.equal(p.w.__DealCalc.getResult().creditType, '4', 'the 4% scenario is selected');
    setField(p, 'dc-state-annual', 2000000); setField(p, 'dc-state-price', 0.8);
    const r = () => p.w.__DealCalc.getResult().costBasis.stateCredit;
    assert.equal(r().equity, null);
    assert.match(r().reason, /which CHFA state credit application/);
    const acc = rules.rules.credit_cap_state_round_two_accelerated.annual_cap, std = rules.rules.credit_cap_state_round_two_standard.annual_cap;
    setField(p, 'dc-state-path', 'round_two');
    assert.equal(r().allowedAnnual, acc);
    setField(p, 'dc-state-standard-annual', 900000);
    assert.equal(r().allowedAnnual, acc + std, 'both Round Two streams count');
    assert.equal(r().equity, (acc + std) * rules.rules.state_credit_term.years * 0.8);
    setField(p, 'dc-state-path', 'with_9pct');
    assert.match(r().reason, /federal 9% credits/);
    assert.deepEqual(p.errors, []);
  });

  await test('state credit equity is not a source in CHFA\'s gap calculation (Method Two)', async () => {
    const p = await openPage('');
    setField(p, 'dc-county-select', '08001');
    await new Promise((r) => setTimeout(r, 600));
    p.w.__DealCalc.recalculate();
    const before = p.w.__DealCalc.getResult().costBasis.basis.gapMethod;
    assert.equal(before.applied, true);
    setField(p, 'dc-state-annual', 400000); setField(p, 'dc-state-price', 0.8);
    const r = p.w.__DealCalc.getResult();
    assert(r.stateEquity > 0, 'non-vacuous: state credit equity is in the capital stack');
    assert.equal(r.costBasis.basis.gapMethod.gap, before.gap, 'the gap left for credit equity ignores state credit equity');
    assert.deepEqual(p.errors, []);
  });

  await test('state credit equity joins the automatic LP buy-in, and only under CHFA LIHTC', async () => {
    const p = await openPage('');
    setField(p, 'dc-county-select', '08001');
    await new Promise((r) => setTimeout(r, 600));
    setField(p, 'dc-state-annual', 400000); setField(p, 'dc-state-price', 0.8);
    p.w.__DealCalc.recalculate();
    let r = p.w.__DealCalc.getResult();
    assert(r.stateEquity > 0 && r.equity > 0, 'non-vacuous: both credits produce equity');
    assert(r.waterfall, 'non-vacuous: the waterfall is computed');
    assert.equal(r.waterfall.autoLpEquity, r.equity + r.stateEquity, 'automatic LP equity is federal plus state');
    assert.equal(r.waterfall.lpEquity, r.equity + r.stateEquity);
    assert.notEqual(text(p, 'dc-wf-lp-equity-auto'), 'Unavailable');
    const snap = p.w.__DealCalcShare.buildSnapshot();
    assert.equal(snap.outputs.stateCreditEquity.value, r.stateEquity, 'JSON export carries state credit equity');
    assert.equal(snap.outputs.creditEquity.value, r.equity, 'and federal credit equity separately');
    assert.equal(p.w._dcReadDealState().outputs.stateCreditEquity, money(r.stateEquity), 'a saved comparison carries it too');
    const c = p.d.getElementById('dc-su-gap').methodologyContext;
    assert(Math.abs(c.tdc - c.equity - c.mortgage - c.grants - c.softLoans - c.deferred - r.gap) < 0.01,
      'the gap explanation adds up to the gap shown, state credit equity included');
    const withState = r.gap;
    setField(p, 'dc-rent-limit-regime', 'market');
    p.w.__DealCalc.recalculate();
    r = p.w.__DealCalc.getResult();
    assert.equal(r.equity, 0, 'no federal credit outside CHFA LIHTC');
    assert.equal(r.stateEquity, 0, 'the state credit pairs with the federal credit, so it is no source either');
    assert.notEqual(r.gap, withState, 'non-vacuous: the regime change moved the gap');
    assert.deepEqual(p.errors, []);
  });

  close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
