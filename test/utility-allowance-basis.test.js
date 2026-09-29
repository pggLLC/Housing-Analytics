#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const limits = require('../js/chfa-rent-limits.js');
const table = require('../data/chfa-income-rent-limits-2026.json');
const read = (p) => fs.readFileSync(p, 'utf8');
const plain = (v) => JSON.parse(JSON.stringify(v));
const county = table.counties.find((c) => c.regular_tiers['60'].max_rents['2br'] > 200).fips;
const otherCounty = table.counties.find((c) => c.fips !== county).fips;
const gross = table.counties.find((c) => c.fips === county).regular_tiers['60'].max_rents['2br'];
const storageKey = 'coho.subjectProject.v1';
const completeBasis = () => ({ method: 'pha', reference: 'County PHA schedule', effective_date: '2026-01-01', resident_paid: ['heat', 'water'], bound_county_fips: county });
const project = (basis = completeBasis()) => ({ county_fips: county, utility_allowance_basis: basis, unit_mix: [
  { bedrooms: '2BR', ami_tier: 60, count: 3, utility_allowance: 150, fees: 25 }
] });
const money = (n) => '$' + Math.round(n).toLocaleString('en-US');
const settle = () => new Promise((resolve) => setImmediate(resolve));
async function app(subject, siteCounty) {
  const w = new JSDOM('<div id="sp"></div><div id="rc"></div>', { runScripts: 'outside-only', url: 'https://example.org/' }).window;
  w.fetch = () => Promise.resolve({ json: () => Promise.resolve(table) });
  w.alert = () => {}; w.confirm = () => true;
  if (subject) w.localStorage.setItem(storageKey, JSON.stringify(subject));
  if (siteCounty) w.SiteState = { getCounty: () => ({ fips: siteCounty }) };
  for (const p of ['js/chfa-rent-limits.js', 'js/components/subject-project.js', 'js/components/subject-rent-comparison.js']) w.eval(read(p));
  w.SubjectProject.mount(w.document.getElementById('sp'));
  w.SubjectRentComparison.attach(w.document.getElementById('rc'));
  await settle();
  return w;
}
function change(w, selector, value) {
  const node = w.document.querySelector(selector);
  assert(node, selector + ' exists');
  if (node.type === 'checkbox') node.checked = value;
  else node.value = value;
  node.dispatchEvent(new w.Event('change', { bubbles: true }));
}
function netCells(w, id) {
  const headers = [...w.document.querySelectorAll('#' + id + ' th')].map((n) => n.textContent.trim());
  const col = headers.indexOf('LIHTC max net');
  assert(col >= 0, id + ': net rent column exists');
  const cells = [...w.document.querySelectorAll('#' + id + ' tbody tr')].map((r) => r.children[col]);
  assert(cells.length > 0 && cells.every(Boolean), id + ': rows exist');
  return cells;
}
function blockedTables(w, reason, basisComplete = false) {
  for (const id of ['sp', 'rc']) {
    for (const cell of netCells(w, id)) {
      const missingAmount = reason === 'utility_allowance_missing';
      assert.equal(cell.getAttribute('data-net-rent-unavailable'), missingAmount && id === 'sp' ? 'utility-allowance' : reason, id);
      assert.equal(cell.title, missingAmount ? w.SubjectProject.UA_MISSING_REASON : reason);
      assert(cell.textContent.trim(), 'visible reason');
      assert(!/\$\s*\d/.test(cell.textContent), 'blocked net rent has no money');
    }
    assert.equal(w.document.querySelector('#' + id + ' caption').textContent.includes('Utility allowance:'), basisComplete, 'caption agrees with basis completeness');
  }
}
let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  PASS ' + name); }
  catch (err) { failed++; console.error('  FAIL ' + name + ': ' + err.stack); }
}
(async () => {
  await test('frozen methods carry the requested paragraphs and one regulation URL', () => {
    const expected = { rhs_building: '(b)(1)', rhs_tenant: '(b)(2)', hud_regulated: '(b)(3)', pha_section8_tenant: '(b)(4)(i)', pha: '(b)(4)(ii)(A)', utility_company: '(b)(4)(ii)(B)', agency_estimate: '(b)(4)(ii)(C)', hud_usm: '(b)(4)(ii)(D)', energy_model: '(b)(4)(ii)(E)', owner_pays_all: null };
    assert(Object.isFrozen(limits.ALLOWANCE_METHODS));
    assert.equal(limits.ALLOWANCE_METHODS.length, 10);
    assert.deepEqual(Object.fromEntries(limits.ALLOWANCE_METHODS.map((m) => [m.method, m.paragraph])), expected);
    for (const method of limits.ALLOWANCE_METHODS) {
      assert(Object.isFrozen(method));
      assert.equal(method.sourceUrl, 'https://www.law.cornell.edu/cfr/text/26/1.42-10');
      assert(method.applicability.trim() && method.label.trim());
      const basis = { ...completeBasis(), method: method.method };
      if (method.method === 'owner_pays_all') basis.resident_paid = [];
      assert.equal(limits.allowanceBasisStatus(basis, county).complete, true);
    }
  });
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const future = tomorrow.getFullYear() + '-' + String(tomorrow.getMonth() + 1).padStart(2, '0') + '-' + String(tomorrow.getDate()).padStart(2, '0');
  const cases = [
    [null, 'allowance_method_missing'],
    [{ ...completeBasis(), method: '' }, 'allowance_method_missing'],
    [{ ...completeBasis(), method: 'invented' }, 'allowance_method_missing'],
    [{ ...completeBasis(), reference: '  ' }, 'allowance_reference_missing'],
    ...['', '2026-02-30', '2025-02-29', '2026-1-01', 'not a date'].map((effective_date) => [{ ...completeBasis(), effective_date }, 'allowance_date_missing']),
    [{ ...completeBasis(), effective_date: future }, 'allowance_date_in_future'],
    [{ ...completeBasis(), resident_paid: [] }, 'resident_utilities_missing'],
    [{ ...completeBasis(), resident_paid: ['internet'] }, 'resident_utilities_missing'],
    [{ ...completeBasis(), bound_county_fips: otherCounty }, 'allowance_basis_other_geography'],
    [{ ...completeBasis(), bound_county_fips: '' }, 'allowance_basis_other_geography'],
    [{ method: 'owner_pays_all', resident_paid: ['heat'] }, 'owner_pays_all_resident_utilities']
  ];
  await test('every unavailable status blocks module arithmetic and both real tables', async () => {
    for (const [basis, reason] of cases) {
      const status = limits.allowanceBasisStatus(basis, county);
      assert.deepEqual(status, { complete: false, unavailableReason: reason });
      const net = limits.maxContractRent({ grossRent: gross, utilityAllowance: 150, fees: 25, basisStatus: status });
      assert.equal(net.contractRent, null);
      assert.equal(net.unavailableReason, reason);
      const w = await app(project(basis));
      try {
        blockedTables(w, reason);
        if (reason === 'allowance_basis_other_geography') {
          change(w, '[data-utility="trash"]', true);
          change(w, '#sp-ua-effective_date', '2026-02-01');
          await settle();
          blockedTables(w, reason);
          assert.equal(w.SubjectProject.get().utility_allowance_basis.bound_county_fips, basis.bound_county_fips);
        }
      } finally { await settle(); w.close(); }
    }
  });
  await test('valid calendar dates include today and leap day', () => {
    const today = new Date();
    const date = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
    for (const effective_date of ['2024-02-29', date]) assert.equal(limits.allowanceBasisStatus({ ...completeBasis(), effective_date }, county).complete, true);
  });
  await test('new projects default to PHA; saved projects without a basis retain numbers and remain blocked', async () => {
    const fresh = await app();
    assert.equal(fresh.SubjectProject.get().utility_allowance_basis.method, 'pha');
    assert.equal(fresh.document.getElementById('sp-ua-method').value, 'pha');
    fresh.close();
    const saved = project(); delete saved.utility_allowance_basis;
    const w = await app(saved);
    try {
      assert.equal(w.SubjectProject.get().unit_mix[0].utility_allowance, 150);
      assert.equal(w.SubjectProject.get().utility_allowance_basis, null);
      assert.equal(w.document.getElementById('sp-ua-method').value, '');
      blockedTables(w, 'allowance_method_missing');
      change(w, '#sp-ua-method', 'pha');
      await settle();
      assert.equal(w.SubjectProject.get().unit_mix[0].utility_allowance, null, 'choosing a method invalidates the old amounts');
      assert.equal(limits.allowanceBasisStatus(w.SubjectProject.get().utility_allowance_basis, county).complete, false);
    } finally { await settle(); w.close(); }
  });
  await test('complete resident basis agrees with module, captions, persisted fields and all UI options', async () => {
    const w = await app(project());
    try {
      const expected = limits.maxContractRent({ grossRent: gross, utilityAllowance: 150, fees: 25, basisStatus: limits.allowanceBasisStatus(completeBasis(), county) });
      assert.equal(expected.contractRent, gross - 175);
      for (const id of ['sp', 'rc']) {
        assert.equal(netCells(w, id)[0].textContent.trim(), money(expected.contractRent));
        const caption = w.document.querySelector('#' + id + ' caption').textContent;
        assert(caption.includes(limits.ALLOWANCE_METHODS.find((m) => m.method === 'pha').label));
        assert(caption.includes(completeBasis().effective_date));
      }
      const panel = w.document.querySelector('[data-role="utility-allowance-basis"]');
      const checkboxes = [...panel.querySelectorAll('input[type="checkbox"]')];
      assert.deepEqual(checkboxes.map((c) => c.dataset.utility), ['heat', 'cooking', 'water_heating', 'other_electric', 'air_conditioning', 'water', 'sewer', 'trash']);
      assert.deepEqual(checkboxes.filter((c) => c.checked).map((c) => c.dataset.utility), completeBasis().resident_paid);
      assert.equal(panel.querySelector('a').href, limits.REGULATION_URL);
      for (const method of limits.ALLOWANCE_METHODS) assert(panel.querySelector('option[value="' + method.method + '"]').textContent.includes(method.applicability));
      change(w, '#sp-ua-reference', 'Updated local schedule');
      change(w, '#sp-ua-effective_date', '2026-02-01');
      change(w, '[data-utility="trash"]', true);
      const stored = JSON.parse(w.localStorage.getItem(storageKey)).utility_allowance_basis;
      assert.equal(stored.reference, 'Updated local schedule');
      assert.equal(stored.effective_date, '2026-02-01');
      assert(stored.resident_paid.includes('trash'));
      assert.equal(stored.bound_county_fips, county);
      await settle();
      for (const id of ['sp', 'rc']) assert(w.document.querySelector('#' + id + ' caption').textContent.includes(stored.effective_date));
    } finally { await settle(); w.close(); }
  });
  await test('PHA amounts are invalidated when the method changes, before either table can relabel them', async () => {
    for (const mode of ['picker', 'set']) {
      const s = project(); s.unit_mix.push({ ...s.unit_mix[0], bedrooms: '1BR', utility_allowance: 100 });
      const w = await app(s);
      try {
        if (mode === 'picker') change(w, '#sp-ua-method', 'energy_model');
        else w.SubjectProject.set({ ...w.SubjectProject.get(), utility_allowance_basis: { ...completeBasis(), method: 'energy_model' } });
        await settle();
        const changed = w.SubjectProject.get();
        assert.equal(changed.utility_allowance_basis.method, 'energy_model');
        assert.equal(changed.utility_allowance_basis.reference, '');
        assert.equal(changed.utility_allowance_basis.effective_date, '');
        assert.deepEqual(plain(changed.utility_allowance_basis.resident_paid), completeBasis().resident_paid);
        assert(changed.unit_mix.every((r) => r.utility_allowance === null), mode + ': all old source amounts cleared');
        assert([...w.document.querySelectorAll('[data-key="utility_allowance"]')].every((c) => c.value === '' && !c.disabled));
        blockedTables(w, 'allowance_reference_missing');
        const methodLabel = limits.ALLOWANCE_METHODS.find((m) => m.method === 'energy_model').label;
        for (const id of ['sp', 'rc']) assert(!w.document.querySelector('#' + id + ' caption').textContent.includes(methodLabel));
        const notice = w.document.querySelector('[data-role="allowance-source-notice"]');
        assert(notice.textContent.trim(), 'source-change notice is visible');
        assert.equal(notice.previousElementSibling.dataset.role, 'utility-allowance-basis');
        change(w, '#sp-ua-reference', 'New energy model');
        change(w, '#sp-ua-effective_date', '2026-02-01');
        await settle();
        blockedTables(w, 'utility_allowance_missing', true);
        change(w, '[data-key="utility_allowance"]', '175');
        await settle();
        assert.equal(w.SubjectProject.get().unit_mix[0].utility_allowance, 175, 'new source amounts can be entered');
      } finally { await settle(); w.close(); }
    }
  });
  await test('reference, date and resident utility edits retain the new basis and clear every row amount', async () => {
    for (const [key, selector, value, expected] of [
      ['reference', '#sp-ua-reference', 'Replacement PHA schedule', 'Replacement PHA schedule'],
      ['effective_date', '#sp-ua-effective_date', '2026-02-01', '2026-02-01'],
      ['resident_paid', '[data-utility="trash"]', true, ['heat', 'water', 'trash']]
    ]) {
      const s = project(); s.unit_mix.push({ ...s.unit_mix[0], bedrooms: '1BR', utility_allowance: 100 });
      const w = await app(s);
      try {
        change(w, selector, value);
        await settle();
        const changed = w.SubjectProject.get();
        assert.deepEqual(plain(changed.utility_allowance_basis), { ...completeBasis(), [key]: expected });
        assert(changed.unit_mix.every((r) => r.utility_allowance === null), key + ': all row amounts cleared');
        assert([...w.document.querySelectorAll('[data-key="utility_allowance"]')].every((c) => c.value === ''));
        blockedTables(w, 'utility_allowance_missing', true);
        assert(w.document.querySelector('[data-role="allowance-source-notice"]').textContent.trim());
      } finally { await settle(); w.close(); }
    }
  });
  await test('unchanged basis events and unrelated edits preserve entered allowances', async () => {
    const w = await app(project());
    try {
      change(w, '#sp-ua-method', 'pha');
      change(w, '#sp-ua-reference', completeBasis().reference);
      change(w, '#sp-ua-effective_date', completeBasis().effective_date);
      change(w, '[data-utility="water"]', true);
      change(w, '#sp-project_name', 'Same allowance source');
      await settle();
      assert.equal(w.SubjectProject.get().unit_mix[0].utility_allowance, 150);
      for (const id of ['sp', 'rc']) assert.equal(netCells(w, id)[0].textContent.trim(), money(gross - 175));
    } finally { await settle(); w.close(); }
  });
  await test('owner pays all sets zero, disables controls, includes fees and clears amounts when switched back', async () => {
    const w = await app(project());
    try {
      change(w, '#sp-ua-method', 'owner_pays_all');
      await settle();
      const s = w.SubjectProject.get();
      assert.equal(s.unit_mix[0].utility_allowance, 0);
      assert.deepEqual(plain(s.utility_allowance_basis.resident_paid), []);
      const status = limits.allowanceBasisStatus(s.utility_allowance_basis, otherCounty);
      assert.equal(status.complete, true, 'owner pays all needs neither date/reference nor county binding');
      assert.equal(limits.maxContractRent({ grossRent: gross, utilityAllowance: s.unit_mix[0].utility_allowance, fees: 25, basisStatus: status }).contractRent, gross - 25);
      for (const id of ['sp', 'rc']) assert.equal(netCells(w, id)[0].textContent.trim(), money(gross - 25));
      assert(w.document.querySelector('[data-key="utility_allowance"]').disabled);
      assert([...w.document.querySelectorAll('[data-utility]')].every((c) => c.disabled && !c.checked));
      assert(w.document.querySelector('[data-role="owner-paid-allowance"]').textContent.includes('$0'));
      const add = [...w.document.querySelectorAll('button')].find((b) => b.textContent === '+ Add row');
      add.click();
      assert(w.SubjectProject.get().unit_mix.every((r) => r.utility_allowance === 0), 'new rows also use the selected owner-paid basis');
      change(w, '#sp-county_fips', otherCounty);
      assert(w.SubjectProject.get().unit_mix.every((r) => r.utility_allowance === 0), 'owner-paid zero survives county change');
      change(w, '#sp-ua-method', 'utility_company');
      assert(w.SubjectProject.get().unit_mix.every((r) => r.utility_allowance === null));
      assert([...w.document.querySelectorAll('[data-key="utility_allowance"]')].every((c) => !c.disabled && c.value === ''));
      assert([...w.document.querySelectorAll('[data-utility]')].every((c) => !c.disabled));
      assert.equal(w.SubjectProject.get().utility_allowance_basis.reference, '');
      assert.equal(w.SubjectProject.get().utility_allowance_basis.effective_date, '');
    } finally { await settle(); w.close(); }
  });
  await test('county change clears source/date/row amounts but keeps method and resident utilities', async () => {
    for (const mode of ['picker', 'set', 'site']) {
      const s = project(); s.unit_mix.push({ ...s.unit_mix[0], bedrooms: '1BR', utility_allowance: 100 });
      const w = await app(s, mode === 'site' ? otherCounty : undefined);
      try {
        if (mode === 'picker') change(w, '#sp-county_fips', otherCounty);
        if (mode === 'set') w.SubjectProject.set({ ...w.SubjectProject.get(), county_fips: otherCounty });
        await settle();
        const changed = w.SubjectProject.get();
        assert.equal(changed.utility_allowance_basis.method, 'pha', mode);
        assert.deepEqual(plain(changed.utility_allowance_basis.resident_paid), completeBasis().resident_paid, mode);
        assert.equal(changed.utility_allowance_basis.reference, '', mode);
        assert.equal(changed.utility_allowance_basis.effective_date, '', mode);
        assert(changed.unit_mix.every((r) => r.utility_allowance === null), mode + ': all row allowances cleared');
        assert([...w.document.querySelectorAll('[data-key="utility_allowance"]')].every((c) => c.value === ''), mode);
        assert(w.document.querySelector('[data-role="allowance-county-notice"]').textContent.trim(), mode + ': notice visible');
        blockedTables(w, 'allowance_reference_missing');
        change(w, '#sp-ua-reference', 'New county schedule');
        change(w, '#sp-ua-effective_date', '2026-02-01');
        assert.equal(w.SubjectProject.get().utility_allowance_basis.bound_county_fips, otherCounty);
        assert(changed.unit_mix.every((r) => r.utility_allowance === null), 'new source must not revive old amounts');
      } finally { await settle(); w.close(); }
    }
  });
  await test('new suite is reachable from the CI chain', () => {
    const scripts = require('../package.json').scripts;
    assert.equal(scripts['test:utility-allowance-basis'], 'node test/utility-allowance-basis.test.js');
    assert(Object.entries(scripts).some(([key, command]) => /^ci:part-/.test(key) && command.split(' && ').includes('npm run test:utility-allowance-basis')));
  });
  console.log(`Utility allowance basis: ${passed} passed, ${failed} failed`);
  if (failed) process.exitCode = 1;
})();
