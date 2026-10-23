'use strict';
// Rent growth may be negative (-3% to +5% a year) so a flat-or-falling market
// can be tested. Growth of 0%, blank and -2% are three different results, a
// blank never becomes 0, and an out-of-range value is unknown, not clamped.
// Inputs are the invented golden scenario A.
const assert = require('node:assert/strict');
const { computeDeal } = require('../js/deal-engine.js');
const { inputsFor } = require('./helpers/deal-engine-inputs.cjs');

function withRentGrowth(value) {
  const input = inputsFor('A');
  if (value === undefined) delete input.fields['pf-rent-growth'];
  else input.fields['pf-rent-growth'] = value;
  return computeDeal(input);
}

const base = withRentGrowth('2');
const zero = withRentGrowth('0');
const falling = withRentGrowth('-2');
const blank = withRentGrowth('');

assert.equal(base.exit.rentGrowth, 0.02);
assert.equal(zero.exit.rentGrowth, 0);
assert.equal(falling.exit.rentGrowth, -0.02);
assert.equal(blank.exit.rentGrowth, null, 'a cleared rent growth is unknown, never 0');

// The three known rates give three different exits, in the right order.
assert(Number.isFinite(falling.exit.nNoi) && Number.isFinite(zero.exit.nNoi) && Number.isFinite(base.exit.nNoi));
assert(falling.exit.nNoi < zero.exit.nNoi && zero.exit.nNoi < base.exit.nNoi,
  `exit NOI falls with rent growth: ${falling.exit.nNoi} < ${zero.exit.nNoi} < ${base.exit.nNoi}`);
assert(falling.exit.resale < zero.exit.resale, 'falling rents lower the resale value');

// Year 1 is the stabilized NOI whatever the growth; year 2 rents fall by 2%.
assert.equal(falling.projection.rows[0].noi, base.projection.rows[0].noi);
const rentsY1 = falling.projection.rows[0].grossRents;
const rentsY2 = falling.projection.rows[1].grossRents;
assert(Math.abs(rentsY2 / rentsY1 - 0.98) < 1e-9, `year-2 rents are 98% of year 1 (${rentsY2 / rentsY1})`);

// A blank builds no projection and says what to enter, with the real range.
assert.equal(blank.projection, null);
assert.match(blank.unavailable.projection, /from -3% to 5%/);

// The range ends are allowed; one step past either end is unknown, not clamped.
assert.equal(withRentGrowth('-3').exit.rentGrowth, -0.03);
assert.equal(withRentGrowth('5').exit.rentGrowth, 0.05);
assert.equal(withRentGrowth('-3.25').exit.rentGrowth, null, 'below -3% is not clamped to -3%');
assert.equal(withRentGrowth('5.25').exit.rentGrowth, null, 'above 5% is not clamped to 5%');

// Expenses are still not modelled as falling.
const expInput = inputsFor('A');
expInput.fields['pf-exp-growth'] = '-1';
assert.equal(computeDeal(expInput).exit.expGrowth, null, 'negative expense growth stays out of range');

// A saved link from before this change (no rent growth field) keeps the 2% default.
assert.equal(withRentGrowth(undefined).exit.rentGrowth, 0.02);
assert.equal(withRentGrowth(undefined).exit.nNoi, base.exit.nNoi);

console.log('deal-engine-signed-rent-growth: PASS');
