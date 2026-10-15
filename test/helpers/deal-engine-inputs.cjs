'use strict';
const golden = require('../fixtures/deal-engine/golden.json');
const sources = require('../fixtures/deal-engine/invented-sources.cjs');
// #2160: the page prefills the INVENTED example budget; engine tests use the same lines.
const costBasis = require('../../js/deal-cost-basis.js');
const costRules = require('../../data/policy/lihtc-underwriting-rules.json');
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
    hasUnitMixWarning: true, fmrData: sources['data/hud-fmr-income-limits.json'].counties[0].fmr,
    costLines: costBasis.exampleLines(), costRules });
}
module.exports = { inputsFor };
