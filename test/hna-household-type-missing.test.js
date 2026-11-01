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

// Labor force and occupation, in the same panel: the same rule. Invented counts only.
function renderLabor(profile) {
  const ids = ['statLfEmployed', 'statLfUnemployed', 'statRetireeProxy', 'statNotInLfUnder65'];
  const dom = new JSDOM('<!doctype html><div><div class="chart-box"><canvas id="chartOccupationMix"></canvas></div></div>' +
    ids.map(id => '<div id="' + id + '">stale</div>').join('') + '<div id="laborForceRetireeNote">—</div>', { runScripts: 'outside-only' });
  const w = dom.window;
  const drawn = [];
  w.HTMLCanvasElement.prototype.getContext = function () { return { canvas: this }; };
  w.Chart = function (ctx, config) { drawn.push({ id: ctx.canvas.id, config }); this.destroy = () => {}; };
  w.HNAState = { charts: {}, state: {} };
  w.eval(read('js/utils/format-money.js'));
  w.eval(read('js/hna/hna-utils.js'));
  w.eval(read('js/hna/hna-renderers.js'));
  w.HNARenderers.renderHouseholdCompositionPanel(Object.assign({}, BASE, profile));
  const chart = drawn.find(d => d.id === 'chartOccupationMix');
  const note = w.document.querySelector('[data-hna-chart-scope-note="chartOccupationMix"]');
  const text = (id) => w.document.getElementById(id).textContent;
  return {
    stat: Object.fromEntries(ids.map(id => [id, text(id)])), retNote: text('laborForceRetireeNote'),
    bars: chart ? Object.fromEntries(chart.config.data.labels.map((l, i) => [l, chart.config.data.datasets[0].data[i]])) : null,
    tip: chart ? (v) => chart.config.options.plugins.tooltip.callbacks.label({ parsed: { x: v } }) : null,
    note: note ? note.textContent : ''
  };
}
const LF = { DP03_0002E: 600, DP03_0005E: 30, DP03_0007E: 400, DP05_0024E: 200 };
const OCC = { DP03_0027E: 300, DP03_0028E: 200, DP03_0029E: 150, DP03_0030E: 100, DP03_0031E: 50 };

for (const [name, v] of [['null', null], ['blank', ''], ['absent', undefined]]) {
  test('unemployed ' + name + ': unemployed and employed show a dash, not 0 and 600', () => {
    const p = Object.assign({}, LF, { DP03_0005E: v }); if (v === undefined) delete p.DP03_0005E;
    const r = renderLabor(p);
    assert(r.stat.statLfUnemployed === '—' && r.stat.statLfEmployed === '—', JSON.stringify(r.stat));
  });
}
test('unemployed a published 0: kept, and employed is the whole labor force', () => {
  const r = renderLabor(Object.assign({}, LF, { DP03_0005E: 0 }));
  assert(r.stat.statLfUnemployed === '0' && r.stat.statLfEmployed === '600', JSON.stringify(r.stat));
});
test('not in labor force missing: retiree split not worked out', () => {
  const r = renderLabor(Object.assign({}, LF, { DP03_0007E: null }));
  assert(r.stat.statRetireeProxy === '—' && r.stat.statNotInLfUnder65 === '—', JSON.stringify(r.stat));
  assert(/not available/.test(r.retNote), r.retNote);
});
test('complete labor counts: figures and the retiree note', () => {
  const r = renderLabor(LF);
  assert(r.stat.statLfEmployed === '570' && r.stat.statRetireeProxy === '170' && r.stat.statNotInLfUnder65 === '230', JSON.stringify(r.stat));
});
test('occupations complete: every group drawn with shares', () => {
  const r = renderLabor(OCC);
  assert(Object.keys(r.bars).length === 5 && /\(37\.5%\)/.test(r.tip(300)) && r.note === '', JSON.stringify(r.bars) + r.note);
});
test('one occupation missing: not drawn as 0, no shares, the gap is named', () => {
  const r = renderLabor(Object.assign({}, OCC, { DP03_0028E: null }));
  assert(!('Service' in r.bars) && Object.keys(r.bars).length === 4, JSON.stringify(r.bars));
  assert(!/%/.test(r.tip(300)), 'share from incomplete counts: ' + r.tip(300));
  assert(/No published count for service/.test(r.note), r.note);
});
test('an occupation count of 0 is real: drawn with shares', () => {
  const r = renderLabor(Object.assign({}, OCC, { DP03_0031E: 0 }));
  assert(r.bars['Production / transportation / material moving'] === 0 && /%/.test(r.tip(300)) && r.note === '', JSON.stringify(r.bars));
});
test('every occupation missing: no chart, and the note says why', () => {
  const r = renderLabor({ DP03_0027E: null, DP03_0028E: null, DP03_0029E: null, DP03_0030E: null, DP03_0031E: null });
  assert(r.bars === null && /no published occupation counts/.test(r.note), r.note);
});

if (failures) { console.log(failures + ' failing'); process.exit(1); }
console.log('hna-household-type-missing: all passed');
