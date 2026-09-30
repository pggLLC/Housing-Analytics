#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const limits = require('../js/chfa-rent-limits.js');
const chfa = require('../data/chfa-income-rent-limits-2026.json');
const hud = require('../data/hud-fmr-income-limits.json');
const gap = require('../data/co_ami_gap_by_county.json');
const read = (p) => fs.readFileSync(p, 'utf8');
const plain = (v) => JSON.parse(JSON.stringify(v));
const county = chfa.counties.find((c) => c.fips === '08077');
assert(county && county.regular_tiers['60'] && county.regular_tiers['100']);
const published = (tier, bedroom) => county.regular_tiers[String(tier)].max_rents[bedroom];
const basis = () => ({ method: 'pha', reference: 'County PHA schedule', effective_date: '2026-01-01',
  resident_paid: ['heat'], bound_county_fips: county.fips });
const row = (tier, bedrooms, key, count) => ({ ami_tier: tier, bedrooms, count,
  proposed_gross_rent: published(tier, key) - 1, utility_allowance: Math.floor(published(tier, key) / 10), fees: 5 });
const project = () => ({ county_fips: county.fips, total_units: 10, vacancy_rate: 0.05,
  utility_allowance_basis: basis(), unit_mix: [row(60, '1BR', '1br', 4), row(100, '2BR', '2br', 6)] });
const marketRow = () => ({ bedrooms: '3BR', ami_tier: 'market', count: 6,
  market_rent: published(100, '3br'), market_rent_source: 'Dated comparable-property rent survey',
  utility_allowance: 999, fees: 999 }); // stale restricted fields must have no effect
const mixed = () => ({ ...project(), unit_mix: [project().unit_mix[0], marketRow()] });
const calculate = (s, options = {}) => limits.rentSchedule(s, { chfaTable: chfa, hudTable: hud, ...options });
const money = (n) => '$' + Math.round(n).toLocaleString('en-US');
const settle = () => new Promise((resolve) => setImmediate(resolve));
let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  PASS ' + name); }
  catch (error) { failed++; console.error('  FAIL ' + name + ': ' + error.stack); }
}
function assertBlocked(schedule, reason) {
  assert.equal(schedule.totals.unavailableReason, reason);
  for (const key of ['restrictedUnits', 'marketUnits', 'le80Units', 'le80Share', 'contractRent',
    'grossResidentRent', 'utilityAllowance', 'annualScheduledRent', 'effectiveRentAfterVacancy']) {
    assert.equal(schedule.totals[key], null, key + ' must be unavailable');
  }
}
async function app(subject, { data = chfa, beforeMount } = {}) {
  const w = new JSDOM('<div id="sp"></div><div id="rc"></div><div id="income"></div><div id="capture"></div>',
    { url: 'https://example.org/market-analysis.html', runScripts: 'outside-only' }).window;
  w.fetch = (url) => Promise.resolve({ json: () => Promise.resolve(String(url).includes('chfa-income') ? data
    : String(url).includes('hud-fmr') ? hud : gap) });
  w.alert = () => {}; w.confirm = () => true;
  w.localStorage.setItem('coho.subjectProject.v1', JSON.stringify(subject));
  for (const p of ['js/chfa-rent-limits.js', 'js/components/subject-project.js', 'js/components/subject-rent-comparison.js',
    'js/components/subject-income-eligibility.js', 'js/components/subject-capture-stack.js']) w.eval(read(p));
  if (beforeMount) beforeMount(w);
  w.SubjectProject.mount(w.document.getElementById('sp'));
  w.SubjectRentComparison.attach(w.document.getElementById('rc'));
  w.SubjectIncomeEligibility.attach(w.document.getElementById('income'));
  w.SubjectCaptureStack.attach(w.document.getElementById('capture'));
  await settle();
  return w;
}
// Keep real project storage/subscriptions, but control when each card loader resolves.
// Independent CHFA/HUD requests also exercise out-of-order completion in comparison.
function delayedCard(name, file) {
  const w = new JSDOM('<div id="card"></div>',
    { url: 'https://example.org/market-analysis.html', runScripts: 'outside-only' }).window;
  const requests = [];
  function delay(data) {
    return new Promise((resolve) => requests.push((available = true) => resolve(available ? data : null)));
  }
  w.fetch = (url) => {
    assert.equal(url, 'data/co_ami_gap_by_county.json');
    return delay(gap).then((data) => ({ json: () => Promise.resolve(data) }));
  };
  w.localStorage.setItem('coho.subjectProject.v1', JSON.stringify(project()));
  for (const p of ['js/chfa-rent-limits.js', 'js/components/subject-project.js', file]) w.eval(read(p));
  w.SubjectProject.loadChfa = () => delay(chfa);
  w.SubjectProject.loadHud = () => delay(hud);
  const container = w.document.getElementById('card');
  w[name].attach(container);
  assert(requests.length > 0, 'restricted render must start a delayed loader');
  assert.equal(container.children.length, 0, 'loader has not resolved yet');
  return { w, container, requests };
}
function assertMarketOnly(container, comparison) {
  assert.equal(container.querySelectorAll('[data-market-rate="true"]').length, 1);
  assert.equal(container.querySelector('[data-market-rate="false"]'), null);
  assert.equal(container.querySelectorAll('tbody tr').length, comparison ? 1 : 0);
}
async function assertStaleIsSilent(w, container, release) {
  const writes = [];
  const observer = new w.MutationObserver((records) => writes.push(...records));
  observer.observe(container, { childList: true, subtree: true, characterData: true, attributes: true });
  try {
    release();
    await settle();
    assert.equal(writes.length, 0, 'obsolete loader must not touch the current DOM');
  } finally { observer.disconnect(); }
}
function change(w, selector, value) {
  const node = w.document.querySelector(selector);
  assert(node, selector + ' exists');
  node.value = value;
  node.dispatchEvent(new w.Event('change', { bubbles: true }));
}

