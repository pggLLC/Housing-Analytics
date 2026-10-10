/**
 * Insights menu and sitemap: every label names the page it opens.
 *
 * On 2026-09-28 the Insights menu had 11 ungrouped items and several labels
 * that described something the page was not: "Housing Legislation — 2026
 * bills tracker" opened one federal law, "CRA Expansion — CRA opportunity
 * areas" opened hypothetical pricing scenarios, and the sitemap called the
 * pricing page "Pricing Dynamics" and Housing News "Policy Briefs". The menu
 * is now grouped (Current / Research / Guides), and this guard pins the
 * agreement, not the wording: each label must appear in the <h1> of the page
 * it links to (or in its <title>, the name a browser tab and a search result
 * show). Rename a page and its label together and this stays green; rename one
 * side alone and it fails. The same holds for links to these pages from
 * anywhere else on the site: a review of this change found five pages still
 * calling them by names they no longer have ("Market Insights",
 * "2026 Housing Legislation Tracker", "Policy Briefs", "Pricing Analysis").
 *
 * The three papers are labelled by what they are (Working Paper, White Paper
 * for Planners, Methods) while their <h1>s are their titles, and #2016 left the
 * white paper's naming to the owner. They are exempted by name below; any
 * other mismatch fails.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const NAV = read('js/navigation.js');

const LABELLED_BY_DOCUMENT_TYPE = {
  'working-paper.html': 'labelled "Working Paper"; its <h1> is the paper title',
  'apa-white-paper.html': 'labelled by audience; its naming is an open owner decision from #2016',
  'methods.html': 'labelled "Methods"; its <h1> is the specification title',
};

// Pages in the Insights area, wherever the sitemap lists them.
const INSIGHTS_AREA = [
  'policy-briefs.html', 'housing-legislation-2026.html', 'colorado-elections.html', 'insights.html',
  'article-pricing.html', 'help-for-homebuyers.html',
  'cra-expansion-analysis.html', 'lihtc-enhancement-ahcia.html',
];

const norm = (text) => new JSDOM(`<p>${text}</p>`).window.document.querySelector('p').textContent
  .toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();

function h1Of(page) {
  const doc = new JSDOM(read(page)).window.document;
  const h1 = doc.querySelector('h1');
  assert.ok(h1, `${page} has no <h1> to agree with`);
  return h1.textContent;
}

// A page's names: its <h1> and its <title> up to the site suffix.
function namesOf(page) {
  const doc = new JSDOM(read(page)).window.document;
  return [h1Of(page), (doc.querySelector('title') || {}).textContent || '']
    .map((t) => norm(t.split('|')[0]));
}
const names = (page, label) => namesOf(page).some((n) => n.includes(norm(label)));

function insightsGroup() {
  const start = NAV.indexOf('label: "Insights"');
  assert.ok(start > -1, 'navigation.js has no Insights group');
  const block = NAV.slice(start, NAV.indexOf('\n      ]', start));
  return [...block.matchAll(/\{\s*label:\s*"([^"]+)"(?:,\s*isHeader:\s*true)?(?:,\s*href:\s*"([^"]+)")?/g)]
    .map(([, label, href]) => ({ label, href: href || null }));
}

test('the Insights menu is grouped, and no group is empty', () => {
  // The structure, not the header words: an ungrouped list of 11 items is
  // what overflowed, and a header with nothing under it is a dead label.
  const items = insightsGroup();
  const headers = items.filter((i) => !i.href);
  assert.ok(headers.length >= 2, `the Insights menu has ${headers.length} group headers; it is not grouped`);
  assert.equal(items[0].href, null, 'the Insights menu starts with an item outside any group');
  items.forEach((item, i) => {
    if (item.href) return;
    const next = items[i + 1];
    assert.ok(next && next.href, `the "${item.label}" group has nothing in it`);
  });
});

test('every Insights menu label appears in the heading of the page it opens', () => {
  const links = insightsGroup().filter((i) => i.href);
  let checked = 0;
  for (const { label, href } of links) {
    if (LABELLED_BY_DOCUMENT_TYPE[href]) continue;
    assert.ok(names(href, label), `menu label "${label}" is not in ${href}'s heading "${h1Of(href).trim()}" or title`);
    checked++;
  }
  assert.ok(checked >= 6, `only ${checked} labels checked; the scan found too little to mean anything`);
  const exempted = links.filter((i) => LABELLED_BY_DOCUMENT_TYPE[i.href]).map((i) => i.href).sort();
  assert.deepEqual(exempted, Object.keys(LABELLED_BY_DOCUMENT_TYPE).sort(), 'the exemption list names a page the menu does not link');
});

test('the sitemap names Insights pages the way their headings do', () => {
  const doc = new JSDOM(read('sitemap.html')).window.document;
  const cards = [...doc.querySelectorAll('a.site-card')].filter((a) => INSIGHTS_AREA.includes(a.getAttribute('href')));
  assert.ok(cards.length >= 8, `only ${cards.length} Insights pages found in the sitemap`);
  for (const card of cards) {
    const href = card.getAttribute('href');
    const name = card.querySelector('.site-card-name').textContent;
    assert.ok(names(href, name), `sitemap names ${href} "${name}", not in its heading "${h1Of(href).trim()}" or title`);
  }
});

test('About and Sitemap stay reachable from the footer', () => {
  const start = NAV.indexOf('class="footer-col"');
  assert.ok(start > -1, 'navigation.js has no footer columns');
  const footer = NAV.slice(start, NAV.indexOf('footer-disclaimer', start));
  for (const page of ['about.html', 'sitemap.html']) {
    assert.ok(footer.includes(`normalizeHref('${page}')`), `${page} left the menu but is not in the footer`);
  }
});

// A link elsewhere on the site whose text is a page name (short, in title
// case) must use a name the page has. Sentences and breadcrumbs ("Insights",
// the section) are not page names and are not checked.
const SMALL = new Set(['and', 'of', 'the', 'for', 'to', 'a', 'an', 'on', 'in', '&', 'vs']);
const looksLikeName = (t) => {
  const words = t.split(/\s+/).filter(Boolean);
  return words.length > 0 && words.length <= 8 && words.every((w) => SMALL.has(w.toLowerCase()) || /^[A-Z0-9&(]/.test(w));
};

test('links from other pages call Insights pages by their names', () => {
  const pages = fs.readdirSync(ROOT).filter((f) => f.endsWith('.html') && f !== 'sitemap.html');
  let checked = 0;
  const wrong = [];
  for (const page of pages) {
    const doc = new JSDOM(read(page)).window.document;
    for (const a of doc.querySelectorAll('a[href]')) {
      const href = a.getAttribute('href').split('#')[0];
      if (!INSIGHTS_AREA.includes(href) || href === page || a.closest('.breadcrumb')) continue;
      const text = a.textContent.replace(/[→←↗]/g, '').replace(/^\s*back to\s+/i, '').replace(/\s+/g, ' ').trim();
      if (!looksLikeName(text)) continue;
      checked++;
      if (!names(href, text)) wrong.push(`${page}: "${text}" -> ${href}`);
    }
  }
  assert.ok(checked >= 8, `only ${checked} page-name links found; the scan is not seeing the site`);
  assert.deepEqual(wrong, [], 'links that call a page by a name it does not have');
});
