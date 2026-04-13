'use strict';
/**
 * test/pro-forma.test.js
 *
 * Unit tests for js/pro-forma.js — 15-Year Operating Pro Forma Module.
 * Tests the public API surface, mortgage-constant math, and DOM rendering.
 *
 * Run: node test/pro-forma.test.js
 * Dependencies: jsdom (devDependency — npm ci)
 */

const { JSDOM } = require('jsdom');

/* ── Build a minimal DOM that mirrors what the deal-calculator creates ───── */
const dom = new JSDOM(`<!DOCTYPE html>
<body>
  <!-- Pro Forma mount point -->
  <div id="pf-container"></div>

  <!-- Deal-calculator inputs that pro-forma.js reads via numVal() / textNum() -->
  <input  id="dc-units"       type="number" value="60">
  <input  id="dc-vacancy"     type="number" value="7">
  <input  id="dc-opex"        type="number" value="450">
  <input  id="dc-rep-reserve" type="number" value="350">
  <input  id="dc-prop-tax"    type="number" value="900">
  <input  id="dc-tax-exempt"  type="number" value="0">
  <input  id="dc-rate"        type="number" value="6.5">
  <input  id="dc-term"        type="number" value="35">
  <span   id="dc-r-rents">720000</span>
  <span   id="dc-r-mortgage">6000000</span>
  <!-- auto-NOI checkbox — not checked, so update() shows placeholder message -->
  <input  id="dc-auto-noi"    type="checkbox">
</body>`);

global.document = dom.window.document;
global.window   = dom.window;
global.self     = dom.window;

/* Stub Chart.js — pro-forma.js tries to construct a Chart instance after render */
dom.window.Chart = function ChartStub() { return { destroy: function () {} }; };

/* Load the module — sets window.ProForma as a side effect */
require('../js/pro-forma.js');
const ProForma = global.window.ProForma;

/* ── tiny test harness ───────────────────────────────────────────────────── */
let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log('  ✅ ' + message);
    passed++;
  } else {
    console.error('  ❌ FAIL: ' + message);
    failed++;
  }
}

function assertClose(actual, expected, tolerance, message) {
  const diff = Math.abs(actual - expected);
  if (diff <= tolerance) {
    console.log('  ✅ ' + message + ' (' + actual.toFixed(4) + ')');
    passed++;
  } else {
    console.error('  ❌ FAIL: ' + message +
      ' — got ' + actual.toFixed(4) + ', expected ~' + expected + ' ±' + tolerance);
    failed++;
  }
}

/* ── test runner ─────────────────────────────────────────────────────────── */
console.log('\nProForma — Unit Tests\n' + '='.repeat(45));

// ── 1. Public API surface ─────────────────────────────────────────────────
console.log('\n1. Public API surface');
assert(typeof ProForma          === 'object',   'window.ProForma is an object');
assert(typeof ProForma.render   === 'function', 'render is a function');
assert(typeof ProForma.update   === 'function', 'update is a function');

// ── 2. Mortgage constant math ─────────────────────────────────────────────
// The mortgageConstant() function is internal but its formula is the standard
// annual mortgage-constant from finance.  We verify the spec here so any
// future refactor can confirm the numbers remain correct.
//
//   MC = (r/12 × (1+r/12)^n) / ((1+r/12)^n − 1) × 12
//   where r = annual rate, n = total months
console.log('\n2. Mortgage constant formula verification');

function mortgageConstant(annualRate, termYears) {
  const monthlyRate = annualRate / 12;
  const totalMonths = termYears * 12;
  if (monthlyRate <= 0 || totalMonths <= 0) return 0;
  const factor = Math.pow(1 + monthlyRate, totalMonths);
  return (monthlyRate * factor / (factor - 1)) * 12;
}

// 6.5% / 35-year: computed result ≈ 0.0725 annual constant
assertClose(mortgageConstant(0.065, 35), 0.0725, 0.0005,
  'MC(6.5%, 35yr) ≈ 0.0725');

// 5.0% / 30-year: ≈ 0.0644
assertClose(mortgageConstant(0.05, 30), 0.0644, 0.0005,
  'MC(5.0%, 30yr) ≈ 0.0644');

