'use strict';
// L7: the deep-tier rent cut and the coverage floor move figures. Invented inputs only.
const assert = require('node:assert/strict');
const { computeDeal } = require('../js/deal-engine.js');
const { inputsFor } = require('./helpers/deal-engine-inputs.cjs');
function run(cut, floor) {
  const input = inputsFor('A');
  input.fields = Object.assign({}, input.fields, { 'dc-stress-rent-low': String(cut), 'dc-stress-dscr-floor': String(floor) });
  return computeDeal(input);
}
const base = run(0, 1.15), cut = run(10, 1.15), strict = run(10, 1.25);
const b = base.sliderImpacts.rentCut, c = cut.sliderImpacts.rentCut, s = strict.sliderImpacts.rentCut;
// Deep tiers are 30%, 40% and 50% AMI; the 60% tier and market units are not cut.
const deep = base.pricedRows.filter(r => typeof r.tier === 'number' && r.tier <= 50);
const deepRents = deep.reduce((sum, r) => sum + r.contractRent * r.units * 12, 0);
assert.equal(b.deepRents, deepRents);
assert.equal(b.noiLoss, 0);
assert.equal(b.noi, base.noi);
assert.ok(Math.abs(c.noiLoss - deepRents * 0.10 * (1 - base.vacancyRate)) < 1e-6, 'cut is deep rents x pct after vacancy');
assert.ok(c.noi < b.noi && c.coverage < b.coverage, 'the cut lowers NOI and coverage');
assert.ok(Math.abs(c.coverage - c.noi / base.annualDebtService) < 1e-12);
// The floor changes the loan the NOI carries, not the loan as sized.
assert.ok(s.supportedLoan < c.supportedLoan, 'a stricter floor carries a smaller loan');
assert.equal(strict.mortgage, base.mortgage, 'nothing is resized');
assert.equal(cut.noi, base.noi, 'the stress never changes the base NOI');
assert.ok(Math.abs(c.supportedLoan * base.mc - c.noi / 1.15) < 1e-6);
assert.equal(c.meetsFloor, c.coverage >= 1.15);
// Out-of-range input is unknown, not a number.
assert.equal(run(-5, 1.15).sliderImpacts.rentCut, null);
assert.equal(run(10, 0).sliderImpacts.rentCut, null);
console.log('PASS deal-engine rent cut and coverage floor');
// Lease-up: a longer ramp loses more of year 1, never the same as 12 months.
function leaseup(m) { const i = inputsFor('A'); i.fields = Object.assign({}, i.fields, { 'dc-stress-leaseup': String(m) }); return computeDeal(i); }
const l6 = leaseup(6), l12 = leaseup(12), l24 = leaseup(24), l36 = leaseup(36);
assert.ok(Math.abs(l6.sliderImpacts.year1Loss - l6.noi * 0.25) < 1e-6);
assert.ok(Math.abs(l12.sliderImpacts.year1Loss - l12.noi * 0.5) < 1e-6);
assert.ok(Math.abs(l24.sliderImpacts.year1Loss - l24.noi * 0.75) < 1e-6);
assert.ok(l36.sliderImpacts.year1Loss > l24.sliderImpacts.year1Loss);
console.log('PASS lease-up ramp past 12 months');
// An interest-only senior loan: at the floor it was sized to, with no cut, the
// loan carried equals the loan as sized (Codex review on #2628).
{
  const i = inputsFor('A');
  i.fields = Object.assign({}, i.fields, { 'dc-senior-type': 'interest_only', 'dc-stress-rent-low': '0' });
  let r = computeDeal(i);
  const floorAtSizing = r.noi / r.annualDebtService;
  i.fields['dc-stress-dscr-floor'] = String(floorAtSizing);
  r = computeDeal(i);
  const io = r.sliderImpacts.rentCut;
  assert.ok(io && Math.abs(io.supportedLoan - r.mortgage) < 1, 'interest-only loan at its own coverage is carried in full');
  assert.ok(Math.abs(io.loanRoom) < 1);
}
console.log('PASS interest-only senior loan at the floor');
