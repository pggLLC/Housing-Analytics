#!/usr/bin/env node
'use strict';
const { createJsPdfMock } = require('./helpers/jspdf-mock.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM, VirtualConsole } = require('jsdom');
const limits = require('../js/chfa-rent-limits.js');
const chfa = require('../data/chfa-income-rent-limits-2026.json');
const hud = require('../data/hud-fmr-income-limits.json');
const zori = require('../data/market/zori_rents_co.json');
const bedroomMix = require('../data/market/acs_renter_bedrooms_co.json');
const read = (p) => fs.readFileSync(p, 'utf8');
const plain = (v) => JSON.parse(JSON.stringify(v));
const settle = () => new Promise((r) => setImmediate(r));
const fips = '08031';
const tiers = [20, 30, 40, 50, 60, 70, 80, 100, 110, 120];
const bedrooms = { studio: 'efficiency', '1br': '1BR', '2br': '2BR', '3br': '3BR', '4br': '4BR' };
const money = (n) => '$' + Math.round(n).toLocaleString('en-US');
const basis = () => ({ method: 'pha', reference: 'County PHA schedule', effective_date: '2026-01-01', resident_paid: ['heat'], bound_county_fips: fips });
const subject = () => ({ county_fips: fips, utility_allowance_basis: basis(), unit_mix: Object.values(bedrooms).map((br, i) => ({ bedrooms: br, ami_tier: 60, count: 1, utility_allowance: 75 + i * 25, fees: 10 + i * 5 })) });
const ceiling = (regime, tier, br) => limits.rentCeiling({ regime, chfaTable: chfa, hudTable: hud, fips, tier, bedrooms: bedrooms[br], rentBurden: 0.30 }).grossRent;
const text = (w, id) => w.document.getElementById(id).textContent.trim();
function change(w, id, value, event = 'change') {
  const el = w.document.getElementById(id); assert(el, id);
  if (el.type === 'checkbox') el.checked = value; else el.value = String(value);
  el.dispatchEvent(new w.Event(event, { bubbles: true }));
}
async function calculator(saved = subject(), { lateModule = false, noSubject = false } = {}) {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => { if (!e.message.startsWith('Not implemented')) errors.push(e.message); });
  const w = new JSDOM('<main><div id="dealCalcMount"></div></main>', { url: 'https://example.org/deal-calculator.html', runScripts: 'outside-only', virtualConsole: vc }).window;
  w.setTimeout = () => 0; w.setInterval = () => 0;
  w.fetch = (url) => {
    const s = String(url);
    const data = s.includes('chfa-income-rent-limits') ? chfa : s.includes('hud-fmr-income-limits') ? hud : s.includes('zori_rents_co') ? zori : String(url).includes('acs_renter_bedrooms_co') ? bedroomMix : null;
    return Promise.resolve({ ok: data != null, json: () => Promise.resolve(data) });
  };
  if (saved) w.localStorage.setItem('coho.subjectProject.v1', JSON.stringify(saved));
  for (const file of ['js/components/zori-rent-utils.js', 'js/utils/format-money.js', 'js/data-connectors/hud-fmr.js', 'js/deal-calculator-math.js']) w.eval(read(file));
  await w.HudFmr.load();
  function loadSubject() {
    w.eval(read('js/chfa-rent-limits.js'));
    const before = w.document.body.innerHTML;
    if (!noSubject) w.eval(read('js/components/subject-project.js'));
    assert.equal(w.document.body.innerHTML, before, 'loading SubjectProject must not mount its UI');
  }
  if (!lateModule) loadSubject();
  w.eval(read('js/deal-engine.js'));
  w.eval(read('js/deal-calculator.js'));
  await settle(); await settle();
  if (lateModule) loadSubject();
  w.eval(read('js/deal-calculator-report-meta.js'));
  w.eval(read('js/deal-calculator-share.js'));
  assert.deepEqual(errors, [], 'no runtime errors');
  w.__DealCalc.setChfaRentTable(chfa);
  // This fast fixture disables async county-population timers. Supply the
  // two counties exercised here so its share URL carries the visible county.
  const county = w.document.getElementById('dc-county-select');
  for (const code of [fips, '08077']) if (![...county.options].some((o) => o.value === code)) county.add(new w.Option(code, code));
  county.value = fips;
  w.__DealCalc.updateAmiLimitsFromFmr(fips);
  return w;
}
function mix(w, rows) {
  for (const tier of tiers) {
    w.document.getElementById('dc-chk-' + tier).checked = rows.some((r) => r.tier === tier);
    w.document.getElementById('dc-units-' + tier).value = 0;
    for (const br of Object.keys(bedrooms)) w.document.getElementById('dc-units-' + tier + '-' + br).value = 0;
  }
  for (const row of rows) w.document.getElementById('dc-units-' + row.tier + '-' + row.br).value = row.units;
  w.document.getElementById('dc-units').value = rows.reduce((n, r) => n + r.units, 0);
  w.__DealCalc.recalculate();
}
function expected(regime, rows, saved, applied = true) {
  const allowance = limits.allowanceByBedroom(saved, fips);
  return rows.reduce((sum, row) => {
    const grossRent = ceiling(regime, row.tier, row.br);
    const rent = applied ? limits.maxContractRent({ grossRent,
      utilityAllowance: allowance.perBedroom[bedrooms[row.br]], fees: allowance.feesPerBedroom[bedrooms[row.br]],
      basisStatus: limits.allowanceBasisStatus(saved.utility_allowance_basis, fips) }).contractRent : grossRent;
    assert(rent != null, 'fixture rent is available');
    return sum + row.units * rent * 12;
  }, 0);
}
function checkRevenue(w, amount) { assert.equal(text(w, 'dc-r-rents'), money(amount)); }
function checkDisclosure(w, reason) {
  for (const id of ['dc-rent-allowance-status', 'dc-noi-allowance-status']) {
    const el = w.document.getElementById(id);
    assert(!el.hidden && el.textContent.trim(), id + ': persistent disclosure');
    assert.equal(el.dataset.allowanceApplied, 'false');
    assert.equal(el.dataset.unavailableReason, reason);
    assert(el.textContent.includes(limits.unavailableMessage(reason)), 'visible reason matches module');
  }
  assert.deepEqual(plain(w.__DealCalcShare.buildSnapshot().utilityAllowance), { applied: false, reason });
}
let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  PASS ' + name); }
  catch (e) { failed++; console.error('  FAIL ' + name + ': ' + e.stack); }
}
(async () => {
  await test('pure resolver preserves absence, requires both county bindings, and agrees across rows and fees', () => {
    const saved = subject(), before = plain(saved);
    assert.deepEqual(Object.keys(limits.allowanceByBedroom(saved, fips).perBedroom), Object.values(bedrooms));
    saved.unit_mix.push({ ...saved.unit_mix[0], utility_allowance: String(saved.unit_mix[0].utility_allowance) });
    assert(limits.allowanceByBedroom(saved, fips).applied, 'equal numeric/string values agree');
    const result = limits.allowanceByBedroom(before, fips);
    for (const row of before.unit_mix) { assert.equal(result.perBedroom[row.bedrooms], row.utility_allowance); assert.equal(result.feesPerBedroom[row.bedrooms], row.fees); }
    assert.deepEqual(before, subject(), 'pure lookup leaves input unchanged');
    saved.unit_mix = [{ bedrooms: '2BR', utility_allowance: null, fees: '' }];
    let resolved = limits.allowanceByBedroom(saved, fips);
    assert.equal(resolved.perBedroom['2BR'], null); assert.equal(resolved.perBedroom['1BR'], null); assert.equal(resolved.feesPerBedroom['2BR'], 0);
    saved.utility_allowance_basis = { method: 'owner_pays_all', resident_paid: [] };
    resolved = limits.allowanceByBedroom(saved, fips);
    assert(Object.values(resolved.perBedroom).every((v) => v === 0));
    saved.county_fips = '08077';
    assert.equal(limits.allowanceByBedroom(saved, fips).reason, 'allowance_basis_other_geography', 'owner pays all also requires the same subject county');
    assert.equal(limits.allowanceByBedroom(null, fips).reason, 'subject_project_unavailable');
  });
  await test('CHFA and formula revenue sum per-bedroom contract rents, with fees and unchanged gross ceilings', async () => {
    const saved = subject(), w = await calculator(saved);
    const rows = [{ tier: 20, br: 'studio', units: 1 }, { tier: 30, br: '1br', units: 2 }, { tier: 60, br: '2br', units: 3 }, { tier: 80, br: '3br', units: 2 }, { tier: 120, br: '4br', units: 1 }];
    try {
      mix(w, rows);
      for (const regime of ['chfa_lihtc', 'ami_formula']) {
        change(w, 'dc-rent-limit-regime', regime);
        checkRevenue(w, expected(regime, rows, saved));
        assert.equal(w.__DealCalc.getUtilityAllowanceMetadata().applied, true);
        assert.equal(w.__DealCalc.getAmiLimitsByBr()[60]['2br'], ceiling(regime, 60, '2br'));
        const vacancy = +w.document.getElementById('dc-vacancy').value / 100;
        const n = rows.reduce((s, r) => s + r.units, 0);
        const expenses = n * (+w.document.getElementById('dc-opex').value * 12 + +w.document.getElementById('dc-rep-reserve').value + +w.document.getElementById('dc-prop-tax').value * (1 - +w.document.getElementById('dc-tax-exempt').value / 100));
        assert.equal(text(w, 'dc-noi-computed'), money(expected(regime, rows, saved) * (1 - vacancy) - expenses));
      }
      // Tier dropdown path (no split counts) must use the same deduction.
      for (const tier of tiers) for (const br of Object.keys(bedrooms)) w.document.getElementById('dc-units-' + tier + '-' + br).value = 0;
      for (const tier of tiers) w.document.getElementById('dc-chk-' + tier).checked = tier === 60;
      w.document.getElementById('dc-units').value = 3;
      change(w, 'dc-units-60', 3, 'input');
      checkRevenue(w, expected('ami_formula', [{ tier: 60, br: '2br', units: 3 }], saved));
    } finally { w.close(); }
  });
  await test('owner pays all uses zero allowances for every bedroom and still deducts the entered fees', async () => {
    const saved = subject(); saved.utility_allowance_basis = { method: 'owner_pays_all', resident_paid: [] };
    const w = await calculator(saved), rows = [{ tier: 60, br: '1br', units: 2 }, { tier: 60, br: '2br', units: 3 }];
    try {
      mix(w, rows); checkRevenue(w, expected('chfa_lihtc', rows, saved));
      const metadata = w.__DealCalcShare.buildSnapshot().utilityAllowance;
      assert.equal(metadata.applied, true); assert.equal(metadata.method, 'owner_pays_all');
      assert(Object.values(metadata.perBedroom).every((v) => v === 0));
      assert.equal(metadata.feesPerBedroom['2BR'], saved.unit_mix[2].fees);
    } finally { w.close(); }
  });
  await test('unavailable, incomplete, mismatched, missing and conflicting allowances keep gross revenue with reasons', async () => {
    const cases = [
      ['no basis', (s) => { delete s.utility_allowance_basis; }, 'allowance_method_missing'],
      ['incomplete', (s) => { s.utility_allowance_basis.effective_date = ''; }, 'allowance_date_missing'],
      ['basis county', (s) => { s.utility_allowance_basis.bound_county_fips = '08077'; }, 'allowance_basis_other_geography'],
      ['subject county', (s) => { s.county_fips = '08077'; }, 'allowance_basis_other_geography'],
      ['missing bedroom', (s) => { s.unit_mix = s.unit_mix.filter((r) => r.bedrooms !== '2BR'); }, 'allowance_bedroom_missing:2BR'],
      ['blank amount', (s) => { s.unit_mix[2].utility_allowance = ''; }, 'allowance_bedroom_missing:2BR'],
      ['conflicting allowance', (s) => { s.unit_mix.push({ ...s.unit_mix[2], utility_allowance: 201 }); }, 'allowance_conflict:2BR'],
      ['conflicting fees', (s) => { s.unit_mix.push({ ...s.unit_mix[2], fees: 201 }); }, 'allowance_conflict:2BR'],
      ['invalid fees', (s) => { s.unit_mix[2].fees = -1; }, 'fees_invalid:2BR']
    ];
    const rows = [{ tier: 60, br: '1br', units: 2 }, { tier: 60, br: '2br', units: 3 }];
    for (const [name, mutate, reason] of cases) {
      const saved = subject(); mutate(saved); const w = await calculator(saved);
      try {
        mix(w, rows);
        for (const regime of ['chfa_lihtc', 'ami_formula']) {
          change(w, 'dc-rent-limit-regime', regime);
          checkRevenue(w, expected(regime, rows, subject(), false)); checkDisclosure(w, reason);
        }
      } catch (e) { throw new Error(name + ': ' + e.message); } finally { w.close(); }
    }
    const w = await calculator(subject(), { noSubject: true });
    try { mix(w, rows); checkRevenue(w, expected('chfa_lihtc', rows, subject(), false)); checkDisclosure(w, 'subject_project_unavailable'); } finally { w.close(); }
  });
  await test('over-deduction blocks revenue and auto NOI with the module reason; exact deductions preserve measured zero', async () => {
    const saved = subject(); saved.unit_mix[2].utility_allowance = ceiling('chfa_lihtc', 60, '2br');
    const w = await calculator(saved);
    try {
      mix(w, [{ tier: 60, br: '2br', units: 2 }]);
      for (const id of ['dc-r-rents', 'dc-r-noi-stab', 'dc-r-mortgage']) assert(!/\$\s*\d/.test(text(w, id)), id + ': blocked, not zero');
      const reason = limits.maxContractRent({ grossRent: ceiling('chfa_lihtc', 60, '2br'), utilityAllowance: saved.unit_mix[2].utility_allowance, fees: saved.unit_mix[2].fees }).unavailableReason;
      assert.equal(w.document.getElementById('dc-rent-allowance-status').dataset.unavailableReason, reason);
      assert(text(w, 'dc-noi-allowance-status').includes(limits.unavailableMessage(reason)));
      assert.equal(w.__DealCalcShare.buildSnapshot().utilityAllowance.applied, true);
      const next = w.SubjectProject.get(); next.unit_mix[2].fees = 0; w.SubjectProject.set(next);
      checkRevenue(w, 0);
    } finally { w.close(); }
  });
  await test('70%+ market cap applies after netting allowances; market-rate ignores the allowance entirely', async () => {
    const saved = subject(), w = await calculator(saved);
    try {
      const market = w.__DealCalc.getZoriPerBrRent(fips)['2br'];
      const gross = ceiling('chfa_lihtc', 80, '2br'); assert(gross > market);
      mix(w, [{ tier: 80, br: '2br', units: 2 }]); change(w, 'dc-achievable-cap', true);
      for (const ua of [gross - market + 50, 10]) {
        const next = w.SubjectProject.get(); next.unit_mix[2].utility_allowance = ua; next.unit_mix[2].fees = 0; w.SubjectProject.set(next);
        const net = limits.maxContractRent({ grossRent: gross, utilityAllowance: ua, fees: 0 }).contractRent;
        checkRevenue(w, 2 * Math.min(net, market) * 12);
      }
      change(w, 'dc-rent-limit-regime', 'market'); checkRevenue(w, 2 * market * 12);
      const next = w.SubjectProject.get(); next.unit_mix[2].utility_allowance = gross + 1; w.SubjectProject.set(next);
      checkRevenue(w, 2 * market * 12);
      assert(w.document.getElementById('dc-noi-allowance-status').hidden);
      assert.deepEqual(plain(w.__DealCalcShare.buildSnapshot().utilityAllowance), { applied: false, reason: 'unrestricted_market' });
    } finally { w.close(); }
  });
  await test('only CHFA LIHTC designates units or creates credits and equity', async () => {
    const w = await calculator();
    try {
      mix(w, [{ tier: 60, br: '2br', units: 3 }]);
      const chfaCredits = text(w, 'dc-r-credits'); assert(/^\$[1-9]/.test(chfaCredits));
      const chfaBasis = text(w, 'dc-r-basis');
      for (const regime of ['ami_formula', 'market']) {
        change(w, 'dc-rent-limit-regime', regime);
        assert.equal(text(w, 'dc-r-basis'), 'Not applicable', 'eligible basis applies only to CHFA LIHTC');
        assert.equal(text(w, 'dc-su-equity'), money(0), 'no LIHTC equity in the capital stack');
        for (const id of ['dc-r-credits', 'dc-r-equity']) {
          assert.equal(w.document.getElementById(id).dataset.lihtcApplicable, 'false');
          assert(!/\$\s*\d/.test(text(w, id))); assert(text(w, id).includes('CHFA'), 'explanation names the allocating agency');
        }
        assert.equal(text(w, 'dc-minimum-set-aside-status'), 'Not applicable');
        mix(w, []);
        assert.equal(text(w, 'dc-r-basis'), 'Not applicable', 'zero total units do not make LIHTC basis applicable');
        assert.equal(text(w, 'dc-su-equity'), money(0));
        mix(w, [{ tier: 60, br: '2br', units: 3 }]);
      }
      change(w, 'dc-rent-limit-regime', 'chfa_lihtc'); assert.equal(text(w, 'dc-r-credits'), chfaCredits);
      assert.equal(text(w, 'dc-r-basis'), chfaBasis, 'returning to CHFA restores the numeric eligible basis');
    } finally { w.close(); }
  });
  await test('same-page and cross-tab edits recalculate; JSON and PDF capture the applied record and its absence', async () => {
    const w = await calculator(subject(), { lateModule: true }), rows = [{ tier: 60, br: '2br', units: 2 }];
    try {
      mix(w, rows);
      const next = w.SubjectProject.get(); next.unit_mix[2].utility_allowance = 220; w.SubjectProject.set(next);
      checkRevenue(w, expected('chfa_lihtc', rows, next));
      const changed = w.SubjectProject.get(); changed.unit_mix[2].utility_allowance = 260;
      const raw = JSON.stringify(changed); w.localStorage.setItem('coho.subjectProject.v1', raw);
      w.dispatchEvent(new w.StorageEvent('storage', { key: 'coho.subjectProject.v1', newValue: raw, storageArea: w.localStorage }));
      checkRevenue(w, expected('chfa_lihtc', rows, changed));
      const resolved = limits.allowanceByBedroom(changed, fips);
      const expectedMeta = { applied: true, reason: null, countyFips: fips, ...resolved.basis, perBedroom: resolved.perBedroom, feesPerBedroom: resolved.feesPerBedroom };
      const metadata = plain(w.__DealCalcShare.buildSnapshot().utilityAllowance); assert.deepEqual(metadata, expectedMeta);

      w.html2canvas = async () => ({ width: 600, height: 600, toDataURL: () => 'image' });
      const pdf = createJsPdfMock();
      w.jspdf = { jsPDF: pdf.jsPDF };
      await w.__DealCalcShare.exportPdf(); pdf.assertSupported(); assert.deepEqual(JSON.parse(pdf.properties.subject).utilityAllowance, metadata);
      // Changing the source through Package C clears row amounts; no stale net rent/export may survive.
      const newBasis = w.SubjectProject.get(); newBasis.utility_allowance_basis.reference = 'Updated PHA schedule'; w.SubjectProject.set(newBasis);
      checkRevenue(w, expected('chfa_lihtc', rows, subject(), false)); checkDisclosure(w, 'allowance_bedroom_missing:2BR');
      await w.__DealCalcShare.exportPdf(); pdf.assertSupported(); assert.deepEqual(JSON.parse(pdf.properties.subject).utilityAllowance, { applied: false, reason: 'allowance_bedroom_missing:2BR' });
      w.localStorage.clear(); w.dispatchEvent(new w.StorageEvent('storage', { key: null, storageArea: w.localStorage }));
      assert.equal(w.__DealCalcShare.buildSnapshot().utilityAllowance.applied, false);
    } finally { w.close(); }
  });
  await test('shared applied allowances reproduce revenue, NOI and gap without reading or writing the recipient basis', async () => {
    const saved = subject(); saved.unit_mix.forEach((r) => { r.utility_allowance = 150; });
    const sender = await calculator(saved), rows = [{ tier: 60, br: '2br', units: 60 }];
    const figures = (w) => ['dc-r-rents', 'dc-r-noi-stab', 'dc-su-gap'].map((id) => text(w, id));
    try {
      change(sender, 'dc-county-select', fips); mix(sender, rows);
      const snapshot = plain(sender.__DealCalcShare.buildSnapshot());
      assert.deepEqual(JSON.parse(new URL(snapshot.url).searchParams.get('utilityAllowance')), snapshot.utilityAllowance);
      assert.equal(snapshot.utilityAllowance.countyFips, fips);
      assert.equal(snapshot.utilityAllowance.perBedroom['2BR'], 150);
      assert(figures(sender).every((v) => /\$-?[\d,]+/.test(v)), 'sender figures are measured: ' + JSON.stringify(figures(sender)));
      for (const noSubject of [true, false]) {
        const local = subject(); local.unit_mix.forEach((r) => { r.utility_allowance = 350; });
        const recipient = await calculator(noSubject ? null : local, { noSubject });
        try {
          const before = recipient.localStorage.getItem('coho.subjectProject.v1');
          recipient.history.replaceState({}, '', snapshot.url);
          recipient.__DealCalcShare.hydrate();
          assert.deepEqual(figures(recipient), figures(sender));
          assert.equal(recipient.localStorage.getItem('coho.subjectProject.v1'), before, 'shared basis never enters Subject Project storage');
          assert.deepEqual(plain(recipient.__DealCalcShare.buildSnapshot().utilityAllowance), snapshot.utilityAllowance);
          for (const id of ['dc-rent-allowance-status', 'dc-noi-allowance-status']) {
            const el = recipient.document.getElementById(id);
            assert.equal(el.dataset.allowanceSource, 'shared');
            assert(el.textContent.includes(snapshot.utilityAllowance.reference));
            assert(el.textContent.includes(snapshot.utilityAllowance.effectiveDate));
          }
          if (!noSubject) {
            local.unit_mix.forEach((r) => { r.utility_allowance = 400; }); recipient.SubjectProject.set(local);
            assert.deepEqual(figures(recipient), figures(sender), 'local edits cannot replace a shared allowance');
            change(recipient, 'dc-rent-limit-regime', 'ami_formula');
            checkRevenue(recipient, expected('ami_formula', rows, local));
            assert.equal(recipient.document.getElementById('dc-rent-allowance-status').dataset.allowanceSource, 'local');
            assert(!recipient.document.getElementById('dc-allowance-local-notice').hidden);
          }
        } finally { recipient.close(); }
      }
    } finally { sender.close(); }
  });
  await test('shared absence keeps the sender reason; older links use local allowances; county edits discard the shared record', async () => {
    const saved = subject(); delete saved.utility_allowance_basis;
    const sender = await calculator(saved), local = subject(), rows = [{ tier: 60, br: '2br', units: 60 }];
    const recipient = await calculator(local);
    try {
      change(sender, 'dc-county-select', fips); mix(sender, rows);
      const snapshot = sender.__DealCalcShare.buildSnapshot();
      recipient.history.replaceState({}, '', snapshot.url); recipient.__DealCalcShare.hydrate();
      checkRevenue(recipient, expected('chfa_lihtc', rows, local, false)); checkDisclosure(recipient, 'allowance_method_missing');
      for (const id of ['dc-r-noi-stab', 'dc-su-gap']) assert.equal(text(recipient, id), text(sender, id));
      change(recipient, 'dc-county-select', '08077');
      checkDisclosure(recipient, 'allowance_basis_other_geography');
      assert(!recipient.document.getElementById('dc-allowance-local-notice').hidden);
      change(recipient, 'dc-county-select', fips); checkRevenue(recipient, expected('chfa_lihtc', rows, local));
      const old = new URL(snapshot.url); old.searchParams.delete('utilityAllowance');
      recipient.history.replaceState({}, '', old.href); recipient.__DealCalcShare.hydrate();
      checkRevenue(recipient, expected('chfa_lihtc', rows, local));
      assert.equal(recipient.document.getElementById('dc-rent-allowance-status').dataset.allowanceSource, 'local');
      // Malformed new records must not silently substitute local deductions.
      old.searchParams.set('utilityAllowance', '{broken');
      recipient.history.replaceState({}, '', old.href); recipient.__DealCalcShare.hydrate();
      checkRevenue(recipient, expected('chfa_lihtc', rows, local, false));
      assert.equal(recipient.__DealCalc.getUtilityAllowanceMetadata().reason, 'shared_allowance_invalid');
    } finally { sender.close(); recipient.close(); }
  });
  await test('shared allowance from a different county is invalid and keeps the gross upper bound', async () => {
    const local = subject(), w = await calculator(local), rows = [{ tier: 60, br: '2br', units: 60 }];
    try {
      mix(w, rows);
      const snapshot = plain(w.__DealCalcShare.buildSnapshot());
      assert.equal(snapshot.utilityAllowance.applied, true);
      const url = new URL(snapshot.url);
      snapshot.utilityAllowance.countyFips = '08077';
      url.searchParams.set('utilityAllowance', JSON.stringify(snapshot.utilityAllowance));
      w.history.replaceState({}, '', url.href); w.__DealCalcShare.hydrate();
      assert.equal(w.document.getElementById('dc-county-select').value, fips);
      checkRevenue(w, expected('chfa_lihtc', rows, local, false));
      for (const id of ['dc-rent-allowance-status', 'dc-noi-allowance-status']) {
        const el = w.document.getElementById(id);
        assert(!el.hidden, 'invalid-record disclosure stays visible');
        assert.equal(el.dataset.allowanceApplied, 'false');
        assert.equal(el.dataset.unavailableReason, 'shared_allowance_invalid');
        assert.match(el.textContent, /upper bound.*shared.*invalid/i);
      }
      assert.deepEqual(plain(w.__DealCalcShare.buildSnapshot().utilityAllowance), { applied: false, reason: 'shared_allowance_invalid' });
    } finally { w.close(); }
  });
  await test('page loads SubjectProject after the rent module and CI reaches this test', () => {
    const w = new JSDOM(read('deal-calculator.html')).window;
    const scripts = [...w.document.querySelectorAll('script[src]')].map((s) => s.getAttribute('src'));
    assert.equal(scripts.indexOf('js/components/subject-project.js'), scripts.indexOf('js/chfa-rent-limits.js') + 1);
    w.close();
    const scriptsConfig = require('../package.json').scripts;
    assert.equal(scriptsConfig['test:deal-calc-net-rent'], 'node test/deal-calc-net-rent.test.js');
    assert(Object.entries(scriptsConfig).some(([key, value]) => /^ci:part-/.test(key) && value.split(' && ').includes('npm run test:deal-calc-net-rent')));
  });
  console.log(`Deal calculator net rent: ${passed} passed, ${failed} failed`);
  if (failed) process.exitCode = 1;
})();
