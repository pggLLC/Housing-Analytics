#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const { openPage, setField, close } = require('./helpers/deal-calculator-page.cjs');
const hud = require('../data/hud-fmr-income-limits.json');
const chfa = require('../data/chfa-income-rent-limits-2026.json');
const limits = require('../js/chfa-rent-limits.js');
const placeGaps = require('../data/co_ami_gap_by_place.json');
const plain = v => JSON.parse(JSON.stringify(v));
const fruta = { geoType: 'place', geoid: '0828745', placeGeoid: '0828745', name: 'Fruita', countyFips: '08077', countyName: 'Mesa County' };
const rec = (p, id) => plain(p.w.InputProvenance.get(p.d.getElementById(id)));
const status = (p,id) => rec(p,id).status;
function guard(p) {
  let count = 0, data = 0;
  for (const el of p.d.querySelectorAll('[data-provenance]')) {
    const entry = p.w.DealCalculatorInputRegistry.get(el.id);
    assert(entry, 'missing field registry entry: ' + el.id);
    assert(entry.definition && entry.status && entry.why, 'incomplete entry: ' + el.id);
    const origin = p.w.InputProvenance.get(el);
    assert(origin, 'no origin: ' + el.id);
    if (origin.status === 'data') {
      for (const key of ['source', 'sourceUrl', 'vintage', 'geography']) assert(origin.origin.meta[key], el.id + ' missing ' + key);
      data++;
    }
    assert(!/\b(appraised|underwritten|approved)\b/i.test(p.d.getElementById(el.id + '-prov').title), el.id + ' overclaims');
    count++;
  }
  assert(count > 100, 'real calculator coverage is not vacuous');
  return { count, data };
}
let failed = 0;
async function test(name, fn) {
  try { await fn(); console.log('  PASS ' + name); }
  catch (e) { failed++; console.error('  FAIL ' + name + '\n' + e.stack); }
  finally { close(); }
}
(async () => {
  await test('real calculator defaults have registry entries and accessible details', async () => {
    const p = await openPage(''); assert.deepEqual(p.errors, []);
    console.log('    checked ' + guard(p).count + ' fields');
    assert.equal(status(p, 'dc-tdc'), 'illustrative');
    const badge = p.d.getElementById('dc-tdc-prov'); badge.focus();
    assert.equal(badge.getAttribute('aria-expanded'), 'true');
    assert.equal(p.d.getElementById(badge.getAttribute('aria-controls')).hidden, false);
    setField(p, 'dc-opex', '555');
    assert.equal(status(p, 'dc-opex'), 'yours');
    assert.equal(rec(p, 'dc-opex').origin.value, '450');
    setField(p, 'dc-opex', ''); assert.equal(status(p, 'dc-opex'), 'assumption');
    assert.equal(p.d.getElementById('dc-opex').value, '', 'clearing restores label, not a number');
  });
  await test('Fruita county AMI and FMR badges agree with HUD records and change county without stale provenance', async () => {
    const p = await openPage('', null, { jurisdiction: fruta });
    setField(p, 'dc-rent-limit-regime', 'ami_formula');
    const county = hud.counties.find(c => c.fips === fruta.countyFips);
    const meta = rec(p, 'dc-rent-limit-example').origin.meta;
    assert.equal(status(p, 'dc-rent-limit-example'), 'data', 'county prefill must be data');
    assert.equal(meta.vintage, hud.meta.income_limits_fiscal_year);
    assert.equal(meta.geography, county.county_name);
    assert.equal(meta.sourceUrl, hud.meta.url_il);
    const direct = limits.rentCeiling({ regime: 'ami_formula', hudTable: hud, fips: county.fips, tier: 60, bedrooms: '2BR', rentBurden: 0.30 });
    assert.equal(+p.d.getElementById('dc-rent-limit-example').dataset.grossRent, direct.grossRent);
    const fmr = rec(p, 'dc-rent-ach-fmr-grid').origin.meta;
    assert.equal(fmr.vintage, hud.meta.fiscal_year); assert.equal(fmr.geography, county.county_name);
    assert.equal(fmr.sourceUrl, hud.meta.url_fmr);
    p.d.getElementById('dc-ami-prefill').click();
    assert.equal(status(p, 'dc-units-30'), 'data');
    assert.equal(rec(p, 'dc-units-30').origin.meta.geography, placeGaps.places[fruta.geoid].place_name);
    assert(rec(p, 'dc-units-30').origin.meta.vintage.includes(String(placeGaps.meta.acs_year)));
    const old = rec(p, 'dc-units-30'); setField(p, 'dc-units-30', '8');
    assert.equal(status(p, 'dc-units-30'), 'yours'); assert.deepEqual(rec(p, 'dc-units-30').origin, old.origin);
    setField(p, 'dc-county-select', '08013');
    for (const el of p.d.querySelectorAll('[data-provenance]')) {
      const record = p.w.InputProvenance.get(el);
      assert(!/Mesa|Fruita/.test(JSON.stringify(record)), el.id + ' retained old geography');
    }
    assert.equal(rec(p, 'dc-rent-limit-example').origin.meta.geography, hud.counties.find(c => c.fips === '08013').county_name);
    assert.equal(status(p, 'dc-units-50'), 'needs-source'); assert.equal(p.d.getElementById('dc-units-50').value, '');
    assert(guard(p).data > 0);
  });
  await test('missing HUD source cannot masquerade as a numeric ceiling', async () => {
    const p = await openPage('', null, { missing: ['hud-fmr-income-limits.json'] });
    const select = p.d.getElementById('dc-county-select');
    select.add(new p.w.Option('Mesa County', fruta.countyFips));
    setField(p, 'dc-county-select', fruta.countyFips); setField(p, 'dc-rent-limit-regime', 'ami_formula');
    assert.equal(status(p, 'dc-rent-limit-example'), 'needs-source');
    assert.equal(p.d.getElementById('dc-rent-limit-example').dataset.grossRent, '');
  });
  await test('missing local need source leaves blank fields and needs-source', async () => {
    const p = await openPage('', null, { jurisdiction: fruta, missing: ['co_ami_gap_by_'] });
    p.d.getElementById('dc-ami-prefill').click();
    for (const tier of [30,40,50,60]) {
      assert.equal(p.d.getElementById('dc-units-' + tier).value, '');
      assert.equal(status(p, 'dc-units-' + tier), 'needs-source');
    }
  });
  await test('schedule and allowance carry the exact basis and table metadata', async () => {
    const s = { county_fips: fruta.countyFips, total_units: 3, vacancy_rate: 0.06,
      utility_allowance_basis: { method: 'pha', reference: 'Mesa schedule', effective_date: '2026-01-01', resident_paid: ['heat'], bound_county_fips: fruta.countyFips },
      unit_mix: [{ bedrooms: '2BR', count: 3, ami_tier: 60, proposed_gross_rent: limits.maxGrossRent(chfa,fruta.countyFips,60,'2BR').grossRent, utility_allowance:150, fees:0 }] };
    const p = await openPage('', s, { jurisdiction: fruta });
    for (const id of ['dc-units','dc-vacancy']) {
      assert.equal(status(p,id),'data'); assert(rec(p,id).origin.meta.vintage.includes(String(chfa.meta.fiscal_year)));
      assert(rec(p,id).origin.meta.vintage.includes(chfa.meta.effective_date));
    }
    assert.equal(rec(p,'dc-rent-allowance-status').origin.meta.source,s.utility_allowance_basis.reference);
    assert.equal(rec(p,'dc-rent-allowance-status').origin.meta.vintage,s.utility_allowance_basis.effective_date);
    guard(p);
  });
  await test('surviving tranche keeps its own origin after deletion and sharing', async () => {
    const p = await openPage('');
    p.d.getElementById('dc-add-tranche').click();
    const rows = p.d.querySelectorAll('[data-tranche-id]');
    const amount = rows[1].querySelector('.dc-tr-amount');
    setField(p, amount.id, '125000');
    const origin = rec(p, amount.id);
    rows[0].querySelector('.dc-tr-remove').click();
    const survivor = p.d.querySelector('.dc-tr-amount');
    assert.equal(survivor.value, '125000');
    assert.deepEqual(rec(p, survivor.id), origin);
    const snapshot = p.w.__DealCalcShare.buildSnapshot();
    const recipient = await openPage(new URL(snapshot.url).search);
    const shared = recipient.d.querySelector('.dc-tr-amount');
    assert.equal(shared.value, survivor.value);
    assert.deepEqual(rec(recipient, shared.id), origin);
  });
  await test('shared URL and JSON preserve defaults and edits but cannot certify unverified allocations', async () => {
    const p = await openPage('', null, { jurisdiction: fruta });
    setField(p, 'dc-rent-limit-regime', 'ami_formula');
    setField(p, 'dc-rate-4', true); setField(p, 'dc-equity-price', '0.92');
    setField(p, 'dc-opex', '510'); p.d.getElementById('dc-ami-prefill').click();
    const snapshot = plain(p.w.__DealCalcShare.buildSnapshot());
    assert(snapshot.inputProvenance && Object.keys(snapshot.inputProvenance.fields).length > 100);
    const expectedStates = Object.values(snapshot.inputProvenance.fields).map(f => f[0]);
    for (const state of ['data','assumption','illustrative','needs-source','yours']) assert(expectedStates.includes(state), 'fixture missing ' + state);
    const recipient = await openPage(new URL(snapshot.url).search);
    const received = plain(recipient.w.__DealCalcShare.buildSnapshot().inputProvenance);
    for (const [id, field] of Object.entries(snapshot.inputProvenance.fields)) {
      assert(received.fields[id], 'missing shared origin ' + id);
      if (field[0] === 'data' && /^dc-units-/.test(id)) {
        assert.equal(received.fields[id][0], 'yours', 'unverified shared allocation: ' + id);
        assert.equal(rec(recipient,id).sharedUnverified, true);
      } else if (field[0] === 'data' || field[0] === 'yours') {
        assert.equal(received.fields[id][0], field[0], 'shared status: ' + id);
      } else {
        const base = recipient.w.DealCalculatorInputRegistry.get(id);
        assert([base.status, 'yours'].includes(received.fields[id][0]), 'shared default cannot promote registry status: ' + id);
      }
    }
    assert.equal(rec(recipient,'dc-units-30').senderClaim.includes(placeGaps.places[fruta.geoid].place_name), true);
    setField(recipient, 'dc-units-30', '11'); assert.equal(status(recipient,'dc-units-30'),'yours');
    const legacy = new URL(snapshot.url); legacy.searchParams.delete('inputProvenance');
    const old = await openPage(legacy.search); assert.deepEqual(old.errors, []);
    assert.equal(status(old,'dc-units-30'),'yours', 'legacy share retains edit semantics');
  });
  await test('forged shared TDC cannot certify provenance or replace the registry definition', async () => {
    const sender = await openPage('', null, { jurisdiction: fruta });
    setField(sender, 'dc-tdc', '12345678');
    assert.equal(status(sender,'dc-tdc'), 'yours');
    const snapshot = plain(sender.w.__DealCalcShare.buildSnapshot());
    const map = snapshot.inputProvenance, url = new URL(snapshot.url);
    map.fields['dc-tdc'] = ['data','12345678',map.sources.length,'12345678'];
    const forged = { source: 'HUD FY2026 Income Limits / Mesa County <b>sender</b>',
      sourceUrl: 'https://www.huduser.gov/portal/datasets/il.html', vintage: 2026, countyFips: fruta.countyFips,
      geography: 'Mesa County', definition: 'Sender-defined cost', why: 'Sender-certified value' };
    map.sources.push(forged); url.searchParams.set('inputProvenance',JSON.stringify(map));
    const recipient = await openPage(url.search);
    assert.equal(recipient.d.getElementById('dc-tdc').value, '12345678');
    const record = rec(recipient,'dc-tdc');
    assert.equal(record.status,'yours'); assert.equal(record.sharedUnverified,true);
    assert(record.senderClaim.includes(forged.source));
    const badge = recipient.d.getElementById('dc-tdc-prov'), detail = recipient.d.getElementById('dc-tdc-prov-detail');
    assert.equal(recipient.d.getElementById('dc-tdc').dataset.provenanceSharedUnverified,'true');
    assert(badge.textContent.length > recipient.w.InputProvenance.LABELS.yours.length, 'visible uncertainty disclosure');
    assert(detail.textContent.includes(forged.source), 'sender claim is retained as plain text');
    assert.equal(detail.querySelector('b, a'),null,'untrusted claim is neither HTML nor a source link');
    assert(detail.textContent.includes(recipient.w.DealCalculatorInputRegistry.get('dc-tdc').definition));
    assert(!detail.textContent.includes(forged.definition)); assert(!detail.textContent.includes(forged.why));
  });
  await test('shared Fruita HUD fields are revalidated against recipient records, never sender metadata', async () => {
    const sender = await openPage('', null, { jurisdiction: fruta });
    setField(sender,'dc-rent-limit-regime','ami_formula');
    const snapshot = plain(sender.w.__DealCalcShare.buildSnapshot()), url = new URL(snapshot.url);
    const map = snapshot.inputProvenance;
    const ids = ['dc-formula-ceiling-eg','dc-rent-limit-example','dc-fmr-note','dc-rent-ach-fmr-grid'];
    for (const id of ids) {
      assert.equal(map.fields[id][0],'data');
      map.sources[map.fields[id][2]].source = 'Untrusted sender caption';
      map.sources[map.fields[id][2]].definition = 'Untrusted sender definition';
    }
    url.searchParams.set('inputProvenance',JSON.stringify(map));
    const recipient = await openPage(url.search);
    for (const id of ids) {
      assert.equal(status(recipient,id),'data', id);
      assert.deepEqual(rec(recipient,id).origin.meta,rec(sender,id).origin.meta,'recipient source record: '+id);
      assert(!recipient.d.getElementById(id+'-prov-detail').textContent.includes('Untrusted sender'));
    }
    // A later selected county and a new restore of the genuine map cannot reuse Mesa evidence.
    setField(recipient,'dc-county-select','08013');
    recipient.w.InputProvenance.restore(map);
    for (const id of ids) {
      assert.equal(status(recipient,id),'yours',id+' wrong county must be unverified');
      assert.equal(rec(recipient,id).sharedUnverified,true);
    }
    const different = new URL(url); different.searchParams.set('county-select','08013');
    const moved = await openPage(different.search);
    for (const id of ids) assert.equal(status(moved,id),'yours',id+' county in link differs from source');
  });
  await test('shared source value and table must both agree; a shared schedule is not local evidence', async () => {
    const sender = await openPage('',null,{jurisdiction:fruta});
    setField(sender,'dc-rent-limit-regime','ami_formula');
    const snapshot = plain(sender.w.__DealCalcShare.buildSnapshot()), map = snapshot.inputProvenance;
    const recipient = await openPage(new URL(snapshot.url).search);
    map.fields['dc-rent-limit-example'][3] = '12345678';
    const fmrField = map.fields['dc-rent-ach-fmr-grid'];
    map.sources[fmrField[2]].vintage = 'another table';
    recipient.w.InputProvenance.restore(map);
    assert.equal(status(recipient,'dc-rent-limit-example'),'yours');
    assert.equal(status(recipient,'dc-rent-ach-fmr-grid'),'yours');
    const subject = { county_fips: fruta.countyFips, total_units: 3, vacancy_rate: 0.06,
      utility_allowance_basis: { method: 'pha', reference: 'Sender source', effective_date: '2026-01-01', resident_paid: ['heat'], bound_county_fips: fruta.countyFips },
      unit_mix: [{ bedrooms:'2BR',count:3,ami_tier:60,proposed_gross_rent:limits.maxGrossRent(chfa,fruta.countyFips,60,'2BR').grossRent,utility_allowance:150,fees:0 }] };
    const scheduleSender = await openPage('',subject,{jurisdiction:fruta});
    const shared = await openPage(new URL(scheduleSender.w.__DealCalcShare.buildSnapshot().url).search);
    for (const id of ['dc-units','dc-vacancy','dc-rent-allowance-status','dc-noi-allowance-status']) {
      assert.equal(status(shared,id),'yours',id+' cannot trust the shared schedule as a source');
      assert.equal(rec(shared,id).sharedUnverified,true);
    }
  });
  await test('shared source override retains the sender original value and claimed source, never data', async () => {
    const sender = await openPage('',null,{jurisdiction:fruta});
    setField(sender,'dc-units','77');
    const defaults = Object.fromEntries([30,40,50,60].map(t=>['dc-units-'+t,rec(sender,'dc-units-'+t).origin.value]));
    sender.d.getElementById('dc-ami-prefill').click();
    const id = Object.keys(defaults).find(id=>rec(sender,id).origin.value !== defaults[id]);
    assert(id,'source prefill must differ from a tool default');
    const original = rec(sender,id).origin;
    assert.equal(status(sender,id),'data');
    setField(sender,id,'9');
    const recipient = await openPage(new URL(sender.w.__DealCalcShare.buildSnapshot().url).search);
    const received = rec(recipient,id);
    assert.notEqual(original.value,received.origin.value,'fixture must distinguish sender origin from recipient default');
    assert.equal(received.status,'yours'); assert.equal(received.sharedUnverified,true);
    assert.equal(received.senderOriginalValue,original.value,'retain sender original, not recipient default');
    assert(received.senderClaim.includes(original.meta.source));
    assert(received.senderClaim.includes(original.meta.geography));
    const detail = recipient.d.getElementById(id+'-prov-detail');
    assert(detail.textContent.includes(original.value)); assert(detail.textContent.includes(original.meta.geography));
    assert(!detail.querySelector('a'), 'sender source remains an unverified plain-text claim');
    const onward = await openPage(new URL(recipient.w.__DealCalcShare.buildSnapshot().url).search);
    assert.equal(rec(onward,id).senderOriginalValue,original.value);
    assert.equal(status(onward,id),'yours');
  });
  process.exit(failed ? 1 : 0);
})().catch(e => { close(); console.error(e); process.exitCode = 1; });
