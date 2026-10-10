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
function inputsFor(scenario) {
  const fixture = golden.scenarios[scenario];
  return clone({ fields: fixture.fields, tranches: fixture.tranches,
    amiLimits: Object.fromEntries(Object.entries(fixture.amiLimitsByBr).map(([tier, rows]) => [tier, rows['2br']])),
    amiLimitsByBr: fixture.amiLimitsByBr, countyFips: '08001', creditRate: 0.09,
    constants: fixture.constants, equityPriceDefault: 0.82, minimumSetAsideElection: '40-60', regime: 'chfa_lihtc',
    resolvedDealMix: { available: false, reason: 'schedule_unavailable:subject_project_unavailable' },
    utilityAllowance: { applied: false, reason: 'allowance_method_missing' },
    perBrMarket: null, manualMarket: { mode: 'zori', note: '', rents: {}, zori: null, source: {}, fallbackBedroom: '2br' },
    hasUnitMixWarning: true, fmrData: sources['data/hud-fmr-income-limits.json'].counties[0].fmr });
}
const money = n => '$' + Math.round(n).toLocaleString('en-US');
const moneyFields = { annualRents: 'dc-r-rents', noi: 'dc-r-noi-stab', mortgage: 'dc-r-mortgage',
  eligibleBasis: 'dc-r-basis', annualCredits: 'dc-r-credits', equity: 'dc-r-equity',
  devFeeTotal: 'dc-r-devfee', deferredDevFee: 'dc-r-deferred', devFeeAtClosing: 'dc-r-devfee-closing',
  annualDebtService: 'dc-r-ads', netPropTax: 'dc-r-proptax', gap: 'dc-su-gap', tdc: 'dc-su-tdc' };
let checked = 0;
for (const scenario of ['A', 'B', 'C']) {
  const input = inputsFor(scenario);
  const before = clone(input);
  const result = computeDeal(input);
  const figures = golden.scenarios[scenario].figures;
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
  if (scenario === 'B') assert.equal(money(result.trancheBreakdown[0].debtService), '$50,592');
  if (scenario === 'C') assert.equal(result.annualOpex, 0, 'legacy blank-opex rule is intentionally unchanged');
}
assert.equal(checked, 78, 'all listed monetary and stress figures checked in every scenario');
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
for (const scenario of ['A', 'B', 'C']) {
  const known = computeDeal(inputsFor(scenario));
  assert.equal(known.sensitivityKnown, true);
  assert(Number.isFinite(known.tornado.mortLo) && known.tornado.mortLo > 0, `${scenario}: known sensitivity is still computed`);
}
assert.equal(unknown.exit.nNoi, null);
assert(unknown.unavailable['exit.nNoi']);
assert(!JSON.stringify(unknown).includes('NaN'));
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
console.log('deal-engine: PASS (invented A/B/C, 78 monetary/stress comparisons, absence, purity and both mounts)');
