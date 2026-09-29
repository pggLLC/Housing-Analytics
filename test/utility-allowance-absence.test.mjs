#!/usr/bin/env node
// A blank utility allowance is unknown, not $0 (#1934).
//
// The subject-project unit table showed "LIHTC max net" = max gross − UA with
// `+row.utility_allowance || 0`, and every seeded row carried
// utility_allowance: 0 — so a user who never entered an allowance was shown the
// full CHFA gross rent as the tenant-paid limit, overstated by the whole
// allowance. This mounts the real component on the real CHFA rent file and
// checks the net-rent cell against computeLihtcMaxRent for each case.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const read = (p) => readFileSync(p, 'utf8');
const chfaJson = JSON.parse(read('data/chfa-income-rent-limits-2026.json'));
let hudJson = null;
try { hudJson = JSON.parse(read('data/hud-fmr-income-limits.json')); } catch (_) { /* optional */ }

function mountWith(subject) {
  const dom = new JSDOM('<!doctype html><body><div id="sp"></div><div id="rc"></div></body>',
    { runScripts: 'outside-only', url: 'https://example.org/market-analysis.html' });
  const w = dom.window;
  w.fetch = (url) => {
    const body = String(url).includes('chfa-income-rent-limits') ? chfaJson
      : String(url).includes('hud-fmr-income-limits') ? hudJson : null;
    return Promise.resolve({ ok: body != null, status: body != null ? 200 : 404, json: () => Promise.resolve(body) });
  };
  w.alert = () => {}; w.confirm = () => true;
  w.localStorage.setItem('coho.subjectProject.v1', JSON.stringify(subject));
  w.eval(read('js/chfa-rent-limits.js'));
  w.eval(read('js/components/subject-project.js'));
  return w;
}
const settle = () => new Promise((r) => setTimeout(r, 30));

// A county the CHFA file actually covers, taken from the file itself.
const SP0 = mountWith({});
let county = null;
for (const fips of ['08077', '08031', '08013']) {
  if (SP0.SubjectProject.computeLihtcMaxRent(chfaJson, fips, 60, '2BR', {})) { county = fips; break; }
}
assert(county, 'no probe county has a CHFA 60% 2BR max rent; the rent file shape changed');
const lihtc = SP0.SubjectProject.computeLihtcMaxRent(chfaJson, county, 60, '2BR', {});
assert(lihtc && lihtc.gross_rent > 0, 'CHFA max gross rent should be a positive number');
const GROSS = lihtc.gross_rent;

// ── 1. The pure rule ───────────────────────────────────────────────────────
const { maxNetRent } = SP0.SubjectProject;
assert.equal(maxNetRent(GROSS, null), null, 'blank allowance → unknown net rent');
assert.equal(maxNetRent(GROSS, ''), null, 'empty-string allowance → unknown net rent');
assert.equal(maxNetRent(GROSS, undefined), null);
assert.equal(maxNetRent(GROSS, 0), GROSS, 'an entered $0 allowance is real: net equals gross');
assert.equal(maxNetRent(GROSS, 150), GROSS - 150);
assert.equal(maxNetRent(GROSS, -5), null, 'a negative allowance is not a value');
assert.equal(maxNetRent(null, 150), null);
assert.equal(maxNetRent(GROSS, GROSS + 1), null, 'allowance above gross → unknown, never clamped $0');
assert.equal(maxNetRent(GROSS, GROSS - 10, 11), null, 'allowance plus fees above gross → unknown');

// ── 2. The rendered table, against computeLihtcMaxRent ─────────────────────
async function netCellFor(ua, fees) {
  const w = mountWith({ county_fips: county, unit_mix: [
    { bedrooms: '2BR', ami_tier: 60, count: 4, sqft: 900, proposed_gross_rent: null, utility_allowance: ua, fees }
  ] });
  w.SubjectProject.mount(w.document.getElementById('sp'));
  await settle();
  const header = [...w.document.querySelectorAll('#sp thead th')].map((th) => th.textContent.trim());
  const col = header.indexOf('LIHTC max net');
  assert(col >= 0, `unit table has no "LIHTC max net" column (headers: ${header.join(' | ')})`);
  const row = w.document.querySelector('#sp tbody tr');
  assert(row, 'unit table rendered no row');
  return row.children[col];
}
const blank = await netCellFor(null);
// The contract, not the wording: no money in the cell, the unavailable marker,
// and the component's own stated reason as the tooltip.
assert(!/\$\s*\d/.test(blank.textContent), `blank allowance must not render a net rent (cell reads "${blank.textContent.trim()}")`);
assert(blank.textContent.trim().length > 0, 'the blank-allowance cell must say something, not render empty');
assert.equal(blank.getAttribute('data-net-rent-unavailable'), 'utility-allowance');
assert.equal(blank.getAttribute('title'), SP0.SubjectProject.UA_MISSING_REASON, 'the cell says why');
const money = (n) => '$' + Math.round(n).toLocaleString('en-US');
assert.equal((await netCellFor(0)).textContent.trim(), money(GROSS), 'UA $0 → net = CHFA gross');
assert.equal((await netCellFor(150)).textContent.trim(), money(GROSS - 150), 'UA $150 → net = CHFA gross − 150');
assert.equal((await netCellFor(150, 40)).textContent.trim(), money(GROSS - 190), 'fees reduce the contract limit');
assert.equal((await netCellFor(GROSS, 0)).textContent.trim(), money(0), 'deductions equal to gross support a genuine zero');
for (const [ua, fees] of [[GROSS + 1, undefined], [GROSS - 10, 11]]) {
  const cell = await netCellFor(ua, fees);
  const result = SP0.ChfaRentLimits.maxContractRent({ grossRent: GROSS, utilityAllowance: ua, fees });
  assert(!/\$\s*\d/.test(cell.textContent), 'over-deduction must not render a money amount');
  assert(cell.textContent.trim().length > 0, 'over-deduction must show an explanation');
  assert.equal(cell.getAttribute('title'), result.unavailableReason);
  assert.equal(cell.getAttribute('data-net-rent-unavailable'), result.unavailableReason);
}


