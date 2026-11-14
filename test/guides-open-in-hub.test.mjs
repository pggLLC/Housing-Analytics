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
// Pages whose own scripts draw parts of them; the hub opens those in a frame and reads them once drawn.
const RENDERED = vm.runInNewContext('(' + /var PAGE_RENDERED = (\{[^;]*\});/.exec(guideJs)[1] + ')');
const KEEP_PATHS = vm.runInNewContext('(' + /var PAGE_PATHS = (\{[^;]*\});/.exec(guideJs)[1] + ')');

// The pages that forward, from the site's own list (js/path-resolver.js, the first script each guide page loads).
const resolver = read('js/path-resolver.js');
const GUIDE_PAGES = vm.runInNewContext('(' + /var GUIDE_PAGES = (\{[^;]*\});/.exec(resolver)[1] + ')');
const pages = Object.keys(GUIDE_PAGES);
const slugOf = (page) => GUIDE_PAGES[page];
// The hub page that draws a guide: the Policy hub, or the front page for the two resident guides (Housing help).
const hubOf = (slug) => Object.keys(HUBS).find((page) => drawn(page, '#/guide/' + slug)) || null;
const carriedSlugs = Object.keys(GUIDES).filter((slug) => hubOf(slug));

console.log('Guides open in the hub');

test('the hub pages draw at least the fifteen written guides, the two resident guides on the front page', () => {
  assert.ok(carriedSlugs.length >= 15, 'the hub pages draw ' + carriedSlugs.length + ' guides: ' + carriedSlugs.join(', '));
  ['renter-help', 'homebuyer-help'].forEach((slug) => assert.equal(hubOf(slug), 'index.html', '#/guide/' + slug + ' is drawn by ' + hubOf(slug) + ', not the front page'));
  assert.ok(drawn('index.html', '#/assistance'), 'the front page does not draw Housing help (#/assistance)');
});

test('every page that forwards is a guide a hub page draws from that same page', () => {
  assert.ok(pages.length >= 15, 'only ' + pages.length + ' pages forward');
  pages.forEach((page) => {
    const slug = slugOf(page);
    assert.equal(GUIDES[slug], page, page + ' forwards to #/guide/' + slug + ', which the hub reads from ' + GUIDES[slug]);
    assert.ok(hubOf(slug), page + ' forwards to #/guide/' + slug + ', which no hub page draws');
    assert.equal(forwarded(page).split('#')[0], hubOf(slug), page + ' forwards to a page that does not draw #/guide/' + slug);
  });
});

test('every guide a hub page draws has its own page forward to it', () => {
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
    const to = hubOf(slug) + '#/guide/' + slug;
    assert.equal(forwarded(page), to, page);
    assert.equal(forwarded(page, { hash: '#some-part_2' }), to + '?at=some-part_2', page + ' with a section link');
    assert.equal(forwarded(page, { hash: '#x&y=<z>' }), to, page + ' with an anchor that is not a plain id');
    assert.equal(forwarded(page, { framed: true }), null, page + ' forwards inside a frame, so the hub could not read it');
    assert.equal(forwarded(page, { search: '?classic=1' }), null, page + ' forwards with ?classic=1');
    assert.equal(forwarded(page, { search: '?a=1&classic' }), null, page + ' forwards with &classic');
  });
});

test('a page that is not a guide is never forwarded', () => {
  ['index.html', 'policy-hub.html', 'deal-calculator.html', 'housing-needs-assessment.html', 'constructor', 'toString', ''].forEach((page) => {
    assert.equal(forwarded(page), null, page);
  });
  assert.equal(forwarded('about.html', { dir: '/Housing-Analytics/' }), 'policy-hub.html#/guide/about', 'a guide served from a sub-folder still forwards beside itself');
});

test('the forward runs before the page paints: the script is the first one each guide page loads, in the head, not deferred', () => {
  pages.forEach((page) => {
    // Read as a browser reads it (no pattern over the markup): the first script element in <head>.
    const first = new JSDOM(read(page)).window.document.head.querySelector('script');
    assert.ok(first && first.getAttribute('src') === 'js/path-resolver.js' && !first.hasAttribute('defer') && !first.hasAttribute('async') && first.getAttribute('type') !== 'module',
      page + ': the first script in <head> is ' + (first ? first.outerHTML : 'missing') + ', not a plain js/path-resolver.js');
  });
});

