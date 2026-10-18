#!/usr/bin/env node
'use strict';
// #2161 (K1) on the real Deal Calculator page (jsdom, page scripts in order): the
// added credit's net new equity table agrees with js/deal-cost-basis.js and the
// INVENTED fixture, the sources and uses count it once it is known, and an unproven
// Transit Zone credit never reads as eligible or enters the sources.
const assert = require('node:assert/strict');
const { openPage, setField, close } = require('./helpers/deal-calculator-page.cjs');
const fx = require('./fixtures/credit-stack/invented.json');

const money = (n) => (n < 0 ? '-$' : '$') + Math.round(Math.abs(n)).toLocaleString('en-US');
let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  PASS ' + name); }
  catch (err) { failed++; console.error('  FAIL ' + name + '\n' + (err && err.stack || err)); }
}
const suText = (p, id) => p.d.getElementById(id).textContent.trim();
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
    const r = p.w.__DealCalc.getResult();
    assert.equal(r.costBasis.addedCredit, null);
    assert.equal(r.creditStack.counted, false);
    assert.equal(r.creditStack.added, 0);
    assert.equal(p.d.getElementById('dc-su-added-row').hidden, true);
    assert.deepEqual(p.errors, []);
  });

  await test('supplement and resized federal: the table shows gross, the cut, fees and net, and the sources count it', async () => {
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
    // The sources count the credit's equity after its fees, so the gap falls by the net new equity.
    assert(Math.abs(r.gapBeforeDeferred - (gapBefore - c.net)) < 0.01, 'gap ' + r.gapBeforeDeferred);
    assert.equal(r.costBasis.addedCredit.gapBefore, gapBefore);
    assert.equal(r.costBasis.addedCredit.gapAfter, r.gapBeforeDeferred);
    assert.equal(rowText(p, 'Funding gap before deferred fee, without this credit'), money(gapBefore));
    assert.equal(rowText(p, 'Funding gap before deferred fee, with this credit'), money(r.gapBeforeDeferred));
    // The sources and uses table, DOH permanent financing and the LP's equity all agree with the result.
    assert.equal(r.creditStack.added, c.gross - fx.added.fees);
    assert.equal(p.d.getElementById('dc-su-added-row').hidden, false);
    assert.equal(suText(p, 'dc-su-added'), money(r.creditStack.added));
    assert.equal(suText(p, 'dc-su-equity'), money(r.equity), 'a supplement leaves federal equity whole');
    const pfAdded = p.d.querySelector('[data-pf-row="added"] [data-pf-amount]');
    assert(pfAdded, 'DOH permanent financing lists the added credit');
    assert.equal(pfAdded.textContent.trim(), money(r.creditStack.added));
    const pfCredits = p.d.querySelector('[data-pf-row="tax_credits"] [data-pf-amount]').textContent.trim();
    assert.equal(pfCredits, money(r.creditStack.federal + r.creditStack.state + r.creditStack.added), 'DOH tax credit equity includes it');
    assert.equal(p.w.DealEngine.creditStackTotal(r), r.creditStack.federal + r.creditStack.state + r.creditStack.added);
    // The investor's automatic equity in the waterfall is the credit equity the sources count.
    assert(r.waterfall, 'non-vacuous: the waterfall runs for this deal');
    assert(Math.abs(r.waterfall.lpEquity - p.w.DealEngine.creditStackTotal(r)) < 0.01, 'LP equity ' + r.waterfall.lpEquity);
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
    const cut = p.w.__DealCalc.getResult();
    assert.equal(cut.creditStack.federal, cut.equity - ac.resizedFederal, 'the cut comes off federal equity in the sources');
    assert.equal(suText(p, 'dc-su-equity'), money(cut.creditStack.federal));
    assert.match(suText(p, 'dc-su-credit-note'), /federal credit cut/);
    // With its fees blank the net is unknown, so the sources leave the credit out and the gap returns.
    setField(p, 'dc-add-fed-cut', '');
    setField(p, 'dc-add-fees', '');
    const blank = p.w.__DealCalc.getResult();
    assert.equal(blank.costBasis.addedCredit.gross, c.gross, 'non-vacuous: the gross is known');
    assert.equal(blank.creditStack.counted, false);
    assert.equal(blank.gapBeforeDeferred, blank.costBasis.addedCredit.gapBefore);
    assert.equal(p.d.getElementById('dc-su-added-row').hidden, true);
    assert.match(suText(p, 'dc-su-credit-note'), /not counted in the sources: Enter the investor fees/);
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
    const r = p.w.__DealCalc.getResult();
    assert.equal(r.stateEquity, fx.state.expectedEquity, 'the awarded state equity is unchanged');
    assert.equal(r.creditStack.state, fx.state.expectedEquity - c.expected.displaced, 'the replaced equity comes off the state line');
    assert.equal(suText(p, 'dc-su-state'), money(r.creditStack.state));
    assert.match(suText(p, 'dc-su-credit-note'), /Colorado state credit equity is .* less/);
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
    // An unproven credit stays out of the sources, and the table says why.
    assert.equal(p.w.__DealCalc.getResult().creditStack.counted, false);
    assert.equal(p.d.getElementById('dc-su-added-row').hidden, true);
    assert.match(suText(p, 'dc-su-credit-note'), /not counted in the sources: Transit Zone credit eligibility unknown/);
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
