'use strict';

/**
 * "What moves LIHTC pricing" (article-pricing.html#tceDrivers,
 * js/components/equity-pricing-drivers.js).
 *
 * The section's sentences are computed from the data, so the guards here pin
 * agreement, not copy:
 *   - the statistics reproduce an independent numpy/statsmodels run on frozen
 *     inputs (test/fixtures/equity-pricing-drivers.json);
 *   - every number the page prints equals what analyze() returns for the
 *     committed data files;
 *   - the Deal Calculator's "no interest-rate series predicted pricing" line
 *     holds only while analyze() finds no significant Granger result;
 *   - absent inputs are skipped, never read as 0.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'js/components/equity-pricing-drivers.js'), 'utf8');
const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));

let failures = 0;
async function run(name, fn) {
  try { await fn(); console.log('  ✓ ' + name); }
  catch (err) { failures += 1; console.error('  ✗ ' + name + '\n    ' + (err && err.stack || err)); }
}

function loadModule() {
  const dom = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only' });
  dom.window.eval(SRC);
  return dom.window.EquityPricingDrivers;
}

function near(actual, expected, tol, label) {
  assert.ok(typeof actual === 'number' && Math.abs(actual - expected) <= tol,
    label + ': expected ' + expected + ' ± ' + tol + ', got ' + actual);
}

// FRED-shaped observations from a { 'YYYY-MM': value } map (one obs a month).
function asFred(map) {
  return { observations: Object.keys(map).sort().map((m) => ({ date: m + '-01', value: String(map[m]) })) };
}

async function renderPage(overrides = {}) {
  const html = fs.readFileSync(path.join(ROOT, 'article-pricing.html'), 'utf8');
  const dom = new JSDOM(html, { url: 'http://127.0.0.1/article-pricing.html', runScripts: 'outside-only', pretendToBeVisual: true });
  const payloads = {
    'data/market/lihtc-equity-pricing-history.json': overrides.history || readJson('data/market/lihtc-equity-pricing-history.json'),
    'data/fred-data.json': overrides.fred || readJson('data/fred-data.json'),
    'data/polymarket-data.json': overrides.polymarket || readJson('data/polymarket-data.json'),
    'data/polymarket-curated.json': readJson('data/polymarket-curated.json'),
    'data/polymarket-history.json': readJson('data/polymarket-history.json')
  };
  dom.window.fetch = (url) => {
    const key = String(url).replace(/^http:\/\/127\.0\.0\.1\//, '');
    if (!(key in payloads)) return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
    return Promise.resolve({ ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(payloads[key])) });
  };
  dom.window.eval(SRC);
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
  return dom;
}

(async () => {
  console.log('equity-pricing-drivers');
  const M = loadModule();
  const S = M.stats;
  const fixture = readJson('test/fixtures/equity-pricing-drivers.json');

  await run('statistics reproduce the independent statsmodels run on frozen inputs', () => {
    const history = { monthly: fixture.pricing };
    const fred = { series: { DGS10: asFred(fixture.rates.DGS10), BAA10Y: asFred(fixture.rates.BAA10Y) } };
    const a = S.analyze(history, fred);
    near(a.driftCentsPerYear.avg, fixture.expected.drift_avg_cents_per_year, 1e-9, 'drift');
    const pricing = S.pricingMonths(history);
    ['DGS10', 'BAA10Y'].forEach((id) => {
      const exp = fixture.expected[id];
      const rates = S.monthlyMeans(fred.series[id].observations);
      // Lead-12 correlation, raw and detrended, recomputed directly.
      const y = [], x = [];
      pricing.forEach((r) => {
        const d = new Date(Date.UTC(+r.month.slice(0, 4), +r.month.slice(5, 7) - 13, 1));
        const k = d.toISOString().slice(0, 7);
        y.push(r.avg); x.push(rates[k]);
      });
      near(S.corr(y, x), exp.raw_lead12, 1e-5, id + ' raw lead 12');
      near(S.corr(S.detrend(y), S.detrend(x)), exp.detrended_lead12, 1e-5, id + ' detrended lead 12');
      // Granger p-values at every lag.
      const dy = [], dx = [];
      for (let i = 1; i < pricing.length; i++) {
        dy.push(pricing[i].avg - pricing[i - 1].avg);
        dx.push(rates[pricing[i].month] - rates[pricing[i - 1].month]);
      }
      Object.keys(exp.granger_p).forEach((lag) => {
        near(S.grangerP(dy, dx, +lag), exp.granger_p[lag], 1e-6, id + ' Granger lag ' + lag);
      });
      const row = a.results.find((r) => r.id === id);
      const minP = Math.min(...Object.values(exp.granger_p));
      near(row.result.granger.p, minP, 1e-6, id + ' best Granger p');
    });
  });

  await run('the Granger test detects a series that really does lead pricing (non-vacuous)', () => {
    // x's change this month becomes pricing's change next month.
    const months = fixture.pricing.map((r) => r.month);
    let seed = 7;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; };
    const xChanges = months.map(() => rnd());
    let level = 0.9, xLevel = 4;
    const monthly = [], xmap = {};
    months.forEach((m, i) => {
      xLevel += xChanges[i];
      xmap[m] = xLevel;
      if (i > 0) level += 0.05 * xChanges[i - 1] + 0.002 * rnd();
      monthly.push({ month: m, nine: level, four: level });
    });
    const a = S.analyze({ monthly }, { series: { DGS10: asFred(xmap) } });
    const row = a.results.find((r) => r.id === 'DGS10');
    assert.ok(row.result.granger.p < 0.001, 'a planted lead must be significant, got p = ' + row.result.granger.p);
    assert.equal(a.grangerSignificant.length, 1);
  });

  await run('absent inputs are skipped, never read as zero', () => {
    const mm = S.monthlyMeans([
      { date: '2024-01-02', value: '4.0' }, { date: '2024-01-03', value: '.' },
      { date: '2024-01-04', value: '' }, { date: '2024-01-05', value: null }, { date: '2024-01-08', value: '5.0' }
    ]);
    assert.equal(mm['2024-01'], 4.5, '"." and blanks are FRED missing markers, not 0');
    const rows = S.pricingMonths({ monthly: [
      { month: '2024-01', nine: 0.9, four: 0.9 },
      { month: '2024-02', nine: null, four: 0.9 },
      { month: '2024-03', nine: 0, four: 0.9 },
      { month: '2024-04', nine: 0.88, four: 0.87 }
    ] });
    assert.deepEqual(rows.map((r) => r.month), ['2024-01', '2024-04']);
    assert.equal(S.analyze({ monthly: [] }, { series: {} }), null, 'no pricing means no analysis, not zeros');
  });

  await run('every number on the page equals analyze() on the committed data', async () => {
    const history = readJson('data/market/lihtc-equity-pricing-history.json');
    const fred = readJson('data/fred-data.json');
    const a = S.analyze(history, fred);
    assert.ok(a && a.months >= 24, 'committed data must produce an analysis');
    const dom = await renderPage();
    const doc = dom.window.document;
    assert.equal(doc.getElementById('tceDriversStatus').textContent, '', 'no load error');
    const sign = (v) => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(2);

    const drift = doc.querySelector('[data-finding="drift"]').textContent;
    assert.ok(drift.includes(a.months + ' months'), drift);
    assert.ok(drift.includes(sign(a.driftCentsPerYear.nine) + '¢') && drift.includes(sign(a.driftCentsPerYear.four) + '¢'), drift);

    const ten = a.results.find((r) => r.id === 'DGS10').result.atStrongestLead;
    const tenText = doc.querySelector('[data-finding="ten-year"]').textContent;
    assert.ok(tenText.includes(sign(ten.raw)) && tenText.includes(sign(ten.detrended)) && tenText.includes(ten.lead + ' month'), tenText);

    const peak = S.sincePeak(a, 'SOFR');
    const peakText = doc.querySelector('[data-finding="since-peak"]').textContent;
    assert.ok(peakText.includes(peak.peakRate.toFixed(2) + '%') && peakText.includes(peak.endRate.toFixed(2) + '%'), peakText);
    assert.ok(peakText.includes('$' + peak.peakPrice.toFixed(2)) && peakText.includes('$' + peak.endPrice.toFixed(2)), peakText);

    const granger = doc.querySelector('[data-finding="granger"]').textContent;
    assert.ok(granger.includes(String(a.grangerTests)), granger);

    const rows = doc.querySelectorAll('#tceDriversTable tbody tr');
    assert.equal(rows.length, M.RATE_SERIES.length, 'one table row per compared series');
    a.results.forEach((r) => {
      const tr = doc.querySelector('#tceDriversTable tr[data-series="' + r.id + '"]');
      assert.ok(tr.textContent.includes(sign(r.result.atStrongestLead.raw)), r.id + ': ' + tr.textContent);
    });

    ['equity-drivers-pricing', 'equity-drivers-rates'].forEach((id) => {
      const svg = doc.querySelector('svg[data-chart="' + id + '"]');
      assert.ok(svg, id + ' chart rendered');
      ['x', 'y'].forEach((axis) => {
        assert.ok(svg.querySelectorAll('[data-axis="' + axis + '"] [data-tick]').length >= 2, id + ' ' + axis + ' axis ticks');
      });
    });
  });

  await run('the Deal Calculator line agrees with the Granger result it cites', () => {
    const panel = fs.readFileSync(path.join(ROOT, 'js/components/equity-forecast-panel.js'), 'utf8');
    const claims = /No interest-rate series predicted pricing/.test(panel);
    assert.ok(/article-pricing\.html#tceDrivers/.test(panel), 'the panel must link the section its claim rests on');
    const a = S.analyze(readJson('data/market/lihtc-equity-pricing-history.json'), readJson('data/fred-data.json'));
    if (claims) {
      assert.equal(a.grangerSignificant.length, 0,
        'the forecast panel says no rate series predicted pricing, but the data now finds: ' +
        a.grangerSignificant.map((r) => r.id).join(', ') + '. Reword the panel.');
    }
    assert.ok(!/2[–-]5¢/.test(panel), 'the unsourced "2–5¢" spread effect must not return');
  });

  await run('market strip reads the curated roles, skips stale and unpriced events', async () => {
    const curated = readJson('data/polymarket-curated.json');
    const poly = readJson('data/polymarket-data.json');
    const expected = curated.events.filter((e) => ['recession', 'fed-decision', 'fed-cuts'].includes(e.role) && poly.events[e.slug] && M.headline(poly.events[e.slug]));
    const dom = await renderPage();
    const cards = dom.window.document.querySelectorAll('#tceDriversMarkets [data-market]');
    assert.deepEqual(Array.from(cards).map((c) => c.getAttribute('data-market')), expected.map((e) => e.slug));
    assert.ok(cards.length >= 1, 'the committed cache should give at least one card');

    const first = expected[0].slug;
    const stale = JSON.parse(JSON.stringify(poly));
    stale.events[first].stale_since = '2026-01-01T00:00:00Z';
    const dom2 = await renderPage({ polymarket: stale });
    assert.ok(!dom2.window.document.querySelector('#tceDriversMarkets [data-market="' + first + '"]'), 'a stale event is not shown as current');

    assert.equal(M.headline({ markets: [{ question: 'x', outcomePrices: 'not json', outcomes: '["Yes","No"]' }] }), null);
    assert.equal(M.headline({ markets: [{ question: 'x', outcomePrices: '[]', outcomes: '["Yes","No"]' }] }), null, 'no price is no headline, not 0%');

    const hist = readJson('data/polymarket-history.json');
    const note = dom.window.document.querySelector('[data-market-history]').textContent;
    assert.ok(note.includes(hist.rows[0].date) && note.includes(hist.rows.length + ' daily snapshots'), note);
  });

  if (failures) { console.error(failures + ' failing'); process.exit(1); }
  console.log('all passed');
})();
