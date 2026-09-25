'use strict';

// Every capture rate on the Market Analysis page divides by one denominator,
// and says which (audit F3).
//
// Found 2026-09-24: the headline and the simulator divided by CHAS
// LIHTC-eligible renters while showing the ACS renter total beside them, and
// the scenario table divided by the ACS total. For Fruita, 100 proposed units
// read 16.7% in the simulator and 10.1% in the scenario table.
//
// The rendered agreement (each displayed rate = its numerator / the
// denominator shown beside it, the same denominator on all three surfaces) is
// held in the browser by scripts/audit/core-rendered-smoke.mjs, which the
// site-audit workflow runs on every PR. This file holds the two pure pieces:
// which denominator is chosen, and that the scenario table divides by it.

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'js/market-analysis.js'), 'utf8');

let failures = 0;
function test(name, fn) {
  try { fn(); console.log('  ✓ ' + name); }
  catch (e) { failures += 1; console.log('  ✗ ' + name + ' — ' + e.message); }
}

// The page's own risk thresholds (market-analysis.js reads PMAScoring.RISK).
const { RISK } = require(path.join(ROOT, 'js/market-analysis-scoring.js'));

function extract(name) {
  const m = src.match(new RegExp('function ' + name + '\\([\\s\\S]*?\\n  \\}'));
  assert(m, name + '() is gone from js/market-analysis.js');
  return new Function('RISK', m[0] + '; return ' + name + ';')(RISK);
}

console.log('\nCapture rates share one denominator and name it');

const captureDenominator = extract('captureDenominator');
const simulateCapture = extract('simulateCapture');

test('the CHAS LIHTC-eligible count is the denominator when it exists, and says so', () => {
  const d = captureDenominator({ captureDenominator: { value: 598, source: 'chas_lihtc_eligible' }, acs: { renter_hh: 991 } });
  assert.strictEqual(d.value, 598);
  assert(/CHAS/.test(d.label) && /80% AMI/.test(d.label), 'the label does not name the CHAS <=80% AMI pool: ' + d.label);
});

test('without CHAS the all-renter fallback is labelled as all incomes, not as eligible renters', () => {
  const d = captureDenominator({ captureDenominator: { value: 991, source: 'acs_total_renter_hh' } });
  assert.strictEqual(d.value, 991);
  assert(/all incomes/.test(d.label) && !/eligible/i.test(d.label), 'fallback label: ' + d.label);
});

test('no renter count is no denominator, never the scoring placeholder of 1 or 0', () => {
  for (const cd of [{ value: 1, source: 'fallback_1' }, { value: 0, source: 'acs_total_renter_hh' }, { value: null, source: 'chas_lihtc_eligible' }, null]) {
    assert.strictEqual(captureDenominator({ captureDenominator: cd }), null, JSON.stringify(cd) + ' gave a denominator');
  }
});

test('the scenario table divides by the denominator it is given', () => {
  global.window = { PMAEngine: {
    computePma: () => ({ overall: 50, dimensions: { captureRisk: 50 }, flags: [] }),
    simulateCapture,
  } };
  const abs = path.join(ROOT, 'js/market-analysis-enhancements.js');
  delete require.cache[require.resolve(abs)];
  require(abs);
  const ENH = global.window.PMAEnhancements;
  assert(ENH && typeof ENH.generateScenarios === 'function', 'PMAEnhancements.generateScenarios is not exposed');
  const acs = { renter_hh: 991 };
  const list = ENH.defaultScenarios(100);
  const withDen = ENH.generateScenarios(acs, 0, list, 598);
  assert.strictEqual(withDen[0].captureRate, Math.round(100 / 598 * 1000) / 10,
    `baseline reads ${withDen[0].captureRate}%, not 100 / 598`);
  assert.strictEqual(withDen[0].captureRate, simulateCapture(598, 100, { ami60: 100 }).captureRate,
    'the scenario baseline and the simulator disagree for the same units and denominator');
  delete global.window;
});

console.log(failures ? `\n${failures} failure(s)` : '\nAll checks passed ✅');
process.exit(failures ? 1 : 0);
