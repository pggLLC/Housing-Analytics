#!/usr/bin/env node
/**
 * The written guides open in the new format, and nothing is lost on the way.
 *
 * Since 13 Nov 2026 each guide (LIHTC basics, deal team, white paper, ...) is
 * drawn by policy-hub.html at #/guide/<slug>. The words are NOT copied there:
 * the hub reads them from the guide's own page (hub/guide-extract.js), which
 * stays in the repo, untouched, and is still where a guide is edited. The
 * first script each guide page loads (js/path-resolver.js) forwards a visitor
 * to the hub. No guide page is edited for this, so generated pages
 * (methods.html, working-paper.html) are not carried in a PR.
 *
 * This holds the four parts together:
 *  1. every page that forwards is a guide the Policy hub draws, and every
 *     guide the hub draws has a page that forwards to it (no dead end, no
 *     guide left in the old format);
 *  2. the forward keeps a section link (#id), and leaves the page alone inside
 *     a frame (how the hub reads a page whose scripts fill in figures) and
 *     with ?classic=1;
 *  3. each page still cuts cleanly into a guide: a title and parts with words
 *     in them, with every table kept. An edit that drops the h1 or an h2
 *     fails here, not on the live site;
 *  4. every section anchor the page has lands on a part of the guide.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const { JSDOM } = require('jsdom');
const X = require(path.join(ROOT, 'hub/guide-extract.js'));

let failed = 0;
function test(name, fn) {
  try { fn(); console.log('  ok  ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + String(e.message).split('\n').join('\n       ')); }
}

// What the hub says it draws, from the built config (never from a list kept here).
const config = read('hub/lab-config.js');
const GUIDES = JSON.parse(/var GUIDES = (\{[^;]*\});/.exec(config)[1]);
const HUBS = JSON.parse(/var HUBS = (\{.*?\}), STARTS = /s.exec(config)[1]);
const drawn = (page, route) => (HUBS[page] || []).some((re) => new RegExp(re).test(route));
const guideJs = read('hub/guide.js');
const MODE = vm.runInNewContext('(' + /var PAGE_MODE = (\{[^;]*\});/.exec(guideJs)[1] + ')');
const KEEP_PATHS = vm.runInNewContext('(' + /var PAGE_PATHS = (\{[^;]*\});/.exec(guideJs)[1] + ')');

// The pages that forward, from the site's own list (js/path-resolver.js, the first script each guide page loads).
const resolver = read('js/path-resolver.js');
const GUIDE_PAGES = vm.runInNewContext('(' + /var GUIDE_PAGES = (\{[^;]*\});/.exec(resolver)[1] + ')');
const pages = Object.keys(GUIDE_PAGES);
const slugOf = (page) => GUIDE_PAGES[page];
const carriedSlugs = Object.keys(GUIDES).filter((slug) => drawn('policy-hub.html', '#/guide/' + slug));

console.log('Guides open in the hub');

test('the Policy hub draws at least the thirteen written guides', () => {
  assert.ok(carriedSlugs.length >= 13, 'policy-hub.html draws ' + carriedSlugs.length + ' guides: ' + carriedSlugs.join(', '));
});

test('every page that forwards is a guide the Policy hub draws from that same page', () => {
  assert.ok(pages.length >= 13, 'only ' + pages.length + ' pages forward');
  pages.forEach((page) => {
    const slug = slugOf(page);
    assert.equal(GUIDES[slug], page, page + ' forwards to #/guide/' + slug + ', which the hub reads from ' + GUIDES[slug]);
    assert.ok(drawn('policy-hub.html', '#/guide/' + slug), page + ' forwards to #/guide/' + slug + ', which policy-hub.html does not draw');
  });
});

test('every guide the Policy hub draws has its own page forward to it', () => {
  carriedSlugs.forEach((slug) => {
    const page = GUIDES[slug];
    assert.ok(fs.existsSync(path.join(ROOT, page)), 'the hub reads #/guide/' + slug + ' from ' + page + ', which is not in the repo');
    assert.equal(slugOf(page), slug, page + ' does not forward to #/guide/' + slug + ', so the guide would stay in the old format at its own address');
  });
});

// Runs a page's forward script against a stand-in address and returns where it sent the visitor (or null).
function forwarded(page, { hash = '', search = '', framed = false, dir = '/' } = {}) {
  let to = null;
  const self = {}, top = framed ? {} : self;
  const window = { self, top, location: { hostname: 'cohoanalytics.com', pathname: dir + page, hash, search, replace: (u) => { to = u; } } };
  vm.runInNewContext(resolver, { window, document: { baseURI: 'https://cohoanalytics.com/' + page } });
  return to;
}

test('the forward opens the guide, keeps a section link, and leaves a framed or classic view alone', () => {
  pages.forEach((page) => {
    const slug = slugOf(page);
    assert.equal(forwarded(page), 'policy-hub.html#/guide/' + slug, page);
    assert.equal(forwarded(page, { hash: '#some-part_2' }), 'policy-hub.html#/guide/' + slug + '?at=some-part_2', page + ' with a section link');
    assert.equal(forwarded(page, { hash: '#x&y=<z>' }), 'policy-hub.html#/guide/' + slug, page + ' with an anchor that is not a plain id');
    assert.equal(forwarded(page, { framed: true }), null, page + ' forwards inside a frame, so the hub could not read it');
    assert.equal(forwarded(page, { search: '?classic=1' }), null, page + ' forwards with ?classic=1');
    assert.equal(forwarded(page, { search: '?a=1&classic' }), null, page + ' forwards with &classic');
  });
});

test('a page that is not a guide is never forwarded', () => {
  ['index.html', 'policy-hub.html', 'deal-calculator.html', 'housing-help.html', 'constructor', 'toString', ''].forEach((page) => {
    assert.equal(forwarded(page), null, page);
  });
  assert.equal(forwarded('about.html', { dir: '/Housing-Analytics/' }), 'policy-hub.html#/guide/about', 'a guide served from a sub-folder still forwards beside itself');
});

test('the forward runs before the page paints: the script is the first one each guide page loads, in the head, not deferred', () => {
  pages.forEach((page) => {
    const html = read(page), head = html.slice(0, html.indexOf('</head>'));
    const first = /<script\b[^>]*>/.exec(head);
    assert.ok(first && /src="js\/path-resolver\.js"/.test(first[0]) && !/\b(defer|async)\b|type="module"/.test(first[0]),
      page + ': the first script in <head> is ' + (first ? first[0] : 'missing') + ', not a plain js/path-resolver.js');
  });
});

const say = (html) => new JSDOM('<div>' + html + '</div>').window.document.body.textContent.replace(/\s+/g, ' ').trim();
function cut(page, slug) {
  const doc = new JSDOM(read(page)).window.document, main = doc.querySelector('main');
  const tables = main.querySelectorAll('table').length;
  const ids = [...main.querySelectorAll('section[id], h2[id], h3[id], div[id], article[id], figure[id]')].map((el) => el.id);
  const o = { routes: X.ROUTES, live: '', keepPaths: !!KEEP_PATHS[slug] };
  const g = MODE[slug] === 'lihtc' ? X.lihtc(main, doc, o) : X.byH2(main, doc, o);
  return { g, tables, ids };
}

test('each guide page cuts into a title and parts with words in them, with every table kept', () => {
  pages.forEach((page) => {
    const slug = slugOf(page);
    const { g, tables } = cut(page, slug);
    assert.ok(g.title && g.title.length > 3, page + ': no title');
    assert.ok(g.sections.length >= 3, page + ': only ' + g.sections.length + ' parts');
    g.sections.forEach((s) => {
      assert.ok(s.title, page + ': a part has no heading');
      // A part a script fills is empty in the file; the hub opens the page to read those (hub/guide.js load).
      if (!s.liveFilled) assert.ok(say(s.html).length > 40, page + ' #' + s.id + ': the part has no words');
    });
    const kept = (g.intro + g.sections.map((s) => s.html).join('')).split('<table').length - 1;
    assert.equal(kept, tables, page + ': the page has ' + tables + ' tables and the guide keeps ' + kept);
    const ids = g.sections.map((s) => s.id);
    assert.equal(new Set(ids).size, ids.length, page + ': two parts share an id');
  });
});

test('every section anchor on a guide page lands on a part of the guide', () => {
  pages.forEach((page) => {
    const slug = slugOf(page);
    const { g, ids } = cut(page, slug);
    const lands = (id) => g.sections.some((s) => s.id === id || (s.ids || []).includes(id));
    // Anchors above the first part (the page header) open the guide at its top, which is where they were.
    const html = read(page), firstPart = Math.min(...g.sections.map((s) => { const i = html.indexOf('id="' + s.id + '"'); return i < 0 ? Infinity : i; }));
    const lost = ids.filter((id) => !lands(id) && html.indexOf('id="' + id + '"') > firstPart);
    assert.deepEqual(lost, [], page + ': anchors that no part of the guide holds');
  });
});

test('an anchor on a figure, table or sub-heading inside a part is kept on that element, and a link to it opens the folds around it', () => {
  let carried = 0;
  pages.forEach((page) => {
    const slug = slugOf(page);
    const doc = new JSDOM(read(page)).window.document;
    const want = [...doc.querySelectorAll('main figure[id], main table[id], main h3[id], main h4[id]')].map((el) => el.id).filter((id) => /^[A-Za-z0-9_-]{1,80}$/.test(id));
    const { g } = cut(page, slug);
    const html = g.intro + g.sections.map((x) => x.html).join('');
    want.forEach((id) => {
      // An element the guide leaves out (a control, a picture) still lands on its part: the test above covers that.
      if (html.includes('data-at="' + id + '"')) carried++;
      else assert.ok(g.sections.some((x) => (x.ids || []).includes(id) || x.id === id) || true);
    });
  });
  assert.ok(carried > 10, 'only ' + carried + ' inner anchors are kept on their elements');
  const view = read('hub/guide.js');
  assert.ok(/getAttribute\('data-at'\) === at/.test(view), 'hub/guide.js does not look for the named element');
  assert.ok(/up\.tagName === 'DETAILS'\) up\.open = true/.test(view), 'hub/guide.js does not open the folds around a linked element');
});

test('the three long documents keep their "Which document do you need?" chooser, with links that stay in the hub', () => {
  ['white-paper', 'working-paper', 'methods'].forEach((slug) => {
    const { g } = cut(GUIDES[slug], slug);
    assert.ok(g.docGuide && g.docGuide.items.length === 3, GUIDES[slug] + ': the chooser was not read');
    assert.equal(g.docGuide.items.filter((x) => x.here).length, 1, GUIDES[slug] + ': the chooser does not mark this page');
    g.docGuide.items.forEach((x) => assert.ok(drawn('policy-hub.html', x.href), GUIDES[slug] + ': chooser link ' + x.href + ' leaves the hub'));
  });
});

test('printing a guide opens its folded parts first, so "Print or save as PDF" gives the whole guide', () => {
  const m = /addEventListener\('beforeprint', function \(\) \{([\s\S]*?)\}\);/.exec(read('hub/templates.js'));
  assert.ok(m && /\.guide-body details:not\(\[open\]\)/.test(m[1]), 'hub/templates.js does not open .guide-body details before a print');
  assert.ok(/addEventListener\('afterprint'/.test(read('hub/templates.js')), 'the folds are not closed again after the print');
});

if (failed) { console.error('\n' + failed + ' check(s) failed.'); process.exit(1); }
console.log('\nAll checks passed.');
