#!/usr/bin/env node
'use strict';
// The Scenario Builder's shaded range: where 2 in 3 past forecasts for a
// place of this size landed, around SDO's line.
//
// 1. data/hna/forecast-error.json is what scripts/hna/build_forecast_error.py
//    writes from SDO's estimates on file, so a new vintage cannot leave it
//    stale unnoticed.
// 2. A second implementation of the error study, here, agrees with it.
// 3. On the page the range is centred on SDO's line, starts at zero width,
//    is the error share of the place's population in homes each year, stops
//    at 20 years, and is said in words under the chart; without the error
//    file the projection still shows, with no range.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const readJson = (rel) => JSON.parse(read(rel));
const fe = readJson('data/hna/forecast-error.json');

// 1. The file is the script's output.
const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'fe-')), 'forecast-error.json');
execFileSync('python3', [path.join(ROOT, 'scripts/hna/build_forecast_error.py'), '--out', tmp], { stdio: 'pipe' });
assert.deepEqual(fe, JSON.parse(fs.readFileSync(tmp, 'utf8')),
  'data/hna/forecast-error.json differs from what build_forecast_error.py writes now; run it');

// 2. The same study, written again: SDO's county estimates, Broomfield and the
//    four counties it came from as one area, every launch year from 1980 with
//    a 10-year base, the average of linear and exponential trend, the 67th
//    percentile of absolute percent error, never falling with years out.
const lines = read('data/hna/source/dola_components_county.csv').split(/\r?\n/);
const head = lines.findIndex((l) => l.startsWith('id,'));
const cols = lines[head].split(',');
const at = (name) => cols.indexOf(name);
const pop = new Map();
for (const l of lines.slice(head + 1)) {
  const c = l.split(',');
  if (c[at('datatype')] !== 'Estimate' || c[at('countyfips')] === '0') continue;
  const area = ['1', '13', '14', '59', '123'].includes(c[at('countyfips')]) ? 'metro' : c[at('countyfips')];
  if (!pop.has(area)) pop.set(area, new Map());
  const y = Number(c[at('year')]);
  pop.get(area).set(y, (pop.get(area).get(y) || 0) + Number(c[at('estimate')]));
}
assert.equal(pop.size, 60, 'SDO estimates give 60 areas');
const classOf = (p) => fe.sizeClasses.findIndex((s) => p >= s.min && (s.max == null || p < s.max));
const errs = fe.sizeClasses.map(() => Array.from({ length: 20 }, () => []));
let last = 0;
for (const s of pop.values()) for (const y of s.keys()) last = Math.max(last, y);
for (const s of pop.values()) {
  for (let L = 1980; L < last; L++) {
    const p0 = s.get(L), pb = s.get(L - 10);
    if (!p0 || !pb) continue;
    for (let h = 1; h <= 20; h++) {
      const actual = s.get(L + h);
      if (!actual) continue;
      const f = ((p0 + (p0 - pb) / 10 * h) + p0 * Math.pow(p0 / pb, h / 10)) / 2;
      errs[classOf(p0)][h - 1].push(Math.abs(f - actual) / actual * 100);
    }
  }
}
const pctl = (v, q) => {
  const a = [...v].sort((x, y) => x - y);
  const k = (a.length - 1) * q, i = Math.floor(k), j = Math.min(i + 1, a.length - 1);
  return a[i] + (a[j] - a[i]) * (k - i);
};
errs.forEach((byH, c) => {
  let worst = 0;
  byH.forEach((e, h) => {
    worst = Math.max(worst, pctl(e, 2 / 3));
    assert(Math.abs(fe.errorPct[c][h] - worst) <= 0.051,
      `size ${c}, ${h + 1} years out: file ${fe.errorPct[c][h]}%, recomputed ${worst.toFixed(2)}%`);
    assert.equal(fe.forecasts[c][h], e.length, `size ${c}, ${h + 1} years out: forecast count`);
  });
});

// 3. The page.
const dom = new JSDOM(`<!doctype html><body>
  <canvas id="sbProjectionChart"></canvas><p id="sbChartEmpty" hidden></p><p id="sbBandNote" hidden></p>
  <table><tbody id="sbResultsBody"></tbody></table>
</body>`, { runScripts: 'outside-only', url: 'http://localhost/hna-scenario-builder.html' });
const w = dom.window;
let drawn = null;
w.Chart = class {
  constructor(canvas, cfg) { drawn = cfg; this.data = cfg.data; this.options = cfg.options; }
  update() { drawn = { data: this.data, options: this.options }; }
  destroy() {}
};
for (const f of ['js/projections/cohort-component-model.js', 'js/projections/scenario-presets.js',
  'js/projections/scenario-storage.js', 'js/projections/scenario-builder.js']) w.eval(read(f));
const SB = w.ScenarioBuilder;
SB.setForecastError(fe);
const note = () => w.document.getElementById('sbBandNote');
const bandSets = () => drawn.data.datasets.filter((d) => d.bandEdge);

