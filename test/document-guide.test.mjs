/**
 * The white paper, the working paper and the methods page each open with the
 * same "Which document do you need?" guide, and the Insights menu and the
 * sitemap describe the three the way the guide does.
 *
 * The owner chose this on 2026-10-11 over merging the three into one page:
 * they serve different readers, and the problem was that nothing told a reader
 * which one they wanted. Three copies of a guide drift, so this pins the
 * agreement, not the wording: every copy must list the same documents in the
 * same order with the same text, mark only its own page as current, and match
 * the menu's label and description for each. Reword all of them together and
 * this stays green; reword one and it fails.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const PAGES = ['apa-white-paper.html', 'working-paper.html', 'methods.html'];
const text = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : null);

export function guideOf(html) {
  const doc = new JSDOM(html).window.document;
  const guides = doc.querySelectorAll('nav.doc-guide');
  if (guides.length !== 1) return { count: guides.length };
  const entries = [...guides[0].querySelectorAll('.doc-guide__list > li')].map((li) => {
    const a = li.querySelector('.doc-guide__name a');
    return {
      href: a && a.getAttribute('href'),
      name: text(a),
      for: text(li.querySelector('.doc-guide__for')),
      about: text(li.querySelector('.doc-guide__about')),
      current: !!(a && a.getAttribute('aria-current') === 'page'),
    };
  });
  return { count: 1, entries };
}

export function menuEntries(nav, hrefs) {
  return [...nav.matchAll(/\{\s*label:\s*"([^"]+)",\s*href:\s*"([^"]+)",\s*desc:\s*"([^"]+)"/g)]
    .map(([, label, href, desc]) => ({ label, href, desc }))
    .filter((e) => hrefs.includes(e.href));
}

const guides = Object.fromEntries(PAGES.map((p) => [p, guideOf(read(p))]));

test('each paper carries exactly one guide, listing all three papers', () => {
  for (const page of PAGES) {
    assert.equal(guides[page].count, 1, `${page} has ${guides[page].count} document guides`);
    assert.deepEqual(guides[page].entries.map((e) => e.href).sort(), [...PAGES].sort(), `${page}'s guide does not list the three papers`);
    for (const e of guides[page].entries) {
      assert.ok(e.name && e.for && e.about, `${page}'s guide entry for ${e.href} is missing its name, line or description`);
    }
  }
});

test('the three copies agree, and each marks only its own page as current', () => {
  const strip = (entries) => entries.map(({ current, ...rest }) => rest);
  const [first, ...rest] = PAGES;
  for (const page of rest) {
    assert.deepEqual(strip(guides[page].entries), strip(guides[first].entries), `${page}'s guide differs from ${first}'s`);
  }
  for (const page of PAGES) {
    const current = guides[page].entries.filter((e) => e.current).map((e) => e.href);
    assert.deepEqual(current, [page], `${page}'s guide marks ${JSON.stringify(current)} as the current page`);
  }
});

test('the Insights menu names and describes the papers the way the guide does, in its order', () => {
  const menu = menuEntries(read('js/navigation.js'), PAGES);
  const guide = guides[PAGES[0]].entries;
  assert.equal(menu.length, 3, `found ${menu.length} of the three papers in the menu`);
  assert.deepEqual(
    menu.map(({ href, label, desc }) => ({ href, label, desc })),
    guide.map(({ href, name, for: line }) => ({ href, label: name, desc: line })),
  );
});

test('the sitemap names and describes the papers the way the guide does', () => {
  const doc = new JSDOM(read('sitemap.html')).window.document;
  for (const e of guides[PAGES[0]].entries) {
    const card = doc.querySelector(`a.site-card[href="${e.href}"]`);
    assert.ok(card, `the sitemap has no card for ${e.href}`);
    assert.equal(text(card.querySelector('.site-card-name')), e.name, `sitemap name for ${e.href}`);
    assert.equal(text(card.querySelector('.site-card-desc')), e.for, `sitemap description for ${e.href}`);
  }
});
