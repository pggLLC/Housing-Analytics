'use strict';

// The Deal Calculator's perm-rate hint is the live FRED 10-year Treasury plus
// the spread data/policy/lihtc-assumptions.json states (2026-10). It replaced
// a typed "Freddie Mac outlook" snapshot whose figures had no citable source.
// The hint must agree with those two files, and an unknown 10-year must show
// no hint at all rather than a rate built on 0.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const root = path.join(__dirname, '..');
const read = (rel) => JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
const FRED = read('data/fred-data.json');
const ASSUMPTIONS = read('data/policy/lihtc-assumptions.json');

function latestDgs10(doc) {
  const obs = doc.series.DGS10.observations || doc.series.DGS10.data;
  for (let i = obs.length - 1; i >= 0; i--) {
    const n = Number(obs[i].value);
    if (obs[i].value !== '.' && obs[i].value !== '' && Number.isFinite(n) && n > 0) return { value: n, date: obs[i].date };
  }
  return null;
}

async function render(fred) {
  const dom = new JSDOM('<!DOCTYPE html><body><div id="dealCalcMount"></div></body>', { url: 'http://localhost/deal-calculator.html' });
  global.window = dom.window;
  global.document = dom.window.document;
  global.HTMLElement = dom.window.HTMLElement;
  global.Event = dom.window.Event;
  window.COHO_DEFAULTS = { creditRate9Pct: 0.09, creditRate4Pct: 0.04, equityPrice9Pct: 0.82, equityPrice4Pct: 0.83 };
  window.DealCalculatorMath = require('../js/deal-calculator-math.js');
  global.fetch = window.fetch = (url) => {
    const u = String(url);
    if (u.includes('fred-data.json')) return Promise.resolve({ ok: true, json: () => Promise.resolve(fred) });
    if (u.includes('lihtc-assumptions.json')) return Promise.resolve({ ok: true, json: () => Promise.resolve(ASSUMPTIONS) });
    return Promise.reject(new Error('fixture fetch disabled'));
  };
  delete require.cache[require.resolve('../js/deal-calculator.js')];
  require('../js/deal-calculator.js');
  document.dispatchEvent(new Event('DOMContentLoaded', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 450));
  return dom.window.document;
}

(async () => {
  console.log('\nDeal Calculator perm-rate hint tests');
  console.log('='.repeat(40));
  const t10 = latestDgs10(FRED);
  const spread = ASSUMPTIONS.permRateSpreadOverTreasury.spreadPct;
  assert(t10, 'the committed FRED file has a 10-year value to check against');
  assert(spread >= 0, 'the assumptions file states a spread');

  const doc = await render(FRED);
  const hint = doc.getElementById('dc-perm-hint');
  assert(hint, 'hint renders from the data files');
  assert.strictEqual(hint.textContent, (t10.value + spread).toFixed(2) + '%', 'hint = latest FRED 10-year + stated spread');
  assert(doc.getElementById('dc-freddie-benchmark').textContent.includes(t10.date), 'hint shows the 10-year observation date');
  assert.strictEqual(doc.getElementById('dc-perm-spread').value, spread.toFixed(2), 'spread input starts at the stated spread');
  assert(!doc.getElementById('dc-perm-spread').closest('label[for], label').querySelector('#dc-rate'), 'spread input is not inside the Interest Rate label');

  doc.getElementById('dc-perm-spread').value = '2.00';
  doc.getElementById('dc-perm-spread').dispatchEvent(new window.Event('input'));
  assert.strictEqual(hint.textContent, (t10.value + 2).toFixed(2) + '%', 'editing the spread updates the hint');
  doc.getElementById('dc-freddie-apply').click();
  assert.strictEqual(doc.getElementById('dc-rate').value, (t10.value + 2).toFixed(2), 'apply writes the hinted rate');

  // FRED's "." (no value that day) is skipped, never read as 0.
  const dotted = JSON.parse(JSON.stringify(FRED));
  const obs = dotted.series.DGS10.observations || dotted.series.DGS10.data;
  obs.push({ date: '2099-01-01', value: '.' });
  const doc2 = await render(dotted);
  assert.strictEqual(doc2.getElementById('dc-perm-hint').textContent, (t10.value + spread).toFixed(2) + '%', 'a "." observation is skipped');

  // No usable 10-year: no hint and no button, not a rate built on zero.
  const empty = JSON.parse(JSON.stringify(FRED));
  (empty.series.DGS10.observations ? empty.series.DGS10.observations : empty.series.DGS10.data).forEach((o) => { o.value = '.'; });
  const doc3 = await render(empty);
  assert.strictEqual(doc3.getElementById('dc-perm-hint'), null, 'no hint without a 10-year value');
  assert.strictEqual(doc3.getElementById('dc-freddie-apply'), null, 'no apply button without a 10-year value');

  console.log('All Deal Calculator perm-rate hint tests passed.');
})().catch((err) => { console.error(err); process.exit(1); });
