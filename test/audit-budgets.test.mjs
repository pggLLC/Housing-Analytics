#!/usr/bin/env node
/**
 * The budgets that make the browser audits fail, tested without a browser.
 *
 * Both audits were reporters until 2026-10-15: axe could find 926 serious
 * failures on the HNA map and finish green, and nothing measured the step 3
 * freeze at all. scripts/audit/lib/audit-budget.mjs is what now turns a
 * finding into a red run, so its logic is checked here, in ci-checks, where
 * there is no browser. The browser halves run in a11y-audit.yml and
 * ux-pass.yml, which must invoke the audits and this file.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkA11yBudget, checkUxBudget, fleschKincaidGrade } from '../scripts/audit/lib/audit-budget.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
let failures = 0;
const test = (name, fn) => {
  try { fn(); console.log(`  ✓ ${name}`); } catch (e) { failures += 1; console.log(`  ✗ ${name} — ${e.message}`); }
};

console.log('audit-budgets');

const res = (page, violations) => ({ page, violations });
const viol = (id, impact, nodeCount) => ({ id, impact, nodeCount });

test('a serious rule over its budget on a page fails, and names the page', () => {
  const { over } = checkA11yBudget(
    [res('a.html', [viol('target-size', 'serious', 15)])],
    { maxElements: { 'target-size': { 'a.html': 14 } } });
  assert.equal(over.length, 1);
  assert.equal(over[0].page, 'a.html');
});

test('a serious rule that is not in the budget at all fails (the 926 unnamed markers)', () => {
  const { over } = checkA11yBudget(
    [res('hna-what-housing-exists.html', [viol('aria-command-name', 'serious', 926)])],
    { maxElements: {} });
  assert.equal(over.length, 1);
  assert.equal(over[0].allowed, 0);
});

test('a fix on one page cannot pay for a new failure on another', () => {
  // Site-wide totals are unchanged (10 + 0 = 5 + 5); the new failure on b.html
  // must still fail. A per-rule allowance across pages let this through.
  const { over } = checkA11yBudget(
    [res('a.html', [viol('target-size', 'serious', 5)]), res('b.html', [viol('target-size', 'serious', 5)])],
    { maxElements: { 'target-size': { 'a.html': 10 } } });
  assert.deepEqual(over.map((o) => o.page), ['b.html']);
});

test('moderate and minor findings are reported, not budgeted', () => {
  const { over } = checkA11yBudget([res('a.html', [viol('region', 'moderate', 40)])], { maxElements: {} });
  assert.equal(over.length, 0);
});

test('a page now below its budget is reported so the budget can come down', () => {
  const { over, under } = checkA11yBudget([res('a.html', [])], { maxElements: { list: { 'a.html': 2 } } });
  assert.equal(over.length, 0);
  assert.deepEqual(under, [{ rule: 'list', page: 'a.html', found: 0, allowed: 2 }]);
});

test('an unaudited page is not reported as fixed', () => {
  const { under } = checkA11yBudget([{ page: 'a.html', error: 'Target crashed', violations: [] }],
    { maxElements: { list: { 'a.html': 2 } } });
  assert.deepEqual(under, []);
});

const UX = { defaults: { maxDomNodes: 15000, maxBlockingMs: 6000, oneH1: true }, pages: {} };
const page = (o) => ({ page: 'p.html', domNodes: 800, blockingMs: 100, h1Count: 1, ...o });

test('the step 3 freeze is over the DOM budget (51,301 nodes before the fix)', () => {
  const b = checkUxBudget([page({ domNodes: 51301 })], UX);
  assert.equal(b.length, 1);
  assert.equal(b[0].measure, 'DOM nodes');
});

test('a page today is within budget (8,754 nodes, the largest measured)', () => {
  assert.deepEqual(checkUxBudget([page({ domNodes: 8754, blockingMs: 849 })], UX), []);
});

test('long main-thread blocking fails', () => {
  assert.equal(checkUxBudget([page({ blockingMs: 18000 })], UX)[0].measure, 'main-thread blocking (ms)');
});

test('a page with no <h1>, or two, fails', () => {
  assert.equal(checkUxBudget([page({ h1Count: 0 }), page({ h1Count: 2 })], UX).length, 2);
});

test('a page that did not load is a breach, not a pass', () => {
  assert.equal(checkUxBudget([{ page: 'gone.html', error: 'HTTP 404' }], UX).length, 1);
});

test('a measurement that did not happen fails instead of passing', () => {
  // null > 6000 and NaN > 6000 are both false.
  const b = checkUxBudget([page({ blockingMs: null }), page({ domNodes: NaN })], UX);
  assert.equal(b.length, 2);
  assert.ok(b.every((x) => x.found === 'not measured'));
});

test('a page whose data never rendered fails, however light it is', () => {
  const budget = { ...UX, pages: { 'p.html': { ready: { selector: '.leaflet-marker-icon', min: 100 } } } };
  assert.equal(checkUxBudget([page({ readyCount: 0 })], budget).length, 1);
  assert.equal(checkUxBudget([page({ readyCount: 926 })], budget).length, 0);
});

test('the expanded state is held to the same limits (a single "show all" was 51,044 nodes)', () => {
  const budget = { ...UX, pages: { 'p.html': { click: { selector: '.more', times: 3 } } } };
  const slow = checkUxBudget([page({ afterClick: { clicks: 3, domNodes: 51044, blockingMs: 300 } })], budget);
  assert.equal(slow.length, 1);
  assert.match(slow[0].measure, /DOM nodes after 3 click/);
  assert.equal(checkUxBudget([page({ afterClick: { clicks: 3, domNodes: 9500, blockingMs: 300 } })], budget).length, 0);
  assert.equal(checkUxBudget([page({ afterClick: { clicks: 0 } })], budget).length, 1, 'a control that was never pressed passed');
  assert.equal(checkUxBudget([page({ afterClick: { clicks: 1, domNodes: 8000, blockingMs: 100 } })], budget).length, 1,
    'one press of three passed: a control that breaks after the first press is measured small');
});

test('a per-page budget overrides the default', () => {
  const b = { ...UX, pages: { 'p.html': { maxDomNodes: 500 } } };
  assert.equal(checkUxBudget([page({ domNodes: 800 })], b).length, 1);
});

test('reading grade separates plain from dense prose', () => {
  const plain = fleschKincaidGrade('The cat sat on the mat. We go to the park. It is a nice day.');
  const dense = fleschKincaidGrade('Jurisdictional affordability determinations necessitate comprehensive demographic and socioeconomic characterization of prospective beneficiary populations.');
  assert.ok(plain < 4, `plain prose graded ${plain}`);
  assert.ok(dense > 16, `dense prose graded ${dense}`);
  assert.equal(fleschKincaidGrade(''), null, 'no prose must be null, not grade 0');
});

test('the committed budgets have the shape the audits read', () => {
  const a = JSON.parse(read('scripts/audit/a11y-budget.json'));
  for (const [rule, pages] of Object.entries(a.maxElements)) {
    for (const [p, v] of Object.entries(pages)) assert.ok(Number.isInteger(v) && v > 0, `${rule} on ${p}: ${v}`);
  }
  const u = JSON.parse(read('scripts/audit/ux-budget.json'));
  assert.ok(Number.isFinite(u.defaults.maxDomNodes) && Number.isFinite(u.defaults.maxBlockingMs));
});

test('the browser lanes run the audits and this file', () => {
  const a11y = read('.github/workflows/a11y-audit.yml');
  assert.match(a11y, /node scripts\/audit\/a11y-audit\.mjs/);
  const ux = read('.github/workflows/ux-pass.yml');
  assert.match(ux, /node scripts\/audit\/ux-pass\.mjs/);
  assert.match(ux, /node test\/audit-budgets\.test\.mjs/);
  assert.match(read('scripts/audit/a11y-audit.mjs'), /checkA11yBudget\(results, budget\)/);
  assert.match(read('scripts/audit/ux-pass.mjs'), /checkUxBudget\(results, budget\)/);
});

test('the usability pass covers every step in the step bar', () => {
  // Agreement, not a pinned list: the pages the step bar sends a visitor to
  // must all be measured.
  const rail = read('js/components/workflow-progress.js');
  // The seven steps of the guided path ("{ num: 1, ... href: 'x.html' }").
  const steps = [...rail.matchAll(/num:\s*\d+[^}]*?href:\s*'([\w-]+\.html)'/g)].map((m) => m[1]);
  assert.ok(steps.length >= 7, `found only ${steps.length} step pages in the step bar`);
  const src = read('scripts/audit/ux-pass.mjs');
  const listed = src.slice(src.indexOf('UX_PAGES = ['), src.indexOf('];', src.indexOf('UX_PAGES = [')));
  const missing = steps.filter((s) => !listed.includes(`'${s}'`));
  assert.deepEqual(missing, [], `step pages not measured: ${missing.join(', ')}`);
});

if (failures) { console.log(`audit-budgets: FAIL (${failures})`); process.exit(1); }
console.log('audit-budgets: PASS');
