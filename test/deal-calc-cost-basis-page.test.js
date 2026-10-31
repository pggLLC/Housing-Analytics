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
    // With no county there is no mortgage, so CHFA's gap method cannot run and capacity is unknown.
    assert.equal(text(p, 'dc-cb-capacity'), 'Unavailable');
    assert.match(text(p, 'dc-cb-credit-note'), /needs CHFA's gap calculation/);
    assert(text(p, 'dc-cb-detail').includes(money(summary.eligible * 0.09)), 'Method One is still shown');
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
    assert.match(text(p, 'dc-cb-detail'), /Capped at \$1,800,000/, 'the cap limits Method One and says why');
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
    // The example deal has land and reserves, so the page asks how much of the grant went there.
    assert.match(text(p, 'dc-r-basis'), /Unavailable.*costs outside eligible basis/);
    setField(p, 'dc-grant-outside', 200000);
    const eligible = cb.summarizeCosts(cb.exampleLines(), 20000000).eligible;
    assert.equal(text(p, 'dc-r-basis'), money(eligible - 300000), 'only the grant spent in basis reduces it');
    setField(p, 'dc-grant-outside', 0);
    assert.equal(text(p, 'dc-r-basis'), money(eligible - 500000));
    // The JSON export carries the classification that decides the basis reduction.
    const tranches = p.w.__DealCalcShare.buildSnapshot().tranches;
    assert(tranches && tranches.length > 0, 'non-vacuous: the export has tranches');
    assert.equal(tranches.find(t => t.mode === 'grant').fundSource, 'federal');
    fed.value = ''; fed.dispatchEvent(new p.w.Event('change', { bubbles: true }));
    assert.match(text(p, 'dc-r-basis'), /federal money/);
  });

  await test('a 4% deal names its state credit application, and each application has its own limit', async () => {
    const p = await openPage('');
    assert(!text(p, 'dc-cb-detail').includes(cb.BOND_TEST_NOTE), 'a 9% deal has no bond test');
    setField(p, 'dc-rate-4', true);
    assert.equal(p.w.__DealCalc.getResult().creditType, '4', 'the 4% scenario is selected');
    assert(text(p, 'dc-cb-detail').includes(cb.BOND_TEST_NOTE), 'a 4% deal says the aggregate basis test is assumed, not checked');
    setField(p, 'dc-state-annual', 2000000); setField(p, 'dc-state-price', 0.8); setField(p, 'dc-state-awarded', true);
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
    assert.equal(text(p, 'dc-cb-capacity'), money(p.w.__DealCalc.getResult().costBasis.basis.capacity), 'once the gap method runs, capacity is known');
    setField(p, 'dc-state-annual', 500000); setField(p, 'dc-state-price', 0.8); setField(p, 'dc-state-awarded', true);
    const r = p.w.__DealCalc.getResult();
    assert(r.stateEquity > 0, 'non-vacuous: state credit equity is in the capital stack');
    assert.equal(r.costBasis.basis.gapMethod.gap, before.gap, 'the gap left for credit equity ignores state credit equity');
    assert.deepEqual(p.errors, []);
  });

  await test('state credit equity joins the automatic LP buy-in, and only under CHFA LIHTC', async () => {
    const p = await openPage('');
    setField(p, 'dc-county-select', '08001');
    await new Promise((r) => setTimeout(r, 600));
    setField(p, 'dc-state-annual', 500000); setField(p, 'dc-state-price', 0.8); setField(p, 'dc-state-awarded', true);
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
    for (const label of ['Method One: qualified basis credit', 'State credit allowed']) assert(text(p, 'dc-cb-detail').includes(label), 'non-vacuous: CHFA LIHTC shows ' + label);
    setField(p, 'dc-rent-limit-regime', 'market');
    p.w.__DealCalc.recalculate();
    r = p.w.__DealCalc.getResult();
    assert.equal(r.equity, 0, 'no federal credit outside CHFA LIHTC');
    assert.equal(r.stateEquity, 0, 'the state credit pairs with the federal credit, so it is no source either');
    assert.notEqual(r.gap, withState, 'non-vacuous: the regime change moved the gap');
    // The detail shows no credit figure where the headline says there is no credit.
    const detail = text(p, 'dc-cb-detail');
    for (const label of ['Method One: qualified basis credit', 'Method Two: gap calculation', 'Credit capacity', 'Qualified basis', 'State credit allowed', 'Equity pay-in']) assert(!detail.includes(label), label + ' is hidden outside CHFA LIHTC');
    assert(detail.includes('No LIHTC credits'), 'and the detail says why, in the headline\'s words');
    assert.deepEqual(p.errors, []);
  });

  await test('the floor-space input and its help text both count only LIHTC units', async () => {
    const p = await openPage('');
    const label = p.d.getElementById('dc-restricted-sf').closest('label').textContent;
    const help = p.w.DealCalculatorInputRegistry.get('dc-restricted-sf').definition;
    // The engine's numerator is LIHTC floor space, so the label and the help must both name LIHTC units.
    for (const [name, words] of [['label', label], ['help text', help]]) {
      assert.match(words, /LIHTC units/, name + ' names the units the fraction counts');
      assert.doesNotMatch(words, /floor area of (all |the )?income-restricted units/i, name + ' does not widen it to every restricted unit');
    }
  });

  await test('a proposed state credit is not a source until it is awarded; CHFA limits disclose other applications', async () => {
    const p = await openPage('');
    setField(p, 'dc-county-select', '08001');
    await new Promise((r) => setTimeout(r, 600));
    setField(p, 'dc-state-annual', 500000); setField(p, 'dc-state-price', 0.8);
    let r = p.w.__DealCalc.getResult();
    assert.equal(r.costBasis.stateCredit.allowedAnnual, 500000, 'non-vacuous: within the 9% pairing');
    assert(!Number.isFinite(r.stateEquity), 'a proposed amount is not equity');
    assert.match(r.costBasis.stateCredit.reason, /three-test/);
    setField(p, 'dc-state-awarded', true);
    r = p.w.__DealCalc.getResult();
    assert.equal(r.stateEquity, 500000 * rules.rules.state_credit_term.years * 0.8, 'an award is a source');
    assert(text(p, 'dc-cb-detail').includes(cb.APPLICANT_LIMIT_NOTE), 'the per-project limit says other active applications count against it');
    assert.deepEqual(p.errors, []);
  });

  await test('an invalid unit mix shows no basis figure in the detail, only its reason', async () => {
    const p = await openPage('');
    assert.match(text(p, 'dc-cb-detail'), /Credit capacity[^$]*\$[1-9]/, 'non-vacuous: a valid mix shows a capacity');
    setField(p, 'dc-units', 5);
    assert(p.d.getElementById('dc-units-sync-warn'), 'the mix is flagged invalid');
    const detail = text(p, 'dc-cb-detail');
    assert.match(detail, /Fix the unit mix/);
    for (const label of ['Applicable fraction', 'Qualified basis', 'Method One: qualified basis credit', 'Credit capacity']) {
      const after = detail.slice(detail.indexOf(label) + label.length).split(/Method|Cost per/)[0];
      assert(detail.includes(label) && !/\$\d|\d%/.test(after.slice(0, 120)), label + ' shows no figure: ' + after.slice(0, 120));
    }
    assert.equal(p.w.__DealCalc.getResult().costBasis.basis.capacity, null);
    // An entered award does not depend on the mix, so its equity stays known.
    setField(p, 'dc-credit-awarded', 1000000);
    const r = p.w.__DealCalc.getResult();
    assert.equal(r.costBasis.basis.capacity, null, 'still no calculated capacity');
    assert.equal(r.annualCredits, 1000000);
    assert.equal(r.equity, 1000000 * 10 * r.equityPrice);
    assert.deepEqual(p.errors, []);
  });

  await test('unknown credits leave no sensitivity chart, and the note names the credit reason', async () => {
    const p = await openPage('');
    setField(p, 'dc-county-select', '08001');
    const mount = p.d.getElementById('tornadoChartMount');
    assert.match(mount.textContent, /Equity Price\$[1-9]/, 'non-vacuous: known credits draw equity bars');
    p.w.__DealCalc.setCostRules(null);
    const r = p.w.__DealCalc.getResult();
    assert(r.noi > 0, 'NOI is still known');
    assert.equal(r.annualCredits, null);
    assert.equal(r.tornado, null);
    assert(!/Equity Price\$/.test(mount.textContent), 'no $0 equity bars');
    assert(mount.textContent.includes('Sensitivity needs a known credit amount. ' + r.basisUnknownReason), mount.textContent);
    assert.deepEqual(p.errors, []);
  });

  await test('a 9% deal with a purchase and a federal grant asks where the grant went', async () => {
    const p = await openPage('');
    setField(p, 'dc-tdc', 21000000);
    setField(p, 'dc-cost-building_acquisition', 1000000);
    setField(p, 'dc-acq-42d2', true);
    const row = p.d.querySelector('[data-tranche-id]');
    const amount = row.querySelector('.dc-tr-amount'); amount.value = '500000'; amount.dispatchEvent(new p.w.Event('input', { bubbles: true }));
    const grant = row.querySelector('.dc-tr-mode[value="grant"]'); grant.checked = true; grant.dispatchEvent(new p.w.Event('change', { bubbles: true }));
    const fed = row.querySelector('.dc-tr-fed'); fed.value = 'federal'; fed.dispatchEvent(new p.w.Event('change', { bubbles: true }));
    setField(p, 'dc-grant-outside', 0);
    assert.match(text(p, 'dc-r-basis'), /Unavailable.*paid for the building purchase/);
    assert.equal(p.w.__DealCalc.getResult().costBasis.basis.calculatedCredit, null);
    setField(p, 'dc-grant-acq', 0);
    const b = p.w.__DealCalc.getResult().costBasis.basis;
    const other = cb.summarizeCosts(cb.exampleLines(), 20000000).eligible - 500000;
    assert.equal(text(p, 'dc-r-basis'), money(other + 1000000));
    assert.equal(Math.round(b.calculatedCredit), Math.round(1000000 * 0.04 + other * 0.09), 'purchase at 4%, the rest at 9%');
    assert.deepEqual(p.errors, []);
  });

  await test('the boost help text agrees with the boost rules and the CHFA percentage input', async () => {
    const p = await openPage('');
    const help = text(p, 'dc-boost-help');
    const fixedPct = Math.round((rules.rules.basis_boost.multiplier - 1) * 100);
    const maxPct = +p.d.getElementById('dc-boost-pct').max;
    assert(help.includes('QCT, DDA or SADDA boost raises eligible basis by ' + fixedPct + '%'), help);
    assert(help.includes('up to ' + maxPct + '%'), 'the CHFA boost is variable up to the input limit: ' + help);
    assert.equal(maxPct, Math.round((rules.rules.basis_boost.designations.chfa.max_multiplier - 1) * 100), 'the input limit is the rule\'s CHFA maximum');
  });

  await test('costs sit in DOH\'s categories with subtotals, cost per unit and per SF, and DOH\'s fee share', async () => {
    const p = await openPage('');
    const summary = cb.summarizeCosts(cb.exampleLines(), 20000000);
    const per = p.w.__DealCalc.getResult().costBasis.costPerSf;
    assert(per.units > 0, 'non-vacuous: the default deal has units');
    const groups = Array.from(p.d.querySelectorAll('[data-cost-group]'));
    assert.deepEqual(groups.map((g) => g.getAttribute('data-cost-group')), cb.GROUPS.map((g) => g.id));
    for (const g of cb.GROUPS) {
      const shown = p.d.querySelector('[data-cost-subtotal="' + g.id + '"]').textContent.trim();
      assert.equal(shown, money(summary.groups[g.id] || 0), g.label + ' subtotal');
    }
    const line = p.d.querySelector('[data-cost-per="structures"]').textContent;
    assert(line.includes(money(summary.byId.structures / per.units) + ' per unit'), line);
    const detail = text(p, 'dc-cb-detail');
    assert(detail.includes(money(cb.sumIds(summary.byId, cb.HARD_COST_IDS) / per.units)), 'hard cost per unit is shown');
    const share = cb.dohDeveloperFeeShare(summary);
    assert(share.value > 0, 'non-vacuous: the example has a DOH fee share');
    const shareText = p.d.querySelector('[data-doh-fee-share]').textContent;
    assert(shareText.includes((share.value * 100).toFixed(1) + '%') && shareText.includes(money(share.base)), shareText);
    // Cost left unitemized could be hard, land or soft, so the split waits for it.
    setField(p, 'dc-cost-structures', 9400000);
    assert.equal(p.w.__DealCalc.getResult().costBasis.costPerSf.hardPerUnit.value, null);
    assert.match(text(p, 'dc-cb-detail'), /Itemize all of Total Development Cost/);
    setField(p, 'dc-cost-structures', 10400000);
    // A line error blanks the subtotals rather than showing a partial sum.
    setField(p, 'dc-cost-construction_interest-eligible', '');
    assert.equal(p.d.querySelector('[data-cost-subtotal="construction"]').textContent.trim(), '—');
    assert.deepEqual(p.errors, []);
  });

  await test('a 4% deal checks the bond test, construction interest and expense target from the page', async () => {
    const p = await openPage('');
    setField(p, 'dc-rate-4', true);
    const r = () => p.w.__DealCalc.getResult();
    const cbr = () => r().costBasis;
    assert.equal(cbr().bondTest.reason, cb.BOND_TEST_NOTE, 'no bonds entered: the note stays');
    const summary = cb.summarizeCosts(cb.exampleLines(), +p.d.getElementById('dc-tdc').value);
    const agg = summary.eligible + (summary.byId.land || 0);
    // INVENTED: bonds at 30% of aggregate basis, from a post-2025 issue.
    setField(p, 'dc-bond-amount', Math.round(agg * 0.30));
    setField(p, 'dc-bond-post2025', 'yes');
    setField(p, 'dc-constr-loan', Math.round(agg * 0.6));
    assert.equal(cbr().bondTest.passes, true);
    assert.equal(cbr().bondTest.threshold, rules.rules.bond_aggregate_basis_test.post_2025_threshold_pct / 100);
    assert.match(text(p, 'dc-cb-detail'), /meets the 25% test/);
    assert(!text(p, 'dc-cb-detail').includes(cb.BOND_TEST_NOTE), 'the assumed-not-checked note goes once the test runs');
    setField(p, 'dc-bond-post2025', 'no');
    assert.match(text(p, 'dc-cb-detail'), /below the 50% test/);
    // Construction interest: the estimate follows the inputs, the budget is the itemized line.
    setField(p, 'dc-constr-rate', 7); setField(p, 'dc-constr-months', 24); setField(p, 'dc-constr-draw', 50);
    const ci = cbr().constructionInterest;
    assert(Math.abs(ci.estimate - Math.round(agg * 0.6) * 0.07 * 2 * 0.5) < 1);
    assert.equal(ci.budget, summary.byId.construction_interest);
    assert.match(text(p, 'dc-cb-detail'), /Construction interest budget/);
    assert.match(text(p, 'dc-cb-detail'), /Operating reserve/);
    assert.match(text(p, 'dc-cb-detail'), /Deferred developer fee repaid by year 15/);
    // An expense target below the line items is reported, and NOI does not move.
    const noi = r().noi;
    setField(p, 'dc-opex-target', 1000);
    assert.equal(r().noi, noi, 'the target never replaces the expenses');
    assert.equal(r().expenseTarget.below, true);
    assert.match(text(p, 'dc-op-target-check'), /below the expenses used/);
    assert.deepEqual(p.errors, []);
  });

  await test('a link saved before the DOH layout opens with the budget it saved', async () => {
    // The pre-DOH example budget as that page's share link carried it, with profit taken out of basis.
    const saved = { land: 1000000, building_acquisition: '', site_work: 1000000, structures: 10400000, general_requirements: 600000,
      overhead: 250000, profit: 500000, bonds: 120000, insurance: 130000, contractor_contingency: 500000, owner_contingency: 400000,
      escalation: 200000, design: 700000, permits: 400000, financing: 1200000, soft_contingency: 200000, developer_fee: 1900000,
      consultant_fee: '', reserves: 500000 };
    const q = new URLSearchParams({ tdc: '20000000' });
    for (const [id, v] of Object.entries(saved)) q.set('cost-' + id, String(v));
    q.set('cost-profit-basis', 'ineligible'); q.set('cost-financing-basis', 'partial'); q.set('cost-financing-eligible', '900000');
    const old = await openPage('?' + q.toString());
    const total = Object.values(saved).reduce((a, v) => a + (+v || 0), 0);
    assert.equal(total, 20000000, 'non-vacuous: the saved budget is the whole $20M');
    // In basis: everything but land, reserves, profit and the ineligible part of financing.
    const eligible = total - 1000000 - 500000 - 500000 - 300000;
    assert.equal(text(old, 'dc-cb-itemized'), money(total), 'the DOH example lines the old budget never named are empty');
    assert.equal(text(old, 'dc-cb-eligible-cost'), money(eligible));
    assert.equal(text(old, 'dc-r-basis'), money(eligible));
    assert.equal(old.d.getElementById('dc-cost-overhead_profit').value, '750000');
    assert.equal(old.d.getElementById('dc-cost-overhead_profit-basis').value, 'partial');
    assert.equal(old.d.getElementById('dc-cost-overhead_profit-eligible').value, '250000');
    assert.equal(old.d.getElementById('dc-cost-soft_other').value, '1200000');
    assert.equal(old.d.getElementById('dc-cost-construction_interest').value, '');
    assert.equal(old.d.getElementById('dc-cost-construction_other').value, '200000', 'the saved escalation allowance is Construction, Other');
    assert.equal(old.d.getElementById('dc-cost-construction_other-basis').value, 'eligible');
    assert.equal(old.d.getElementById('dc-cost-construction_interest-eligible').value, '', 'no example eligible part on an emptied line');
    assert.equal(old.d.getElementById('dc-cost-professional_other').value, '700000', 'architecture and engineering is Professional fees, Other');
    assert.equal(old.d.getElementById('dc-cost-design').value, '');
    assert.equal(old.d.getElementById('dc-cost-reserve_other').value, '500000', 'operating and replacement reserves are Reserves, Other');
    assert.equal(old.d.getElementById('dc-cost-reserves').value, '');
    assert.deepEqual(old.errors, []);
  });

  close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