const say = (html) => new JSDOM('<div>' + html + '</div>').window.document.body.textContent.replace(/\s+/g, ' ').trim();
function cut(page, slug) {
  const doc = new JSDOM(read(page)).window.document, main = doc.querySelector('main');
  const tables = main.querySelectorAll('table').length;
  const ids = [...main.querySelectorAll('section[id], h2[id], h3[id], div[id], article[id], figure[id]')].map((el) => el.id);
  const o = { routes: X.ROUTES, live: '', self: '#/guide/' + slug, keepPaths: !!KEEP_PATHS[slug] };
  const g = MODE[slug] === 'lihtc' ? X.lihtc(main, doc, o) : X.byH2(main, doc, o);
  return { g, tables, ids };
}

test('each guide page cuts into a title and parts with words in them, with every table kept', () => {
  pages.forEach((page) => {
    const slug = slugOf(page);
    const { g, tables } = cut(page, slug);
    assert.ok(g.title && g.title.length > 3, page + ': no title');
    // The homebuyer page's program groups are drawn by its script from the program file, so its file alone has one
    // part and the mount; the browser check in the pull request compared the drawn page.
    const scriptDrawn = RENDERED[slug] && new JSDOM(read(page)).window.document.querySelector('main [data-homeownership-programs]');
    assert.ok(g.sections.length >= (scriptDrawn ? 1 : 3), page + ': only ' + g.sections.length + ' parts');
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
  // Every such anchor is either kept on its element or, where the guide leaves the element out (a control, a
  // picture), still lands on its part (the test above). The LIHTC guide's two diagrams are the known case.
  let carried = 0;
  pages.forEach((page) => {
    const doc = new JSDOM(read(page)).window.document;
    const want = [...doc.querySelectorAll('main figure[id], main table[id], main h3[id], main h4[id]')].map((el) => el.id).filter((id) => /^[A-Za-z0-9_-]{1,80}$/.test(id));
    const { g } = cut(page, slugOf(page));
    const html = g.intro + g.sections.map((x) => x.html).join('');
    want.forEach((id) => { if (html.includes('data-at="' + id + '"')) carried++; });
  });
  assert.ok(carried >= 2, 'only ' + carried + ' inner anchors are kept on their elements');
  const lihtc = cut('lihtc-guide-for-stakeholders.html', 'lihtc-basics').g.sections.map((x) => x.html).join('');
  ['creditsToCashDiagram', 'creditPathDiagram'].forEach((id) => assert.ok(lihtc.includes('data-at="' + id + '"'), 'the LIHTC guide lost the anchor #' + id));
  const view = read('hub/guide.js');
  assert.ok(/getAttribute\('data-at'\) === at/.test(view), 'hub/guide.js does not look for the named element');
  assert.ok(/up\.tagName === 'DETAILS'\) up\.open = true/.test(view), 'hub/guide.js does not open the folds around a linked element');
});

test('a link in a guide to another part of the same page stays a link, and lands on that part of the guide', () => {
  const found = {};
  pages.forEach((page) => {
    const slug = slugOf(page), { g } = cut(page, slug);
    const html = g.intro + g.sections.map((x) => x.html).join('');
    const ats = [...new Set([...html.matchAll(/href="#\/guide\/([a-z0-9-]+)\?at=([A-Za-z0-9_-]+)"/g)].map((m) => { assert.equal(m[1], slug, page + ': a part link names another guide'); return m[2]; }))];
    ats.forEach((id) => {
      const lands = g.sections.some((x) => x.id === id || (x.ids || []).includes(id)) || html.includes('data-at="' + id + '"');
      assert.ok(lands, page + ': the link to #' + id + ' has nowhere to land in the guide');
    });
    found[slug] = ats;
  });
  // Methods cross-refers between its numbered sections ("review §05 first"); those were plain text before.
  ['m-apportion', 'm-anchor', 'm-burden', 'm-affordability', 'm-score', 'm-absence', 'm-loss'].forEach((id) => assert.ok(found.methods.includes(id), 'methods.html: the link to #' + id + ' was dropped'));
  assert.ok(found['resident-services'].includes('rs-costs'), 'resident-services.html: the link to "What services cost" was dropped');
  const view = read('hub/guide.js');
  assert.ok(/self: '#\/guide\/' \+ slug/.test(view), 'hub/guide.js does not tell the reader the guide\'s own address');
  assert.ok(/here\.land\(m\[2\]\)\) ev\.preventDefault\(\)/.test(view), 'hub/guide.js does not land a same-guide link directly');
});

