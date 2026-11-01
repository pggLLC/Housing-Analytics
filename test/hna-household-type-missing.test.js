'use strict';
/**
 * Household type chart: a count the Census table does not publish stays
 * missing. Before the fix, renderHouseholdCompositionPanel read each
 * component as `safeNum(v) || 0`, so a missing married-couple count was
 * drawn as 0, its households were added to "Other (shared, etc.)", and
 * "Other" became the tallest bar. A measured 0 must still be drawn as 0.
 *
 * Invented counts only. Run: node test/hna-household-type-missing.test.js
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

let failures = 0;
function test(name, fn) {
  try { fn(); console.log('  ok  ' + name); }
  catch (e) { failures += 1; console.log('  FAIL ' + name + '\n       ' + e.message); }
}
function assert(c, m) { if (!c) throw new Error(m); }

const BASE = { DP02_0001E: 1000, DP02_0002E: 400, DP02_0004E: 100, DP02_0007E: 30, DP02_0011E: 20, DP02_0008E: 120, DP02_0012E: 130 };

function render(profile) {
  const dom = new JSDOM('<!doctype html><div><div class="chart-box"><canvas id="chartHouseholdSize"></canvas></div></div>', { runScripts: 'outside-only' });
  const w = dom.window;
  const drawn = [];
  w.HTMLCanvasElement.prototype.getContext = function () { return { canvas: this }; };
  w.Chart = function (ctx, config) { drawn.push({ id: ctx.canvas.id, config }); this.destroy = () => {}; };
  w.HNAState = { charts: {}, state: {} };
  w.eval(read('js/utils/format-money.js'));
  w.eval(read('js/hna/hna-utils.js'));
  w.eval(read('js/hna/hna-renderers.js'));
  w.HNARenderers.renderHouseholdCompositionPanel(profile);
  const chart = drawn.find(d => d.id === 'chartHouseholdSize');
  const note = w.document.querySelector('[data-hna-chart-scope-note="chartHouseholdSize"]');
  const bars = chart ? chart.config.data.labels.map((l, i) => [l, chart.config.data.datasets[0].data[i]]) : [];
  const pct = chart ? (v) => chart.config.options.plugins.tooltip.callbacks.label({ parsed: { y: v } }) : null;
  return { bars: Object.fromEntries(bars), labels: bars.map(b => b[0]), note: note ? note.textContent : '', pct };
}

test('complete counts: every group drawn, Other is the remainder', () => {
  const r = render(Object.assign({}, BASE));
  assert(r.bars['Married couple'] === 400 && r.bars['Single parent'] === 50 && r.bars['Living alone'] === 250, JSON.stringify(r.bars));
  assert(r.bars['Other (shared, etc.)'] === 200, 'Other ' + r.bars['Other (shared, etc.)']);
  assert(r.note === '', 'unexpected note: ' + r.note);
  assert(/\(40\.0%\)/.test(r.pct(400)), r.pct(400));
});

test('missing married-couple count: not drawn as 0, no Other, the gap is named', () => {
  const r = render(Object.assign({}, BASE, { DP02_0002E: null }));
  assert(!('Married couple' in r.bars), 'married drawn as ' + r.bars['Married couple']);
  assert(!('Other (shared, etc.)' in r.bars), 'Other drawn as ' + r.bars['Other (shared, etc.)']);
  assert(/No published count for married couples/.test(r.note), 'note: ' + r.note);
  assert(/\(25\.0%\)/.test(r.pct(250)), 'share not of all households: ' + r.pct(250));
});

test('absent property (single-parent part): group and Other left out', () => {
  const p = Object.assign({}, BASE); delete p.DP02_0011E;
  const r = render(p);
  assert(!('Single parent' in r.bars) && !('Other (shared, etc.)' in r.bars), JSON.stringify(r.bars));
  assert(/single parents/.test(r.note), 'note: ' + r.note);
});

test('measured 0 stays a real 0 and Other still computes', () => {
  const r = render(Object.assign({}, BASE, { DP02_0004E: 0 }));
  assert(r.bars['Cohabiting couple'] === 0, 'cohabiting ' + r.bars['Cohabiting couple']);
  assert(r.bars['Other (shared, etc.)'] === 300, 'Other ' + r.bars['Other (shared, etc.)']);
  assert(r.note === '', 'unexpected note: ' + r.note);
});

if (failures) { console.log(failures + ' failing'); process.exit(1); }
console.log('hna-household-type-missing: all passed');
