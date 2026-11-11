#!/usr/bin/env node
// Site search must find every public page, and the searches readers actually type.
//
//   node test/site-search.test.mjs                          # the built dist/ (run after build:public)
//   node test/site-search.test.mjs https://cohoanalytics.com/   # the live site, after a deploy
//
// Runs the browser's own ranking (js/site-search.js) over the real index, so a page that the
// index misses, or a search that the ranking buries, fails here instead of for a reader.

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { copyFile, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { gatedSearchIndex } from '../scripts/build-gated-search-index.mjs';
import { SEARCH_HIDDEN } from '../scripts/lib/search-index.mjs';

const { rank, kindOf, shortTitle } = createRequire(import.meta.url)('../js/site-search.js');
const live = process.argv[2];

async function load(rel) {
  if (!live) return readFile(path.join('dist', rel), 'utf8');
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(new URL(rel, live), { cache: 'no-store' });
    if (res.ok) return res.text();
    if (attempt >= 3) throw new Error(`${rel}: HTTP ${res.status}`);
    await new Promise((r) => setTimeout(r, 5000));
  }
}

const index = JSON.parse(await load('search-index.json'));
const sitemap = await load('sitemap.xml');
assert(index.length > 500, `search index has only ${index.length} records`);

const top = (q, n = 5) => rank(index, q).slice(0, n).map((r) => r.u);
const failures = [];
function expectFound(q, url, n = 5) {
  const got = top(q, n);
  if (!got.includes(url)) failures.push(`"${q}" should list ${url} in its top ${n}; got ${got.join(', ') || 'nothing'}`);
}

// 1. Every page in the sitemap has a search record.
const urls = new Set(index.map((r) => r.u));
const bare = new Set(index.map((r) => r.u.replace(/#.*$/, '')));
for (const [, loc] of sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)) {
  const u = new URL(loc.replace(/&amp;/g, '&'));
  const rel = decodeURIComponent(u.pathname.replace(/^\//, '')) + u.search;
  // The article's county maps are iframes inside it; search finds the article.
  if (rel.startsWith('assets/')) continue;
  const key = (rel === '' || rel.endsWith('/')) ? `${rel}index.html` : rel;
  if (!urls.has(key) && !bare.has(key)) failures.push(`sitemap page ${key} is missing from the search index`);
}

// 2. Every page is found by its own name.
for (const r of index) {
  if (r.u.includes('#') || r.u.includes('?') || r.u.startsWith('places/') || r.u.startsWith('docs/')) continue;
  const name = r.t.replace(/\s*[|—].*$/, '').trim();
  if (name.length >= 4) expectFound(name, r.u, 10);
}

// 3. Searches readers type, including the run-together spellings.
const SEARCHES = [
  ['land banking', 'land-banking-awards.html'],
  ['landbanking', 'land-banking-awards.html'],
  ['land banking map', 'land-banking-awards.html'],
  ['prop 123', 'land-banking-awards.html'],
  ['prop123', 'land-banking-awards.html'],
  ['commuting', 'commuting.html'],
  ['largest employers', 'commuting.html'],
  ['deal calculator', 'deal-calculator.html'],
  ['market analysis', 'market-analysis.html'],
  ['housing needs assessment', 'housing-needs-assessment.html'],
  ['map', 'data-map-browser.html'],
  ['silt', 'places/0870195.html'],
  // Readers looking for help use their own words, not the page's.
  ['help paying rent', 'housing-help.html', 1],
  ['rental assistance', 'housing-help.html'],
  ['eviction', 'housing-help.html', 1],
  ['first-time homebuyer', 'help-for-homebuyers.html', 1],
  ['data', 'data-review-hub.html', 1],
  ['map', 'data-map-browser.html', 1],
];
for (const [q, url, n] of SEARCHES) expectFound(q, url, n);

// 3b. What readers care about, not how the site is run: maintainer screens, templates and
// contributor notes stay out; definitions and method notes do not crowd out the pages.
for (const u of SEARCH_HIDDEN.keys()) {
  if (urls.has(u)) failures.push(`${u} is maintainer-only (${SEARCH_HIDDEN.get(u)}) but is in the search index`);
}
for (const q of ['rent', 'data', 'housing authority', 'construction costs', 'voucher']) {
  const backups = rank(index, q).slice(0, 5).filter((r) => kindOf(r.u) === 'Glossary' || kindOf(r.u) === 'Methodology');
  if (backups.length > 1) failures.push(`"${q}" top 5 has ${backups.length} glossary or methodology rows: ${backups.map((r) => r.u).join(', ')}`);
}
// A term search still puts its definition first.
for (const [q, url] of [['ami', 'index.html#glossary=AMI'], ['qap', 'index.html#glossary=QAP']]) expectFound(q, url, 1);
// Titles show as words: no entity codes, and no site name tacked on.
for (const r of index) {
  if (/&#?[a-z0-9]+;/i.test(r.t)) failures.push(`${r.u} title shows an entity code: ${r.t}`);
}
const shown = shortTitle('Deal Calculator | COHO Analytics');
if (shown !== 'Deal Calculator') failures.push(`result titles should drop the site name; got "${shown}"`);

// 4. On the developer site, its own pages are searchable and place profiles go to the public site.
if (!live) {
  const bundle = await mkdtemp(path.join(os.tmpdir(), 'gated-search-'));
  try {
    await writeFile(path.join(bundle, 'search-index.json'), JSON.stringify(index));
    for (const name of (await readdir('.')).filter((n) => /^developer.*\.html$/.test(n))) {
      await copyFile(name, path.join(bundle, name));
    }
    const { records, added } = await gatedSearchIndex(bundle);
    assert(added.length > 0, 'the developer site added no pages to its search index');
    for (const r of added) {
      const got = rank(records, r.t.replace(/\s*[|—].*$/, '')).slice(0, 10).map((x) => x.u);
      if (!got.includes(r.u)) failures.push(`developer site: "${r.t}" does not find ${r.u}`);
    }
    const gatedTop = rank(records, 'land banking map').slice(0, 5).map((r) => r.u);
    if (!gatedTop.includes('developer-where.html')) {
      failures.push(`developer site: "land banking map" should list developer-where.html; got ${gatedTop.join(', ')}`);
    }
    // Rewritten place URLs still rank below topic pages on a topic search.
    const topical = rank(records, 'rent burden').slice(0, 10).filter((r) => r.u.includes('places/'));
    if (topical.length > 2) failures.push(`developer site: "rent burden" top 10 has ${topical.length} place profiles`);
    assert(records.filter((r) => r.u.includes('places/')).every((r) => r.u.startsWith('https://cohoanalytics.com/places/')),
      'developer site: place profiles must link to the public site, which serves them');
  } finally {
    await rm(bundle, { recursive: true, force: true });
  }
}

assert.deepEqual(failures, [], `${failures.length} search problem(s):\n  ${failures.join('\n  ')}`);
console.log(`site search OK${live ? ` on ${live}` : ''}: ${index.length} records, every sitemap page indexed and found by name.`);
