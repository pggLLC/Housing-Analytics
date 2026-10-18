#!/usr/bin/env node
'use strict';
// #2161 (K1) on the real Deal Calculator page (jsdom, page scripts in order): the
// added credit's net new equity table agrees with js/deal-cost-basis.js and the
// INVENTED fixture, and an unproven Transit Zone credit never reads as eligible.
const assert = require('node:assert/strict');
const { openPage, setField, close } = require('./helpers/deal-calculator-page.cjs');
const fx = require('./fixtures/credit-stack/invented.json');

const money = (n) => (n < 0 ? '-$' : '$') + Math.round(Math.abs(n)).toLocaleString('en-US');
let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  PASS ' + name); }
  catch (err) { failed++; console.error('  FAIL ' + name + '\n' + (err && err.stack || err)); }
}
const rowText = (p, label) => {
  const row = [...p.d.querySelectorAll('#dc-add-rows tr')].find((tr) => tr.querySelector('th').firstChild.textContent === label);
  assert(row, 'row "' + label + '" renders');
  return row.querySelector('td').textContent.trim();
};
function enterAdded(p, over) {
  const v = Object.assign({ 'dc-add-kind': 'other', 'dc-add-annual': fx.added.annual, 'dc-add-years': fx.added.years,
    'dc-add-price': fx.added.price, 'dc-add-fees': fx.added.fees, 'dc-add-mode': 'supplement' }, over);
  Object.keys(v).forEach((id) => setField(p, id, v[id]));
}

