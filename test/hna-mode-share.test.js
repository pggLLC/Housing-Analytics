#!/usr/bin/env node
'use strict';

// The HNA commute mode chart (chartMode) draws what the summary files hold:
// B08301 worker counts when present, the S0801 shares otherwise, and never a
// mode the source does not carry as 0%. Taxi and motorcycle commuters, which
// older summaries leave out of every B08301 mode, show as Other.

const assert = require('node:assert/strict');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
let failures = 0;
function test(name, fn) {
  try { fn(); console.log('  ✓ ' + name); }
  catch (e) { failures += 1; console.log('  ✗ ' + name + ' — ' + e.message); }
}

function render(s0801, counts) {
  const dom = new JSDOM('<canvas id="chartMode"></canvas>', { url: 'http://127.0.0.1/hna-where-its-heading.html' });
  let config = null;
  global.window = dom.window;
  global.document = dom.window.document;
  global.localStorage = dom.window.localStorage;
  global.getComputedStyle = dom.window.getComputedStyle;
  global.Chart = function ChartStub(ctx, c) { config = c; return { destroy() {} }; };
  window.Chart = global.Chart;
  window.HNAState = { charts: {}, els: {} };
  window.HNAUtils = { fmtNum: (v) => String(v), safeNum: (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v))) ? null : Number(v) };
  window.HTMLCanvasElement.prototype.getContext = function getContext() { return { canvas: this }; };
  const abs = path.join(ROOT, 'js/hna/hna-renderers.js');
  delete require.cache[require.resolve(abs)];
  require(abs);
  window.HNARenderers.renderModeShare(s0801, counts);
  const out = {};
  config.data.labels.forEach((l, i) => { out[l] = config.data.datasets[0].data[i]; });
  return { modes: out, subtitle: config.options.plugins.subtitle.text };
}

console.log('\nHNA commute mode share');

test('B08301 counts give every mode as a share of workers', () => {
  // Fruita (0828745) as its summary file holds it.
  const { modes } = render({ _acsYear: 2024 }, { total: 6300, drive: 5033, carpool: 354, transit: 0, bike: 121, walk: 137, other: 9, work_from_home: 646 });
  assert.deepEqual(modes, { 'Drive alone': 79.9, Carpool: 5.6, Transit: 0, Walk: 2.2, Bicycle: 1.9, WFH: 10.3, Other: 0.1 });
});

test('workers no B08301 mode counts (taxi, motorcycle) show as Other', () => {
  // Coal Creek CDP: 1,275 workers, 1,237 across the six named modes.
  const { modes } = render({}, { total: 1275, drive: 1019, carpool: 23, transit: 0, bike: 0, walk: 0, other: 0, work_from_home: 195 });
  assert.equal(modes.Other, 3);
});

test('without counts, S0801 shares come from the 2019+ columns and missing modes are left off', () => {
  // Mesa County's summary: S0801 holds drove alone and carpooled; B08301 is all zeros.
  const { modes, subtitle } = render({ _acsYear: 2024, _acsSeries: 'acs1', S0801_C01_003E: 74.3, S0801_C01_004E: 10.4, S0801_C01_005E: 7.6, S0801_C01_008E: 1.07 },
    { total: 0, drive: 0, carpool: 0, transit: 0, bike: 0, walk: 0, other: 0, work_from_home: 0 });
  assert.deepEqual(modes, { 'Drive alone': 74.3, Carpool: 10.4 });
  assert.match(subtitle, /not in the data: Transit, Walk, Bicycle, WFH, Other/);
});

test('S0801 columns 009-013 are read as transit, walk, bicycle, other and WFH', () => {
  const { modes } = render({ S0801_C01_003E: 70, S0801_C01_004E: 8, S0801_C01_009E: 3, S0801_C01_010E: 4, S0801_C01_011E: 1, S0801_C01_012E: 2, S0801_C01_013E: 12 }, null);
  assert.deepEqual(modes, { 'Drive alone': 70, Carpool: 8, Transit: 3, Walk: 4, Bicycle: 1, WFH: 12, Other: 2 });
});

console.log(failures ? `\nhna-mode-share: ${failures} failed` : '\nhna-mode-share: PASS');
process.exit(failures ? 1 : 0);
