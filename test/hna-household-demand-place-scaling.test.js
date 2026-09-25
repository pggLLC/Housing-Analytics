#!/usr/bin/env node
'use strict';

// The AMI-tier household-demand chart must describe the same households as
// the household-formation chart beside it.
//
// Found 2026-09-24: for Fruita (~5.8k households) chartHouseholdDemand — and
// the HNA Excel sheet built from it — showed Mesa County's ~67k households
// under a "Fruita (city)" heading. DOLA household projections are
// county-level; chartProjectedHH scaled them to the place by its share of
// county population, chartHouseholdDemand read the unscaled county series.
// Two charts, two answers for one quantity.
//
// Held here as an agreement, not a number: for every year, the demand
// chart's tiers must sum to the formation chart's households, for a place and
// for a county, rendered through the real _renderScenarioSection against the
// real Mesa County projection file.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const proj = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/hna/projections/08077.json'), 'utf8'));

let failures = 0;
function test(name, fn) {
  try { fn(); console.log('  ✓ ' + name); }
  catch (e) { failures += 1; console.log('  ✗ ' + name + ' — ' + e.message); }
}

function render(geoType, popSel) {
  const dom = new JSDOM(`
    <select id="projScenario"><option value="baseline">Baseline</option></select>
    <div><div class="chart-box"><canvas id="chartProjectedHH"></canvas></div></div>
    <div><div class="chart-box"><canvas id="chartHouseholdDemand"></canvas></div></div>
    <p id="householdDemandScopeCaption" hidden></p>
  `, { url: 'http://127.0.0.1/housing-needs-assessment.html' });
  const charts = {};
  global.window = dom.window;
  global.document = dom.window.document;
  global.localStorage = dom.window.localStorage;
  global.Chart = function ChartStub(ctx, config) {
    charts[ctx.canvas.id] = config;
    return { destroy() {} };
  };
  window.Chart = global.Chart;
  window.HNAState = { charts: {}, els: { geoType: { value: geoType }, geoSelect: { value: geoType === 'county' ? '08077' : '0828745' } } };
  window.HNAUtils = { fmtNum: (v) => String(Math.round(Number(v) || 0)), PROJECTION_SCENARIOS: {} };
  window.HTMLCanvasElement.prototype.getContext = function getContext() { return { canvas: this }; };
  const abs = path.join(ROOT, 'js/hna/hna-renderers.js');
  delete require.cache[require.resolve(abs)];
  require(abs);
  const theme = { c1: '#111', c2: '#222', c3: '#333', c4: '#444', c5: '#555', c6: '#666', c7: '#777', text: '#000', muted: '#666', border: '#ddd' };
  try {
    window.HNARenderers._renderScenarioSection(proj, popSel, proj.years, proj.baseYear, '08077', theme, {});
  } catch (e) {
    // Anything after the two charts (the data-quality badge) is outside this
    // guard; the charts are asserted to exist below, so a throw before them
    // still fails.
  }
  const note = (id) => {
    const box = document.getElementById(id).closest('.chart-box');
    return box && box.parentElement ? box.parentElement.textContent.replace(/\s+/g, ' ') : '';
  };
  return { charts, note };
}

function tierTotals(config) {
  const sets = config.data.datasets;
  return config.data.labels.map((_, i) => sets.reduce((sum, ds) => sum + ds.data[i], 0));
}

console.log('\nHNA household-demand chart agrees with household formation');

const countyHh = proj.housing_need.households_dola;
assert(Array.isArray(countyHh) && countyHh.length > 5, 'Mesa County projection has no household series to test against');
// A place at ~8.7% of county population — Fruita's order of magnitude — with
// a share that drifts over time, so a per-year scaling mistake shows.
const placePop = proj.population_dola.map((p, i) => p * (0.087 + i * 0.0005));

test('for a place, demand tiers sum to the formation chart, year by year', () => {
  const { charts } = render('place', placePop);
  assert(charts.chartProjectedHH && charts.chartHouseholdDemand, 'one of the two charts did not render');
  const formation = charts.chartProjectedHH.data.datasets[0].data;
  const demand = tierTotals(charts.chartHouseholdDemand);
  assert.equal(demand.length, formation.length);
  const tiers = charts.chartHouseholdDemand.data.datasets.length;
  demand.forEach((d, i) => {
    // Each tier is rounded to a whole household, so the sum may differ from
    // the formation series by at most one per tier.
    assert(Math.abs(d - formation[i]) <= tiers,
      `year ${proj.years[i]}: demand chart totals ${d}, formation chart shows ${Math.round(formation[i])}`);
  });
  assert(demand[0] < countyHh[0] * 0.2,
    `the place's demand chart still shows county-scale households (${demand[0]} of the county's ${Math.round(countyHh[0])})`);
});

test('the scaling is each year\'s own population share', () => {
  // Both charts share one helper, so agreement between them cannot catch a
  // wrong helper. The rule itself: households scale with the place's share
  // of county population in that year, not a share frozen at the base year.
  render('place', placePop);
  const out = window.HNARenderers._placeScaledHouseholds(countyHh, placePop, proj.population_dola);
  assert.equal(out.scaled, true);
  out.series.forEach((v, i) => {
    const expected = countyHh[i] * placePop[i] / proj.population_dola[i];
    assert(Math.abs(v - expected) < 1e-6, `year ${proj.years[i]}: scaled to ${v}, share rule gives ${expected}`);
  });
  assert.equal(window.HNARenderers._placeScaledHouseholds(countyHh, null, proj.population_dola).scaled, false,
    'no place series still reports itself as scaled');
});

test('for a place, the demand chart says it was scaled to the place', () => {
  const { note } = render('place', placePop);
  assert(/Scaled to this place/.test(note('chartHouseholdDemand')),
    'the demand chart note does not say its households were scaled: ' + note('chartHouseholdDemand'));
});

test('for a county, both charts show the county series', () => {
  const { charts } = render('county', proj.population_dola);
  const formation = charts.chartProjectedHH.data.datasets[0].data;
  const demand = tierTotals(charts.chartHouseholdDemand);
  const tiers = charts.chartHouseholdDemand.data.datasets.length;
  demand.forEach((d, i) => {
    assert(Math.abs(formation[i] - countyHh[i]) < 1e-6, 'county formation chart altered the DOLA series');
    assert(Math.abs(d - countyHh[i]) <= tiers, `year ${proj.years[i]}: county demand ${d} vs DOLA ${Math.round(countyHh[i])}`);
  });
});

test('a place that cannot be scaled says its households are county-level', () => {
  // No usable place population series: nothing to scale by.
  const { charts, note } = render('place', null);
  const demand = tierTotals(charts.chartHouseholdDemand);
  const tiers = charts.chartHouseholdDemand.data.datasets.length;
  assert(Math.abs(demand[0] - countyHh[0]) <= tiers, 'unscalable place did not fall back to the county series');
  // The claim that must hold, not a particular sentence: it says the data is
  // county-level, and it does not say it was scaled to the place.
  const text = note('chartHouseholdDemand');
  assert(/County data shown for this place/.test(text) && !/Scaled to this place/.test(text),
    'an unscaled county series under a place heading is not disclosed as county data: ' + text);
});

if (failures) { console.log(`\n${failures} failed`); process.exit(1); }
console.log('\nhna-household-demand-place-scaling: PASS');
