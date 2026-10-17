#!/usr/bin/env node
'use strict';
// DOH PR 3 on the real Deal Calculator page (jsdom, page scripts in order). The
// permanent financing table must agree with js/deal-permanent-financing.js run
// on the page's own engine result, not with numbers copied here. Deal figures
// are the page's INVENTED defaults.
const assert = require('node:assert/strict');
const { openPage, setField, close } = require('./helpers/deal-calculator-page.cjs');
const pf = require('../js/deal-permanent-financing.js');

const fruta = { geoType: 'place', geoid: '0828745', placeGeoid: '0828745', name: 'Fruita', countyFips: '08077', countyName: 'Mesa County' };
const money = (n) => '$' + Math.round(n).toLocaleString('en-US');
const amount = (p, key) => { const r = p.d.querySelector('[data-pf-row="' + key + '"]'); return r ? r.querySelector('[data-pf-amount]').textContent : null; };
const val = (p, id) => String(p.d.getElementById(id).value).trim();
function moduleView(p) {
  const r = p.w.__DealCalc.getResult();
  return { r, s: pf.summarize({ result: r, tranches: r.tranches || [], seniorLenderType: val(p, 'dc-senior-lender-type'),
    capRatePct: val(p, 'dc-pf-cap-rate'), capLvrPct: val(p, 'dc-pf-cap-lvr'),
    appraisedValue: val(p, 'dc-pf-appraised'), appraisedLvrPct: val(p, 'dc-pf-appraised-lvr') }) };
}
function setRow(p, row, sel, value) {
  const el = p.d.querySelectorAll('[data-tranche-id]')[row].querySelector(sel);
  assert(el, sel + ' renders in tranche row ' + row);
  el.value = value;
  el.dispatchEvent(new p.w.Event('input', { bubbles: true }));
  el.dispatchEvent(new p.w.Event('change', { bubbles: true }));
}
const doh = (p, row) => p.d.querySelectorAll('[data-tranche-id]')[row].querySelector('.dc-tr-doh');
let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  PASS ' + name); }
  catch (err) { failed++; console.error('  FAIL ' + name + '\n' + (err && err.stack || err)); }
}