test('a glossary popup the page was given by the site\'s glossary script is not read as the guide\'s words', () => {
  // js/glossary.js wraps a term on a guide page before the hub reads it. Live on 13 Nov the popup's definition was
  // printed inside the sentence ("CHFA Colorado Housing and Finance Authority Colorado's housing finance ...").
  const glossary = read('js/glossary.js');
  assert.ok(glossary.includes('class="gl-tooltip-trigger"') && glossary.includes('class="gl-tooltip-popup"'), 'js/glossary.js no longer names its popup gl-tooltip-trigger / gl-tooltip-popup; hub/guide-extract.js drops them by those names');
  const doc = new JSDOM('<main><div id="x"><p>Confirm terms with <abbr class="gl-tooltip-trigger" tabindex="0" aria-label="CHFA: the authority">CHFA<span class="gl-tooltip-popup" aria-hidden="true"><strong>Colorado Housing and Finance Authority</strong>Colorado\'s housing finance authority.</span></abbr> first.</p></div></main>').window.document;
  const html = X.clean(doc.getElementById('x'), doc, { routes: X.ROUTES, live: '' });
  assert.equal(say(html), 'Confirm terms with CHFA first.', 'the popup text was kept: ' + html);
  assert.ok(!/<abbr|<span|<strong/.test(html), 'popup markup was kept: ' + html);
});

