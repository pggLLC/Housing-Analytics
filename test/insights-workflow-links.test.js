'use strict';
// #2011: requested routes, not surrounding prose. Navigation's existing GROUPS
// is the shared page-name source; no second list of expected display strings.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { JSDOM, VirtualConsole } = require('jsdom');
const { openPage, close } = require('./helpers/deal-calculator-page.cjs');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const norm = text => text.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
const ROUTES = [
  ['homebuyers-hna', 'help-for-homebuyers.html', 'housing-needs-assessment.html#affordable-ownership-need-section', 'main'],
  ['homebuyers-study', 'help-for-homebuyers.html', 'for-sale-market-study.html', 'main'],
  ['hna-homebuyers', 'housing-needs-assessment.html', 'help-for-homebuyers.html', '#affordable-ownership-need-section'],
  ['study-homebuyers', 'for-sale-market-study.html', 'help-for-homebuyers.html', 'main'],
  ['legislation-transit', 'housing-legislation-2026.html', 'housing-needs-assessment.html#hnaTransitZonePanel', '#bill-status-cards [role="listitem"]'],
  ['equity-deal', 'article-pricing.html', 'deal-calculator.html#dc-equity-price', 'main'],
  ['deal-equity', 'deal-calculator.html', 'article-pricing.html', '#dc-equity-price'],
  ['cra-deal', 'cra-expansion-analysis.html', 'deal-calculator.html#dc-equity-price', 'main'],
  ['history-deal', 'colorado-deep-dive.html', 'deal-calculator.html', 'main'],
  ['intelligence-market', 'colorado-deep-dive.html', 'market-analysis.html', '#sitesel-heading'],
  ['deep-dive-opportunities', 'colorado-deep-dive.html', 'lihtc-opportunity-finder.html', '.page-hero'],
  ['deep-dive-jurisdiction', 'colorado-deep-dive.html', 'select-jurisdiction.html', '.page-hero'],
];

async function render(file) {
  const dom = new JSDOM(read(file), { url: 'https://cohoanalytics.com/' + file,
    runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: new VirtualConsole() });
  const w = dom.window;
  w.matchMedia = () => ({ matches: false, addEventListener() {} });
  w.fetch = async url => ({ ok: true, json: async () => JSON.parse(read(new URL(url, w.location.href).pathname.slice(1))) });
  w.eval(read('js/navigation.js'));
  if (file === 'housing-legislation-2026.html') {
    w.eval(read('js/legislative-tracker.js'));
    const scripts = [...w.document.scripts].filter(s => s.textContent.includes('Populate bill-status-cards'));
    assert.equal(scripts.length, 1, 'real legislation card renderer must be exercised');
    w.eval(scripts[0].textContent);
  }
  w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
  await new Promise(resolve => setTimeout(resolve, 40));
  return dom;
}

test('all 12 contextual routes use existing canonical targets and shared page names', async () => {
  const pages = new Map();
  let deal;
  try {
    deal = await openPage('#dc-equity-price');
    const names = deal.w.WorkflowPageNames;
    assert.ok(names && Object.keys(names).length > 20, 'shared nav-name source did not load');
    for (const file of new Set(ROUTES.map(r => r[1]))) {
      if (file !== 'deal-calculator.html') pages.set(file, await render(file));
    }
    const checked = new Set();
    for (const [id, from, expected, selector] of ROUTES) {
      const doc = from === 'deal-calculator.html' ? deal.d : pages.get(from).window.document;
      const links = [...doc.querySelectorAll(`[data-workflow-link="${id}"]`)];
      assert.equal(links.length, 1, `${id}: expected one contextual link`);
      const a = links[0], href = a.getAttribute('href');
      const [file, anchor] = href.split('#');
      assert.doesNotMatch(file, /^hna-.*\.html$/, `${id}: generated HNA view is not canonical`);
      assert.ok(fs.existsSync(path.join(root, file)), `${id}: missing target file ${file}`);
      // The calculator builds its inputs at runtime: load the real target page,
      // not a fixture containing the id. Other anchors are in the canonical HTML.
      const target = file === 'deal-calculator.html' ? deal.d : new JSDOM(read(file)).window.document;
      if (anchor) assert.ok(target.getElementById(anchor), `${id}: target anchor #${anchor} is missing from ${file}`);
      assert.equal(href, expected, `${id}: points at the wrong workflow step`);
      assert.ok(names[file], `${file}: no shared navigation name`);
      const label = (a.querySelector('[data-page-name]') || a).textContent.trim();
      assert.equal(label, names[file], `${id}: link name disagrees with shared navigation`);
      assert.ok(norm(target.title).includes(norm(names[file])), `${file}: title does not name its nav destination`);
      let host = doc.querySelector(selector);
      if (id === 'deal-equity') host = host.closest('label');
      if (id === 'intelligence-market') host = host.closest('section');
      if (id === 'legislation-transit') {
        host = a.closest('[role="listitem"]');
        const bills = JSON.parse(read('data/policy/tax-credit-legislation.json')).entries;
        const bill = bills.find(b => b.id === 'hb26-1065-transit-housing-investment-zones');
        assert.ok(host.textContent.includes(bill.title), 'transit link is not in the HB26-1065 card');
      }
      assert.ok(host && host.contains(a), `${id}: link is outside its decision context`);
      checked.add(id);
    }
    assert.equal(checked.size, ROUTES.length, 'every requested direction must be checked');
    const actualCount = [...pages.values()].reduce((n, p) => n + p.window.document.querySelectorAll('[data-workflow-link]').length, 0)
      + deal.d.querySelectorAll('[data-workflow-link]').length;
    assert.equal(actualCount, ROUTES.length, 'an added contextual link escaped the target/name scan');
    assert.equal(deal.d.getElementById('dc-equity-price').closest('details').open, true,
      'incoming equity link must reveal the input inside Assumptions');
    console.log(`Checked ${checked.size} contextual links, their names, and all destination anchors.`);
  } finally {
    for (const dom of pages.values()) dom.window.close();
    close();
  }
});

