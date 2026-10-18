#!/usr/bin/env node
'use strict';
// DOH PR 4 on the real Deal Calculator page (jsdom, page scripts in order).
// Sources by activity and the 15-year rows must agree with
// js/deal-doh-schedules.js run on the page's own engine result, not with
// numbers copied here. Deal figures are the page's INVENTED defaults.
const assert = require('node:assert/strict');
const { openPage, setField, close } = require('./helpers/deal-calculator-page.cjs');
const ds = require('../js/deal-doh-schedules.js');

const fruta = { geoType: 'place', geoid: '0828745', placeGeoid: '0828745', name: 'Fruita', countyFips: '08077', countyName: 'Mesa County' };
const money = (n) => '$' + Math.round(n).toLocaleString('en-US');
const cell = (p, row, col) => { const r = p.d.querySelector('[data-su-row="' + row + '"]'); return r ? r.querySelector('[data-su="' + col + '"]').textContent : null; };
const year = (p, row, n) => { const r = p.d.querySelector('[data-doh15-row="' + row + '"]'); return r ? r.querySelectorAll('td')[n - 1].textContent : null; };
function setRow(p, row, sel, value) {
  const el = p.d.querySelectorAll('[data-tranche-id]')[row].querySelector(sel);
  assert(el, sel + ' renders in tranche row ' + row);
  el.value = value;
  el.dispatchEvent(new p.w.Event('input', { bubbles: true }));
  el.dispatchEvent(new p.w.Event('change', { bubbles: true }));
}
const rowField = (p, row, sel) => p.d.querySelectorAll('[data-tranche-id]')[row].querySelector(sel).value;
let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  PASS ' + name); }
  catch (err) { failed++; console.error('  FAIL ' + name + '\n' + (err && err.stack || err)); }
}

