'use strict';
// The market-analysis supply stat must be labelled for what it counts, and a
// project with no reported unit count must be disclosed, not summed as 0.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const S = require('../js/market-analysis-supply.js');
const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'market-analysis.html'), 'utf8');
const js = fs.readFileSync(path.join(ROOT, 'js/market-analysis.js'), 'utf8');

// 1. Behaviour: parts kept separate, unknown units disclosed, never 0.
const lihtc = [{ properties: { N_UNITS: 40 } }, { properties: { TOTAL_UNITS: '20' } }];
const other = [{ total_units: 12 }, { assisted_units: null, total_units: null }, { total_units: 0 }];
const s = S.summarizeAffordableSupply(lihtc, other);
assert.strictEqual(s.lihtcCount, 2);
assert.strictEqual(s.lihtcUnits, 60);
assert.strictEqual(s.otherAssistedCount, 3);
assert.strictEqual(s.affordableCount, s.lihtcCount + s.otherAssistedCount);
assert.strictEqual(s.affordableUnitsKnown, 72);
assert.strictEqual(s.unitsUnknownCount, 2, 'null and 0 unit counts are unknown, not zero');
assert(/2 of 5/.test(s.unitsUnavailableReason), s.unitsUnavailableReason);
const allUnknown = S.summarizeAffordableSupply([], [{ total_units: null }]);
assert.strictEqual(allUnknown.affordableUnits, null, 'no reported counts → null, not 0');
assert.strictEqual(S.summarizeAffordableSupply([], []).unitsUnavailableReason, null);

// 2. Agreement: each element the renderer fills with a combined figure must
//    carry a label that names that figure, not "LIHTC".
const combined = [
  ['result.affordableCount', /affordable[^]*project/i],
  ['result.affordableUnitsKnown', /affordable[^]*unit/i],
];
combined.forEach(([expr, want]) => {
  const re = new RegExp("setText\\('([A-Za-z]+)',[^;]*" + expr.replace('.', '\\.') + '\\b');
  const m = js.match(re);
  assert(m, 'renderer writes ' + expr + ' to a stat (scan found nothing)');
  const block = html.match(new RegExp('id="' + m[1] + '"[^]*?pma-stat-label">([^<]+)<'));
  assert(block, 'stat #' + m[1] + ' exists in market-analysis.html with a label');
  assert(want.test(block[1]) && !/^\s*LIHTC/i.test(block[1]),
    '#' + m[1] + ' label "' + block[1] + '" must describe ' + expr);
});
// The units stat and the capture rate must read the same figure.
assert(js.includes('computePma(acs, affordableUnitsKnown,'), 'capture scoring uses affordableUnitsKnown');
assert(/var exUnits = result\.affordableUnitsKnown;/.test(js), 'capture numerator line uses affordableUnitsKnown');
assert(/'Value unavailable'/.test(js) && /result\.affordableUnits == null \? null/.test(js),
  'units stat shows Value unavailable when no project reports a count');
// And nothing labelled LIHTC-only is fed the combined count.
assert(!/setText\('pmaLihtc[A-Za-z]*',\s*result\.affordable/.test(js));
// 3. The disclosure element the renderer fills must exist.
assert(js.includes("el('pmaAffordableUnitsNote')") && html.includes('id="pmaAffordableUnitsNote"'));
console.log('pma-affordable-supply-label: all assertions passed');