(async () => {
  await test('restricted schedule equals hand-summed module results from the CHFA file', () => {
    const s = project(), original = plain(s), result = calculate(s);
    let monthlyContract = 0, monthlyGross = 0, monthlyAllowance = 0;
    const status = limits.allowanceBasisStatus(s.utility_allowance_basis, s.county_fips);
    for (let i = 0; i < s.unit_mix.length; i++) {
      const r = s.unit_mix[i];
      const cap = limits.maxGrossRent(chfa, s.county_fips, r.ami_tier, r.bedrooms);
      const net = limits.maxContractRent({ grossRent: r.proposed_gross_rent, utilityAllowance: r.utility_allowance,
        fees: r.fees, basisStatus: status });
      assert.equal(result.rows[i].limit.grossRent, cap.grossRent);
      assert.equal(result.rows[i].rowReason, null);
      assert.equal(result.rows[i].contractRent, net.contractRent);
      monthlyContract += net.contractRent * r.count;
      monthlyGross += r.proposed_gross_rent * r.count;
      monthlyAllowance += r.utility_allowance * r.count;
    }
    assert.equal(result.scheduledUnits, 10);
    assert.equal(result.totals.restrictedUnits, 10);
    assert.equal(result.totals.marketUnits, 0);
    assert.equal(result.totals.contractRent, monthlyContract / 10);
    assert.equal(result.totals.grossResidentRent, monthlyGross / 10);
    assert.equal(result.totals.utilityAllowance, monthlyAllowance / 10);
    assert.equal(result.totals.annualScheduledRent, monthlyContract * 12);
    assert.equal(result.totals.effectiveRentAfterVacancy, monthlyContract * 12 * 0.95);
    assert.equal(result.totals.le80Units, 4);
    assert.equal(result.totals.le80Share, 4 / 10);
    assert.deepEqual(s, original, 'calculation does not mutate the project');
  });
  await test('mixed and all-market schedules never look up a CHFA limit or deduct market allowances', () => {
    const s = mixed(), result = calculate(s);
    const r = s.unit_mix[0];
    const net = limits.maxContractRent({ grossRent: r.proposed_gross_rent, utilityAllowance: r.utility_allowance,
      fees: r.fees, basisStatus: limits.allowanceBasisStatus(basis(), county.fips) }).contractRent;
    assert.equal(result.rows[1].contractRent, s.unit_mix[1].market_rent);
    assert.equal(result.rows[1].utilityAllowance, 0);
    assert.equal(result.rows[1].fees, 0);
    assert.equal(result.totals.annualScheduledRent, (net * 4 + s.unit_mix[1].market_rent * 6) * 12);
    assert.equal(result.totals.restrictedUnits, 4);
    assert.equal(result.totals.marketUnits, 6);
    assert.equal(result.totals.le80Share, 0.4);
    const all = { total_units: 6, vacancy_rate: 0, unit_mix: [marketRow()] };
    const original = limits.maxGrossRent;
    try {
      limits.maxGrossRent = () => { throw new Error('market row attempted CHFA lookup'); };
      const market = calculate(all, { chfaTable: null });
      assert.equal(market.totals.annualScheduledRent, all.unit_mix[0].market_rent * 6 * 12);
      assert.equal(market.totals.effectiveRentAfterVacancy, market.totals.annualScheduledRent);
      assert.equal(market.totals.le80Units, 0);
      assert.equal(market.totals.le80Share, 0);
    } finally { limits.maxGrossRent = original; }
  });
  await test('unit-count mismatch blocks every total and both summaries without rewriting project units', async () => {
    const s = project(); s.total_units = 11;
    const result = calculate(s);
    assertBlocked(result, 'unit_count_mismatch');
    assert.equal(result.comparison.unavailableReason, 'unit_count_mismatch');
    assert.equal(result.comparison.grossResidentRent, null);
    const w = await app(s);
    try {
      assert.equal(w.SubjectProject.get().total_units, 11);
      const summary = w.document.querySelector('[data-role="rent-schedule-summary"]');
      assert.equal(summary.dataset.unavailableReason, 'unit_count_mismatch');
      assert.match(summary.querySelector('[data-role="schedule-unit-count"]').textContent, /10.*11/);
      assert.equal(summary.querySelector('[data-total="annualScheduledRent"]').dataset.value, '');
      assert.equal(w.document.querySelector('[data-role="rent-comparison-summary"]').dataset.unavailableReason, 'unit_count_mismatch');
      change(w, '#sp-total_units', '10'); await settle();
      assert.equal(summary.dataset.unavailableReason, '');
      assert.equal(Number(summary.querySelector('[data-total="annualScheduledRent"]').dataset.value), calculate(project()).totals.annualScheduledRent);
    } finally { await settle(); w.close(); }
  });
  await test('≤80% share includes the 80% boundary and excludes higher tiers and market units', () => {
    const s = { ...project(), unit_mix: [row(80, '1BR', '1br', 3), row(90, '2BR', '2br', 1), marketRow()] };
    const result = calculate(s);
    assert.equal(result.totals.restrictedUnits, 4);
    assert.equal(result.totals.marketUnits, 6);
    assert.equal(result.totals.le80Units, 3);
    assert.equal(result.totals.le80Share, 3 / 10);
  });
  await test('vacancy is required, accepts entered zero, and rejects out-of-range rates', async () => {
    for (const vacancy_rate of [null, undefined, '', ' ']) {
      const result = calculate({ ...project(), vacancy_rate });
      assert(result.totals.annualScheduledRent > 0);
      assert.equal(result.totals.effectiveRentAfterVacancy, null);
      assert.equal(result.totals.effectiveRentUnavailableReason, 'vacancy_rate_missing');
    }
    for (const vacancy_rate of [-1, 1.01, Infinity]) assert.equal(calculate({ ...project(), vacancy_rate }).totals.effectiveRentAfterVacancy, null);
    const zero = calculate({ ...project(), vacancy_rate: 0 });
    assert.equal(zero.totals.effectiveRentAfterVacancy, zero.totals.annualScheduledRent);
    const w = await app({ ...project(), vacancy_rate: null });
    try {
      assert.equal(w.document.getElementById('sp-vacancy_rate').value, '');
      assert.equal(w.document.querySelector('[data-role="vacancy-reason"]').dataset.unavailableReason, 'vacancy_rate_missing');
      change(w, '#sp-vacancy_rate', '7.5'); await settle();
      assert.equal(w.SubjectProject.get().vacancy_rate, 0.075);
      assert.equal(Number(w.document.querySelector('[data-total="effectiveRentAfterVacancy"]').dataset.value), zero.totals.annualScheduledRent * 0.925);
    } finally { await settle(); w.close(); }
  });
  await test('over-max, missing source, missing allowance basis and deductions carry row reasons and block totals', () => {
    const over = project(); over.unit_mix[0].proposed_gross_rent = published(60, '1br') + 1;
    const missingSource = mixed(); missingSource.unit_mix[1].market_rent_source = '  ';
    const missingBasis = project(); delete missingBasis.utility_allowance_basis;
    const overDeduction = project(); overDeduction.unit_mix[0].utility_allowance = overDeduction.unit_mix[0].proposed_gross_rent + 1;
    for (const [s, i, reason] of [[over, 0, 'over_chfa_max'], [missingSource, 1, 'market_rent_source_missing'],
      [missingBasis, 0, 'allowance_method_missing'], [overDeduction, 0, 'deductions_exceed_gross_rent']]) {
      const result = calculate(s);
      assertBlocked(result, 'unpriced_rows');
      assert.equal(result.rows[i].rowReason, reason);
      assert.equal(result.rows[i].contractRent, null);
      assert(result.unpricedRows.some((r) => r.rowNumber === i + 1 && r.rowReason === reason));
      assert.equal(result.comparison.grossResidentRent, null);
    }
    const exact = project(); exact.unit_mix[0].utility_allowance = exact.unit_mix[0].proposed_gross_rent; exact.unit_mix[0].fees = 0;
    assert.equal(calculate(exact).rows[0].contractRent, 0, 'genuinely measured zero remains valid');
  });
  await test('comparison excludes blank rows from every weighted figure and discloses the missing count', async () => {
    for (const missing of [2, 1, 0]) {
      const s = project();
      for (let i = 0; i < missing; i++) s.unit_mix[i].proposed_gross_rent = null;
      const result = calculate(s), priced = s.unit_mix.slice(missing);
      const count = priced.reduce((n, r) => n + r.count, 0);
      const expected = count ? priced.reduce((sum, r) => sum + r.proposed_gross_rent * r.count, 0) / count : null;
      assert.equal(result.comparison.grossResidentRent, expected);
      assert.equal(result.missingRentRows.length, missing);
      if (missing) assertBlocked(result, 'unpriced_rows');
      if (count) {
        const fmr = hud.counties.find((c) => c.fips === county.fips).fmr;
        const weightedFmr = priced.reduce((sum, r) => sum + fmr[r.bedrooms === '1BR' ? 'one_br' : 'two_br'] * r.count, 0) / count;
        assert.equal(result.comparison.fmr, weightedFmr);
        assert.equal(result.comparison.vsFmr, (expected - weightedFmr) / weightedFmr * 100);
      } else assert.equal(result.comparison.vsFmr, null);
      const w = await app(s);
      try {
        const summary = w.document.querySelector('[data-role="rent-comparison-summary"]');
        assert.equal(summary.querySelector('[data-role="missing-rent-count"]').dataset.count, String(missing));
        assert(summary.querySelector('[data-role="missing-rent-count"]').textContent.includes(String(missing)));
        const proposed = summary.querySelector('[data-comparison="grossResidentRent"]');
        assert.equal(proposed.dataset.value, expected == null ? '' : String(expected));
        assert(proposed.textContent.includes(expected == null ? 'unavailable' : money(expected)));
        assert(!summary.textContent.includes('$0'), 'no blank rent becomes a $0 weighted figure');
        assert(!summary.textContent.includes('-100%') && !summary.textContent.includes('-100.0%'));
        if (missing) assert(w.document.querySelector('[data-role="schedule-blocked"]').textContent.includes('Row 1'));
      } finally { await settle(); w.close(); }
    }
  });
  await test('both tables consume the module schedule; UI edits retain market sources and update the summary', async () => {
    const s = mixed(), expected = calculate(s);
    let calls = 0;
    const w = await app(s, { beforeMount(w) {
      const original = w.ChfaRentLimits.rentSchedule;
      w.ChfaRentLimits.rentSchedule = (...args) => {
        calls++;
        const result = original(...args);
        result.totals.annualScheduledRent = 12345;
        result.comparison.grossResidentRent = 23456;
        result.rows[1].contractRent = 34567;
        return result;
      };
    } });
    try {
      assert(calls >= 2, 'both real components call the shared function');
      assert.equal(w.document.querySelector('[data-total="annualScheduledRent"]').dataset.value, '12345');
      assert.equal(w.document.querySelector('[data-comparison="grossResidentRent"]').dataset.value, '23456');
      for (const id of ['sp', 'rc']) {
        const tr = w.document.querySelector('#' + id + ' tr[data-market-rate="true"]');
        assert(tr.textContent.includes('Market rate'));
        assert.equal(tr.querySelector('[data-role="scheduled-contract-rent"]').textContent.startsWith(money(34567)), true);
      }
      assert.equal(w.document.querySelector('#sp [data-key="utility_allowance"][data-idx="1"]'), null);
      assert.equal(w.document.querySelector('#sp [data-key="fees"][data-idx="1"]'), null);
      assert(w.document.querySelector('[data-key="market_rent_source"]').required);
      const source = w.document.querySelector('[data-key="market_rent_source"]');
      source.focus();
      source.value = 'Typed source';
      source.setSelectionRange(5, 5);
      source.dispatchEvent(new w.Event('input', { bubbles: true }));
      assert.equal(w.document.activeElement.dataset.key, 'market_rent_source', 'live schedule refresh retains source-field focus');
      assert.equal(w.document.activeElement.selectionStart, 5, 'live schedule refresh retains the caret');
      assert.equal(w.SubjectProject.get().unit_mix[1].market_rent_source, 'Typed source');
      change(w, '[data-key="market_rent_source"]', 'Updated local rent survey');
      change(w, '[data-key="market_rent"]', String(s.unit_mix[1].market_rent + 10));
      await settle();
      assert.equal(w.SubjectProject.get().unit_mix[1].market_rent_source, 'Updated local rent survey');
      assert.equal(w.SubjectProject.get().unit_mix[1].market_rent, s.unit_mix[1].market_rent + 10);
      const disclosure = w.document.querySelector('[data-role="pre-expense-disclosure"]').textContent;
      assert.match(disclosure, /(?:pre-expense|before expenses)/);
      assert.match(disclosure, /(?:not|does not).*NOI.*supportable debt/);
      assert(w.document.querySelector('[data-role="ami-planning-disclosure"]').textContent.trim());
      // The disclosure describes the revenue calculation above; it does not change it.
      assert.equal(expected.totals.annualScheduledRent, expected.rows.reduce((sum, r) => sum + r.contractRent * r.count * 12, 0));
    } finally { await settle(); w.close(); }
    const picker = await app(project());
    try {
      assert.equal(picker.document.querySelector('[data-key="ami_tier"][data-idx="1"]').value, String(project().unit_mix[1].ami_tier),
        'a saved tier outside the short picker list still displays the tier used by the schedule');
      change(picker, '[data-key="ami_tier"][data-idx="1"]', 'market'); await settle();
      assert.equal(picker.SubjectProject.get().unit_mix[1].ami_tier, 'market');
      assert(picker.document.querySelector('[data-key="market_rent"][data-idx="1"]'));
      assert.equal(picker.document.querySelector('#sp tr[data-market-rate="true"] [data-role="scheduled-contract-rent"]').dataset.rowReason, 'market_rent_missing');
    } finally { await settle(); picker.close(); }
  });
  await test('both tables name unpriceable rows and an all-market project survives missing CHFA data', async () => {
    const s = mixed();
    s.unit_mix[0].proposed_gross_rent = published(60, '1br') + 1;
    s.unit_mix[1].market_rent_source = '';
    const w = await app(s);
    try {
      for (const id of ['sp', 'rc']) {
        const cells = [...w.document.querySelectorAll('#' + id + ' [data-role="scheduled-contract-rent"]')];
        assert.deepEqual(cells.map((c) => c.dataset.rowReason), ['over_chfa_max', 'market_rent_source_missing']);
        assert(cells.every((c) => c.textContent.trim() && !/\$\d/.test(c.textContent)));
      }
    } finally { await settle(); w.close(); }
    const market = { total_units: 6, vacancy_rate: 0, unit_mix: [marketRow()] };
    const m = await app(market, { data: null });
    try {
      for (const id of ['sp', 'rc']) {
        assert.equal(m.document.querySelector('#' + id + ' [data-role="scheduled-contract-rent"]').dataset.rowReason, '');
        assert(m.document.querySelector('#' + id + ' tr[data-market-rate="true"]'));
      }
      assert.equal(Number(m.document.querySelector('[data-total="annualScheduledRent"]').dataset.value), market.unit_mix[0].market_rent * 6 * 12);
    } finally { await settle(); m.close(); }
  });
  await test('market rows are listed but excluded from restricted demand and income lookups', async () => {
    for (const s of [mixed(), { total_units: 6, vacancy_rate: 0, unit_mix: [marketRow()] }]) {
      let lookupTiers = [];
      const w = await app(s, { beforeMount(w) {
        const original = w.SubjectProject.computeIncomeLimit;
        w.SubjectProject.computeIncomeLimit = (...args) => { lookupTiers.push(args[2]); assert.notEqual(args[2], 'market'); return original(...args); };
      } });
      try {
        for (const id of ['income', 'capture']) {
          const list = w.document.querySelectorAll('#' + id + ' [data-market-rate="true"]');
          assert.equal(list.length, 1);
          assert(list[0].textContent.includes('Market rate') && list[0].textContent.includes('6 units'));
        }
        if (s.county_fips) {
          assert.deepEqual(lookupTiers, [60]);
          const rows = [...w.document.querySelectorAll('#capture tbody tr')];
          assert.equal(rows.length, 1);
          assert.equal(rows[0].children[1].textContent, '4', 'market units never enter restricted capture');
        } else assert.equal(lookupTiers.length, 0);
      } finally { await settle(); w.close(); }
    }
  });
  for (const [name, file] of [
    ['SubjectCaptureStack', 'js/components/subject-capture-stack.js'],
    ['SubjectIncomeEligibility', 'js/components/subject-income-eligibility.js'],
    ['SubjectRentComparison', 'js/components/subject-rent-comparison.js']
  ]) {
    const comparison = name === 'SubjectRentComparison';
    await test(name + ': delayed restricted render cannot replace the all-market view', async () => {
      // Both successful and unavailable obsolete results must leave the new view alone.
      for (const available of [true, false]) {
        const { w, container, requests } = delayedCard(name, file);
        try {
          const oldRequests = requests.slice();
          w.SubjectProject.set({ ...project(), total_units: 6, unit_mix: [marketRow()] });
          const marketRequests = requests.slice(oldRequests.length);
          assert.equal(marketRequests.length, comparison ? 2 : 0);
          marketRequests.forEach((release) => release());
          await settle();
          assertMarketOnly(container, comparison);
          await assertStaleIsSilent(w, container, () => oldRequests.forEach((release) => release(available)));
          assertMarketOnly(container, comparison);
        } finally { w.close(); }
      }
    });
    await test(name + ': all-market to restricted without county keeps Pick a county after delayed loads', async () => {
      for (const available of [true, false]) {
        const { w, container, requests } = delayedCard(name, file);
        try {
          // Capture/income use a synchronous all-market view: retain a pending earlier
          // restricted load so this transition still has obsolete work to invalidate.
          w.SubjectProject.set({ total_units: 6, vacancy_rate: 0, unit_mix: [marketRow()] });
          const pendingCount = requests.length;
          w.SubjectProject.set({ ...project(), county_fips: '' });
          assert.equal(requests.length, pendingCount, 'missing county must not start another load');
          assert.match(container.textContent, /Pick a county/i);
          await assertStaleIsSilent(w, container, () => requests.forEach((release) => release(available)));
          assert.match(container.textContent, /Pick a county/i);
          assert.equal(container.querySelector('table, [data-market-rate="true"]'), null);
        } finally { w.close(); }
      }
    });
  }
  await test('the schedule suite is reachable from CI and components no longer keep independent rent sums', () => {
    const pkg = require('../package.json');
    assert.equal(pkg.scripts['test:rent-schedule'], 'node test/rent-schedule.test.js');
    assert(Object.entries(pkg.scripts).some(([k, v]) => /^ci:part-/.test(k) && v.split(' && ').includes('npm run test:rent-schedule')));
    const comparison = read('js/components/subject-rent-comparison.js');
    assert(!/sumProposed|sumLihtcCap|sumFmr/.test(comparison));
    for (const p of ['js/components/subject-project.js', 'js/components/subject-rent-comparison.js']) {
      assert(read(p).includes('.rentSchedule('));
    }
  });
  console.log(`Rent schedule: ${passed} passed, ${failed} failed`);
  if (failed) process.exitCode = 1;
})().catch((e) => { console.error(e); process.exitCode = 1; });
