'use strict';

const assert = require('assert');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const root = path.resolve(__dirname, '..');
const dataPath = path.join(root, 'data', 'market', 'colorado-foreclosure-performance.json');
const htmlPath = path.join(root, 'colorado-deep-dive.html');
const data = require(dataPath);
const html = fs.readFileSync(htmlPath, 'utf8');

function latestPoints(key) {
  return data.series[key].points.slice(-12);
}

function extractDeepDiveChartScript() {
  const scripts = [];
  const re = /<script(?:\s[^>]*)?>([\s\S]*?)<\/script\s*>/gi;
  let match;
  while ((match = re.exec(html))) {
    if (match[1].includes('safeChart("foreclosure-chart"') ||
        match[1].includes('colorado-foreclosure-performance.json')) {
      scripts.push(match[1]);
    }
  }
  assert.strictEqual(scripts.length, 1, 'exactly one foreclosure chart render script found');
  return scripts[0];
}

async function renderForeclosureChart(foreclosureData) {
  const dom = new JSDOM('<canvas id="foreclosure-chart"></canvas><p id="foreclosureChartSource"></p><div id="foreclosureRiskLevel"></div><div id="foreclosureRiskTile"></div><div id="foreclosureRiskSummary"></div><div id="foreclosureProcessMetric"></div><div id="foreclosureLeadMetric"></div><p id="foreclosureNarrative"></p><canvas id="ami-need-chart"></canvas><canvas id="concessions-chart"></canvas>', {
    url: 'http://127.0.0.1/colorado-deep-dive.html',
    runScripts: 'outside-only'
  });
  const chartCalls = [];
  const { window } = dom;
  window.console = console;
  window.getComputedStyle = () => ({ getPropertyValue: () => '' });
  window.Chart = function Chart(el, cfg) {
    chartCalls.push({ id: el.id, cfg });
  };
  window.fetch = (url) => {
    const text = String(url);
    if (text.includes('colorado-foreclosure-performance.json')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(foreclosureData) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ statewide: null, meta: {} }) });
  };
  window.eval(extractDeepDiveChartScript());
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
  return { window, chartCalls };
}

(async () => {
  assert.strictEqual(data.schema, 'colorado-foreclosure-performance/v1', 'foreclosure schema is versioned');
  assert.strictEqual(data.meta.source, 'FHFA National Mortgage Database (NMDB) Residential Mortgage Performance Statistics', 'FHFA NMDB is the source');
  assert.strictEqual(data.series.foreclosure_process_pct.series_id, 'PFORECL', 'primary series is PFORECL');
  assert(data.series.foreclosure_process_pct.points.length >= 90, 'foreclosure series is non-vacuous');
  assert(data.series.serious_delinquency_pct.points.length >= 90, 'serious delinquency context is non-vacuous');
  assert(/^\d{4}-\d{2}-\d{2}$/.test(data.meta.review_by), 'review_by is ISO formatted');
  assert(data.meta.verification_notes.some((note) => /DOLA/.test(note.source) && /no current foreclosure\/NED county report/.test(note.result)), 'DOLA verification disposition is documented');

  assert(!html.includes('data:[70, 55, 62, 68]'), 'old hardcoded foreclosure index is absent');
  assert(!html.includes('data:[70,55,62,68]'), 'old hardcoded foreclosure index is absent without spaces');
  assert(!/ATTOM Foreclosure Data|monthly filing count|56% of pre-pandemic/.test(html), 'stale ATTOM filing copy is absent');
  assert(html.includes('data/market/colorado-foreclosure-performance.json'), 'page fetches foreclosure JSON artifact');
  assert(html.includes('FHFA NMDB Residential Mortgage Performance Statistics'), 'page labels source as FHFA NMDB');

  const rendered = await renderForeclosureChart(data);
  const foreclosureCall = rendered.chartCalls.find((call) => call.id === 'foreclosure-chart');
  assert(foreclosureCall, 'foreclosure chart renders from JSON');
  assert.deepStrictEqual(
    foreclosureCall.cfg.data.labels,
    latestPoints('foreclosure_process_pct').map((p) => p.period),
    'chart labels use the latest JSON quarters'
  );
  assert.deepStrictEqual(
    foreclosureCall.cfg.data.datasets[0].data,
    latestPoints('foreclosure_process_pct').map((p) => p.value_pct),
    'chart primary dataset uses PFORECL JSON values'
  );
  assert.deepStrictEqual(
    foreclosureCall.cfg.data.datasets[1].data,
    latestPoints('serious_delinquency_pct').map((p) => p.value_pct),
    'chart context dataset uses P90DL JSON values'
  );
  assert(rendered.window.document.getElementById('foreclosureNarrative').textContent.includes('0.1%'), 'risk narrative uses JSON summary value');

  const empty = JSON.parse(JSON.stringify(data));
  empty.series.foreclosure_process_pct.points = [];
  const emptyRendered = await renderForeclosureChart(empty);
  assert(!emptyRendered.chartCalls.some((call) => call.id === 'foreclosure-chart'), 'empty foreclosure JSON does not render a chart');

  const freshnessOutput = execFileSync(process.execPath, [path.join(root, 'scripts', 'audit', 'benchmark-freshness-check.mjs')], {
    cwd: root,
    env: { ...process.env, BENCHMARK_FRESHNESS_NOW: '2026-10-18' },
    encoding: 'utf8'
  });
  assert(freshnessOutput.includes('Colorado foreclosure performance: review_by 2026-10-17 at meta.review_by has passed'), 'freshness audit warns on expired foreclosure review_by');

  console.log('Foreclosure performance data/render tests passed.');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