(async () => {
  console.log('Deal Calculator permanent financing on the page (DOH PR 3)');
  await test('the table shows the module\'s DOH groups for the page\'s own result, and they add to TDC', async () => {
    const p = await openPage('', null, { jurisdiction: fruta });
    const { r, s } = moduleView(p);
    assert(Number.isFinite(r.gap) && r.mortgage > 0 && r.tdc > 0, 'a real result to check against');
    const t = s.totals;
    assert.equal(amount(p, 'conventional'), money(t.conventional));
    assert.equal(amount(p, 'conventional'), money(r.mortgage), 'the first mortgage defaults to Conventional');
    assert.equal(amount(p, 'tax_credits'), money(t.taxCredits));
    assert.equal(amount(p, 'nine'), money(r.equity));
    assert.equal(amount(p, 'owner'), money(t.ownerEquity));
    assert.equal(amount(p, 'deferred_fee'), money(r.deferredDevFee));
    assert.equal(amount(p, 'total_sources'), money(t.totalSources));
    assert.equal(amount(p, 'gap'), money(r.gap));
    assert.equal(amount(p, 'tdc'), money(r.tdc));
    assert(Math.abs(t.totalSources + r.gap - r.tdc) < 0.01, 'total sources plus gap is TDC');
    assert.equal(p.d.querySelectorAll('[data-pf-mortgage]').length, 1);
    assert.equal(p.d.querySelector('[data-pf="possible-ds"]').textContent, money(r.noi / pf.DOH_DCR));
    assert.match(p.d.querySelector('[data-pf="cap-value"]').textContent, /Enter a cap rate/);
    assert.equal(val(p, 'dc-senior-lender-type'), 'C');
    assert.deepEqual(p.errors, []);
  });

  await test('a tranche\'s DOH group moves its dollars between rows; a hard mortgage becomes the second mortgage', async () => {
    const p = await openPage('', null, { jurisdiction: fruta });
    setRow(p, 0, '.dc-tr-prog', 'prop123');
    assert.equal(doh(p, 0).value, 'government', 'a program change takes that program\'s default group');
    setRow(p, 0, '.dc-tr-amount', '400000');
    let v = moduleView(p);
    assert.equal(v.s.government.length, 1, 'the tranche counts as government money');
    assert.equal(amount(p, 'government'), money(v.s.totals.government));
    assert.equal(amount(p, 'government'), money(400000));
    setRow(p, 0, '.dc-tr-doh', 'hard_T');
    v = moduleView(p);
    assert.equal(amount(p, 'tax_exempt'), money(400000));
    assert.equal(amount(p, 'government'), money(0));
    const second = p.d.querySelector('[data-pf-mortgage="1"]');
    assert(second && /^Second mortgage \(Prop 123\): Tax-exempt/.test(second.textContent), second && second.textContent);
    assert.equal(amount(p, 'total_sources'), money(v.s.totals.totalSources));
    setField(p, 'dc-senior-lender-type', 'F');
    assert.equal(amount(p, 'federal_financing'), money(p.w.__DealCalc.getResult().mortgage));
    assert.equal(amount(p, 'conventional'), money(0));
    setRow(p, 0, '.dc-tr-prog', 'other');
    assert.equal(doh(p, 0).value, '', 'Other / custom is not guessed');
    assert(amount(p, 'unclassified'), 'an ungrouped source gets its own row');
    assert.match(p.d.getElementById('dc-pf-reason').textContent, /Choose where this source counts/);
    assert.equal(p.d.getElementById('dc-pf-reason').hidden, false);
    assert.deepEqual(p.errors, []);
  });

  await test('maximum loan by value uses the entered cap rate and LVR', async () => {
    const p = await openPage('', null, { jurisdiction: fruta });
    setField(p, 'dc-pf-cap-rate', '6.5'); setField(p, 'dc-pf-cap-lvr', '80');
    setField(p, 'dc-pf-appraised', '9000000'); setField(p, 'dc-pf-appraised-lvr', '75');
    const { r, s } = moduleView(p);
    assert.equal(p.d.querySelector('[data-pf="cap-max"]').textContent, money(r.noi / 0.065 * 0.8));
    assert.equal(p.d.querySelector('[data-pf="appraised-max"]').textContent, money(6750000));
    assert.equal(p.d.querySelector('[data-pf="over-max"]').textContent, money(s.overMaxLoan));
    assert.deepEqual(p.errors, []);
  });

  await test('a share link and the JSON export carry each tranche\'s DOH group and the lender type; an older link keeps the program default', async () => {
    const sender = await openPage('', null, { jurisdiction: fruta });
    setRow(sender, 0, '.dc-tr-prog', 'prop123');
    setRow(sender, 0, '.dc-tr-amount', '400000');
    setRow(sender, 0, '.dc-tr-doh', 'owner');
    setField(sender, 'dc-senior-lender-type', 'T');
    const params = new URLSearchParams(sender.w.__DealCalcShare.serialize());
    const tr = params.get('tr');
    assert.equal(tr.split(':')[12], 'owner', 'the thirteenth tranche field is the DOH group');
    assert.equal(params.get('senior-lender-type'), 'T');
    const snap = sender.w.__DealCalcShare.buildSnapshot();
    assert.equal(snap.tranches[0].doh, 'owner', 'the JSON export carries the DOH group too');
    const recipient = await openPage('?' + params.toString(), null, { jurisdiction: fruta });
    assert.equal(doh(recipient, 0).value, 'owner');
    assert.equal(val(recipient, 'dc-senior-lender-type'), 'T');
    assert.equal(amount(recipient, 'tax_exempt'), amount(sender, 'tax_exempt'));
    assert.equal(amount(recipient, 'owner'), amount(sender, 'owner'));
    const old = new URLSearchParams(params);
    old.set('tr', tr.split(':').slice(0, 12).join(':'));
    const oldRecipient = await openPage('?' + old.toString(), null, { jurisdiction: fruta });
    assert.equal(doh(oldRecipient, 0).value, 'government', 'a link from before this change takes the program default');
    assert.deepEqual(sender.errors.concat(recipient.errors, oldRecipient.errors), []);
  });

  close();
  console.log(passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
