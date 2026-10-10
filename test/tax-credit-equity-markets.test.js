'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const root = path.join(__dirname, '..');
const componentPath = path.join(root, 'js', 'components', 'tax-credit-equity-markets.js');
const componentSrc = fs.readFileSync(componentPath, 'utf8');
const provenanceSrc = fs.readFileSync(path.join(root, 'js', 'provenance-label.js'), 'utf8');

function readJson(relPath) {
  return JSON.parse(fs.readFileSync(path.join(root, relPath), 'utf8'));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function waitForRender() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function installFetch(window, overrides = {}) {
  const payloads = {
    'data/policy/tax-credit-legislation.json': overrides.legislation || readJson('data/policy/tax-credit-legislation.json'),
    'data/market/tax-credit-transfer-pricing.json': overrides.transferPricing || readJson('data/market/tax-credit-transfer-pricing.json'),
    'data/market/novogradac-equity-pricing.json': overrides.lihtcBenchmark || readJson('data/market/novogradac-equity-pricing.json'),
    'data/market/lihtc-equity-pricing-history.json': overrides.lihtcHistory || readJson('data/market/lihtc-equity-pricing-history.json')
  };
  window.resolveAssetUrl = (url) => url;
  window.fetch = (url) => {
    const key = String(url).replace(/^http:\/\/127\.0\.0\.1\//, '');
    if (!Object.prototype.hasOwnProperty.call(payloads, key)) {
      return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
    }
    return Promise.resolve({ ok: true, status: 200, json: async () => clone(payloads[key]) });
  };
}

async function renderArticle(overrides) {
  const html = fs.readFileSync(path.join(root, 'article-pricing.html'), 'utf8');
  const dom = new JSDOM(html, {
    url: 'http://127.0.0.1/article-pricing.html',
    runScripts: 'outside-only',
    pretendToBeVisual: true
  });
  installFetch(dom.window, overrides);
  dom.window.eval(provenanceSrc);
  dom.window.eval(componentSrc);
  dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
  await waitForRender();
  await waitForRender();
  return dom;
}

async function renderCra() {
  const html = fs.readFileSync(path.join(root, 'cra-expansion-analysis.html'), 'utf8');
  const dom = new JSDOM(html, {
    url: 'http://127.0.0.1/cra-expansion-analysis.html',
    runScripts: 'outside-only',
    pretendToBeVisual: true
  });
  installFetch(dom.window);
  dom.window.eval(provenanceSrc);
  dom.window.eval(componentSrc);
  dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
  await waitForRender();
  await waitForRender();
  return dom;
}

console.log('\nTax Credit Equity Markets render tests');
console.log('='.repeat(46));

(async () => {
  const dom = await renderArticle();
  const doc = dom.window.document;
  const bodyText = doc.body.textContent.replace(/\s+/g, ' ');

  assert.strictEqual(doc.querySelector('h1').textContent.trim(), 'Tax Credit Equity Markets', 'article is retitled in place');
  assert(doc.querySelector('[data-tax-credit-equity-markets]'), 'article has equity-markets root');
  assert(!doc.querySelector('#dcEquityForecast'), 'the article does not copy the calculator forecast');
  assert.strictEqual(doc.querySelector('[data-workflow-link="equity-deal"]').getAttribute('href'),
    'deal-calculator.html#dc-equity-price', 'pricing assumptions link to the calculator');
  assert(doc.querySelector('#tceHistoryChart svg'), 'LIHTC history chart renders from JSON');
  assert(bodyText.includes('2026-Q2'), 'history chart exposes the current quarterly vintage');
  // The history chart has readable axes, and they agree with the file it
  // draws: the y range spans every price, the x ticks are the file's years,
  // and the legend's latest values are the last quarter's. (2026-10-09: it
  // shipped with neither axis.)
  {
    const hist = readJson('data/market/lihtc-equity-pricing-history.json').quarterly;
    const svg = doc.querySelector('#tceHistoryChart svg');
    const ticks = (axis) => Array.from(svg.querySelectorAll('[data-axis="' + axis + '"] [data-tick]')).map((t) => t.textContent.trim());
    const yTicks = ticks('y').map((t) => Number(t.replace('$', '')));
    assert(yTicks.length >= 2 && yTicks.every(Number.isFinite), 'y axis has dollar tick labels: ' + ticks('y').join(' '));
    const prices = hist.flatMap((r) => [r.nine, r.four]);
    assert(Math.min(...yTicks) <= Math.min(...prices) && Math.max(...yTicks) >= Math.max(...prices),
      'y axis range covers every price in the file');
    const years = Array.from(new Set(hist.filter((r) => /Q1$/.test(r.quarter)).map((r) => r.quarter.slice(0, 4))));
    assert.deepStrictEqual(ticks('x'), years, 'x axis ticks are the years in the file');
    assert(svg.querySelector('[data-axis="y"] [data-axis-title]').textContent.trim(), 'y axis has a title');
    const legend = svg.querySelector('[data-legend]').textContent;
    const lastRow = hist[hist.length - 1];
    assert(legend.includes('$' + lastRow.nine.toFixed(2)) && legend.includes('$' + lastRow.four.toFixed(2)), 'legend shows the latest 9% and 4% prices');
  }
  // The table shows the file's prices, whatever they are this quarter.
  const bench = readJson('data/market/novogradac-equity-pricing.json');
  const tableText = doc.querySelector('#tceNovogradacTable').textContent.replace(/\s+/g, ' ');
  const money = (v) => '$' + v.toFixed(2);
  assert(tableText.includes(money(bench.pricing.national_avg.credit_9pct)), 'Novogradac national 9% benchmark renders');
  assert(tableText.includes(money(bench.pricing.national_avg.credit_4pct)), 'Novogradac national 4% benchmark renders');
  const coRow = Array.from(doc.querySelectorAll('#tceNovogradacTable tbody tr'))
    .find((tr) => tr.cells[0].textContent.trim() === bench.pricing.by_state.CO.label);
  assert(coRow, 'Colorado row renders');
  assert.strictEqual(coRow.cells[3].textContent.trim(), money(bench.pricing.by_state.CO.median_all_credits), 'Colorado median renders from the file');
  assert.strictEqual(coRow.cells[1].textContent.trim(), 'Not published', 'an unpublished 9% split reads as not published, not $0.00');
  const regionRows = Array.from(doc.querySelectorAll('#tceNovogradacTable tbody tr')).filter((tr) => / region/.test(tr.cells[0].textContent));
  assert.strictEqual(regionRows.length, Object.keys(bench.pricing.by_region).length, 'one row per Novogradac region');
  assert(!/\$0\.00/.test(tableText), 'no unknown price renders as $0.00');

  // State QAP table: one row per plan; a figure only where the plan states one.
  const qap = bench.state_qap_pricing;
  const qapRows = Array.from(doc.querySelectorAll('#tceQapTable [data-qap-state]'));
  assert.strictEqual(qapRows.length, qap.entries.length, 'one row per state plan');
  assert(qapRows.length > 0, 'the QAP scan found plans to check');
  for (const entry of qap.entries) {
    const row = doc.querySelector(`#tceQapTable [data-qap-state="${entry.state}"]`);
    const shown = row.cells[1].textContent.trim();
    if (entry.price_low > 0 && entry.price_high > 0) assert.strictEqual(shown, money(entry.price_low) + '–' + money(entry.price_high), `${entry.state} range`);
    else if (entry.price_assumed > 0) assert.strictEqual(shown, money(entry.price_assumed), `${entry.state} assumed price`);
    else if (entry.price_low > 0) assert.strictEqual(shown, money(entry.price_low) + ' or more', `${entry.state} floor`);
    else assert.strictEqual(shown, 'Not stated', `${entry.state} states no figure`);
    assert.strictEqual(row.querySelector('a').getAttribute('href'), entry.source_url, `${entry.state} links its plan`);
  }
  assert.strictEqual(doc.querySelector('#tceQapTable [data-qap-state="CO"]').cells[1].textContent.trim(), 'Not stated', 'Colorado publishes no QAP price');
  // The summary's comparison quotes medians that must match the benchmark it compares against.
  for (const [label, value] of [['North Central', bench.pricing.by_region.north_central.median_all_credits],
    ['Colorado', bench.pricing.by_state.CO.median_all_credits], ['Southwest', bench.pricing.by_region.southwest.median_all_credits]]) {
    assert(qap.summary.includes(`${money(value)} ${label}`), `QAP summary quotes the ${label} median the file holds`);
  }
  assert(doc.getElementById('tceQapSummary').textContent.includes(qap.checked), 'summary shows when the plans were checked');
  assert(doc.querySelector('[data-transfer-id="itc-transfer-investment-grade-2025"]'), 'ITC transfer market row renders');
  assert(doc.querySelector('[data-transfer-id="nmtc-equity-pricing"]'), 'NMTC unverified pricing row renders');
  // A row whose low and high are one figure is an average, never shown as a range.
  const transfer = readJson('data/market/tax-credit-transfer-pricing.json');
  const averages = transfer.markets.filter((m) => m.price_low != null && m.price_low === m.price_high);
  assert(averages.length > 0, 'the transfer scan found averages to check');
  for (const m of averages) {
    const cell = doc.querySelector(`[data-transfer-id="${m.id}"]`).cells[2].textContent.trim();
    assert.strictEqual(cell, `$${Math.round(m.price_low * 1000) / 1000} average`, `${m.id} shows its average`);
  }
  assert(doc.querySelector('[data-policy-id="cra-2025-rescission-npr"]'), 'CRA rescission NPR policy card renders');
  assert(doc.querySelector('[data-policy-id="obbba-lihtc-ceiling-12pct"]'), 'LIHTC enacted policy card renders');

  const explainerRows = Array.from(doc.querySelectorAll('#tceExplainerMatrix [data-credit-row]'));
  assert.strictEqual(explainerRows.length, 6, 'explainer matrix renders one row for each credit type');
  ['lihtc-9', 'lihtc-4', 'htc', 'nmtc', 'itc', 'ptc'].forEach((id) => {
    assert(doc.querySelector(`#tceExplainerMatrix [data-credit-row="${id}"]`), `explainer row present: ${id}`);
  });
  assert(bodyText.includes('10-year credit stream'), 'LIHTC §42 10-year stream appears');
  assert(bodyText.includes('15-year compliance'), 'LIHTC §42 15-year compliance appears');
  assert(bodyText.includes('ratably over 5 years'), 'HTC §47 timing appears');
  assert(bodyText.includes('39% over 7 years'), 'NMTC §45D timing appears');
  assert(bodyText.includes('5% for the first 3 years'), 'NMTC 5%/6% schedule appears');
  assert(bodyText.includes('§6418 transfer proceeds are excluded from seller income'), '§6418 seller exclusion sentence appears');
  assert(bodyText.includes('buyer discount is not taxed as income'), '§6418 buyer-discount tax sentence appears');
  assert(bodyText.includes('§6417 provides elective-pay treatment'), '§6417 direct-pay note appears');

  const emptyTransfer = readJson('data/market/tax-credit-transfer-pricing.json');
  emptyTransfer.markets = [];
  const emptyTransferDom = await renderArticle({ transferPricing: emptyTransfer });
  assert.strictEqual(
    emptyTransferDom.window.document.querySelectorAll('[data-transfer-id]').length,
    0,
    'non-vacuous proof: empty transfer-pricing JSON removes transfer rows'
  );

  const emptyLegislation = readJson('data/policy/tax-credit-legislation.json');
  emptyLegislation.entries = [];
  const emptyLegislationDom = await renderArticle({ legislation: emptyLegislation });
  assert.strictEqual(
    emptyLegislationDom.window.document.querySelectorAll('[data-policy-id]').length,
    0,
    'non-vacuous proof: empty policy JSON removes watchlist cards'
  );

  const craDom = await renderCra();
  const craText = craDom.window.document.body.textContent.replace(/\s+/g, ' ');
  assert(craText.includes('July 18, 2025 notice of proposed rulemaking'), 'CRA page status copy names the rescission NPR');
  assert(craDom.window.document.querySelector('[data-policy-id="cra-2025-rescission-npr"]'), 'CRA page renders shared watchlist');
  const craIds = Array.from(craDom.window.document.querySelectorAll('[data-policy-id]'))
    .map((node) => node.getAttribute('data-policy-id'));
  assert(craIds.length > 0, 'CRA watchlist rendered entries');
  assert(
    !craIds.includes('obbba-25c-25d-termination') && !craIds.includes('nhia-119th-congress'),
    'data-tax-credit-watch scope attribute filters out homebuyer entries on the CRA page'
  );
  assert(!craText.includes('Medium-Low (25%)'), 'CRA page no longer shows stale hardcoded passage probability card');

  // Research & Analysis cards render from data/insights/catalog.json.
  const catalog = JSON.parse(fs.readFileSync(path.join(root, 'data', 'insights', 'catalog.json'), 'utf8'));
  const pricingCard = catalog.entries.find((e) => e.url === 'article-pricing.html');
  assert(pricingCard, 'Research & Analysis lists the equity markets page');
  assert.strictEqual(pricingCard.title, 'Tax Credit Equity Markets', 'Research & Analysis uses the page title');
  assert(pricingCard.summary.includes('federal policy watchlist'), 'Research & Analysis card describes the data-backed policy watch');

  console.log('All Tax Credit Equity Markets render tests passed.');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
