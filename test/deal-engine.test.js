'use strict';
// All inputs are invented, captured from the real page before extraction.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { computeDeal } = require('../js/deal-engine.js');
const golden = require('./fixtures/deal-engine/golden.json');
const sources = require('./fixtures/deal-engine/invented-sources.cjs');
const root = path.resolve(__dirname, '..');
const clone = value => JSON.parse(JSON.stringify(value));
const { inputsFor } = require('./helpers/deal-engine-inputs.cjs');
const money = n => '$' + Math.round(n).toLocaleString('en-US');
const moneyFields = { annualRents: 'dc-r-rents', noi: 'dc-r-noi-stab', mortgage: 'dc-r-mortgage',
  eligibleBasis: 'dc-r-basis', annualCredits: 'dc-r-credits', equity: 'dc-r-equity',
  devFeeTotal: 'dc-r-devfee', deferredDevFee: 'dc-r-deferred', devFeeAtClosing: 'dc-r-devfee-closing',
  annualDebtService: 'dc-r-ads', netPropTax: 'dc-r-proptax', gap: 'dc-su-gap', tdc: 'dc-su-tdc' };
let checked = 0;
for (const scenario of ['A', 'B']) {
  const input = inputsFor(scenario);
  const before = clone(input);
  const result = computeDeal(input);
  const figures = require('./helpers/deal-engine-b1-expected.cjs')(scenario, require('./helpers/deal-engine-l1-expected.cjs')(scenario, golden.scenarios[scenario].figures));
  for (const [key, id] of Object.entries(moneyFields)) {
    assert.equal(money(result[key]), figures[id], `${scenario}: ${key} equals the pre-move display`); checked++;
  }
  for (const [key, id] of Object.entries({ nNoi: 'noi', resale: 'resale', firstMortBal: 'mortbal', softBal: 'softbal', netProceeds: 'net' })) {
    assert.equal(money(result.exit[key]), figures['dc-exit-' + id], `${scenario}: exit ${key}`); checked++;
  }
  assert.equal((result.mc * 100).toFixed(4) + '%', figures['dc-r-mc']);
  assert.equal((result.capRate * 100).toFixed(2) + '%', figures['dc-r-cap-rate']);
  assert.equal((result.breakEvenOcc * 100).toFixed(1) + '%', figures['dc-r-beo']);
  assert.equal(result.baseDSCR.toFixed(2) + 'x', figures['dc-r-dscr-base']);
  assert.equal(result.exit.irr == null ? '—' : (result.exit.irr * 100).toFixed(1) + '%', figures['dc-exit-irr']);
  assert.equal(result.exit.dfYr ? 'Year ' + result.exit.dfYr : (result.deferredDevFee > 0 ? '> ' + result.exit.holdYears + 'y' : 'n/a'), figures['dc-exit-defyr']);
  for (const key of ['rent10', 'vac5', 'opex10', 'combined']) {
    assert.equal(money(result.stress[key].noi), figures[`dc-r-stress-${key}-noi`]);
    assert.equal(result.stress[key].dscr.toFixed(2) + 'x', figures[`dc-r-stress-${key}-dscr`]); checked += 2;
    const margin = result.stress[key].margin;
    assert.equal((margin >= 0 ? '+' : '') + margin.toFixed(2), figures[`dc-r-stress-${key}-margin`]);
  }
  assert.deepEqual(input, before, 'pure calculation leaves caller inputs unchanged');
  result.pricedRows[0].units = 999;
  assert.deepEqual(input, before, 'returned nested values do not alias caller inputs');
  assert.equal(computeDeal(input).annualRents, computeDeal(clone(input)).annualRents, 'deterministic from plain inputs');
  if (scenario === 'B') assert.equal(money(result.trancheBreakdown[0].debtService), '$0');
}
assert.equal(checked, 52, 'all listed monetary and stress figures checked in every scenario');
const blank = computeDeal(inputsFor('C'));
for (const key of ['annualOpex', 'noi', 'mortgage', 'annualDebtService', 'gap', 'fundingGap', 'projection', 'waterfall', 'stressBase']) {
  assert.equal(blank[key], null, key + ': clearing operating cost is unavailable');
  assert.equal(blank.unavailable[key], blank.unavailable.noi, key + ': same missing-input reason');
}
assert.equal(blank.annualRents, computeDeal(inputsFor('A')).annualRents, 'known rent revenue is retained');
const enteredZero = inputsFor('A'); enteredZero.fields['dc-opex'] = '0';
assert.equal(computeDeal(enteredZero).annualOpex, 0, 'an explicit entered zero remains a measured zero');
assert(computeDeal(enteredZero).noi > 0);
assert.equal(blank.sensitivityKnown, false);
assert.equal(blank.tornado, null);
const missing = inputsFor('A');
missing.countyFips = null; missing.amiLimits = null; missing.amiLimitsByBr = null;
const unknown = computeDeal(missing);
for (const key of ['annualRents', 'noi', 'mortgage', 'annualDebtService', 'gap', 'deferredDevFee']) {
  assert.equal(unknown[key], null, `${key}: unknown is null`);
  assert.equal(typeof unknown.unavailable[key], 'string');
  assert(unknown.unavailable[key].length > 0, `${key}: reason travels with absence`);
}
assert.equal(unknown.sensitivityKnown, false);
assert.equal(unknown.tornado, null, 'unknown NOI/rents: no sensitivity swings computed from 0');
assert(unknown.unavailable.tornado, 'tornado: reason travels with absence');
for (const scenario of ['A', 'B']) {
  const known = computeDeal(inputsFor(scenario));
  assert.equal(known.sensitivityKnown, true);
  assert(Number.isFinite(known.tornado.mortLo) && known.tornado.mortLo > 0, `${scenario}: known sensitivity is still computed`);
}
// Known NOI and rents but unknown credits: the equity swings would be $0, so no sensitivity.
const noRules = inputsFor('A'); noRules.costRules = null;
const creditsUnknown = computeDeal(noRules);
assert(creditsUnknown.noi > 0 && creditsUnknown.annualRents > 0, 'non-vacuous: NOI and rents are known');
assert.equal(creditsUnknown.annualCredits, null);
assert.equal(creditsUnknown.sensitivityKnown, false);
assert.equal(creditsUnknown.tornado, null);
assert(creditsUnknown.unavailable.tornado, 'tornado: reason travels with absence');
assert.equal(unknown.exit.nNoi, null);
assert(unknown.unavailable['exit.nNoi']);
assert(!JSON.stringify(unknown).includes('NaN'));
// Typed growth outside the inputs' advertised ranges is unknown, never used or clamped.
// Rent growth may be negative (-3% to 5%); expense growth stays 0% to 6%.
for (const [id, range, ok, bad] of [['pf-rent-growth', '-3% to 5%', '5', '100'], ['pf-exp-growth', '0% to 6%', '6', '-1']]) {
  const edge = inputsFor('A'); edge.fields[id] = ok;
  assert(computeDeal(edge).exit.nNoi > 0, id + ': the range limit itself is accepted');
  const out = inputsFor('A'); out.fields[id] = bad;
  const r = computeDeal(out);
  assert.equal(r.exit.nNoi, null, id + ': out-of-range growth leaves exit NOI unavailable');
  assert.equal(r.projection, null, id + ': and the projection');
  assert.equal(r.waterfall, null, id + ': and the waterfall');
  assert(r.unavailable['exit.nNoi'].includes(range), id + ': the reason names the range');
}
// #2160: a deferred fee is a source in CHFA's gap method however its amount is
// set, so auto-balance and the same manual deferral reserve the same credit.
{
  const auto = computeDeal(inputsFor('A'));
  const manualIn = inputsFor('A'); manualIn.fields['dc-deferred-auto-balance'] = false;
  const manual = computeDeal(manualIn);
  assert(auto.deferredDevFee > 0, 'non-vacuous: auto-balance defers part of the fee when the gap method binds');
  assert.equal(auto.deferredDevFee, manual.deferredDevFee, 'auto-balance defers what the manual setting would');
  assert.equal(auto.annualCredits, manual.annualCredits, 'and the gap method reserves the same credit');
}
// Grep the whole module (stricter than just computeDeal's body).
const source = fs.readFileSync(path.join(root, 'js/deal-engine.js'), 'utf8');
assert(!/\b(?:document|window)\b/.test(source), 'engine is independent of browser state');
let mounts = 0;
for (const file of fs.readdirSync(root).filter(name => name.endsWith('.html'))) {
  const html = fs.readFileSync(path.join(root, file), 'utf8');
  const scripts = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)].map(match => match[1]);
  if (!scripts.includes('js/deal-calculator.js')) continue;
  mounts++;
  assert(scripts.indexOf('js/deal-engine.js') >= 0 && scripts.indexOf('js/deal-engine.js') < scripts.indexOf('js/deal-calculator.js'), `${file}: engine loads before calculator`);
}
assert.equal(mounts, 2, 'every calculator mount is covered');
console.log('deal-engine: PASS (invented A/B/C, 52 A/B monetary/stress comparisons with explicit L1 accrual corrections and explicit C absence, absence, purity and both mounts)');