test('Insights leave project equity figures in the calculator', () => {
  const cra = new JSDOM(read('cra-expansion-analysis.html')).window.document;
  assert.equal(cra.querySelectorAll('#cra-calc, [data-calc-equity], [data-credit-amount]').length, 0);
  assert.ok(cra.querySelector('[data-workflow-link="cra-deal"]'));
  const article = new JSDOM(read('article-pricing.html')).window.document;
  assert.equal(article.querySelectorAll('#dcEquityForecast, script[src="js/components/equity-forecast-panel.js"]').length, 0);
  assert.ok(article.querySelector('[data-workflow-link="equity-deal"]'));
});

test('Insights titles, sitemap and research catalog agree with the shared page names', async () => {
  const dom = await render('help-for-homebuyers.html');
  try {
    const names = dom.window.WorkflowPageNames;
    const files = ['help-for-homebuyers.html', 'housing-legislation-2026.html', 'article-pricing.html',
      'cra-expansion-analysis.html', 'colorado-deep-dive.html'];
    const sitemap = new JSDOM(read('sitemap.html')).window.document;
    const catalog = JSON.parse(read('data/insights/catalog.json')).entries;
    let checked = 0;
    for (const file of files) {
      const page = new JSDOM(read(file)).window.document;
      assert.equal(page.title.split('|')[0].trim(), names[file], `${file}: title drifted from its shared name`);
      const card = sitemap.querySelector(`a.site-card[href="${file}"] .site-card-name`);
      assert.ok(card, `${file}: missing sitemap card`);
      assert.equal(card.textContent.trim(), names[file], `${file}: sitemap label drifted`);
      const entry = catalog.find(e => e.url === file);
      assert.ok(entry, `${file}: missing catalog entry`);
      assert.equal(entry.title, names[file], `${file}: catalog label drifted`);
      checked++;
    }
    // Page-name links (as opposed to action sentences) throughout authored
    // top-level pages must use these same names. Generated views are excluded.
    const generated = new Set(JSON.parse(read('data/hna/hna-views.json')).views.map(v => v.slug));
    let labels = 0;
    const small = new Set(['and', 'of', 'the', 'for', 'to', 'a', 'an', 'on', 'in', '&', 'vs']);
    for (const file of fs.readdirSync(root).filter(f => f.endsWith('.html') && !generated.has(f))) {
      const page = new JSDOM(read(file)).window.document;
      for (const a of page.querySelectorAll('a[href]')) {
        const target = a.getAttribute('href').split('#')[0];
        if (!files.includes(target) || a.closest('.breadcrumb')) continue;
        const label = (a.querySelector('.site-card-name') || a).textContent.replace(/[→←↗]/g, '').replace(/\s+/g, ' ').trim();
        const words = label.split(' ');
        if (words.length > 8 || !words.every(w => small.has(w.toLowerCase()) || /^[A-Z0-9&(]/.test(w))) continue;
        assert.equal(label, names[target], `${file}: page-name link to ${target} drifted`);
        labels++;
      }
    }
    assert.equal(checked, files.length);
    assert.ok(labels >= 20, `only ${labels} authored page-name links scanned`);
    console.log(`Checked ${checked} page titles/catalog/sitemap labels and ${labels} authored page-name links.`);
  } finally { dom.window.close(); }
});
