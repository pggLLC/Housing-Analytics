#!/usr/bin/env node
/**
 * Data contract for data/market/co-construction-labor-cost.json, the monthly
 * Colorado construction labor (rates + availability) and materials summary
 * written by scripts/fetch_co_construction_labor_cost.py.
 *
 * Every check is relational — it recomputes from something independent of the
 * fetch script's own arithmetic rather than reading back a value it wrote:
 *   - latest and yoy are recomputed from the series' own observations
 *     (percent for $ and jobs, percentage points for rates);
 *   - materials are recomputed from data/fred-data.json, the file the page
 *     charts from, so the summary and the chart cannot disagree;
 *   - the summary numbers must equal the monthly series and history rows, and
 *     the sentence must state the numbers it carries;
 *   - OEWS rows must cover every area x occupation the file declares, and the
 *     declared areas must be the statewide area and the seven metros.
 * An absent value is null with a reason, never 0. The second half sabotages a
 * copy of the file and proves each check fires (and that the mutation applied).
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const DATA_FILE = 'data/market/co-construction-labor-cost.json';
const readJson = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const DATA = readJson(DATA_FILE);
const FRED = readJson('data/fred-data.json');

// Claims, not copy: the series the Deep Dive panels are built on, and their basis.
const EXPECTED_MONTHLY = {
  SMU08000002000000001: { panel: 'labor-availability', basis: 'pct' },
  SMU08000002000000003: { panel: 'labor-rates', basis: 'pct' },
  SMU08000002000000011: { panel: 'labor-rates', basis: 'pct' },
  LASST080000000000003: { panel: 'labor-availability', basis: 'pts' },
  JTU230000000000000JOR: { panel: 'labor-availability', basis: 'pts' },
  JTU230000000000000HIR: { panel: 'labor-availability', basis: 'pts' },
};
const EXPECTED_AREAS = ['0800000', '0019740', '0017820', '0022660', '0014500', '0024540', '0024300', '0039380'];
const WAGE = 'SMU08000002000000003';
const EMPLOYMENT = 'SMU08000002000000001';

const text = (v) => typeof v === 'string' && v.trim().length > 0;
const num = (v) => typeof v === 'number' && Number.isFinite(v);
const close = (a, b, tol = 0.011) => num(a) && num(b) && Math.abs(a - b) <= tol;

function shift(period, months) {
  const [y, m] = period.split('-').map(Number);
  const i = y * 12 + (m - 1) + months;
  return `${String(Math.floor(i / 12)).padStart(4, '0')}-${String((i % 12) + 1).padStart(2, '0')}`;
}

function yoy(values, period, basis) {
  const cur = values.get(period);
  const prior = values.get(shift(period, -12));
  if (!num(cur) || !num(prior)) return null;
  if (basis === 'pts') return cur - prior;
  if (prior <= 0) return null;
  return (cur / prior - 1) * 100;
}

function fredValues(id) {
  const out = new Map();
  for (const o of ((FRED.series || {})[id] || {}).observations || []) {
    const v = Number.parseFloat(o.value);
    if (o.value !== null && o.value !== '' && Number.isFinite(v)) out.set(String(o.date).slice(0, 7), v);
  }
  return out;
}

function contractIssues(data) {
  const issues = [];
  const check = (ok, msg) => { if (!ok) issues.push(msg); };

  for (const key of ['generatedAt', 'sources', 'monthly', 'oews', 'materials', 'summary', 'history']) {
    check(Object.hasOwn(data, key), `missing top-level key ${key}`);
  }
  check(!Number.isNaN(Date.parse(data.generatedAt)), 'generatedAt is not a timestamp');

  // ── monthly ───────────────────────────────────────────────────────────────
  const monthly = data.monthly || {};
  check(Object.keys(EXPECTED_MONTHLY).every((id) => Object.hasOwn(monthly, id)),
    'a required monthly series was dropped (it must stay, null with a reason)');
  const seriesValues = {};
  for (const [id, s] of Object.entries(monthly)) {
    const exp = EXPECTED_MONTHLY[id];
    if (exp) check(s.panel === exp.panel, `${id}: panel ${s.panel}, expected ${exp.panel}`);
    const obs = s.observations || [];
    if (!obs.length) {
      check(s.latest === null && text(s.unavailableReason), `${id}: no observations and no unavailableReason`);
      continue;
    }
    check(s.unavailableReason === null, `${id}: has observations but also an unavailableReason`);
    const periods = obs.map((o) => o.period);
    check(periods.every((p, i) => i === 0 || p > periods[i - 1]), `${id}: observations not strictly oldest -> newest`);
    check(obs.every((o) => num(o.value) && o.value > 0), `${id}: an observation is not a positive number (0 stands in for unknown)`);
    const last = obs[obs.length - 1];
    check(s.latest && s.latest.period === last.period && s.latest.value === last.value
      && s.latest.preliminary === last.preliminary, `${id}: latest is not the last observation`);
    const values = new Map(obs.map((o) => [o.period, o.value]));
    seriesValues[id] = values;
    const basis = exp ? exp.basis : (s.yoy && s.yoy.basis);
    const expected = yoy(values, last.period, basis);
    if (expected === null) {
      check(s.yoy === null && text(s.yoyUnavailableReason), `${id}: yoy cannot be computed but is not null with a reason`);
    } else {
      check(s.yoy && s.yoy.period === last.period && s.yoy.basis === basis && close(s.yoy.value, expected),
        `${id}: yoy ${s.yoy && s.yoy.value} does not recompute to ${expected.toFixed(2)} (${basis})`);
    }
  }

  // ── OEWS ─────────────────────────────────────────────────────────────────
  const oews = data.oews || {};
  const areaCodes = (oews.areas || []).map((a) => a.code);
  check(JSON.stringify([...areaCodes].sort()) === JSON.stringify([...EXPECTED_AREAS].sort()),
    `OEWS areas ${areaCodes.join(',')} are not statewide + the seven metros`);
  const rows = oews.rows || [];
  const seen = new Set(rows.map((r) => `${r.area}|${r.soc}`));
  check(seen.size === rows.length, 'OEWS has duplicate area x occupation rows');
  for (const a of oews.areas || []) {
    for (const o of oews.occupations || []) {
      check(seen.has(`${a.code}|${o.soc}`), `OEWS missing ${a.code} x ${o.soc}`);
    }
  }
  check(rows.length === (oews.areas || []).length * (oews.occupations || []).length, 'OEWS has rows outside its declared areas/occupations');
  check(rows.some((r) => num(r.hourlyMean)), 'OEWS has no hourly mean at all (non-vacuity)');
  for (const r of rows) {
    const at = `OEWS ${r.area} x ${r.soc}`;
    for (const k of ['employment', 'hourlyMean', 'hourlyMeanPrior']) {
      check(r[k] === null || (num(r[k]) && r[k] > 0), `${at}: ${k} is ${r[k]} (0 stands in for unknown)`);
    }
    if (r.employment === null || r.hourlyMean === null) check(text(r.unavailableReason), `${at}: null estimate without a reason`);
    if (num(r.hourlyMean) && num(r.hourlyMeanPrior)) {
      check(close(r.changePct, (r.hourlyMean / r.hourlyMeanPrior - 1) * 100), `${at}: changePct does not recompute`);
    } else {
      check(r.changePct === null && text(r.changeUnavailableReason), `${at}: change without both years, or null without a reason`);
    }
  }

  // ── materials agree with data/fred-data.json ──────────────────────────────
  const mats = (data.materials || {}).series || [];
  check(mats.length >= 6, `only ${mats.length} materials series`);
  check(mats.some((m) => m.id === 'WPUIP231120'), 'the multifamily-inputs headline is missing from materials');
  for (const m of mats) {
    check(Object.hasOwn(FRED.series || {}, m.id), `${m.id} is not in data/fred-data.json`);
    const values = fredValues(m.id);
    if (!values.size) {
      check(m.latest === null && text(m.unavailableReason), `${m.id}: no FRED data but not null with a reason`);
      continue;
    }
    const lastPeriod = [...values.keys()].sort().pop();
    check(m.latestPeriod === lastPeriod && m.latest === values.get(lastPeriod),
      `${m.id}: latest ${m.latestPeriod}=${m.latest} disagrees with fred-data.json ${lastPeriod}=${values.get(lastPeriod)}`);
    const expected = yoy(values, lastPeriod, 'pct');
    if (expected === null) check(m.yoyPct === null && text(m.unavailableReason), `${m.id}: null yoy without a reason`);
    else check(close(m.yoyPct, expected), `${m.id}: yoyPct ${m.yoyPct} does not recompute to ${expected.toFixed(2)}`);
  }

  // ── summary agrees with the series, history and fred-data ─────────────────
  const sum = data.summary || {};
  check(text(sum.text), 'summary.text is blank');
  if (sum.period) {
    const pairs = [
      ['laborWageYoyPct', seriesValues[WAGE] ? yoy(seriesValues[WAGE], sum.period, 'pct') : null],
      ['employmentYoyPct', seriesValues[EMPLOYMENT] ? yoy(seriesValues[EMPLOYMENT], sum.period, 'pct') : null],
      ['materialsYoyPct', yoy(fredValues('WPUIP231120'), sum.period, 'pct')],
    ];
    for (const [key, expected] of pairs) {
      if (expected === null) { check(sum[key] === null, `summary.${key} should be null`); continue; }
      check(close(sum[key], expected), `summary.${key} ${sum[key]} does not recompute to ${expected.toFixed(2)}`);
      check(sum.text.includes(`${Math.abs(sum[key]).toFixed(1)}%`), `summary.text does not state ${key} (${Math.abs(sum[key]).toFixed(1)}%)`);
    }
    const hist = (data.history || []).find((h) => h.period === sum.period);
    check(hist && ['laborWageYoyPct', 'employmentYoyPct', 'materialsYoyPct'].every((k) => hist[k] === sum[k]),
      'the history row for the summary period disagrees with the summary');
  }
  const hp = (data.history || []).map((h) => h.period);
  check(hp.length >= 12, `history has only ${hp.length} rows (it is rebuilt from observations)`);
  check(hp.every((p, i) => i === 0 || p > hp[i - 1]), 'history periods not strictly increasing');
  return issues;
}

let passed = 0;
function test(name, fn) { fn(); passed += 1; console.log(`  ✓ ${name}`); }

console.log('co-construction-labor-cost');

test('the committed file satisfies the data contract', () => {
  assert.deepEqual(contractIssues(DATA), []);
});

test('the committed file passes scripts/validate-schemas.js\'s contract', () => {
  const { constructionLaborCostIssues } = require('../scripts/validate-schemas.js');
  assert.deepEqual(constructionLaborCostIssues(DATA), []);
});

// ── sabotage: each mutation must apply, and the contract must catch it ───────
function sabotage(name, mutate, expectPattern) {
  test(`sabotage: ${name}`, () => {
    const copy = JSON.parse(JSON.stringify(DATA));
    const before = JSON.stringify(copy);
    mutate(copy);
    assert.notEqual(JSON.stringify(copy), before, 'the mutation did not apply');
    const issues = contractIssues(copy);
    assert.ok(issues.some((i) => expectPattern.test(i)), `not caught: ${issues.join(' | ') || '(no issues)'}`);
  });
}

const firstMonthly = (d) => d.monthly[WAGE];
sabotage('latest diverges from the last observation',
  (d) => { firstMonthly(d).latest.value += 1; }, /latest is not the last observation/);
sabotage('yoy no longer recomputes',
  (d) => { firstMonthly(d).yoy.value += 0.5; }, /yoy .* does not recompute/);
sabotage('a rate series reports pct instead of pts',
  (d) => { d.monthly.LASST080000000000003.yoy.basis = 'pct'; }, /LASST080000000000003: yoy/);
sabotage('an unknown observation coerced to 0',
  (d) => { firstMonthly(d).observations[0].value = 0; }, /0 stands in for unknown/);
sabotage('a failed series emptied without a reason',
  (d) => { Object.assign(d.monthly[EMPLOYMENT], { observations: [], latest: null, unavailableReason: null }); },
  /no observations and no unavailableReason/);
sabotage('a series dropped silently',
  (d) => { delete d.monthly.JTU230000000000000HIR; }, /was dropped/);
sabotage('an OEWS cell missing',
  (d) => { d.oews.rows.pop(); }, /OEWS missing/);
sabotage('an OEWS wage coerced to 0',
  (d) => { d.oews.rows.find((r) => r.hourlyMean !== null).hourlyMean = 0; }, /hourlyMean is 0/);
sabotage('materials disagree with fred-data.json',
  (d) => { d.materials.series[0].latest += 1; }, /disagrees with fred-data\.json/);
sabotage('summary sentence states a different number',
  (d) => { d.summary.text = d.summary.text.replace(/\d+\.\d%/, '99.9%'); }, /summary\.text does not state/);
sabotage('history row disagrees with the summary',
  (d) => { d.history[d.history.length - 1].laborWageYoyPct = 42; }, /history row/);

test('rewording the summary sentence (numbers kept) stays green', () => {
  const copy = JSON.parse(JSON.stringify(DATA));
  const before = copy.summary.text;
  copy.summary.text = `Reworded: ${before.replace('year over year', 'compared with a year before')}`;
  assert.notEqual(copy.summary.text, before, 'the rewording did not apply');
  assert.deepEqual(contractIssues(copy), []);
});

console.log(`\nco-construction-labor-cost: ${passed} passed`);