test('hover help on a guide page is kept in the guide: column heading tips, glossary definitions, and a link to the page itself', () => {
  // The guide pages get these from js/components/table-header-tips.js and js/glossary.js, which do not run in the hub.
  // 1. A heading's own tip survives the cut, both as written (data-tip, title) and after the page's script moved it.
  const doc = new JSDOM('<main><div id="x"><table><thead><tr><th data-tip="As written.">A</th><th title="From a title.">B</th>' +
    '<th class="th-tip" tabindex="0"><span class="th-tip__label">C</span><span class="th-tip__pop" role="tooltip">Moved by the script.</span></th></tr></thead><tbody><tr><td>1</td><td>2</td><td>3</td></tr></tbody></table></div></main>').window.document;
  const html = X.clean(doc.getElementById('x'), doc, { routes: X.ROUTES, live: '' });
  ['As written.', 'From a title.', 'Moved by the script.'].forEach((t) => assert.ok(html.includes('data-tip="' + t + '"'), 'a heading tip was lost (' + t + '): ' + html));
  assert.ok(!html.includes('th-tip__pop') && !/Moved by the script\.<\/th>/.test(html) && !/>CMoved/.test(html), 'the tip was read as the heading\'s words: ' + html);
  const g = cut(GUIDES['lihtc-basics'], 'lihtc-basics').g;
  const written = (read(GUIDES['lihtc-basics']).match(/<th\b[^>]*\sdata-tip="/g) || []).length;
  const kept = ((g.intro + g.sections.map((x) => x.html).join('')).match(/<th\b[^>]*\sdata-tip="/g) || []).length;
  assert.ok(written > 0 && kept === written, GUIDES['lihtc-basics'] + ': ' + written + ' heading tips written, ' + kept + ' kept');
  // 2. The view fills the rest from the same two files the site's scripts read.
  const view = read('hub/guide.js');
  ['data/glossary.json', 'data/table-header-tips.json'].forEach((f) => {
    assert.ok(view.includes("'" + f + "'"), 'hub/guide.js no longer reads ' + f);
    assert.ok(read('js/glossary.js').includes('glossary.json') && read('js/components/table-header-tips.js').includes('table-header-tips.json'), 'the site\'s own scripts no longer read these files');
  });
  const terms = JSON.parse(read('data/glossary.json')).terms;
  assert.ok(Array.isArray(terms) && terms.length > 100 && terms.every((t) => t.term && t.definition), 'data/glossary.json is no longer { terms: [{ term, definition }] }');
  const tips = JSON.parse(read('data/table-header-tips.json'));
  assert.ok(Object.keys(tips.tips || tips).length > 50, 'data/table-header-tips.json no longer holds the heading tips');
  assert.ok(/function hoverHelp\(/.test(view) && /hoverHelp\(document\.querySelector\('\.guide-body'\)/.test(view), 'hub/guide.js no longer adds hover help once a guide is drawn');
  // A sortable heading holds the sorter's arrow button; whichever script runs first, the heading keeps its tip.
  assert.ok(view.includes("button:not(.th-sort)"), 'hub/guide.js skips a heading the table sorter has already given its arrow button');
  // A tap on a sortable heading opens the definition and does not sort; the arrow is the touch target for sorting
  // (js/components/table-header-tips.js keeps the same rule on the guide's own page).
  assert.ok(/pointerType === 'touch'/.test(view) && /closest\('\.th-sort'\)/.test(view) && /ev\.stopPropagation\(\); ev\.preventDefault\(\);\s*gtipShow\(th\)/.test(view), 'hub/guide.js lets a tap on a heading sort the table');
  assert.ok(/thSortArrow \|\| !lastPointerTouch/.test(read('js/components/table-header-tips.js')), 'js/components/table-header-tips.js changed how a heading tap is told from a sort; hub/guide.js follows it');
  // 2b. The pages define terms a second way: js/components/inline-glossary.js, once per page, for every term with
  // a short definition, the ones js/glossary.js does not link on sight included (Prop 123, GEOID, market study).
  // The guide does the same for a page that asks for it, from the same list.
  const inline = read('js/components/inline-glossary.js');
  const inlineTerms = (inline.slice(inline.indexOf('var TERMS = {'), inline.indexOf('};', inline.indexOf('var TERMS = {'))).match(/^\s+'(?:[^'\\]|\\.)+':\s*'/gm) || []).length;
  // Its keys: a term's inline_key or name, and each other spelling (scripts/sync-glossary.mjs tooltipKeys).
  const withShort = new Set(terms.filter((t) => t.short).flatMap((t) => [t.inline_key || t.term, ...(t.aliases || [])])).size;
  assert.ok(inlineTerms > 80 && inlineTerms === withShort, 'js/components/inline-glossary.js defines ' + inlineTerms + ' terms and data/glossary.json gives ' + withShort + ' keys with a short definition; hub/guide.js reads the second as the first');
  assert.ok(/!t\.short\) return;\s*\[t\.inline_key \|\| t\.term\]\.concat\(t\.aliases \|\| \[\]\)/.test(view) && /if \(!termsOnce \|\| !F\.oncePattern\) return;/.test(view) && /, F, !!g\.termsOnce\);/.test(view), 'hub/guide.js no longer defines each short-definition term once in a guide whose page does');
  const extractSrc = read('hub/guide-extract.js');
  assert.ok(/querySelector\('\.js-glossary-auto'\)/.test(extractSrc) && /b\.termsOnce = true/.test(extractSrc) && /querySelectorAll\('\.js-glossary-auto'\)/.test(inline), 'hub/guide-extract.js no longer reads the page\'s own request for once-per-page definitions (.js-glossary-auto)');
  const asking = Object.keys(GUIDES).filter((slug) => /class="[^"]*\bjs-glossary-auto\b/.test(read(GUIDES[slug])));
  assert.ok(asking.length >= 10, 'only ' + asking.length + ' guide pages ask for once-per-page definitions; the scan found too little to check');
  // 3. The page as written stays one link away.
  assert.ok(/g\.live\) \+ '\?classic=1"/.test(view), 'the guide no longer links its own page with ?classic=1');
});

test('the three long documents keep their "Which document do you need?" chooser, with links that stay in the hub', () => {
  ['white-paper', 'working-paper', 'methods'].forEach((slug) => {
    const { g } = cut(GUIDES[slug], slug);
    assert.ok(g.docGuide && g.docGuide.items.length === 3, GUIDES[slug] + ': the chooser was not read');
    assert.equal(g.docGuide.items.filter((x) => x.here).length, 1, GUIDES[slug] + ': the chooser does not mark this page');
    g.docGuide.items.forEach((x) => assert.ok(drawn('policy-hub.html', x.href), GUIDES[slug] + ': chooser link ' + x.href + ' leaves the hub'));
  });
});

test('a guide whose figures arrive after the first read is read again, not cached without them', () => {
  const extract = read('hub/guide-extract.js'), view = read('hub/guide.js');
  assert.ok(/function fromPage\(url, o, onLate\)/.test(extract) && /onLate\(cut\(/.test(extract), 'hub/guide-extract.js no longer reads a changed page again');
  assert.ok(/X\.fromPage\(page, o, function \(late\)/.test(view), 'hub/guide.js does not take the later read');
});

test('printing a guide opens its folded parts first, so "Print or save as PDF" gives the whole guide', () => {
  const m = /addEventListener\('beforeprint', function \(\) \{([\s\S]*?)\}\);/.exec(read('hub/templates.js'));
  assert.ok(m && /\.guide-body details:not\(\[open\]\)/.test(m[1]), 'hub/templates.js does not open .guide-body details before a print');
  assert.ok(/addEventListener\('afterprint'/.test(read('hub/templates.js')), 'the folds are not closed again after the print');
});

if (failed) { console.error('\n' + failed + ' check(s) failed.'); process.exit(1); }
console.log('\nAll checks passed.');
