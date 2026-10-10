'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const Predictor = require('../js/lihtc-deal-predictor.js');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const base = { proposedUnits: 120, ami30UnitsNeeded: 150, competitiveSetSize: 0 };
let cases = 0;
for (const absent of [undefined, null, '', ' ', NaN, Infinity, 'bad']) {
  const rec = Predictor.predictConcept({ ...base, pmaScore: absent, softFundingAvailable: absent });
  for (const [key, reason] of [['pmaScore', 'pma_score_missing'], ['softFundingAvailable', 'soft_funding_missing']]) {
    assert.equal(rec.inputAvailability[key].value, null, key + ' stays absent');
    assert.equal(rec.inputAvailability[key].unavailableReason, reason);
    assert(rec.caveats.some(line => line.includes(rec.inputAvailability[key].reason)));
  }
  assert(!rec.keyRationale.some(line => /soft funding.*\$|PMA score|adequate PMA/i.test(line)), 'no invented-input rationale');
  assert(!rec.keyRisks.some(line => /Below-moderate PMA|Limited local soft funding|Soft funding unavailable and/i.test(line)), 'unknown is not a measured weak input');
  assert.notEqual(rec.conceptType, 'mixed-use', 'missing PMA cannot become the adequate-score finding');
  for (const key of ['localSoft', 'firstMortgage', 'gap']) assert.equal(rec.indicativeCapitalStack[key], null, key);
  assert.equal(rec.indicativeCapitalStack.unavailableReason, 'soft_funding_missing');
  assert.equal(rec.scenarioSensitivity.demandSignalRange.low, null);
  assert.equal(rec.scenarioSensitivity.demandSignalRange.high, null);
  assert.equal(rec.scenarioSensitivity.demandSignalRange.unavailableReason, 'pma_score_missing');
  cases++;
}
const known = Predictor.predictConcept({ ...base, softFundingAvailable: 750000, pmaScore: 72 });
assert.equal(known.inputAvailability.softFundingAvailable.value, 750000);
assert.equal(known.indicativeCapitalStack.localSoft, 750000);
assert(known.keyRationale.some(line => /soft funding/i.test(line) && line.includes('$750K')));
assert.equal(known.conceptType, 'mixed-use');
assert.equal(known.scenarioSensitivity.demandSignalRange.low, 'moderate');
assert.equal(known.scenarioSensitivity.demandSignalRange.high, 'strong');
const zero = Predictor.predictConcept({ ...base, softFundingAvailable: 0, pmaScore: 0 });
assert.equal(zero.indicativeCapitalStack.localSoft, 0);
assert.equal(zero.inputAvailability.pmaScore.value, 0);
assert.equal(zero.inputAvailability.pmaScore.unavailableReason, null);
assert(zero.keyRisks.some(line => line.includes('PMA score (0)')));
assert(zero.keyRisks.some(line => /Limited local soft funding/.test(line)));

// The actual PMA consumers must not turn the new null stack entries into $0.
for (const externalRenderer of [true, false]) {
  const dom = new JSDOM('<div id="lihtcConceptCard"></div>', { url: 'https://example.org/market-analysis.html', runScripts: 'outside-only' });
  const w = dom.window;
  w.setTimeout = () => 0;
  w.fetch = () => Promise.resolve({ ok: false });
  w.LIHTCDealPredictor = Predictor;
  const handlers = {};
  w.PMAAnalysisRunner = { run: () => ({ on: function(event, fn) { handlers[event] = fn; return this; } }) };
  if (externalRenderer) w.eval(read('js/lihtc-concept-card-renderer.js'));
  w.eval(read('js/pma-ui-controller.js'));
  w.PMAUIController.runEnhanced(39.1, -105.1);
  handlers.complete({ pma: {} });
  const card = w.document.getElementById('lihtcConceptCard');
  for (const label of ['1st Mortgage', 'Local Soft']) {
    const row = [...card.querySelectorAll('tr')].find(el => el.cells[0]?.textContent === label);
    assert(row, label + ' is checked on the ' + externalRenderer + ' renderer');
    assert.match(row.cells[1].textContent, /unavailable/i);
    assert(!row.cells[1].textContent.includes('$0'));
  }
  assert(card.querySelector('[data-unavailable-reason="soft_funding_missing"]'));
  dom.window.close(); cases++;
}
assert.equal(cases, 9, 'all missing-value forms and both PMA consumers checked');
console.log('predictor-policy: PASS (invented absence, $750,000, measured zero and both real PMA consumers)');