// ── 3. No seeded row starts with an allowance nobody entered ──────────────
// Non-vacuity on the scan: the component seeds rows in several places.
const src = read('js/components/subject-project.js');
const seeds = [...src.matchAll(/utility_allowance:\s*([^,}\s]+)/g)].map((m) => m[1]);
assert(seeds.length >= 5, `expected the add-row button and presets to seed rows, found ${seeds.length}`);
assert.deepEqual(seeds.filter((v) => v !== 'null'), [], 'every seeded row must start with utility_allowance: null');
for (const f of ['js/components/subject-project.js', 'js/components/subject-rent-comparison.js']) {
  assert(!/utility_allowance\s*\|\|\s*0/.test(read(f)), `${f} coerces a blank utility allowance to 0`);
}

// ── 4. Rent comparison shows an entered $0, and — for blank ────────────────
{
  const w = mountWith({ county_fips: county, unit_mix: [
    { bedrooms: '2BR', ami_tier: 60, count: 4, proposed_gross_rent: 1200, utility_allowance: 0 },
    { bedrooms: '2BR', ami_tier: 60, count: 4, proposed_gross_rent: 1200, utility_allowance: null }
  ] });
  w.eval(read('js/components/subject-rent-comparison.js'));
  const RC = w.SubjectRentComparison;
  if (RC && typeof RC.render === 'function') {
    RC.render(w.document.getElementById('rc'));
    await settle();
    const header = [...w.document.querySelectorAll('#rc thead th')].map((th) => th.textContent.trim());
    const col = header.indexOf('Util. allow.');
    const rows = [...w.document.querySelectorAll('#rc tbody tr')];
    if (col >= 0 && rows.length === 2) {
      assert.equal(rows[0].children[col].textContent.trim(), '$0', 'an entered $0 allowance shows as $0');
      assert.equal(rows[1].children[col].textContent.trim(), '—', 'a blank allowance shows as —');
      console.log('  rent comparison: $0 vs blank rendered distinctly');
    } else {
      assert.fail(`rent comparison did not render the expected table (col ${col}, rows ${rows.length})`);
    }
  } else {
    assert.fail('SubjectRentComparison.render is not exposed; update this guard to the component\'s entry point');
  }
}

// ── 5. Both tables carry module provenance and fee-adjusted net rents ──────
{
  const w = mountWith({ county_fips: county, unit_mix: [
    { bedrooms: '2BR', ami_tier: 60, count: 4, utility_allowance: 150, fees: 40 },
    { bedrooms: '2BR', ami_tier: 60, count: 4, utility_allowance: GROSS + 1 },
    { bedrooms: '2BR', ami_tier: 60, count: 4, utility_allowance: 0 }
  ] });
  // Distinct returned metadata proves the captions consume the module result.
  const original = w.ChfaRentLimits.maxGrossRent;
  w.ChfaRentLimits.maxGrossRent = (...args) => ({ ...original(...args), tableYear: 2099, effectiveDate: '2099-06-17' });
  w.SubjectProject.mount(w.document.getElementById('sp'));
  w.eval(read('js/components/subject-rent-comparison.js'));
  w.SubjectRentComparison.render(w.document.getElementById('rc'));
  await settle();
  for (const id of ['sp', 'rc']) {
    const caption = w.document.querySelector('#' + id + ' caption');
    assert(caption && caption.textContent.includes('2099') && caption.textContent.includes('2099-06-17'), id + ': caption must show module table year and date');
    const headers = [...w.document.querySelectorAll('#' + id + ' thead th')].map((th) => th.textContent.trim());
    const col = headers.indexOf('LIHTC max net');
    assert(col >= 0);
    const rows = [...w.document.querySelectorAll('#' + id + ' tbody tr')];
    assert.equal(rows[0].children[col].textContent.trim(), money(GROSS - 190));
    assert(!/\$\s*\d/.test(rows[1].children[col].textContent), id + ': over-deduction must have no rent amount');
    assert.equal(rows[1].children[col].getAttribute('title'), 'deductions_exceed_gross_rent');
    assert.equal(rows[2].children[col].textContent.trim(), money(GROSS));
  }
  assert.equal(w.document.querySelectorAll('#rc [data-fees-entered="false"]').length, 2);
  assert.equal(w.document.querySelectorAll('#rc [data-fees-entered="true"]').length, 1);
  const input = w.document.querySelector('#sp input[data-key="fees"]');
  assert(input, 'the subject row provides a fees input');
  input.value = '55';
  input.dispatchEvent(new w.Event('change', { bubbles: true }));
  assert.equal(w.SubjectProject.get().unit_mix[0].fees, 55, 'fees persist with the subject row');
  const headers = [...w.document.querySelectorAll('#sp thead th')].map((th) => th.textContent.trim());
  assert.equal(w.document.querySelector('#sp tbody tr').children[headers.indexOf('LIHTC max net')].textContent.trim(), money(GROSS - 205));
  w.close();
}

console.log(`Utility allowance absence: PASS (county ${county}, CHFA 60% 2BR gross ${money(GROSS)}; blank → no net rent + reason, $0 → gross, $150 → gross − 150; ${seeds.length} seeded rows start blank)`);