(async () => {
  console.log('Deal Calculator sources by activity and 15-year rows on the page (DOH PR 4)');
  await test('the activity table and 15-year rows show the module\'s view of the page\'s own result', async () => {
    const p = await openPage('', null, { jurisdiction: fruta });
    const r = p.w.__DealCalc.getResult();
    const shown = p.w.__DealCalc.getDohSchedules();
    assert(Number.isFinite(r.gap) && r.deferredDevFee > 0 && r.projection, 'a real result to check against');
    assert.equal(cell(p, 'construction', 'cost'), money(r.costBasis.summary.groups.construction));
    assert.equal(cell(p, 'total', 'cost'), money(r.tdc));
    assert.equal(cell(p, 'gap', 'other'), money(r.gap));
    assert.equal(cell(p, 'total', 'other'), money(shown.sourcesByActivity.totals.other));
    assert.equal(cell(p, 'total', 'other'), money(p.w.__DealCalc.getPermanentFinancing().totals.totalSources), 'every source counted once');
    const f = ds.fifteenYear(r);
    assert.equal(year(p, 'noi', 1), money(f.rows[0].noi));
    assert.equal(year(p, 'noi', 15), money(f.rows[14].noi));
    assert.equal(year(p, 'deferred_fee', 1), money(f.rows[0].deferredFee));
    assert.equal(year(p, 'after', 15), money(f.rows[14].availableAfterPayments));
    assert.equal(p.d.querySelector('[data-doh15="payback"]').textContent, 'Year ' + r.exit.dfYr, 'the payback year is the exit panel\'s');
    assert.equal(p.d.querySelector('[data-doh15-total="deferred_fee"]').querySelectorAll('td')[2].textContent, money(f.deferredFee.totals.total));
    assert.deepEqual(p.errors, []);
  });

  await test('a source\'s activity, status and state flag move its dollars on the table', async () => {
    const p = await openPage('', null, { jurisdiction: fruta });
    setRow(p, 0, '.dc-tr-prog', 'prop123');
    assert.equal(rowField(p, 0, '.dc-tr-state'), 'yes', 'Prop 123 is a state request by default');
    setRow(p, 0, '.dc-tr-amount', '400000');
    assert.equal(cell(p, 'general', 'state'), money(400000), 'unassigned, it pays for the whole project');
    setRow(p, 0, '.dc-tr-activity', 'construction');
    setRow(p, 0, '.dc-tr-status', 'committed');
    assert.equal(cell(p, 'construction', 'state'), money(400000));
    assert.equal(cell(p, 'construction', 'sources'), 'Prop 123 (committed)');
    const live = p.d.getElementById('dc-act-live').textContent;
    assert.match(live, /^Sources by activity updated\. /, 'screen readers hear the moved dollars');
    assert(live.includes('Construction: state ' + money(400000)) && live.includes('Prop 123, committed'), live);
    setRow(p, 0, '.dc-tr-status', 'pending');
    assert(p.d.getElementById('dc-act-live').textContent.includes('Prop 123, pending'), 'a status-only change is announced');
    setRow(p, 0, '.dc-tr-amount', '');
    const blank = p.d.getElementById('dc-act-live').textContent;
    assert(blank.includes('Construction: state unavailable'), 'an unknown amount is read as unavailable, not $0: ' + blank);
    assert.match(p.d.getElementById('dc-act-reason').textContent, /Prop 123 has no valid amount/, 'and the reason says which source');
    setRow(p, 0, '.dc-tr-amount', '400000');
    setRow(p, 0, '.dc-tr-status', 'committed');
    assert.equal(cell(p, 'general', 'state'), '—');
    setRow(p, 0, '.dc-tr-state', 'no');
    assert.equal(cell(p, 'construction', 'state'), '—');
    assert.equal(cell(p, 'construction', 'other'), money(400000));
    setRow(p, 0, '.dc-tr-prog', 'chfa_htf');
    assert.equal(rowField(p, 0, '.dc-tr-state'), 'no', 'a program change takes that program\'s default');
    setRow(p, 0, '.dc-tr-amount', '900000');
    setRow(p, 0, '.dc-tr-activity', 'reserves');
    assert.match(p.d.getElementById('dc-act-reason').textContent, /more than its cost/);
    assert.equal(p.d.getElementById('dc-act-reason').hidden, false);
    assert.deepEqual(p.errors, []);
  });

  await test('asset management and bridge payments change the rows and the payback year; a blank entry says why', async () => {
    const p = await openPage('', null, { jurisdiction: fruta });
    const before = p.w.__DealCalc.getResult().exit.dfYr;
    setField(p, 'dc-asset-mgmt-fee', '15000');
    setField(p, 'dc-bridge-ds', '30000'); setField(p, 'dc-bridge-years', '2');
    const r = p.w.__DealCalc.getResult();
    assert.equal(before, 14, 'the invented default repays in year 14');
    assert.equal(r.exit.dfYr, null, 'with the payments it is not repaid within 15 years');
    assert.equal(year(p, 'bridge', 1), money(30000));
    assert.equal(year(p, 'bridge', 3), money(0));
    assert.equal(year(p, 'asset_fee', 1), money(15000));
    assert.equal(p.d.querySelector('[data-doh15="payback"]').textContent, 'Cash flow does not repay the deferred fee within 15 years.');
    const f = ds.fifteenYear(r);
    assert(f.deferredFee.unpaidAfter > 0);
    assert.equal(p.d.querySelector('[data-doh15="unpaid"]').textContent, money(f.deferredFee.unpaidAfter));
    assert.equal(p.d.getElementById('dc-exit-defyr').textContent, '> 15y', 'the exit panel agrees');
    assert.equal(p.d.getElementById('dc-doh15-live').textContent, 'DOH 15-year schedule updated. Deferred developer fee not repaid: ' + f.deferredFee.reason + '.', 'screen readers hear the changed answer');
    ['dc-asset-mgmt-fee', 'dc-asset-mgmt-growth', 'dc-bridge-ds', 'dc-bridge-years'].forEach(id => assert.equal(p.d.getElementById(id).style.minHeight, '44px', id + ' is a 44px touch target'));
    assert.equal(p.d.querySelector('[data-doh15="asset-unpaid"]'), null, 'a fee cash covers owes nothing after year 15');
    setField(p, 'dc-asset-mgmt-fee', '900000');
    const owed = ds.fifteenYear(p.w.__DealCalc.getResult()).assetMgmt.unpaidAfter;
    assert(owed > 0);
    assert.equal(p.d.querySelector('[data-doh15="asset-unpaid"]').textContent, money(owed), 'a fee cash cannot cover shows what is still owed');
    setField(p, 'dc-asset-mgmt-fee', '0'); setField(p, 'dc-bridge-ds', '5000'); setField(p, 'dc-bridge-years', '1');
    const r2 = p.w.__DealCalc.getResult();
    assert(r2.exit.dfYr >= before, 'a small bridge payment repays no sooner');
    assert.equal(p.d.querySelector('[data-doh15="payback"]').textContent, 'Year ' + r2.exit.dfYr);
    assert.equal(p.d.getElementById('dc-exit-defyr').textContent, 'Year ' + r2.exit.dfYr);
    assert.equal(p.d.querySelector('[data-doh15-row="unpaid_ds"]'), null, 'no unpaid debt service row when the mortgage is covered');
    setField(p, 'dc-senior-mode', 'entered'); setField(p, 'dc-senior-amount', '20000000');
    const under = ds.fifteenYear(p.w.__DealCalc.getResult());
    assert(under.rows[0].mustPayUnpaid > 0, 'an undercovered entered mortgage');
    assert.equal(year(p, 'unpaid_ds', 1), money(under.rows[0].mustPayUnpaid), 'the unpaid debt service is shown, so the rows add up');
    setField(p, 'dc-senior-mode', 'sized');
    setField(p, 'dc-asset-mgmt-fee', '');
    assert.equal(p.d.getElementById('dc-doh15-reason').textContent, 'Unavailable — Enter the asset management fee as $0 or more a year.');
    assert.equal(p.d.getElementById('dc-doh15-table').textContent, '');
    assert.deepEqual(p.errors, []);
  });

  await test('a share link and the JSON export carry the new fields; an older link keeps the defaults', async () => {
    const sender = await openPage('', null, { jurisdiction: fruta });
    setRow(sender, 0, '.dc-tr-prog', 'chfa_htf');
    setRow(sender, 0, '.dc-tr-amount', '300000');
    setRow(sender, 0, '.dc-tr-activity', 'site');
    setRow(sender, 0, '.dc-tr-status', 'committed');
    setRow(sender, 0, '.dc-tr-state', 'yes');
    setField(sender, 'dc-asset-mgmt-fee', '12000');
    const params = new URLSearchParams(sender.w.__DealCalcShare.serialize());
    const tr = params.get('tr');
    assert.deepEqual(tr.split(':').slice(13), ['site', 'committed', 'yes']);
    assert.equal(params.get('asset-mgmt-fee'), '12000');
    const snap = sender.w.__DealCalcShare.buildSnapshot();
    assert.equal(snap.tranches[0].activity, 'site');
    assert.equal(snap.tranches[0].status, 'committed');
    assert.equal(snap.tranches[0].stateRequest, true);
    assert.equal(money(snap.dohSchedules.sourcesByActivity.rows.find(x => x.id === 'site').state), cell(sender, 'site', 'state'), 'the export matches the table');
    assert.equal(snap.dohSchedules.fifteenYear.deferredFee.paybackYear, sender.w.__DealCalc.getResult().exit.dfYr);
    const recipient = await openPage('?' + params.toString(), null, { jurisdiction: fruta });
    assert.equal(rowField(recipient, 0, '.dc-tr-activity'), 'site');
    assert.equal(rowField(recipient, 0, '.dc-tr-status'), 'committed');
    assert.equal(rowField(recipient, 0, '.dc-tr-state'), 'yes');
    assert.equal(cell(recipient, 'site', 'state'), cell(sender, 'site', 'state'));
    assert.equal(recipient.d.querySelector('[data-doh15="payback"]').textContent, sender.d.querySelector('[data-doh15="payback"]').textContent);
    const old = new URLSearchParams(params);
    old.set('tr', tr.split(':').slice(0, 13).join(':'));
    old.delete('asset-mgmt-fee');
    const oldRecipient = await openPage('?' + old.toString(), null, { jurisdiction: fruta });
    assert.equal(rowField(oldRecipient, 0, '.dc-tr-activity'), '', 'a link from before this change pays for the whole project');
    assert.equal(rowField(oldRecipient, 0, '.dc-tr-status'), 'pending');
    assert.equal(rowField(oldRecipient, 0, '.dc-tr-state'), 'no', 'and takes the program default');
    assert.equal(oldRecipient.d.getElementById('dc-asset-mgmt-fee').value, '0');
    assert.deepEqual(sender.errors.concat(recipient.errors, oldRecipient.errors), []);
  });

  close();
  console.log(passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
