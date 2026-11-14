#!/usr/bin/env node
/**
 * Redirect group A and county costs (paul, 14 Nov 2026): 16 old pages whose content now lives in a hub view.
 *
 * js/path-resolver.js, the first script those pages load, does two things:
 *  1. an old address forwards to its view, carrying a place, a deal or a comparison; never inside a
 *     frame, never with ?classic=1 (the page as written), and never while select-jurisdiction.html picks
 *     a place for another page;
 *  2. on the pages that stay, links to those pages and to the written guides are pointed at the views.
 *
 * This test holds the list, the hubs that draw each view, the lab's own list (hub/nav.js, which points the
 * hub views' links the same way) and the old header menus (js/navigation.js) in agreement.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { ARRIVE_WITH } from '../scripts/audit/lib/arrive-with.mjs';

const require = createRequire(import.meta.url);
const { JSDOM } = require('jsdom');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

let failed = 0;
function test(name, fn) {
  try { fn(); console.log('  ok  ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + String(e.message).split('\n').join('\n       ')); }
}

const resolver = read('js/path-resolver.js');
const MOVED = vm.runInNewContext('(' + /var MOVED_PAGES = (\{[^;]*\});/.exec(resolver)[1] + ')');
const config = read('hub/lab-config.js');
const HUBS = JSON.parse(/var HUBS = (\{.*?\}), STARTS = /s.exec(config)[1]);
const drawn = (page, route) => (HUBS[page] || []).some((re) => new RegExp(re).test(route) || new RegExp(re).test(route + '/'));

// Run js/path-resolver.js as a page at `url` would, with `html` as the page body.
function load(url, html = '', framed = false) {
  const u = new URL(url);
  const dom = new JSDOM('<!doctype html><body>' + html + '</body>', { url });
  let went = null;
  const location = { href: u.href, pathname: u.pathname, search: u.search, hash: u.hash, host: u.host, hostname: u.hostname, protocol: u.protocol, replace: (to) => { went = to; } };
  const win = { location, addEventListener() {}, MutationObserver: dom.window.MutationObserver };
  win.self = win; win.top = framed ? {} : win;
  const ctx = vm.createContext({ window: win, document: dom.window.document, URL, URLSearchParams, Array, Object, String, RegExp, setTimeout });
  vm.runInContext(resolver, ctx);
  // The page finishes parsing (jsdom is still 'loading' while the script runs, as a real head script is).
  dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
  return { went, doc: dom.window.document, win };
}
const SITE = 'https://cohoanalytics.com/';

test('every forwarded page exists, loads the forwarding script in its head, and its view is drawn by the hub named', () => {
  const pages = Object.keys(MOVED);
  assert.equal(pages.length, 16, 'group A is 15 pages, plus county costs');
  for (const p of pages) {
    const html = read(p), head = html.slice(0, html.indexOf('</head>'));
    assert.ok(/<script src="js\/path-resolver\.js"><\/script>/.test(head), p + ' does not load js/path-resolver.js in its head');
    const [hub, hash] = MOVED[p].split('#');
    assert.ok(fs.existsSync(path.join(ROOT, hub)), hub + ' is missing');
    assert.ok(drawn(hub, '#' + hash), hub + ' does not draw #' + hash + ' (hub/lab-config.js HUBS)');
  }
});

test('the lab list (hub/nav.js) sends each forwarded page to the same view', () => {
  const nav = read('hub/nav.js');
  const LAB = vm.runInNewContext('(' + /var MOVED = (\{[^;]*\});/.exec(nav)[1] + ')');
  for (const [p, to] of Object.entries(MOVED)) assert.equal(LAB[p], '#' + to.split('#')[1], p + ': lab ' + LAB[p] + ', site ' + to);
});

test('an old address forwards, carrying its place, deal or comparison', () => {
  assert.equal(load(SITE + 'policy-briefs.html').went, 'policy-hub.html#/news');
  assert.equal(load(SITE + 'deal-summary.html?d=101-main-frisco').went, 'deal-hub.html#/deals/101-main-frisco');
  assert.equal(load(SITE + 'compare.html?jurisdictions=0828745,0831660&target=9pct').went, 'places-hub.html#/places/compare?g=0828745,0831660&t=9pct');
  assert.equal(load(SITE + 'hna-scenario-builder.html?geoid=0828745').went, 'places-hub.html#/places/scenario?g=0828745');
  assert.equal(load(SITE + 'recommendation.html?fips=08077').went, 'deal-hub.html#/recommendation?g=08077');
  // Targets with an underscore are compare.js targets too (Codex P2 on #2875).
  for (const t of ['workforce_resort', 'prop123_local']) assert.equal(load(SITE + 'compare.html?jurisdictions=0828745&target=' + t).went, 'places-hub.html#/places/compare?g=0828745&t=' + t);
  assert.equal(load(SITE + 'compare.html?jurisdictions=%3Cscript%3E').went, 'places-hub.html#/places/compare', 'a bad place code is dropped');
  assert.equal(load(SITE + 'select-jurisdiction.html').went, 'places-hub.html#/places');
});

test('not forwarded: ?classic=1, inside a frame, the picker while another page uses it, pages that stay', () => {
  assert.equal(load(SITE + 'data-map-browser.html?classic=1').went, null, 'classic');
  assert.equal(load(SITE + 'commuting.html', '', true).went, null, 'frame');
  for (const q of ['?next=market-analysis.html', '?step=2', '?new=1', '?classic=1']) assert.equal(load(SITE + 'select-jurisdiction.html' + q).went, null, 'picker ' + q);
  for (const p of ['housing-needs-assessment.html', 'market-analysis.html', 'deal-calculator.html', 'economic-dashboard.html']) assert.equal(load(SITE + p).went, null, p);
});

test('on a page that stays, links to forwarded pages and guides point at the views; others are left alone', () => {
  const { doc, went } = load(SITE + 'housing-needs-assessment.html?geoid=0828745',
    '<a id="a" href="preservation.html">x</a><a id="b" href="recommendation.html?geoid=0828745">x</a>' +
    '<a id="c" href="https://cohoanalytics.com/methods.html#m-sampling-error">x</a><a id="d" href="select-jurisdiction.html?classic=1">x</a>' +
    '<a id="e" href="data-map-browser.html?classic=1">x</a><a id="f" href="market-analysis.html">x</a><a id="g" href="#top">x</a>' +
    '<a id="h" href="https://example.com/compare.html">x</a><a id="i" href="select-jurisdiction.html?new=1">x</a>');
  assert.equal(went, null);
  const h = (id) => doc.getElementById(id).getAttribute('href');
  assert.equal(h('a'), SITE + 'opportunities-hub.html#/opportunity/preservation');
  assert.equal(h('b'), SITE + 'deal-hub.html#/recommendation?g=0828745');
  assert.equal(h('c'), SITE + 'policy-hub.html#/guide/methods?at=m-sampling-error');
  for (const id of ['d', 'e', 'f', 'g', 'h', 'i']) assert.ok(!/-hub\.html/.test(h(id)), id + ' was rewritten to ' + h(id));
});

// A link drawn after the page loads (a chapter's Next link, a deal card) is pointed at its view as it appears; a
// calculator share link's long hash is not read again for each link (it stalled pages with many links).
const late = load(SITE + 'housing-needs-assessment.html?geoid=0828745', '<div id="m"></div>');
const shared = load(SITE + 'deal-calculator.html#v=1&' + 'tdc=20000000&'.repeat(4000), '<a id="a" href="compare.html">x</a><a id="b" href="deal-market-analysis.html#x">x</a>');
await new Promise((r) => setTimeout(r, 50)); // the pages have finished loading
late.doc.getElementById('m').innerHTML = '<p><a id="z" href="commuting.html">x</a><a id="y" href="market-analysis.html">x</a></p>';
await Promise.resolve(); // a MutationObserver answers before the next task
late.doc.getElementById('y').setAttribute('href', 'hna-scenario-builder.html?geoType=place&geoid=0828745');
await Promise.resolve();
test('a link drawn after the page loads is pointed at its view; a long share-link hash does not get in the way', () => {
  assert.equal(late.doc.getElementById('z').getAttribute('href'), SITE + 'opportunities-hub.html#/opportunity/commuting');
  assert.equal(late.doc.getElementById('y').getAttribute('href'), SITE + 'places-hub.html#/places/scenario?g=0828745', 'a link whose address changes later');
  assert.equal(shared.went, null);
  assert.equal(shared.doc.getElementById('a').getAttribute('href'), SITE + 'places-hub.html#/places/compare');
  assert.equal(shared.doc.getElementById('b').getAttribute('href'), 'deal-market-analysis.html#x');
});

test('a page in a subfolder gets the view at the site root', () => {
  const { doc } = load(SITE + 'places/0828745.html', '<a id="a" href="../local-incentives.html">x</a>');
  assert.equal(doc.getElementById('a').getAttribute('href'), SITE + 'places-hub.html#/places/incentives');
});

test('the old header menus link to the views, and the place pill keeps the old picker for the pages that use it', () => {
  const nav = read('js/navigation.js');
  // The old seven-step rail names these pages as its steps, and its menu entries must match the rail
  // (test/step-count-agreement, guided-path-product-routes, place-deals-limits). Their links are pointed at
  // the views as the page draws them or they are used (the check above), not in the menu's source.
  const RAIL = new Set(['select-jurisdiction.html', 'hna-scenario-builder.html', 'recommendation.html', 'land-value.html', 'deal-summary.html']);
  // The Insights menu entries likewise: test/insights-nav-labels ties each Insights label to the heading of the page
  // it names, so they keep the old page's file in the menu source and are pointed at the views the same way.
  const INSIGHTS = new Set(['policy-briefs.html', 'colorado-elections.html', 'local-incentives.html', 'article-pricing.html']);
  for (const p of Object.keys(MOVED).filter((x) => !RAIL.has(x) && !INSIGHTS.has(x))) {
    const plain = new RegExp('(href: "|normalizeHref\\(\'|root \\+ \')' + p.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&') + '(?!\\?classic|\\?new)', 'g');
    assert.equal((nav.match(plain) || []).length, 0, 'js/navigation.js still links to ' + p);
  }
  assert.ok(/select-jurisdiction\.html\?classic=1" class="jurisdiction-pill"/.test(nav), 'the place pill');
});

test('the site audits measure each forwarded page as written (?classic=1), not the hub view it forwards to', () => {
  for (const p of Object.keys(MOVED)) assert.equal(ARRIVE_WITH[p], '?classic=1', p + ' is not opened with ?classic=1 by scripts/audit/lib/arrive-with.mjs');
});

if (failed) { console.error(failed + ' check(s) failed'); process.exit(1); }
console.log('All old-page forward checks passed');
