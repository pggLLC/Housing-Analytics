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
const read = p => fs.readFileSync(p, 'utf8');
const plain = v => JSON.parse(JSON.stringify(v));
const settle = () => new Promise(resolve => setImmediate(resolve));
const fips = '08077';
const money = n => '$' + Math.round(n).toLocaleString('en-US');
const basis = () => ({ method: 'pha', reference: 'County PHA schedule', effective_date: '2026-01-01',
  resident_paid: ['heat'], bound_county_fips: fips });
function restricted(tier, bedrooms, count) {
  const gross = limits.maxGrossRent(chfa, fips, tier, bedrooms).grossRent;
  assert(gross > 0, 'fixture requires a published CHFA rent');
  return { ami_tier: tier, bedrooms, count, proposed_gross_rent: gross - 37, utility_allowance: 150, fees: 10 };
}
function subject() {
  return { county_fips: fips, total_units: 10, vacancy_rate: 0.04, utility_allowance_basis: basis(),
    unit_mix: [restricted(60, '2BR', 5), restricted(90, '1BR', 1), restricted(110, '3BR', 1), restricted(120, 'efficiency', 1),
      { ami_tier: 'market', bedrooms: '2BR', count: 2, market_rent: limits.maxGrossRent(chfa, fips, 100, '2BR').grossRent,
        market_rent_source: 'Survey, September 2026 "Autumn"', utility_allowance: 999, fees: 999 }] };
}
const schedule = s => limits.rentSchedule(s, { chfaTable: chfa });
const expectedRevenue = s => schedule(s).rows.reduce((sum, row) => sum + row.contractRent * row.count * 12, 0);
function change(w, id, value, event = 'change') {
  const el = w.document.getElementById(id); assert(el, id);
  if (el.type === 'checkbox') el.checked = value; else el.value = String(value);
  el.dispatchEvent(new w.Event(event, { bubbles: true }));
}
const text = (w, id) => w.document.getElementById(id).textContent.trim();
async function calculator(saved = subject(), options = {}) {
  const errors = [], vc = new VirtualConsole();
  vc.on('jsdomError', e => { if (!e.message.startsWith('Not implemented')) errors.push(e.message); });
  const w = new JSDOM('<main><div id="dealCalcMount"></div></main>', {
    url: 'https://example.org/deal-calculator.html' + (options.search || ''), runScripts: 'outside-only', virtualConsole: vc }).window;
  w.setTimeout = () => 0; w.setInterval = () => 0;
  w.fetch = url => {
    const path = String(url), data = path.includes('chfa-income-rent-limits') ? chfa
      : path.includes('hud-fmr-income-limits') ? hud : path.includes('zori_rents_co') ? zori : null;
    return Promise.resolve({ ok: data != null, json: () => Promise.resolve(data) });
  };
  if (saved) w.localStorage.setItem('coho.subjectProject.v1', JSON.stringify(saved));
  if (options.manualInputs) w.localStorage.setItem('coho.dealCalc.manualMix.v1', options.manualInputs);
  for (const file of ['js/utils/format-money.js', 'js/data-connectors/hud-fmr.js', 'js/deal-calculator-math.js', 'js/chfa-rent-limits.js']) w.eval(read(file));
  if (!options.noSubject) {
    w.eval(read('js/components/subject-project.js'));
    if (options.forbidSubjectRead) w.SubjectProject.get = () => { throw new Error('Shared deal read recipient Subject Project'); };
  }
  await w.HudFmr.load();
  w.eval(read('js/deal-calculator.js'));
  await settle(); await settle();
  w.eval(read('js/deal-calculator-report-meta.js'));
  w.eval(read('js/deal-calculator-share.js'));
  w.__DealCalc.setChfaRentTable(chfa);
  const county = w.document.getElementById('dc-county-select');
  for (const code of [fips, '08031']) if (![...county.options].some(o => o.value === code)) county.add(new w.Option(code, code));
  county.value = fips; w.__DealCalc.updateAmiLimitsFromFmr(fips);
  if (options.search) w.__DealCalcShare.hydrate();
  await settle();
  assert.deepEqual(errors, [], 'no runtime errors');
  return w;
}
function assertRevenue(w, s) {
  assert.equal(text(w, 'dc-r-rents'), money(expectedRevenue(s)));
  assert.equal(+w.document.getElementById('dc-units').value, s.total_units);
  assert.equal(+w.document.getElementById('dc-vacancy').value, s.vacancy_rate * 100);
  const expenses = s.total_units * (+w.document.getElementById('dc-opex').value * 12 + +w.document.getElementById('dc-rep-reserve').value
    + +w.document.getElementById('dc-prop-tax').value * (1 - +w.document.getElementById('dc-tax-exempt').value / 100));
  assert.equal(text(w, 'dc-noi-computed'), money(expectedRevenue(s) * (1 - s.vacancy_rate) - expenses));
}
let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  PASS ' + name); }
  catch (e) { failed++; console.error('  FAIL ' + name + ': ' + e.stack); }
}
(async () => {
  await test('adapter carries priced rows and source records without mutating the schedule', () => {
    const result = schedule(subject()), original = plain(result);
    const mix = limits.dealMixFromSchedule(result, { countyFips: fips, regime: 'chfa_lihtc' });
    assert(mix.available); assert.equal(mix.totalUnits, 10); assert.equal(mix.vacancyRate, 0.04);
    assert.deepEqual(mix.restrictedRows.map(r => r.contractRent), result.rows.filter(r => !r.isMarket).map(r => r.contractRent));
    assert.deepEqual(mix.marketRows.map(r => r.rent), result.rows.filter(r => r.isMarket).map(r => r.contractRent));
    assert.equal(mix.sourceMeta.tableYear, chfa.meta.fiscal_year);
    assert.equal(mix.sourceMeta.effectiveDate, chfa.meta.effective_date);
    assert.deepEqual(mix.sourceMeta.allowanceBasis, { method: basis().method, reference: basis().reference, effectiveDate: basis().effective_date });
    assert.equal(mix.sourceMeta.marketRentSources[0].source, subject().unit_mix[4].market_rent_source);
    assert.equal(mix.sourceMeta.vacancyRate, subject().vacancy_rate);
    mix.sourceMeta.allowanceBasis.reference = 'Edited copy'; assert.deepEqual(result, original);
    assert.equal(limits.dealMixFromSchedule(result, { countyFips: '08031', regime: 'chfa_lihtc' }).reason, 'schedule_other_county');
    assert.equal(limits.dealMixFromSchedule(result, { countyFips: fips, regime: 'ami_formula' }).reason, 'schedule_requires_chfa_setting');
    for (const [mutate, reason] of [[s => { s.total_units++; }, 'unit_count_mismatch'], [s => { s.vacancy_rate = ''; }, 'vacancy_rate_missing']]) {
      const s = subject(); mutate(s);
      assert.equal(limits.dealMixFromSchedule(schedule(s), { countyFips: fips, regime: 'chfa_lihtc' }).reason, 'schedule_unavailable:' + reason);
    }
  });
  await test('schedule revenue includes 90% and market rows, with no second allowance deduction or grid cap', async () => {
    const s = subject(), w = await calculator(s);
    try {
      assertRevenue(w, s);
      assert.equal(w.__DealCalc.getUtilityAllowanceMetadata().reason, 'included_in_schedule_rents');
      assert.equal(w.__DealCalcShare.buildSnapshot().utilityAllowance.applied, false);
      assert.equal(w.document.getElementById('dc-unit-mix-status').dataset.mode, 'schedule');
      assert(text(w, 'dc-unit-mix-status').includes('Market Analysis'));
      assert(w.document.getElementById('dc-manual-unit-mix').hidden);
      assert(w.document.getElementById('dc-vacancy').readOnly && w.document.getElementById('dc-units').readOnly);
      assert.equal(w.document.getElementById('dc-units-90-1br'), null, 'there is no 90% grid column');
      const rows = [...w.document.querySelectorAll('#dc-schedule-table tbody tr')];
      assert.equal(rows.length, s.unit_mix.length);
      assert.equal(rows.find(r => r.dataset.tier === '90').dataset.rent, String(schedule(s).rows[1].contractRent));
      assert(rows.find(r => r.dataset.tier === 'market').textContent.includes(s.unit_mix[4].market_rent_source));
      assert.equal(w.document.querySelector('#dc-schedule-table input'), null);
      assert.deepEqual(plain(w.__DealCalc.collectBedroomMix()), { studio: 1, '1br': 1, '2br': 7, '3br': 1, '4br': 0 });
      change(w, 'dc-units-60-2br', 500, 'input'); change(w, 'dc-achievable-cap', true);
      assertRevenue(w, s);
      assert.equal(w.__DealCalcShare.buildSnapshot().rentSchedule.mode, 'schedule');
    } finally { w.close(); }
  });
  await test('designation counts only eligible restricted tiers, never market or 110/120% planning bands', async () => {
    const w = await calculator();
    try {
      const eligible = subject().unit_mix.filter(r => r.ami_tier !== 'market' && w.__DealCalc.isLihtcCreditEligiblePct(r.ami_tier, '40-60')).reduce((n, r) => n + r.count, 0);
      const expectedBasis = +w.document.getElementById('dc-tdc').value * +w.document.getElementById('dc-basis-pct').value / 100 * eligible / subject().total_units;
      assert.equal(text(w, 'dc-r-basis'), money(expectedBasis));
      assert.equal(text(w, 'dc-r-credits'), money(expectedBasis * 0.09));
      assert(eligible < subject().total_units && eligible === 5);
      change(w, 'dc-minimum-set-aside', 'average-income');
      assert.equal(text(w, 'dc-r-credits'), money(0), 'CHFA all-units AIT rule still applies');
      const market = { county_fips: fips, total_units: 2, vacancy_rate: 0, unit_mix: [subject().unit_mix[4]] };
      w.SubjectProject.set(market); assertRevenue(w, market);
      assert.equal(text(w, 'dc-r-credits'), money(0));
    } finally { w.close(); }
  });
  await test('each unavailable schedule reason restores the manual grid and D2 pricing', async () => {
    for (const [name, mutate, county, regime, reason] of [
      ['unpriced', s => { s.unit_mix[0].proposed_gross_rent = ''; }, fips, 'chfa_lihtc', 'schedule_unavailable:unpriced_rows'],
      ['county', () => {}, '08031', 'chfa_lihtc', 'schedule_other_county'],
      ['setting', () => {}, fips, 'ami_formula', 'schedule_requires_chfa_setting'],
      ['vacancy', s => { s.vacancy_rate = ''; }, fips, 'chfa_lihtc', 'schedule_unavailable:vacancy_rate_missing']
    ]) {
      const w = await calculator();
      try {
        const s = subject(); mutate(s); w.SubjectProject.set(s);
        change(w, 'dc-county-select', county); change(w, 'dc-rent-limit-regime', regime);
        const status = w.document.getElementById('dc-unit-mix-status');
        assert.equal(status.dataset.mode, 'manual', name); assert.equal(status.dataset.unavailableReason, reason);
        assert(status.textContent.includes(reason)); assert(!w.document.getElementById('dc-manual-unit-mix').hidden);
        assert(!w.document.getElementById('dc-vacancy').readOnly);
        assert.equal(+w.document.getElementById('dc-units').value, 60, 'fallback restores the existing manual grid total');
        const ua = limits.allowanceByBedroom(w.SubjectProject.get(), county);
        const annual = [30, 40, 50, 60].reduce((sum, tier) => {
          const gross = limits.rentCeiling({ regime, chfaTable: chfa, hudTable: hud, fips: county, tier, bedrooms: '2BR', rentBurden: 0.30 }).grossRent;
          const net = ua.applied ? limits.maxContractRent({ grossRent: gross, utilityAllowance: ua.perBedroom['2BR'], fees: ua.feesPerBedroom['2BR'] }).contractRent : gross;
          return sum + 15 * net * 12;
        }, 0);
        assert.equal(text(w, 'dc-r-rents'), money(annual));
      } finally { w.close(); }
    }
  });
  await test('manual fallback without a county stays unavailable rather than becoming zero revenue', async () => {
    const w = await calculator();
    try {
      change(w, 'dc-county-select', '');
      assert.equal(w.document.getElementById('dc-unit-mix-status').dataset.mode, 'manual');
      for (const id of ['dc-r-rents', 'dc-r-noi-stab', 'dc-r-mortgage']) {
        assert(!/\$\s*\d/.test(text(w, id)), id + ': unavailable, not measured zero');
      }
    } finally { w.close(); }
  });
  await test('market rows cannot invalidate restricted D2 allowances after opting into the manual grid', async () => {
    for (const staleMarketFields of [false, true]) {
      const s = subject();
      if (!staleMarketFields) { delete s.unit_mix[4].utility_allowance; delete s.unit_mix[4].fees; }
      const resolved = limits.allowanceByBedroom(s, fips);
      assert.equal(resolved.applied, true, 'market rows carry no allowance or fees, even if old fields remain');
      assert.equal(resolved.perBedroom['2BR'], s.unit_mix[0].utility_allowance);
      assert.equal(resolved.feesPerBedroom['2BR'], s.unit_mix[0].fees);
      const w = await calculator(s);
      try {
        w.document.getElementById('dc-edit-unit-mix').click();
        assert.equal(w.__DealCalc.getUtilityAllowanceMetadata().applied, true);
        const expected = s.unit_mix.filter(r => [60, 110, 120].includes(r.ami_tier)).reduce((sum, r) => {
          const gross = limits.maxGrossRent(chfa, fips, r.ami_tier, r.bedrooms).grossRent;
          return sum + limits.maxContractRent({ grossRent: gross, utilityAllowance: r.utility_allowance, fees: r.fees }).contractRent * r.count * 12;
        }, 0);
        assert.equal(text(w, 'dc-r-rents'), money(expected));
      } finally { w.close(); }
    }
  });
  await test('Edit here instead prefills supported columns and persists the manual choice with those inputs', async () => {
    const w = await calculator(); let saved;
    try {
      w.document.getElementById('dc-edit-unit-mix').click();
      assert.equal(w.document.getElementById('dc-unit-mix-source').value, 'manual');
      for (const [id, expected] of [['dc-units-60-2br', 5], ['dc-units-110-3br', 1], ['dc-units-120-studio', 1], ['dc-units', 10], ['dc-vacancy', 4]]) {
        assert.equal(+w.document.getElementById(id).value, expected, id);
      }
      const omitted = JSON.parse(w.document.getElementById('dc-unrepresented-schedule-rows').value);
      assert.deepEqual(omitted.map(r => r.tier), [90, 'market']);
      assert(text(w, 'dc-unrepresented-schedule-notice').includes('90%') && text(w, 'dc-unrepresented-schedule-notice').includes('not representable'));
      const s = w.SubjectProject.get(); s.unit_mix[0].count = 8; s.total_units = 13; w.SubjectProject.set(s);
      assert.equal(+w.document.getElementById('dc-units-60-2br').value, 5, 'manual choice survives subject edits');
      change(w, 'dc-units-60-2br', 4, 'input');
      saved = w.localStorage.getItem('coho.dealCalc.manualMix.v1'); assert(saved);
      const snapshot = w.__DealCalcShare.buildSnapshot(); assert.equal(snapshot.inputs['unit-mix-source'], 'manual');
      assert.equal(snapshot.rentSchedule.mode, 'manual');
    } finally { w.close(); }
    const restored = await calculator(subject(), { manualInputs: saved });
    try {
      assert.equal(restored.document.getElementById('dc-unit-mix-status').dataset.mode, 'manual');
      assert.equal(+restored.document.getElementById('dc-units-60-2br').value, 4);
      assert(text(restored, 'dc-unrepresented-schedule-notice').includes('90%'));
    } finally { restored.close(); }
  });
  await test('same-page and storage changes recalculate the resolved schedule and vacancy', async () => {
    const w = await calculator();
    try {
      const s = w.SubjectProject.get(); s.unit_mix[0].proposed_gross_rent -= 20; s.vacancy_rate = 0.08;
      w.SubjectProject.set(s); assertRevenue(w, s);
      s.unit_mix[4].market_rent += 30; s.vacancy_rate = 0;
      w.localStorage.setItem('coho.subjectProject.v1', JSON.stringify(s));
      w.dispatchEvent(new w.StorageEvent('storage', { key: 'coho.subjectProject.v1' })); assertRevenue(w, s);
    } finally { w.close(); }
  });
  await test('shared schedule reproduces revenue, NOI and gap with no recipient subject reads or writes', async () => {
    const sender = await calculator();
    try {
      const snapshot = plain(sender.__DealCalcShare.buildSnapshot()), search = new URL(snapshot.url).search;
      for (const local of [null, { ...subject(), vacancy_rate: 0.5 }]) {
        const recipient = await calculator(local, { search, noSubject: !local, forbidSubjectRead: !!local });
        try {
          assert.deepEqual(plain(recipient.__DealCalcShare.buildSnapshot().outputs), snapshot.outputs);
          assert.deepEqual(plain(recipient.__DealCalcShare.buildSnapshot().rentSchedule), snapshot.rentSchedule);
          assert.equal(recipient.localStorage.getItem('coho.subjectProject.v1'), local ? JSON.stringify(local) : null);
          assert(text(recipient, 'dc-unit-mix-status').includes('shared scenario'));
          recipient.__DealCalc.setChfaRentTable(null);
          assert.equal(text(recipient, 'dc-r-rents'), snapshot.outputs.annualRents, 'shared prices do not require the recipient table');
        } finally { recipient.close(); }
      }
      const recipient = await calculator(subject(), { search });
      try {
        change(recipient, 'dc-county-select', '08031');
        assert.equal(recipient.document.getElementById('dc-unit-mix-status').dataset.unavailableReason, 'schedule_other_county');
        assert(!recipient.document.getElementById('dc-schedule-local-notice').hidden);
        change(recipient, 'dc-county-select', fips); assertRevenue(recipient, subject());
        recipient.__DealCalcShare.hydrate(); recipient.document.getElementById('dc-edit-unit-mix').click();
        assert.equal(recipient.__DealCalcShare.buildSnapshot().rentSchedule.mode, 'manual');
        assert.notEqual(recipient.__DealCalc.getUtilityAllowanceMetadata().reason, 'included_in_schedule_rents');
        // Load the share again, then a setting edit must also release it.
        recipient.__DealCalcShare.hydrate(); change(recipient, 'dc-rent-limit-regime', 'ami_formula');
        assert.equal(recipient.document.getElementById('dc-unit-mix-status').dataset.unavailableReason, 'schedule_requires_chfa_setting');
      } finally { recipient.close(); }
    } finally { sender.close(); }
  });
  await test('shared schedule with the wrong county is rejected; old links retain their manual grid', async () => {
    const sender = await calculator();
    try {
      const params = new URL(sender.__DealCalcShare.buildSnapshot().url).searchParams;
      const record = JSON.parse(params.get('rentSchedule')); record.countyFips = '08031';
      params.set('rentSchedule', JSON.stringify(record));
      const bad = await calculator(null, { search: '?' + params, noSubject: true });
      try { assert.equal(bad.document.getElementById('dc-unit-mix-status').dataset.unavailableReason, 'shared_schedule_invalid'); } finally { bad.close(); }
      params.delete('rentSchedule'); params.delete('utilityAllowance'); params.delete('unit-mix-source');
      const old = await calculator(subject(), { search: '?' + params });
      try { assert.equal(old.document.getElementById('dc-unit-mix-status').dataset.mode, 'manual'); } finally { old.close(); }
    } finally { sender.close(); }
  });
  await test('deal JSON and PDF metadata include the priced schedule and source records', async () => {
    const w = await calculator();
    try {
      const snapshot = plain(w.__DealCalcShare.buildSnapshot());
      assert.equal(snapshot.rentSchedule.rows.length, subject().unit_mix.length);
      assert.deepEqual(snapshot.rentSchedule.sourceMeta, schedule(subject()).sourceMeta);

      w.html2canvas = async () => ({ width: 600, height: 600, toDataURL: () => 'image' });
      const pdf = createJsPdfMock();
      w.jspdf = { jsPDF: pdf.jsPDF };
      await w.__DealCalcShare.exportPdf(); pdf.assertSupported(); assert.deepEqual(JSON.parse(pdf.properties.subject).rentSchedule, snapshot.rentSchedule);
    } finally { w.close(); }
  });
  await test('Market Analysis JSON and CSV include full schedule rows, reasons, totals and sources', async () => {
    const vc = new VirtualConsole();
    const w = new JSDOM('<button id="pmaExportJson"></button><button id="pmaExportCsv"></button>',
      { url: 'https://example.org/market-analysis.html', runScripts: 'outside-only', virtualConsole: vc }).window;
    const downloads = [];
    w.Blob = function (parts) { downloads.push(parts.join('')); };
    w.URL.createObjectURL = () => 'blob:test'; w.HTMLAnchorElement.prototype.click = () => {};
    w.fetch = () => Promise.resolve({ json: () => Promise.resolve(chfa) });
    for (const path of ['js/chfa-rent-limits.js', 'js/components/subject-project.js', 'js/market-analysis/market-analysis-utils.js',
      'js/market-analysis-scoring.js', 'js/market-analysis.js']) w.eval(read(path));
    await settle();
    try {
      const E = w.PMAEngine;
      const acs = { renter_hh: 200, total_hh: 400, pop: 1000, cost_burden_rate: 0.4, vacancy_rate: 0.05, median_gross_rent: 1500, median_hh_income: 60000 };
      const result = Object.assign(E.computePma(acs, 10, 0, 39.74, -104.99, [], 95000, [], {}), { acs });
      E._setLastResultForTest(result);
      for (const missing of [false, true]) {
        const s = subject(); if (missing) s.unit_mix[0].proposed_gross_rent = '';
        w.localStorage.setItem('coho.subjectProject.v1', JSON.stringify(s)); downloads.length = 0;
        w.document.getElementById('pmaExportJson').click(); w.document.getElementById('pmaExportCsv').click(); await settle();
        assert.equal(downloads.length, 2);
        const json = JSON.parse(downloads.find(d => d.startsWith('{')));
        const expected = schedule(s); assert.deepEqual(json.rentSchedule, expected);
        const csv = downloads.find(d => d.startsWith('field,value'));
        const values = Object.fromEntries(csv.split('\n').map(line => {
          const i = line.indexOf(','); let value = line.slice(i + 1);
          if (value.startsWith('"')) value = value.slice(1, -1).replace(/""/g, '"');
          return [line.slice(0, i), value];
        }));
        expected.rows.forEach(row => assert.deepEqual(JSON.parse(values['rent_schedule.row.' + row.rowNumber]), row));
        assert.deepEqual(JSON.parse(values['rent_schedule.totals']), expected.totals);
        assert.deepEqual(JSON.parse(values['rent_schedule.sources']), expected.sourceMeta);
        assert.equal(values['rent_schedule.unavailable_reason'], missing ? 'unpriced_rows' : '');
      }
      w.SubjectProject = null; downloads.length = 0; w.document.getElementById('pmaExportJson').click();
      assert.equal(JSON.parse(downloads[0]).rentSchedule.unavailableReason, 'subject_project_unavailable');
      assert.equal(result.rentSchedule, undefined, 'export does not mutate the analysis result');
    } finally { w.close(); }
  });
  await test('the new suite is reachable from a CI part', () => {
    const scripts = require('../package.json').scripts;
    assert.equal(scripts['test:deal-calc-schedule'], 'node test/deal-calc-schedule.test.js');
    assert(Object.entries(scripts).some(([k, v]) => /^ci:part-/.test(k) && v.split(' && ').includes('npm run test:deal-calc-schedule')));
  });
  console.log(`Deal calculator schedule: ${passed} passed, ${failed} failed`);
  if (failed) process.exitCode = 1;
})().catch(e => { console.error(e); process.exitCode = 1; });
