#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM, VirtualConsole } = require('jsdom');
const limits = require('../js/chfa-rent-limits.js');
const chfa = require('../data/chfa-income-rent-limits-2026.json');
const hud = require('../data/hud-fmr-income-limits.json');
const zori = require('../data/market/zori_rents_co.json');
const read = (p) => fs.readFileSync(p, 'utf8');
const plain = (v) => JSON.parse(JSON.stringify(v));
const settle = () => new Promise((r) => setImmediate(r));
const bedrooms = [['studio', 'efficiency', '0br'], ['1br', '1BR', '1br'], ['2br', '2BR', '2br'], ['3br', '3BR', '3br'], ['4br', '4BR', '4br']];
const tiers = [20, 30, 40, 50, 60, 70, 80, 100, 110, 120];
const counties = ['08031', '08077', chfa.counties.find((c) => c.hera_special).fips];
const formulaMethod = 'Formula ceiling for a non-CHFA AMI-restricted rental — not a published program limit';
const money = (n) => '$' + Math.round(n).toLocaleString('en-US');
const args = (extra = {}) => ({ chfaTable: chfa, hudTable: hud, fips: counties[0], tier: 60, bedrooms: '2BR', rentBurden: 0.30, ...extra });
function change(w, id, value, event = 'change') {
  const el = w.document.getElementById(id);
  assert(el, id);
  if (el.type === 'checkbox') el.checked = value;
  else el.value = String(value);
  el.dispatchEvent(new w.Event(event, { bubbles: true }));
}
async function calculator({ hudTable = hud, lateModule = false } = {}) {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => { if (!e.message.startsWith('Not implemented')) errors.push(e.message); });
  const w = new JSDOM('<main><div id="dealCalcMount"></div></main>', { url: 'https://example.org/deal-calculator.html', runScripts: 'outside-only', virtualConsole: vc }).window;
  w.setTimeout = () => 0;
  w.setInterval = () => 0;
  w.fetch = (url) => {
    let data = null;
    if (String(url).includes('chfa-income-rent-limits')) data = chfa;
    if (String(url).includes('hud-fmr-income-limits')) data = hudTable;
    if (String(url).includes('zori_rents_co')) data = zori;
    return Promise.resolve({ ok: data != null, json: () => Promise.resolve(data) });
  };
  for (const file of ['js/utils/format-money.js', 'js/data-connectors/hud-fmr.js', 'js/deal-calculator-math.js']) w.eval(read(file));
  await w.HudFmr.load();
  if (!lateModule) w.eval(read('js/chfa-rent-limits.js'));
  w.eval(read('js/deal-calculator.js'));
  if (lateModule) w.eval(read('js/chfa-rent-limits.js'));
  w.eval(read('js/deal-calculator-share.js'));
  await settle(); await settle();
  const dc = w.__DealCalc;
  assert(w.document.getElementById('dc-rent-limit-regime'), 'real calculator rendered');
  assert.deepEqual(errors, [], 'no script errors');
  dc.setChfaRentTable(chfa);
  dc.updateAmiLimitsFromFmr(counties[0]);
  return w;
}
let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  PASS ' + name); }
  catch (e) { failed++; console.error('  FAIL ' + name + ': ' + e.stack); }
}
(async () => {
  await test('CHFA calculator limits equal the published county/tier/bedroom data and ignore rent burden', async () => {
    const w = await calculator({ lateModule: true });
    try {
      assert.equal(w.document.getElementById('dc-rent-limit-regime').value, 'chfa_lihtc');
      assert(w.document.getElementById('dc-const-rent-burden').disabled);
      for (const fips of counties) for (const burden of [0.28, 0.30, 0.40]) {
        w.__DealCalc._setConstantsForTest({ rentBurdenPct: burden });
        w.__DealCalc.updateAmiLimitsFromFmr(fips);
        const byBr = w.__DealCalc.getAmiLimitsByBr();
        const county = chfa.counties.find((c) => c.fips === fips);
        for (const tier of tiers) for (const [br, moduleBr, key] of bedrooms) {
          const expected = county.regular_tiers[tier].max_rents[key];
          assert.equal(byBr[tier][br], expected, `${fips}/${tier}/${br}/${burden}`);
          assert.equal(limits.maxGrossRent(chfa, fips, tier, moduleBr).grossRent, expected);
          assert.equal(limits.rentCeiling(args({ fips, tier, bedrooms: moduleBr, rentBurden: burden })).grossRent, expected);
        }
      }
    } finally { w.close(); }
  });
  await test('non-CHFA formula uses the HUD household sizes and responds to rent burden', async () => {
    const w = await calculator();
    try {
      change(w, 'dc-rent-limit-regime', 'ami_formula');
      assert(!w.document.getElementById('dc-const-rent-burden').disabled);
      for (const fips of counties) {
        const il = hud.counties.find((c) => c.fips === fips).income_limits;
        const imputed = [il.il50_1person, (il.il50_1person + il.il50_2person) / 2, il.il50_3person, il.il50_4person * 1.04, il.il50_4person * 1.16];
        for (const burden of [0.28, 0.30, 0.40]) {
          w.__DealCalc.updateAmiLimitsFromFmr(fips);
          change(w, 'dc-const-rent-burden', burden * 100, 'input');
          const byBr = w.__DealCalc.getAmiLimitsByBr();
          for (const tier of tiers) bedrooms.forEach(([br, moduleBr], i) => {
            const expected = imputed[i] * (tier / 50) * burden / 12;
            const result = limits.rentCeiling(args({ regime: 'ami_formula', fips, tier, bedrooms: moduleBr, rentBurden: burden }));
            assert(Math.abs(result.grossRent - expected) < 1e-8);
            assert(Math.abs(byBr[tier][br] - expected) < 1e-8);
            assert.equal(result.method, formulaMethod);
            assert.equal(result.tableYear, hud.meta.income_limits_fiscal_year);
            assert.equal(result.sourceUrl, 'https://www.huduser.gov/portal/datasets/il.html');
          });
        }
      }
    } finally { w.close(); }
  });
  await test('missing income limits remain unavailable without a four-person or other-bedroom fallback', async () => {
    for (const [field, affected] of [['il50_1person', ['efficiency', '1BR']], ['il50_2person', ['1BR']], ['il50_3person', ['2BR']], ['il50_4person', ['3BR', '4BR']]]) {
      for (const missing of [null, undefined, '', 0]) {
        const table = plain(hud);
        table.counties.find((c) => c.fips === counties[0]).income_limits[field] = missing;
        for (const bedrooms of affected) {
          const result = limits.rentCeiling(args({ regime: 'ami_formula', hudTable: table, bedrooms }));
          assert.equal(result.grossRent, null, field + '/' + bedrooms);
          assert.equal(result.unavailableReason, 'income_limit_missing');
        }
      }
    }
    const table = plain(hud);
    delete table.counties.find((c) => c.fips === counties[0]).income_limits.il50_1person;
    const w = await calculator({ hudTable: table });
    try {
      change(w, 'dc-rent-limit-regime', 'ami_formula');
      const byBr = w.__DealCalc.getAmiLimitsByBr();
      assert.equal(byBr[60].studio, null);
      assert.equal(byBr[60]['1br'], null);
      assert(byBr[60]['2br'] > 0, 'another bedroom is available but must not substitute for studio');
      for (const tier of tiers) { change(w, 'dc-units-' + tier, 0, 'input'); change(w, 'dc-chk-' + tier, tier === 60, 'input'); }
      change(w, 'dc-units', 1, 'input');
      change(w, 'dc-units-60', 1, 'input');
      change(w, 'dc-br-60', 'studio');
      assert(!/\$\s*\d/.test(w.document.getElementById('dc-r-rents').textContent), 'missing ceiling blocks revenue');
      assert(!/\$\s*\d/.test(w.document.getElementById('dc-r-mortgage').textContent), 'missing ceiling blocks mortgage');
      for (const regime of ['chfa_lihtc', 'ami_formula', 'market']) {
        change(w, 'dc-rent-limit-regime', regime);
        w.__DealCalc.updateAmiLimitsFromFmr(null);
        assert(!/\$\s*\d/.test(w.document.getElementById('dc-r-rents').textContent), regime + ': no county leaves revenue unknown');
        assert(!/\$\s*\d/.test(w.document.getElementById('dc-r-mortgage').textContent), regime + ': no county leaves the mortgage unknown');
      }
    } finally { w.close(); }
  });
  await test('market has no ceiling and uses the existing market rents for the rent roll', async () => {
    const result = limits.rentCeiling(args({ regime: 'market' }));
    assert.equal(result.grossRent, null);
    assert.equal(result.unavailableReason, 'unrestricted_market');
    const w = await calculator();
    try {
      change(w, 'dc-rent-limit-regime', 'market');
      assert(w.document.getElementById('dc-const-rent-burden').disabled);
      const market = w.__DealCalc.getZoriPerBrRent(counties[0]);
      assert(market && market['2br'] > 0, 'real market data is available');
      for (const tier of tiers) { change(w, 'dc-units-' + tier, 0, 'input'); change(w, 'dc-chk-' + tier, tier === 60, 'input'); }
      change(w, 'dc-units', 1, 'input');
      change(w, 'dc-units-60', 1, 'input');
      assert.equal(w.document.getElementById('dc-r-rents').textContent.trim(), money(market['2br'] * 12));
      assert.equal(w.document.getElementById('dc-r-equity').textContent.trim(), money(0), 'unrestricted units generate no LIHTC equity');
      for (const row of Object.values(w.__DealCalc.getAmiLimitsByBr())) assert(Object.values(row).every((v) => v === null));
      const rows = [...w.document.querySelectorAll('#dc-rent-ach-body tr')];
      assert.equal(rows.length, tiers.length);
      for (const row of rows) assert(row.textContent.includes(limits.unavailableMessage('unrestricted_market')));
    } finally { w.close(); }
  });
  await test('HERA requires an eligible county and a valid PIS date on or before 2008-12-31', () => {
    const county = chfa.counties.find((c) => c.hera_special && c.hera_tiers['60']);
    for (const pisDate of ['2000-01-01', '2008-12-31']) {
      const result = limits.rentCeiling(args({ fips: county.fips, useHera: true, pisDate }));
      assert.equal(result.grossRent, county.hera_tiers['60'].max_rents['2br']);
    }
    for (const [pisDate, reason] of [[null, 'hera_pis_missing'], ['', 'hera_pis_missing'], ['2008-02-30', 'hera_pis_missing'], ['2009-01-01', 'hera_pis_after_2008']]) {
      const result = limits.rentCeiling(args({ fips: county.fips, useHera: true, pisDate }));
      assert.equal(result.grossRent, null);
      assert.equal(result.unavailableReason, reason);
      assert.equal(limits.maxGrossRent(chfa, county.fips, 60, '2BR', { useHera: true, pisDate }).unavailableReason, reason);
      assert.equal(limits.incomeLimit(chfa, county.fips, 60, 3, { useHera: true, pisDate }).incomeLimit, null);
    }
    assert.equal(limits.heraStatus(chfa, county.fips, { useHera: true }).sourceNote, chfa.meta.hera_special_note);
    const regular = chfa.counties.find((c) => !c.hera_special);
    assert.equal(limits.rentCeiling(args({ fips: regular.fips, useHera: true, pisDate: '2008-12-31' })).unavailableReason, 'hera_county_unavailable');
  });
  await test('SubjectProject HERA controls and rows use the date guard for saved and edited projects', async () => {
    const county = chfa.counties.find((c) => c.hera_special && c.hera_tiers['60']);
    const w = new JSDOM('<div id="sp"></div>', { url: 'https://example.org/', runScripts: 'outside-only' }).window;
    w.fetch = () => Promise.resolve({ json: () => Promise.resolve(chfa) });
    w.localStorage.setItem('coho.subjectProject.v1', JSON.stringify({ county_fips: county.fips, use_hera_special: true, pis_date: null,
      unit_mix: [{ bedrooms: '2BR', ami_tier: 60, count: 1 }] }));
    w.eval(read('js/chfa-rent-limits.js')); w.eval(read('js/components/subject-project.js'));
    w.SubjectProject.mount(w.document.getElementById('sp'));
    await settle();
    try {
      const gross = () => w.document.querySelector('#sp tbody tr').children[7].textContent.trim();
      assert(w.document.getElementById('sp-use_hera_special').disabled);
      assert.equal(gross(), limits.unavailableMessage('hera_pis_missing'));
      change(w, 'sp-pis_date', '2009-01-01');
      assert.equal(gross(), limits.unavailableMessage('hera_pis_after_2008'));
      change(w, 'sp-pis_date', '2008-12-31');
      assert(!w.document.getElementById('sp-use_hera_special').disabled);
      assert.equal(gross(), money(county.hera_tiers['60'].max_rents['2br']));
      change(w, 'sp-pis_date', '');
      assert(w.document.getElementById('sp-use_hera_special').disabled);
      assert.equal(gross(), limits.unavailableMessage('hera_pis_missing'));
    } finally { w.close(); }
  });
  await test('both HERA subject panels pass the saved PIS date and block invalid HERA without stale totals', async () => {
    const county = chfa.counties.find((c) => c.hera_special && c.hera_tiers['60']);
    const w = new JSDOM('<div id="rent"></div><div id="income"></div>', { url: 'https://example.org/', runScripts: 'outside-only' }).window;
    w.fetch = (url) => Promise.resolve({ json: () => Promise.resolve(String(url).includes('chfa-') ? chfa : hud) });
    w.localStorage.setItem('coho.subjectProject.v1', JSON.stringify({ county_fips: county.fips, use_hera_special: true, pis_date: '2008-12-31',
      utility_allowance_basis: { method: 'owner_pays_all', resident_paid: [] },
      unit_mix: [{ bedrooms: '2BR', ami_tier: 60, count: 1, proposed_gross_rent: 1000, utility_allowance: 0 }] }));
    for (const file of ['js/chfa-rent-limits.js', 'js/components/subject-project.js', 'js/components/subject-rent-comparison.js', 'js/components/subject-income-eligibility.js']) w.eval(read(file));
    const rent = w.document.getElementById('rent'), income = w.document.getElementById('income');
    async function render() { w.SubjectRentComparison.render(rent); w.SubjectIncomeEligibility.render(income); await settle(); }
    try {
      await render();
      assert.equal(rent.querySelector('tbody tr').children[6].textContent, money(county.hera_tiers['60'].max_rents['2br']));
      assert.equal(income.querySelector('tbody tr').children[6].textContent, money(county.hera_tiers['60'].income_limits['3p']));
      for (const [date, reason] of [['', 'hera_pis_missing'], ['2008-02-30', 'hera_pis_missing'], ['2009-01-01', 'hera_pis_after_2008']]) {
        w.SubjectProject.set({ ...w.SubjectProject.get(), pis_date: date });
        await render();
        for (const panel of [rent, income]) {
          assert.equal(panel.querySelector('tbody'), null, 'blocked HERA clears previous table and aggregate');
          assert.equal(panel.textContent, limits.unavailableMessage(reason));
        }
      }
      w.SubjectProject.set({ ...w.SubjectProject.get(), use_hera_special: false });
      await render();
      assert.equal(rent.querySelector('tbody tr').children[6].textContent, money(county.regular_tiers['60'].max_rents['2br']));
      assert.equal(income.querySelector('tbody tr').children[6].textContent, money(county.regular_tiers['60'].income_limits['3p']));
    } finally { w.close(); }
  });
  await test('live examples, captions, share inputs and JSON/PDF metadata agree with the chosen regime', async () => {
    const w = await calculator();
    try {
      for (const regime of ['chfa_lihtc', 'ami_formula', 'market']) {
        change(w, 'dc-rent-limit-regime', regime);
        const expected = limits.rentCeiling(args({ regime }));
        const meta = Object.fromEntries(['regime', 'method', 'source', 'tableYear', 'effectiveDate'].map((key) => [key, expected[key]]));
        for (const id of ['dc-formula-ceiling-eg', 'dc-rent-limit-example']) {
          const example = w.document.getElementById(id);
          assert.equal(example.dataset.grossRent, expected.grossRent == null ? '' : String(expected.grossRent));
          assert(example.textContent.includes(expected.grossRent == null ? limits.unavailableMessage(expected.unavailableReason) : money(expected.grossRent)));
        }
        assert(w.document.getElementById('dc-fmr-note').textContent.includes(expected.grossRent == null ? limits.unavailableMessage(expected.unavailableReason) : money(expected.grossRent)));
        const caption = w.document.getElementById('dc-rent-limit-caption').textContent;
        assert(caption.includes(expected.source));
        if (expected.tableYear != null) assert(caption.includes(String(expected.tableYear)));
        const snap = w.__DealCalcShare.buildSnapshot();
        assert.deepEqual(plain(snap.rentLimits), meta);
        assert.equal(snap.inputs['rent-limit-regime'], regime);
        assert.equal(new URL(snap.url).searchParams.get('rent-limit-regime'), regime);
        let properties, saved = false;
        w.html2canvas = async () => ({ width: 600, height: 600, toDataURL: () => 'image' });
        w.jspdf = { jsPDF: function () { this.internal = { pageSize: { getWidth: () => 600, getHeight: () => 800 } }; this.addImage = () => {}; this.setProperties = (p) => { properties = p; }; this.save = () => { saved = true; }; } };
        await w.__DealCalcShare.exportPdf();
        assert(saved, 'PDF generated');
        assert.deepEqual(JSON.parse(properties.subject).rentLimits, meta);
      }
    } finally { w.close(); }
  });
  await test('page loads the module and CHFA file, and CI reaches this suite', () => {
    const w = new JSDOM(read('deal-calculator.html')).window;
    const scripts = [...w.document.querySelectorAll('script[src]')].map((s) => s.getAttribute('src'));
    assert(scripts.indexOf('js/chfa-rent-limits.js') >= 0);
    assert(scripts.indexOf('js/chfa-rent-limits.js') < scripts.indexOf('js/deal-calculator.js'));
    assert([...w.document.querySelectorAll('script:not([src])')].some((s) => s.textContent.includes('data/chfa-income-rent-limits-2026.json')));
    w.close();
    const p = require('../package.json').scripts;
    assert.equal(p['test:rent-ceiling-regime'], 'node test/rent-ceiling-regime.test.js');
    assert(Object.entries(p).some(([k, v]) => /^ci:part-/.test(k) && v.split(' && ').includes('npm run test:rent-ceiling-regime')));
  });
  console.log(`Rent ceiling regime: ${passed} passed, ${failed} failed`);
  if (failed) process.exitCode = 1;
})();
