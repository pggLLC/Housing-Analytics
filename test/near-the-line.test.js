'use strict';
// "Near the line" (paul, 24 Nov 2026, "approve near-the-line labels"): a note beside a band or call that a
// small move would tip. It must never change the band or the call.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
let failed = 0;
function test(name, fn) {
  try { fn(); console.log('  ✅ ' + name); } catch (e) { failed += 1; console.error('  ❌ ' + name + '\n     ' + e.message); }
}
function load(file, extra) {
  const sandbox = Object.assign({ window: {}, document: { readyState: 'complete', addEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; } } }, extra || {});
  sandbox.window.document = sandbox.document;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), sandbox, { filename: file });
  return sandbox.window;
}

const O = load('js/hna/hna-ownership-need.js').HNAOwnershipNeed;
const max80 = O.maxAffordablePrice(100000, 0.8);
const max100 = O.maxAffordablePrice(100000, 1.0);
function band(price) {
  return O.affordabilityTest({ ami_4person: 100000 }, { value: price, source: 'test' });
}

console.log('near-the-line');
test('ownership: a home exactly at the 80% price is market-attainable and near the line', () => {
  const t = band(max80);
  assert.strictEqual(t.classification, 'market-attainable');
  assert.strictEqual(t.nearLine.amiPct, 80);
  assert.strictEqual(t.nearLine.pct, 0);
  assert.strictEqual(t.nearLine.becomes, 'stretch');
});
test('ownership: just inside 3% above the 100% price is priced-out, near the line, would become stretch', () => {
  const t = band(Math.round(max100 * 1.029));
  assert.strictEqual(t.classification, 'priced-out');
  assert.strictEqual(t.nearLine.amiPct, 100);
  assert.strictEqual(t.nearLine.becomes, 'stretch');
});
test('ownership: beyond 3% of both lines carries no note', () => {
  assert.strictEqual(band(Math.round(max100 * 1.04)).nearLine, null);
  assert.strictEqual(band(Math.round(max80 * 0.96)).nearLine, null);
});
test('ownership: the note never moves the band', () => {
  [0.9, 0.98, 1, 1.02].forEach((k) => {
    const p = Math.round(max80 * k), t = band(p);
    assert.strictEqual(t.classification, p <= max80 ? 'market-attainable' : p <= max100 ? 'stretch' : 'priced-out');
  });
});
test('ownership-need.json: each near-line record is within 3% and names the other band', () => {
  const recs = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/hna/ownership-need.json'), 'utf8')).records;
  let n = 0;
  Object.values(recs).forEach((r) => {
    assert.ok('affordability_near_line' in r, r.geoid + ' lacks affordability_near_line');
    const x = r.affordability_near_line;
    if (!x) return;
    n += 1;
    assert.ok(Math.abs(x.pct) <= O.NEAR_LINE_PCT, r.geoid);
    assert.notStrictEqual(x.becomes, r.affordability_classification, r.geoid);
  });
  assert.ok(n > 0, 'no record is near a line');
});

const M = load('js/hna/hna-market-call.js').HnaMarketCall;
const md = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/market/market-direction.json'), 'utf8'));
test('market call: a near-line record gets one plain sentence naming the call it would become', () => {
  const rec = { call: 'steady', near_line: [{ signal: 'rent', value: 0.3, line: 0, becomes: 'softening' }] };
  assert.strictEqual(M.nearLineText(rec), 'Near the line: the past year’s rent change, +0.3%, is 0.3 points from its 0.0% line; crossing it would make this softening.');
  assert.strictEqual(M.nearLineText({ call: 'steady', near_line: [] }), '');
});
test('market call: the HNA line carries the note only where the file has one', () => {
  const withNote = Object.keys(md.counties).find((k) => md.counties[k].near_line.length && md.counties[k].call !== 'not_enough_data');
  const without = Object.keys(md.counties).find((k) => !md.counties[k].near_line.length);
  assert.ok(/Near the line/.test(M._lineFor(md, { kind: 'county', geoid: withNote })));
  assert.ok(!/Near the line/.test(M._lineFor(md, { kind: 'county', geoid: without })));
});

if (failed) { console.error(failed + ' failed'); process.exit(1); }
