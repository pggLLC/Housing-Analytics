'use strict';

const assert = require('assert');
const { mortgageConstant } = require('../js/deal-calculator-math.js');

function assertClose(actual, expected, tolerance, message) {
  assert(
    Math.abs(actual - expected) <= tolerance,
    `${message}: got ${actual}, expected ${expected} +/- ${tolerance}`
  );
}

function supportableMortgage(noi, dcr, annualRate, termYears) {
  const constant = mortgageConstant(annualRate, termYears);
  return constant > 0 && noi > 0 ? (noi / dcr) / constant : 0;
}

console.log('\nDeal Calculator mortgage math regression tests');
console.log('='.repeat(52));

assertClose(
  mortgageConstant(0.065, 35),
  0.07249851814952209,
  0.000001,
  '6.5% / 35-year annual mortgage constant'
);

assertClose(
  supportableMortgage(500000, 1.20, 0.065, 35),
  5747243.906521328,
  1,
  'NOI $500k / 1.20 DCR / 6.5% / 35-year supportable mortgage'
);

assertClose(
  mortgageConstant(0.0525, 30),
  0.06626444425702768,
  0.000001,
  '5.25% / 30-year annual mortgage constant'
);

assertClose(
  supportableMortgage(375000, 1.15, 0.0525, 30),
  4920994.360971434,
  1,
  'NOI $375k / 1.15 DCR / 5.25% / 30-year supportable mortgage'
);

assert.strictEqual(mortgageConstant(0, 35), 0, 'zero annual rate returns 0');
assert.strictEqual(mortgageConstant(0.065, 0), 0, 'zero term returns 0');

console.log('All Deal Calculator mortgage math tests passed.');