// Edge cases: zero rate or zero term → 0
assert(mortgageConstant(0,    35) === 0, 'MC returns 0 for zero rate');
assert(mortgageConstant(0.065, 0) === 0, 'MC returns 0 for zero term');

// ── 3. render() populates the mount element ───────────────────────────────
console.log('\n3. render() DOM output');
ProForma.render('pf-container');

const container = dom.window.document.getElementById('pf-container');
assert(container.innerHTML.length > 50,         'render() populates container');

// Assumption inputs created by buildUI()
assert(dom.window.document.getElementById('pf-rent-growth') !== null,
  'render() creates #pf-rent-growth input');
assert(dom.window.document.getElementById('pf-exp-growth') !== null,
  'render() creates #pf-exp-growth input');
assert(dom.window.document.getElementById('pf-years') !== null,
  'render() creates #pf-years input');
assert(dom.window.document.getElementById('pf-table-wrap') !== null,
  'render() creates #pf-table-wrap');
assert(dom.window.document.getElementById('pf-chart') !== null,
  'render() creates #pf-chart canvas');

// Canvas accessibility attributes (Rule 15)
const canvas = dom.window.document.getElementById('pf-chart');
assert(canvas.getAttribute('role') === 'img',
  'pf-chart canvas has role="img"');
assert((canvas.getAttribute('aria-label') || '').length > 0,
  'pf-chart canvas has a non-empty aria-label');

// ── 4. update() — with auto-NOI unchecked shows placeholder message ───────
console.log('\n4. update() placeholder when auto-NOI is disabled');
ProForma.update();
const tableWrap = dom.window.document.getElementById('pf-table-wrap');
// When dc-auto-noi is unchecked, update() writes a placeholder paragraph
assert(tableWrap !== null, '#pf-table-wrap still exists after update()');
assert(tableWrap.innerHTML.length > 0, '#pf-table-wrap has content after update()');

// ── 5. update() — with auto-NOI checked and non-zero rents ───────────────
console.log('\n5. update() generates table rows when auto-NOI is enabled');
const autoNoiEl = dom.window.document.getElementById('dc-auto-noi');
autoNoiEl.checked = true;

ProForma.update();

// The table wrap should now contain a proper table
const tbl = tableWrap.querySelector('table');
assert(tbl !== null, 'update() renders a <table> when auto-NOI is enabled');

if (tbl) {
  const rows = tbl.querySelectorAll('tbody tr');
  // Default #pf-years value is 15
  assert(rows.length === 15, 'default projection has 15 table rows');

  // Year 1 row should exist and contain data
  const firstRow = rows[0];
  const cells = firstRow.querySelectorAll('td');
  assert(cells.length > 0, 'first row has at least one cell');
  assert(cells[0].textContent.trim() === '1', 'first cell of first row is year 1');
}

// ── 6. Changing pf-years re-renders with correct row count ────────────────
console.log('\n6. Changing projection years re-renders table');
const yearsInput = dom.window.document.getElementById('pf-years');
yearsInput.value = '10';
// Simulate input event
yearsInput.dispatchEvent(new dom.window.Event('input'));

const tbl2 = tableWrap.querySelector('table');
if (tbl2) {
  const rows2 = tbl2.querySelectorAll('tbody tr');
  assert(rows2.length === 10, 'changing pf-years to 10 produces 10 rows');
} else {
  assert(false, 'table present after years input change');
}

// ── 7. Clamping of projection years ──────────────────────────────────────
console.log('\n7. Projection years are clamped to valid range [5, 30]');
// The update() function clamps years: Math.min(30, Math.max(5, years))
yearsInput.value = '2';   // below min 5
yearsInput.dispatchEvent(new dom.window.Event('input'));
let tbl3 = tableWrap.querySelector('table');
if (tbl3) {
  assert(tbl3.querySelectorAll('tbody tr').length === 5,
    'years < 5 clamps to 5 rows');
}

yearsInput.value = '99';  // above max 30
yearsInput.dispatchEvent(new dom.window.Event('input'));
let tbl4 = tableWrap.querySelector('table');
if (tbl4) {
  assert(tbl4.querySelectorAll('tbody tr').length === 30,
    'years > 30 clamps to 30 rows');
}

// ── summary ───────────────────────────────────────────────────────────────
console.log('\n' + '='.repeat(45));
console.log('ProForma: ' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
