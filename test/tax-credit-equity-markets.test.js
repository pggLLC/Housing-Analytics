'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const root = path.join(__dirname, '..');
const componentPath = path.join(root, 'js', 'components', 'tax-credit-equity-markets.js');
const componentSrc = fs.readFileSync(componentPath, 'utf8');

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
  assert(doc.querySelector('#dcEquityForecast'), 'article reuses the shared equity forecast mount');
  assert(doc.querySelector('#tceHistoryChart svg'), 'LIHTC history chart renders from JSON');
  assert(bodyText.includes('2026-Q2'), 'history chart exposes the current quarterly vintage');
  assert(bodyText.includes('$0.86'), 'Novogradac national 9% benchmark renders');
  assert(bodyText.includes('$0.84'), 'Novogradac national 4% benchmark renders');
  assert(doc.querySelector('[data-transfer-id="itc-transfer-investment-grade-2025"]'), 'ITC transfer market row renders');
  assert(doc.querySelector('[data-transfer-id="nmtc-equity-pricing"]'), 'NMTC unverified pricing row renders');
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

  const insightsHtml = fs.readFileSync(path.join(root, 'insights.html'), 'utf8');
  assert(insightsHtml.includes('Tax Credit Equity Markets'), 'insights page features the retitled equity markets page');
  assert(insightsHtml.includes('federal policy watchlist'), 'insights card describes the data-backed policy watch');

  console.log('All Tax Credit Equity Markets render tests passed.');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
