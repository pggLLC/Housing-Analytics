#!/usr/bin/env node
'use strict';
// The exit inputs, the partnership's deal terms and the sponsor's return on the
// real Deal Calculator page (jsdom, page scripts in order):
// - a blank or out-of-range hold or exit cap shows its reason, never a default;
// - the waterfall panel's terms reach the calculation (they sit outside the
//   calculator mount, which the page once read alone);
// - the sponsor's return counts only what the split pays the sponsor, beside
//   the older figure that counts every dollar of partnership cash;
// - the structure graphic and the terms table show the terms the split used.
const assert = require('node:assert/strict');
const { openPage, setField, close } = require('./helpers/deal-calculator-page.cjs');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  PASS ' + name); }
  catch (err) { failed++; console.error('  FAIL ' + name + '\n' + (err && err.stack || err)); }
}
const text = (p, id) => p.d.getElementById(id).textContent.trim();
const settle = () => new Promise((r) => setTimeout(r, 400));
// Newton-free check: the rate at which the flows' present value is zero, by bisection.
function irr(flows) {
  const npv = (r) => flows.reduce((a, f, t) => a + f / Math.pow(1 + r, t), 0);
  let lo = -0.99, hi = 1;
  for (let i = 0; i < 200; i++) { const m = (lo + hi) / 2; if (npv(m) > 0) lo = m; else hi = m; }
  return (lo + hi) / 2;
}

async function dealPage() {
  const p = await openPage('');
  // With a county the rents, the first mortgage and the deferred fee are known.
  setField(p, 'dc-county-select', '08001');
  await settle();
  p.w.__DealCalc.recalculate();
  const r = p.w.__DealCalc.getResult();
  assert(r.exit.resale > 0 && r.deferredDevFee > 0 && r.waterfall, 'non-vacuous: the default deal has a sale, a deferred fee and a split');
  return p;
}
const result = (p) => p.w.__DealCalc.getResult();