(async () => {
  console.log('Deal Calculator added credit and net new equity (#2161)');
  assert.equal(fx.invented, true, 'the fixture is marked invented');

  await test('no added credit: the table is hidden and the stack is unchanged', async () => {
    const p = await openPage('');
    assert.equal(p.d.getElementById('dc-add-result').hidden, true);
    assert.equal(p.w.__DealCalc.getResult().costBasis.addedCredit, null);
    assert.deepEqual(p.errors, []);
  });

  await test('supplement and resized federal: the table shows gross, the cut, fees and net; the stack does not move', async () => {
    const p = await openPage('');
    // With a county the first mortgage and CHFA's gap method run, so the gap is known.
    setField(p, 'dc-county-select', '08001');
    await new Promise((r) => setTimeout(r, 600));
    p.w.__DealCalc.recalculate();
    const gapBefore = p.w.__DealCalc.getResult().gapBeforeDeferred;
    assert(Number.isFinite(gapBefore), 'non-vacuous: the gap is known before the credit is added');
    enterAdded(p);
    const c = fx.cases.supplement.expected;
    assert.equal(p.d.getElementById('dc-add-result').hidden, false);
    assert.equal(rowText(p, 'Gross equity'), money(c.gross));
    assert.equal(rowText(p, 'Net new equity'), money(c.net));
    assert.equal(rowText(p, 'Possible cut to another award'), 'rule not sourced');
    const r = p.w.__DealCalc.getResult();
    assert.equal(r.gapBeforeDeferred, gapBefore, 'the added credit is reported beside the stack, not in it');
    assert.equal(r.costBasis.addedCredit.gapAfter, gapBefore - c.net);
    assert.equal(rowText(p, 'Funding gap before deferred fee, with this credit'), money(gapBefore - c.net));
    // The added credit's results export with the other outputs, which come from the same result.
    const snap = p.w.__DealCalcShare.buildSnapshot();
    assert.equal(snap.outputs.addedCreditGrossEquity.value, r.costBasis.addedCredit.gross);
    assert.equal(snap.outputs.addedCreditNetNewEquity.value, r.costBasis.addedCredit.net);
    assert.equal(snap.outputs.fundingGapWithAddedCredit.value, r.costBasis.addedCredit.gapAfter);
    // The cut needs a known federal credit; the default deal has one only once the gap method runs.
    setField(p, 'dc-credit-awarded', fx.federal.annual);
    setField(p, 'dc-equity-price', fx.federal.price);
    setField(p, 'dc-add-fed-cut', fx.cases.resizedFederal.federalCutAnnual);
    const ac = p.w.__DealCalc.getResult().costBasis.addedCredit;
    assert.equal(ac.reason, null, ac.reason);
    assert.equal(ac.resizedFederal, fx.cases.resizedFederal.expected.resizedFederal);
    assert.equal(rowText(p, 'Net new equity'), money(fx.cases.resizedFederal.expected.net));
    assert.deepEqual(p.errors, []);
  });

  await test('substitute for the state credit: displaced equity comes off and net is negative', async () => {
    const p = await openPage('');
    setField(p, 'dc-rate-4', true);
    setField(p, 'dc-state-path', fx.state.path);
    setField(p, 'dc-state-annual', fx.state.annual); setField(p, 'dc-state-price', fx.state.price); setField(p, 'dc-state-awarded', true);
    assert.equal(p.w.__DealCalc.getResult().stateEquity, fx.state.expectedEquity, 'base state equity');
    const c = fx.cases.substitute;
    enterAdded(p, { 'dc-add-mode': 'substitute', 'dc-add-displaces': 'state', 'dc-add-displaced-annual': c.displacedStateAnnual });
    const ac = p.w.__DealCalc.getResult().costBasis.addedCredit;
    assert.equal(ac.reason, null, ac.reason);
    assert.equal(ac.displaced, c.expected.displaced);
    assert.equal(rowText(p, 'Net new equity before fees'), money(c.expected.netBeforeFees));
    assert.equal(rowText(p, 'Net new equity'), money(c.expected.net));
    assert.match(p.d.getElementById('dc-add-rows').textContent, /less than it displaces/);
    assert.deepEqual(p.errors, []);
  });

  await test('a Transit Zone credit reads eligibility unknown until Market Analysis places the site in a zone and evidence is entered', async () => {
    const p = await openPage('');
    enterAdded(p, { 'dc-add-kind': 'tz' });
    const ac = () => p.w.__DealCalc.getResult().costBasis.addedCredit;
    assert.equal(p.d.getElementById('dc-add-tz-note').hidden, false);
    assert.equal(ac().eligibility, 'unknown');
    assert.equal(rowText(p, 'Eligibility'), 'Eligibility unknown');
    assert.equal(rowText(p, 'Net new equity'), 'Not available');
    assert.match(p.d.getElementById('dc-add-reason').textContent, /^Transit Zone credit eligibility unknown/);
    // The reason sends the user to Market Analysis; that page must load both the zone check and this calculator.
    assert.match(p.d.getElementById('dc-add-reason').textContent, /Market Analysis page/);
    const ma = require('fs').readFileSync(require('path').join(__dirname, '../market-analysis.html'), 'utf8');
    assert(/src="js\/transit-zone\.js"/.test(ma) && /src="js\/deal-calculator\.js"/.test(ma), 'Market Analysis checks the zone and mounts the calculator');
    setField(p, 'dc-add-evidence', 'Invented: OEDIT map printout');
    assert.equal(ac().eligibility, 'unknown', 'evidence alone is not enough without the map answer');
    // A site Market Analysis places inside an official zone polygon.
    p.w.TransitZone = { fundingPath: (r) => (r && r.program && r.program.qualified ? 'official' : null) };
    const inside = { status: 'within_2mi', designation: 'official_in', program: { qualified: true, programRule: '', determinationMethod: 'point_in_official_polygon' } };
    p.w.__DealCalc.setTransitZoneContext(inside);
    assert.equal(ac().eligibility, 'evidence entered', 'the zone answer recomputes the deal');
    assert.equal(rowText(p, 'Net new equity'), money(fx.cases.supplement.expected.net));
    p.w.__DealCalc.setTransitZoneContext(Object.assign({}, inside, { program: Object.assign({}, inside.program, { qualified: false }) }));
    assert.equal(ac().eligibility, 'not in a zone');
    assert.equal(rowText(p, 'Net new equity'), 'Not available');
    assert.deepEqual(p.errors, []);
  });

  await test('replacing a state credit that has investor fees takes off its net equity, as the stack counts it', async () => {
    const p = await openPage('');
    setField(p, 'dc-rate-4', true);
    setField(p, 'dc-state-path', fx.state.path);
    setField(p, 'dc-state-annual', fx.state.annual); setField(p, 'dc-state-price', fx.state.price); setField(p, 'dc-state-awarded', true);
    setField(p, 'dc-state-fees', 20000);
    // An identical credit with no fees replacing all of it gains exactly the fees it avoids.
    enterAdded(p, { 'dc-add-annual': fx.state.annual, 'dc-add-years': 6, 'dc-add-price': fx.state.price, 'dc-add-fees': 0,
      'dc-add-mode': 'substitute', 'dc-add-displaces': 'state', 'dc-add-displaced-annual': fx.state.annual });
    const r = p.w.__DealCalc.getResult();
    assert.equal(r.costBasis.addedCredit.displaced, r.stateEquity, 'the displaced equity is the state equity in the stack');
    assert(Math.abs(r.costBasis.addedCredit.net - 20000) < 0.01, 'net ' + r.costBasis.addedCredit.net);
    assert.deepEqual(p.errors, []);
  });

  await test('state credit investor fees reduce state equity in the stack', async () => {
    const p = await openPage('');
    setField(p, 'dc-rate-4', true);
    setField(p, 'dc-state-path', fx.state.path);
    setField(p, 'dc-state-annual', fx.state.annual); setField(p, 'dc-state-price', fx.state.price); setField(p, 'dc-state-awarded', true);
    setField(p, 'dc-state-fees', 20000);
    assert.equal(p.w.__DealCalc.getResult().stateEquity, fx.state.expectedEquity - 20000);
    assert.match(p.d.getElementById('dc-cb-detail').textContent, /less \$20,000 investor fees/);
    assert.deepEqual(p.errors, []);
  });

  close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
