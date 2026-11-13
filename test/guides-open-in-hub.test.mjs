#!/usr/bin/env node
/**
 * The written guides open in the new format, and nothing is lost on the way.
 *
 * Since 13 Nov 2026 each guide (LIHTC basics, deal team, white paper, ...) is
 * drawn by policy-hub.html at #/guide/<slug>. The words are NOT copied there:
 * the hub reads them from the guide's own page (hub/guide-extract.js), which
 * stays in the repo and is still where a guide is edited. The page itself
 * forwards a visitor to the hub with a small script at the top of <head>.
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

const FORWARD = /<script data-guide-forward="([a-z-]+)">([\s\S]*?)<\/script>/;
const pages = fs.readdirSync(ROOT).filter((f) => f.endsWith('.html') && FORWARD.test(read(f)));
const carriedSlugs = Object.keys(GUIDES).filter((slug) => drawn('policy-hub.html', '#/guide/' + slug));

console.log('Guides open in the hub');

test('the Policy hub draws at least the thirteen written guides', () => {
  assert.ok(carriedSlugs.length >= 13, 'policy-hub.html draws ' + carriedSlugs.length + ' guides: ' + carriedSlugs.join(', '));
});

test('every page that forwards is a guide the Policy hub draws from that same page', () => {
  assert.ok(pages.length >= 13, 'only ' + pages.length + ' pages forward');
  pages.forEach((page) => {
    const slug = FORWARD.exec(read(page))[1];
    assert.equal(GUIDES[slug], page, page + ' forwards to #/guide/' + slug + ', which the hub reads from ' + GUIDES[slug]);
    assert.ok(drawn('policy-hub.html', '#/guide/' + slug), page + ' forwards to #/guide/' + slug + ', which policy-hub.html does not draw');
  });
});

test('every guide the Policy hub draws has its own page forward to it', () => {
  carriedSlugs.forEach((slug) => {
    const page = GUIDES[slug];
    assert.ok(fs.existsSync(path.join(ROOT, page)), 'the hub reads #/guide/' + slug + ' from ' + page + ', which is not in the repo');
    const m = FORWARD.exec(read(page));
    assert.ok(m && m[1] === slug, page + ' does not forward to #/guide/' + slug + ', so the guide would stay in the old format at its own address');
  });
});

// Runs a page's forward script against a stand-in address and returns where it sent the visitor (or null).
function forwarded(page, { hash = '', search = '', framed = false } = {}) {
  let to = null;
  const self = {}, top = framed ? {} : self;
  const window = { self, top };
  vm.runInNewContext(FORWARD.exec(read(page))[2], { window, location: { hash, search, replace: (u) => { to = u; } }, URLSearchParams });
  return to;
}

test('the forward opens the guide, keeps a section link, and leaves a framed or classic view alone', () => {
  pages.forEach((page) => {
    const slug = FORWARD.exec(read(page))[1];
    assert.equal(forwarded(page), 'policy-hub.html#/guide/' + slug, page);
    assert.equal(forwarded(page, { hash: '#some-part_2' }), 'policy-hub.html#/guide/' + slug + '?at=some-part_2', page + ' with a section link');
    assert.equal(forwarded(page, { hash: '#x&y=<z>' }), 'policy-hub.html#/guide/' + slug, page + ' with an anchor that is not a plain id');
    assert.equal(forwarded(page, { framed: true }), null, page + ' forwards inside a frame, so the hub could not read it');
    assert.equal(forwarded(page, { search: '?classic=1' }), null, page + ' forwards with ?classic=1');
    assert.equal(forwarded(page, { search: '?a=1&classic' }), null, page + ' forwards with &classic');
  });
});

test('the forward runs before anything else on the page loads', () => {
  pages.forEach((page) => {
    const html = read(page), at = html.indexOf('<script data-guide-forward');
    const before = html.slice(0, at);
    assert.ok(!/<script\b|<link\b[^>]*stylesheet/i.test(before), page + ' loads a script or stylesheet before the forward, so the old page could flash first');
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
    const slug = FORWARD.exec(read(page))[1];
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
    const slug = FORWARD.exec(read(page))[1];
    const { g, ids } = cut(page, slug);
    const lands = (id) => g.sections.some((s) => s.id === id || (s.ids || []).includes(id));
    // Anchors above the first part (the page header) open the guide at its top, which is where they were.
    const html = read(page), firstPart = Math.min(...g.sections.map((s) => { const i = html.indexOf('id="' + s.id + '"'); return i < 0 ? Infinity : i; }));
    const lost = ids.filter((id) => !lands(id) && html.indexOf('id="' + id + '"') > firstPart);
    assert.deepEqual(lost, [], page + ': anchors that no part of the guide holds');
  });
});

test('the three long documents keep their "Which document do you need?" chooser, with links that stay in the hub', () => {
  ['white-paper', 'working-paper', 'methods'].forEach((slug) => {
    const { g } = cut(GUIDES[slug], slug);
    assert.ok(g.docGuide && g.docGuide.items.length === 3, GUIDES[slug] + ': the chooser was not read');
    assert.equal(g.docGuide.items.filter((x) => x.here).length, 1, GUIDES[slug] + ': the chooser does not mark this page');
    g.docGuide.items.forEach((x) => assert.ok(drawn('policy-hub.html', x.href), GUIDES[slug] + ': chooser link ' + x.href + ' leaves the hub'));
  });
});

if (failed) { console.error('\n' + failed + ' check(s) failed.'); process.exit(1); }
console.log('\nAll checks passed.');