(async () => {
  console.log('Deal Calculator exit inputs, partnership terms and sponsor return');

  await test('a blank, zero or text exit cap shows its reason instead of the 6.5% default', async () => {
    const p = await dealPage();
    const base = result(p).exit.resale;
    for (const v of ['', '0', 'abc', '2.5', '13']) {
      setField(p, 'dc-exit-cap', v);
      const r = result(p);
      assert.equal(r.exit.resale, null, 'cap "' + v + '" builds no price');
      assert.equal(r.unavailable['exit.resale'], 'Enter an exit cap rate from 3% to 12%.');
      assert.equal(r.waterfall, null, 'no split without a price');
      assert.match(text(p, 'dc-exit-resale'), /^Unavailable — Enter an exit cap rate/);
      assert.match(text(p, 'dc-exit-sponsor-irr'), /^Unavailable — Enter an exit cap rate/);
      assert(r.exit.nNoi > 0, 'the sale-year NOI does not depend on the cap and stays known');
    }
    setField(p, 'dc-exit-cap', '6.5');
    assert.equal(result(p).exit.resale, base, 'a typed 6.5 gives the same price as before');
    setField(p, 'dc-exit-cap', '8');
    assert(Math.abs(result(p).exit.resale - result(p).exit.nNoi / 0.08) < 0.01);
    assert.equal(p.d.getElementById('dc-exit-resale-label').textContent, 'Resale value (year-15 NOI ÷ 8.00% cap)', 'the label names the year and the cap used');
    assert.deepEqual(p.errors, []);
  });

  await test('a blank or out-of-range hold shows its reason; the box allows what the engine allows', async () => {
    const p = await dealPage();
    const box = p.d.getElementById('dc-exit-hold');
    assert.equal(box.min, '5'); assert.equal(box.max, '30');
    for (const v of ['', '3', '45', '12.5']) {
      setField(p, 'dc-exit-hold', v);
      const r = result(p);
      assert.equal(r.exit.holdYears, null, 'hold "' + v + '" is not clamped');
      assert.equal(r.unavailable['exit.resale'], 'Enter a hold period of 5 to 30 whole years.');
      assert.match(text(p, 'dc-exit-noi'), /^Unavailable — Enter a hold period/);
      assert.doesNotMatch(text(p, 'dc-exit-notes'), /NaN|Year-null/);
    }
    setField(p, 'dc-exit-hold', '10');
    assert.equal(result(p).exit.holdYears, 10);
    assert.equal(p.d.getElementById('dc-exit-noi-label').textContent, 'Year-10 stabilized NOI');
    assert.deepEqual(p.errors, []);
  });

  await test('the sponsor return counts only the cash the split pays the sponsor', async () => {
    const p = await dealPage();
    const r = result(p), wf = r.waterfall;
    const flows = [-r.deferredDevFee].concat(wf.annual.map((a) => a.gp));
    assert(Math.abs(wf.sponsorIrr - irr(flows)) < 1e-6, 'sponsor return ' + wf.sponsorIrr + ' vs ' + irr(flows));
    assert(Math.abs(wf.sponsorCash - wf.annual[wf.annual.length - 1].cumGp) < 0.01);
    assert(r.exit.irr > wf.sponsorIrr, 'counting the investor\'s share overstates it: ' + r.exit.irr + ' > ' + wf.sponsorIrr);
    assert.equal(text(p, 'dc-exit-sponsor-irr'), (wf.sponsorIrr * 100).toFixed(1) + '%');
    assert.equal(text(p, 'dc-exit-irr'), (r.exit.irr * 100).toFixed(1) + '%');
    assert.match(text(p, 'dc-exit-notes'), /including the investor's share, so it overstates what the sponsor keeps/);
  });

  await test('the waterfall panel\'s terms reach the calculation', async () => {
    const p = await dealPage();
    const before = result(p).waterfall;
    setField(p, 'dc-wf-lp-ops-share', '90');
    const ops = result(p).waterfall;
    assert.equal(ops.terms.lpOpsShare, 0.9);
    const row = ops.annual.find((a) => a.lp > 0);
    if (row) assert(Math.abs(row.lp / 0.9 * 0.1 - (row.gp - (result(p).projection.rows[row.year - 1].deferredFeePaid || 0))) < 1, 'surplus splits 90/10');
    setField(p, 'dc-wf-pref', '0');
    setField(p, 'dc-wf-gp-residual', '80');
    const changed = result(p).waterfall;
    assert.equal(changed.prefRate, 0);
    assert.equal(changed.gpResidualPct, 0.8);
    assert.notEqual(JSON.stringify(changed.terms), JSON.stringify(before.terms));
    setField(p, 'dc-wf-lp-ops-share', '150');
    assert.equal(result(p).waterfall, null);
    assert.equal(result(p).unavailable.waterfall, 'Enter the investor\'s share of operating cash from 0% to 100%.');
    assert.match(text(p, 'dcDealTerms'), /Split unavailable: Enter the investor's share/);
    assert.equal(result(p).partnershipTerms.lpOpsShare, null, 'a rejected share is not published');
    assert.doesNotMatch(text(p, 'dcDealTerms') + text(p, 'dcPartnershipStructure'), /150%|-50%/, 'the rejected figure is not shown as a term');
    setField(p, 'dc-wf-lp-ops-share', '99.99');
    assert(result(p).waterfall, 'a valid share brings the split back');
    setField(p, 'dc-wf-exit', '');
    assert.equal(result(p).waterfall, null, 'an explicitly blank exit choice is not read as a sale');
    assert.equal(result(p).unavailable.waterfall, 'Choose how the investor exits.');
    assert.match(text(p, 'dc-exit-sponsor-irr'), /^Unavailable/);
    const termValue = (label) => [...p.d.querySelectorAll('#dcDealTerms tbody tr')].find((tr) => tr.querySelector('th').textContent === label).children[1].textContent;
    assert.equal(termValue('How the investor exits'), 'Unavailable', 'a blank exit is not shown as a sale');
    assert.equal(termValue('Buyout price'), 'Unavailable');
    assert.match(text(p, 'dcPartnershipStructure'), /At the exit: unavailable/);
    setField(p, 'dc-wf-exit', 'sale');
    setField(p, 'dc-wf-catchup', '');
    assert.equal(result(p).waterfall, null);
    assert.equal(termValue('Sponsor catch-up'), 'Unavailable', 'a blank catch-up is not shown as none');
    assert.deepEqual(p.errors, []);
  });

  await test('a buyout needs a price, then the sponsor keeps the value after it', async () => {
    const p = await dealPage();
    setField(p, 'dc-wf-exit', 'buyout');
    assert.equal(result(p).waterfall, null);
    assert.equal(result(p).unavailable.waterfall, 'Enter the price the sponsor pays for the investor\'s interest.');
    assert.match(text(p, 'dcPartnershipStructure'), /Unavailable: Enter the price the sponsor pays/);
    setField(p, 'dc-wf-buyout', '50000');
    const r = result(p), wf = r.waterfall;
    const names = wf.tiers.map((t) => t.name);
    assert(names.includes('4. Investor buyout price') && names.includes('5. Value the sponsor keeps after the buyout'));
    assert(!names.some((n) => /preferred return|Residual split/.test(n)), 'sale-only steps do not apply');
    const paid = wf.tiers.reduce((a, t) => a + t.amount, 0);
    assert(Math.abs(paid - wf.grossProceeds) < 0.01, 'the steps account for the whole value');
    assert.equal(wf.lpTotal, 50000, 'the investor gets the agreed price');
    assert(wf.sponsorIrr > 0, 'keeping the value after the buyout earns the sponsor a return: ' + wf.sponsorIrr);
    // A price above the value left is still paid in full; the sponsor funds the difference.
    const left = wf.grossProceeds - wf.tiers.filter((t) => !/^[45]\./.test(t.name)).reduce((a, t) => a + t.amount, 0);
    setField(p, 'dc-wf-buyout', String(Math.round(left + 1000000)));
    const big = result(p).waterfall;
    assert.equal(big.lpTotal, Math.round(left + 1000000), 'a high price is not cut to the value left');
    const short = big.tiers.find((t) => /buyout shortfall/.test(t.name));
    assert(short && short.amount < 0, 'the sponsor pays the shortfall');
    assert(Math.abs(big.tiers.reduce((a, t) => a + t.amount, 0) - big.grossProceeds) < 0.01);
    assert(!(big.sponsorIrr >= wf.sponsorIrr), 'a higher price lowers the sponsor return or leaves it unavailable');
    setField(p, 'dc-wf-buyout', String(Math.round(left + 2000000)));
    assert.equal(result(p).waterfall.lpTotal, Math.round(left + 2000000), 'two different prices give two different payments');
    assert.match(text(p, 'dcPartnershipStructure'), /Sponsor pays .* of its own/);
    setField(p, 'dc-wf-buyout', '50000');
    const terms = p.d.getElementById('dcDealTerms');
    const unused = [...terms.querySelectorAll('tr[data-unused="true"] th')].map((th) => th.textContent);
    assert.deepEqual(unused, ['Investor preferred return', 'Sponsor catch-up', 'Residual split']);
    assert.match(text(p, 'dcPartnershipStructure'), /sponsor buys the investor out/);
    assert.deepEqual(p.errors, []);
  });

  await test('the structure graphic and the terms table show the terms the split used', async () => {
    const p = await dealPage();
    const r = result(p), wf = r.waterfall;
    const fig = text(p, 'dcPartnershipStructure');
    for (const who of ['Tax credit investor (limited partner)', 'Sponsor (general partner)', 'Lenders', 'Every year', 'What each side gets back']) {
      assert(fig.includes(who), 'the graphic shows ' + who);
    }
    assert(fig.includes('Owns 99.99%') && fig.includes('Owns 0.01%'), 'ownership comes from the yearly cash share');
    const rows = [...p.d.querySelectorAll('#dcDealTerms tbody tr')].map((tr) => tr.querySelector('th').textContent);
    assert.deepEqual(rows, ['Investor equity', 'Ownership and yearly cash split', 'Deferred developer fee', 'Hold period', 'Exit cap rate',
      'How the investor exits', 'Buyout price', 'Investor preferred return', 'Sponsor catch-up', 'Residual split']);
    const value = (label) => [...p.d.querySelectorAll('#dcDealTerms tbody tr')].find((tr) => tr.querySelector('th').textContent === label).children[1].textContent;
    assert.equal(value('Hold period'), r.exit.holdYears + ' years');
    assert.equal(value('Investor preferred return'), +(wf.prefRate * 100).toFixed(1) + '%');
    assert.equal(value('Residual split'), Math.round(wf.gpResidualPct * 100) + '% sponsor / ' + Math.round((1 - wf.gpResidualPct) * 100) + '% investor');
    assert.equal(p.d.getElementById('dcWaterfallDetails').open, true, 'the partnership panel opens without a click');
    setField(p, 'dc-wf-lp-ops-share', '99');
    assert(text(p, 'dcPartnershipStructure').includes('Owns 99%'), 'the graphic follows the term');
    assert.deepEqual(p.errors, []);
  });

  close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
})();
