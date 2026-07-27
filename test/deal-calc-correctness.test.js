'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const dcSrc = fs.readFileSync(path.join(root, 'js', 'deal-calculator.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'deal-calculator.html'), 'utf8');
const { computeApplicableFraction } = require('../js/deal-calculator-math.js');

console.log('\nDeal Calculator correctness guard');
console.log('='.repeat(42));

assert(Math.abs(computeApplicableFraction(40, 60) - (40 / 60)) < 0.0001, '40 LIHTC / 60 total uses total-unit denominator');
assert.strictEqual(computeApplicableFraction(40, 40), 1, 'pure LIHTC deal has 100% applicable fraction');
assert.strictEqual(computeApplicableFraction(40, 0), 1, 'zero total units preserves legacy 100% fallback');
assert.strictEqual(computeApplicableFraction(60, 60), 1, 'equal LIHTC and total units caps at 100%');
assert.strictEqual(computeApplicableFraction(70, 60), 1, 'applicable fraction cannot exceed 100%');

assert(dcSrc.includes('window.DealCalculatorMath.computeApplicableFraction(lihtcUnits, units)'), 'calculator uses shared applicable-fraction helper with total units');
assert(!dcSrc.includes('lihtcUnits / totalLihtcEligibleAndMarket'), 'old eligible-plus-market denominator removed');
assert(!dcSrc.includes('totalLihtcEligibleAndMarket'), 'old applicable-fraction denominator variable removed');
assert(dcSrc.includes("lihtcUnits + ' LIHTC units / ' + units"), 'applicable-fraction note renders total residential denominator');
assert(dcSrc.includes('lihtcUnits < units && lihtcUnits > 0'), 'applicable-fraction note renders for unrestricted-unit mixed deals');
assert(dcSrc.includes('Market-rate and unrestricted units generate rent but no federal LIHTC credits'), 'applicable-fraction note discloses unrestricted units');

assert(dcSrc.includes("'4br':    il50_4p * 1.16"), '4BR LIHTC rent proxy uses 1.16 HUD adjustment factor');
assert(!dcSrc.includes("'4br':    il50_4p * 1.10"), 'stale 1.10 4BR proxy removed');

assert(!dcSrc.includes("safeVal('dc-vacancy') || 5"), 'vacancy reads no longer default legitimate 0% to 5%');
assert(!dcSrc.includes("safeVal('dc-vacancy') || 7"), 'vacancy reads no longer default legitimate 0% to 7%');
assert(dcSrc.includes('function vacFrac()'), 'central vacancy fraction helper exists');
assert(dcSrc.includes('return (Number.isFinite(v) ? v : 7) / 100;'), 'vacancy helper honors 0 and defaults missing values to 7%');

assert(dcSrc.includes('id="dc-equity-price" type="number" min="0.50" max="1.20" step="0.01" value="0.86"'), 'rendered equity pricing input defaults to 0.86');
assert(!dcSrc.includes('id="dc-equity-price" type="number" min="0.50" max="1.20" step="0.01" value="0.90"'), 'stale 0.90 equity pricing default removed from calculator template');
assert(html.includes("safeVal('dc-equity-price')"), 'deal-calculator.html still exports the live equity pricing input');

assert(dcSrc.includes('Senior <abbr data-glossary="DSCR">DSCR</abbr> (1st mortgage, stabilized)'), 'DSCR label clarifies senior mortgage coverage');
assert(dcSrc.includes('reflects senior mortgage coverage only; all-in coverage including soft debt is shown in the pro forma'), 'DSCR note clarifies senior-only coverage');
assert(!dcSrc.includes('<abbr data-glossary="DSCR">DSCR</abbr> (stabilized)</dt>'), 'ambiguous DSCR stabilized label removed');

console.log('All Deal Calculator correctness guards passed.');