const mesaFiles = {
  baselines: { '08077': readJson('data/hna/scenario-baseline/08077.json') },
  projections: { '08077': readJson('data/hna/projections/08077.json') },
};
const ranking = readJson('data/hna/ranking-index.json').rankings;
const fruitaRow = ranking.find((r) => r.geoid === '0828745');
const places = readJson('data/hna/projections/places.json').places;

function check(label, geo, data) {
  const ctx = SB.contextFor(geo, data);
  assert(!ctx.unavailableReason, `${label}: loads`);
  SB.init(ctx);
  const sdo = SB.getResults().baseline;
  const band = SB.bandSeries(sdo, ctx);
  const k = classOf(sdo[0].population);
  assert(k >= 0, `${label}: has a size class`);
  assert.equal(band[0].high, band[0].low, `${label}: no range in the base year`);
  const b = ctx.counties[0].baseline.sdo;
  const v = ctx.counties[0].vacancy;
  for (const i of [1, 10, 20]) {
    const e = fe.errorPct[k][i - 1] / 100;
    const want = e * sdo[i].population * (b.households[i] / (1 - v)) / b.population[i];
    assert(Math.abs((band[i].high - band[i].low) / 2 - want) < 1e-6, `${label} ${sdo[i].year}: half-width ${want.toFixed(1)} homes`);
    assert(Math.abs((band[i].high + band[i].low) / 2 - sdo[i].homesNeeded) < 1e-6, `${label} ${sdo[i].year}: centred on SDO's line`);
  }
  assert(band[1].high - band[1].low < band[20].high - band[20].low, `${label}: wider at 20 years than at 1`);
  assert(band.slice(21).every((x) => x === null), `${label}: no range past 20 years out`);

  // Drawn: a low edge and a high edge that fills down to it, under the lines,
  // one legend entry.
  const sets = Array.from(bandSets());
  assert.deepEqual(Array.from(sets, (d) => d.bandEdge), ['low', 'high'], `${label}: low and high edges drawn`);
  assert.equal(sets[1].fill, '-1', `${label}: the high edge fills to the low edge`);
  assert.equal(drawn.data.datasets.indexOf(sets[1]) - drawn.data.datasets.indexOf(sets[0]), 1, `${label}: edges adjacent, so '-1' is the low edge`);
  assert.equal(sets[1].data[20], Math.round(band[20].high), `${label}: high edge plotted`);
  const filter = drawn.options.plugins.legend.labels.filter;
  const shown = drawn.data.datasets.map((d, i) => filter({ datasetIndex: i }, drawn.data)).filter(Boolean).length;
  assert.equal(shown, drawn.data.datasets.length - 1, `${label}: one legend entry for the range`);
  assert.equal(note().hidden, false, `${label}: the range is said in words`);
  assert.match(note().textContent, new RegExp(`By ${sdo[20].year} that is a population ${Math.round(fe.errorPct[k][19])}% above or below`),
    `${label}: note gives the 20-year error: "${note().textContent}"`);
  console.log(`  ${label}: ${note().textContent}`);
  return band;
}

const mesa = check('Mesa County', { geoid: '08077', name: 'Mesa County', type: 'county' }, mesaFiles);
const fruita = check('Fruita', {
  geoid: '0828745', name: 'Fruita', type: 'place', containingCounty: '08077',
  population: fruitaRow.metrics.population,
}, Object.assign({ ledger: places, cross: {} }, mesaFiles));
assert(fruita[20].high - fruita[20].low < mesa[20].high - mesa[20].low, 'a town’s range is smaller than its county’s');

// On a phone the chart is square, so the lines are not a sliver under the
// legend; on a wider screen it keeps 2:1.
const fakeChart = { options: { aspectRatio: 2 }, resize() {} };
drawn.options.onResize(fakeChart, { width: 390 });
assert.equal(fakeChart.options.aspectRatio, 1, 'square chart at 390px');
drawn.options.onResize(fakeChart, { width: 1200 });
assert.equal(fakeChart.options.aspectRatio, 2, '2:1 chart on a wide screen');

// Without the error file the projection still shows, with no range; when the
// file arrives after a projection, the range is drawn then.
SB.setForecastError(null);
SB.init(SB.contextFor({ geoid: '08077', name: 'Mesa County', type: 'county' }, mesaFiles));
assert(SB.hasProjection(), 'projection shows without the error file');
assert.equal(bandSets().length, 0, 'no range without the error file');
assert.equal(note().hidden, true, 'no range sentence without the error file');
SB.setForecastError(fe);
assert.equal(bandSets().length, 2, 'the range is drawn when the error file arrives after the projection');
assert.equal(note().hidden, false, 'and said in words');

// The page fetches the file on its own, so it never holds up a projection.
const html = read('hna-scenario-builder.html');
assert(/cachedJSON\('data\/hna\/forecast-error\.json'\)\s*\.then\(function \(fe\) \{ window\.ScenarioBuilder\.setForecastError\(fe\); \}\)\s*\.catch\(function \(\) \{\}\);/.test(html),
  'the page loads the error file apart from the projection and passes it to the builder');

console.log(`forecast-error-band: PASS (file matches script and a second implementation; 20-year error ${fe.errorPct.map((r) => r[19] + '%').join(', ')} by size; range centred on SDO's line in Mesa and Fruita)`);
