/**
 * LIHTC equity pricing: one source for every page that shows it (#2010).
 *
 * Until 2026-10 Insights typed a "Q1 2026" table (9% $0.87, 4% $0.89 — 4%
 * above 9%), the CRA scenario page typed "Q4 2027" prices, a $0.85 calculator
 * baseline and a $0.91–$0.94 weighted figure its own assumptions did not
 * produce, and the Colorado Deep Dive drew eight typed quarters as a
 * "forecast", five of them already past. None agreed with
 * data/market/novogradac-equity-pricing.json, which the Tax Credit Equity
 * Markets page reads.
 *
 * This guard renders the three pages from the committed data and asserts the
 * figures they show equal values recomputed here from the data files — not
 * values taken from the renderer:
 *   - Insights: each price is the file's national price, each QoQ/YoY the
 *     history's, and the as_of shown is the file's;
 *   - CRA: each scenario price is the benchmark price moved by the % range that
 *     card states, the weighted figure is those ranges weighted by the
 *     probabilities the page states, and the probabilities in the hero
 *     agree with the cards;
 *   - Deep Dive: the chart draws exactly the history's recorded quarters;
 *   - the history file ends on the benchmark's vintage, at its prices.
 * It also fails if a typed price or a dated "Q4 2027" projection comes back.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const json = (rel) => JSON.parse(read(rel));
const BASE = 'https://pggllc.github.io/Housing-Analytics/';
const BENCH = json('data/market/novogradac-equity-pricing.json');
const HIST = json('data/market/lihtc-equity-pricing-history.json');
const NAT = BENCH.pricing.national_avg;
const Q = HIST.quarterly;
const money = (v) => '$' + v.toFixed(2);
const pct = (v) => { const p = v * 100; return (p > 0 ? '+' : p < 0 ? '−' : '') + Math.abs(p).toFixed(1) + '%'; };

function render(page, { onWindow } = {}) {
  const charts = [];
  const dom = new JSDOM(read(page), {
    runScripts: 'dangerously', url: BASE + page, pretendToBeVisual: true,
    beforeParse(window) {
      window.fetch = (url) => {
        const p = new URL(String(url), BASE).pathname;
        const rel = p.slice(p.indexOf('data/'));
        if (rel.startsWith('data/') && fs.existsSync(path.join(ROOT, rel))) {
          return Promise.resolve({ ok: true, json: () => Promise.resolve(json(rel)) });
        }
        return Promise.resolve({ ok: false, json: () => Promise.resolve(null) });
      };
      window.console.warn = () => {};
      window.console.error = () => {};
      window.Chart = function (ctx, cfg) { charts.push({ id: ctx.id, cfg }); };
      // Pages set Chart.defaults.* at load; any depth of it is writable here.
      const anyDepth = () => new Proxy({}, { get: (t, k) => (k in t ? t[k] : (t[k] = anyDepth())) });
      window.Chart.defaults = anyDepth();
      window.eval(read('js/components/equity-pricing.js'));
      if (onWindow) onWindow(window);
    },
  });
  return { dom, doc: dom.window.document, charts };
}
const until = async (fn) => { for (let i = 0; i < 400 && !fn(); i++) await new Promise((r) => setTimeout(r, 5)); };

test('the pricing history ends on the benchmark vintage, at the benchmark prices', () => {
  const last = Q[Q.length - 1];
  assert.equal(last.quarter, BENCH.meta.vintage);
  assert.equal(last.nine, NAT.credit_9pct);
  assert.equal(last.four, NAT.credit_4pct);
});

test('Insights prices, QoQ, YoY and as_of come from the data files', async () => {
  const { doc } = render('insights.html');
  await until(() => doc.querySelector('#insightsPricingRows [data-credit]'));
  const rows = [...doc.querySelectorAll('#insightsPricingRows [data-credit]')];
  assert.equal(rows.length, 2, 'one row per credit type the file prices');
  for (const [key, field] of [['nine', 'credit_9pct'], ['four', 'credit_4pct']]) {
    const cells = [...doc.querySelector(`[data-credit="${key}"]`).cells].map((c) => c.textContent.trim());
    const n = Q.length - 1;
    assert.equal(cells[1], money(NAT[field]), `${key} price`);
    assert.equal(cells[2], pct(Q[n][key] / Q[n - 1][key] - 1), `${key} QoQ`);
    assert.equal(cells[3], pct(Q[n][key] / Q[n - 4][key] - 1), `${key} YoY`);
  }
  assert.equal(doc.querySelector('[data-pricing-as-of]').getAttribute('data-pricing-as-of'), BENCH.meta.as_of);
  const static_ = read('insights.html');
  assert.doesNotMatch(static_, /<td[^>]*>\$0\.\d\d<\/td>/, 'no typed price cells');
});

test('CRA scenario figures are the benchmark price moved by the assumptions the page states', async () => {
  const { doc, charts } = render('cra-expansion-analysis.html');
  await until(() => !/computed/i.test(doc.getElementById('cra-weighted').textContent));
  const base = NAT.credit_9pct;
  const cards = [...doc.querySelectorAll('[data-cra-scenario]')];
  assert.equal(cards.length, 4);
  const sc = cards.map((el) => ({
    el, p: Number(el.dataset.probability), lo: Number(el.dataset.lowPct), hi: Number(el.dataset.highPct),
  }));
  assert.equal(sc.reduce((s, x) => s + x.p, 0), 100, 'probabilities sum to 100');

  // The hero's probabilities and each card's badge agree with the card's data.
  const hero = [...doc.querySelectorAll('.hero-stats .stat-value')].map((e) => e.textContent.trim());
  assert.deepEqual(hero, sc.map((x) => x.p + '%'));
  for (const x of sc) {
    assert.match(x.el.querySelector('.chart-header span').textContent, new RegExp('^' + x.p + '% probability'));
    assert.equal(x.el.querySelector('[data-scenario-price]').textContent,
      money(base * (1 + x.lo / 100)) + '–' + money(base * (1 + x.hi / 100)));
  }
  const tot = sc.reduce((s, x) => s + x.p, 0);
  const wlo = sc.reduce((s, x) => s + x.p * x.lo, 0) / tot;
  const whi = sc.reduce((s, x) => s + x.p * x.hi, 0) / tot;
  assert.equal(doc.getElementById('cra-weighted').textContent,
    money(base * (1 + wlo / 100)) + ' – ' + money(base * (1 + whi / 100)));

  // Project equity dollars belong to the calculator, not a copied $3M example.
  assert.equal(doc.querySelectorAll('#cra-calc [data-calc-equity]').length, 0);
  assert.equal(doc.querySelector('[data-workflow-link="cra-deal"]').getAttribute('href'),
    'deal-calculator.html#dc-equity-price');

  // Chart: every line starts at the benchmark price; no dated projection.
  const chart = charts.find((c) => c.id === 'scenarios-chart');
  assert.ok(chart, 'scenario chart drawn');
  for (const ds of chart.cfg.data.datasets) assert.equal(ds.data[0], base);
  // The axis starts at the benchmark's vintage, not at the reader's visit.
  const [y, qn] = BENCH.meta.vintage.split('-Q').map(Number);
  const want = Array.from({ length: 7 }, (_, i) => { const k = y * 4 + qn - 1 + i; return `${Math.floor(k / 4)}-Q${(k % 4) + 1}`; });
  assert.deepEqual([...chart.cfg.data.labels], want, 'scenario axis counts quarters from the benchmark vintage');
  // What a reader sees: the rendered page's text, scripts excluded.
  const main = doc.querySelector('main').cloneNode(true);
  main.querySelectorAll('script').forEach((el) => el.remove());
  assert.ok(main.textContent.includes('Price after six quarters'), 'scan found the scenario cards');
  assert.doesNotMatch(main.textContent, /Q4 2027|\$0\.9\d\s*-\s*\$0\.9\d/, 'no typed projection');
});

test('Deep Dive draws the recorded quarters, not a typed forecast', async () => {
  const { doc, charts } = render('colorado-deep-dive.html');
  await until(() => doc.getElementById('btn-market'));
  doc.getElementById('btn-market').dispatchEvent(new doc.defaultView.MouseEvent('click', { bubbles: true }));
  await until(() => charts.some((c) => c.id === 'mo-pricing-history'));
  const chart = charts.find((c) => c.id === 'mo-pricing-history');
  assert.ok(chart, 'pricing history chart drawn');
  const want = Q.slice(-12);
  assert.deepEqual(chart.cfg.data.labels, want.map((r) => r.quarter));
  assert.deepEqual(chart.cfg.data.datasets[0].data, want.map((r) => r.nine));
  assert.deepEqual(chart.cfg.data.datasets[1].data, want.map((r) => r.four));
  assert.ok(!charts.some((c) => /forecast/.test(c.id)), 'no forecast chart');
  assert.doesNotMatch(read('colorado-deep-dive.html'), /data: \[0\.8\d,/, 'no typed price series');
});

test('legislative equity uplift is unknown (null), never a silent zero or missing', async () => {
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const P = require('../js/lihtc-deal-predictor-enhanced.js');
  const [row] = P.evaluateScenarios([{}]);
  assert.ok('legislativeBoost' in row, 'key present');
  assert.equal(row.legislativeBoost, null);
});

test('legislation does not price equity from unsourced constants', () => {
  assert.doesNotMatch(read('js/lihtc-deal-predictor-enhanced.js'), /LEGISLATIVE_EQUITY_BOOST/);
  assert.doesNotMatch(read('js/cra-expansion-forecast.js'), /getCurrentBills/);
});
