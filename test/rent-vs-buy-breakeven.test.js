// Rent vs Buy breakeven (js/rent-vs-buy-breakeven.js).
//
// The down payment is cash the buyer pays out; it comes back only through
// the sale proceeds. It must never be counted as a gain. Net cost of buying
// through year t = cumulative P&I + property tax + maintenance + down payment
// + closing costs + forgone return on the down payment - (home value - loan
// balance - selling costs). That is compared with cumulative rent.
//
// Run: node --test test/rent-vs-buy-breakeven.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

global.window = {};
global.document = { readyState: 'complete', getElementById: () => null };
require(path.join(__dirname, '..', 'js', 'rent-vs-buy-breakeven.js'));
const { compute } = global.window.RentVsBuyBreakeven;

// Independent 30-year amortization, month by month.
function reference(p) {
  const down = p.homePrice * p.downPaymentPct / 100;
  const r = p.mortgageRatePct / 100 / 12;
  let bal = p.homePrice - down;
  const pi = bal * r * Math.pow(1 + r, 360) / (Math.pow(1 + r, 360) - 1);
  let value = p.homePrice;
  let own = 0;
  let rent = p.monthlyRent;
  let rentCum = 0;
  const rows = [];
  for (let year = 1; year <= 30; year++) {
    rentCum += rent * 12;
    rent *= 1 + p.rentEscalationPct / 100;
    own += pi * 12 + value * (p.propTaxRatePct + p.maintPct) / 100;
    for (let m = 0; m < 12; m++) bal -= pi - bal * r;
    value *= 1 + p.homeAppreciationPct / 100;
    const net = own + down + p.homePrice * p.closingCostPct / 100 +
      down * (Math.pow(1 + p.opportunityRatePct / 100, year) - 1) -
      (value - Math.max(bal, 0) - value * p.sellingCostPct / 100);
    rows.push({ year, net, rentCum });
  }
  return rows;
}

test('default inputs do not break even in year 1', () => {
  const result = compute({});
  assert.notEqual(result.breakevenYear, 1, 'the down payment must not be counted as a gain');
  assert.ok(result.breakevenYear === null || result.breakevenYear > 5,
    `default breakeven ${result.breakevenYear} is implausibly fast`);
});

test('year-1 net cost of buying exceeds a year of rent at defaults', () => {
  const result = compute({});
  const y1 = result.buySeries[0].cum;
  assert.ok(y1 > result.rentSeries[0].cum, 'buying costs more than renting in the first year');
  // Year 1 nets out to the transaction costs plus a year of owning costs,
  // not just a year of interest.
  const p = result.params;
  const transaction = p.homePrice * (p.closingCostPct + p.sellingCostPct * (1 + p.homeAppreciationPct / 100)) / 100;
  assert.ok(y1 > transaction, 'closing and selling costs are in the year-1 cost');
});

test('series match an independent amortization of the stated formula', () => {
  const p = compute({}).params;
  const ref = reference(p);
  const result = compute({});
  for (const row of ref) {
    const got = result.buySeries[row.year - 1].cum;
    assert.ok(Math.abs(got - row.net) < 1, `year ${row.year}: ${got} vs ${row.net}`);
    assert.ok(Math.abs(result.rentSeries[row.year - 1].cum - row.rentCum) < 1e-6);
  }
  const expected = ref.find((row) => row.net < row.rentCum);
  assert.equal(result.breakevenYear, expected ? expected.year : null);
});

test('a larger down payment does not make buying look cheaper by itself', () => {
  // With no appreciation and no interest the only effect of more cash down is
  // more forgone return, so the net cost of buying cannot fall.
  const base = { mortgageRatePct: 0.0001, homeAppreciationPct: 0, rentEscalationPct: 0 };
  const low = compute({ ...base, downPaymentPct: 5 }).buySeries[4].cum;
  const high = compute({ ...base, downPaymentPct: 50 }).buySeries[4].cum;
  assert.ok(high >= low - 1, `50% down (${high}) must not cost less than 5% down (${low})`);
});

test('higher rent brings breakeven earlier; zero-cost renting never breaks even', () => {
  const a = compute({ monthlyRent: 2500 }).breakevenYear;
  const b = compute({ monthlyRent: 3500 }).breakevenYear;
  assert.ok(a && b && b < a, `breakeven should move earlier with rent (${a} → ${b})`);
  assert.equal(compute({ monthlyRent: 1 }).breakevenYear, null);
});
