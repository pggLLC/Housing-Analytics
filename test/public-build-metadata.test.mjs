#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { isSensitive } from '../scripts/lib/public-sensitive-patterns.mjs';
import { pageTabs, pageText, redirectAlias, wordBag } from '../scripts/lib/search-index.mjs';

execFileSync(process.execPath, ['scripts/build-public-site.mjs'], { stdio: 'inherit' });

// The deploy guard rejects the whole artifact if a forbidden file reaches dist,
// and deploy.yml runs on PUSH ONLY — never on pull_request. So a file that trips
// it cannot be caught before merge, and the failure surfaces as every deploy
// failing while main keeps moving and the live site quietly goes stale. That
// happened on 2026-09-15: #1680 added a sixth parquet to a five-entry
// exclusion list. Run the real guard here, where PRs do see it.
execFileSync(process.execPath, ['scripts/audit/public-artifact-guard.mjs', 'dist'], { stdio: 'inherit' });

function jsonLdBlocks(html) {
  return Array.from(html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi))
    .map((match) => JSON.parse(match[1]));
}

function hasSchemaType(blocks, type) {
  return blocks.some((block) => {
    if (block['@type'] === type) return true;
    return Array.isArray(block['@graph']) && block['@graph'].some((node) => node['@type'] === type);
  });
}

const sitemap = await readFile('dist/sitemap.xml', 'utf8');
const sitemapUrls = sitemap.match(/<loc>https:\/\/[^<]+<\/loc>/g) || [];
const placeUrls = sitemap.match(/<loc>https:\/\/[^<]+\/places\/\d{7}\.html<\/loc>/g) || [];
assert(placeUrls.length >= 480, `expected at least 480 place URLs, found ${placeUrls.length}`);
assert(sitemapUrls.length >= 500, `expected sitemap to include public tool pages plus places, found ${sitemapUrls.length}`);
assert(!sitemap.includes('developer-brief'), 'private developer pages must not enter the sitemap');
assert(!sitemap.includes('_template.html'), 'templates must not enter the sitemap');
assert(!sitemap.includes('404.html'), '404 page must not enter the sitemap');
const curated = JSON.parse(await readFile('dist/data/policy_briefs_curated.json', 'utf8'));
const researchIds = curated.briefs.filter((brief) => brief.is_curated).map((brief) => brief.id).sort();
assert(researchIds.length > 0, 'no curated briefs to check in the public sitemap');
const readerUrls = sitemapUrls.filter((url) => url.includes('/research-brief.html'));
assert.deepEqual(readerUrls.map((loc) => new URL(loc.replace(/<\/?loc>/g, '')).searchParams.get('id')).sort(),
  researchIds, 'the public sitemap must link every existing curated id, never the bare reader');
const reader = await readFile('dist/research-brief.html', 'utf8');
assert(reader.includes('data/policy_briefs_curated.json'), 'the built reader must load the shipped curated feed');
const searchIndex = JSON.parse(await readFile('dist/search-index.json', 'utf8'));
assert(!searchIndex.some((record) => record.u === 'research-brief.html'),
  'search must not send readers to a brief URL without an id');

// Search coverage. Each check derives what the index must hold from what the build serves,
// never from a list kept here: a new county, tab, brief, doc or redirect is covered by itself.
const searchUrls = new Set(searchIndex.map((record) => record.u));
const searchable = (record) => [record.t, record.a, record.k, record.d, record.b].join(' ').toLowerCase();

const ranking = JSON.parse(await readFile('dist/data/hna/ranking-index.json', 'utf8'));
const counties = ranking.rankings.filter((row) => row.type === 'county');
assert.equal(counties.length, 64, 'the ranking index should list all 64 Colorado counties');
for (const county of counties) {
  const record = searchIndex.find((r) => r.u.startsWith(`housing-needs-assessment.html?geoid=${county.geoid}&`));
  assert(record, `search must find ${county.name} (${county.geoid})`);
  assert(record.t.includes(county.name), `${county.geoid}'s search title must carry the name the ranking index gives it`);
}

for (const brief of curated.briefs.filter((b) => b.is_curated)) {
  const record = searchIndex.find((r) => r.u === `research-brief.html?id=${encodeURIComponent(brief.id)}`);
  assert(record, `search must find curated brief ${brief.id}`);
  // The reader renders the implications and the source titles, so their words must be searchable too.
  const rendered = [brief.summary, brief.implications, ...(brief.articles || []).map((a) => a && a.title)]
    .flat().filter((v) => typeof v === 'string').join(' ');
  const missing = wordBag(pageText(rendered)).split(' ').filter((w) => w.length >= 4 && !searchable(record).includes(w));
  assert.deepEqual(missing.slice(0, 5), [], `brief ${brief.id}: rendered words missing from its search record`);
}

const servedDocs = (await readdir('dist/docs', { recursive: true })).filter((name) => name.endsWith('.md'));
assert(servedDocs.length > 0, 'no public methodology docs found to check in search');
for (const name of servedDocs) assert(searchUrls.has(`docs/${name.split(path.sep).join('/')}`), `search must find docs/${name}`);

const servedRootPages = (await readdir('dist')).filter((name) => name.endsWith('.html'));
let tabbedPages = 0;
let redirects = 0;
for (const name of servedRootPages) {
  const html = await readFile(`dist/${name}`, 'utf8');
  const tabs = pageTabs(html);
  if (tabs.length > 1) {
    tabbedPages++;
    tabs.forEach((tab, i) => {
      const url = i === 0 ? name : `${name}#${tab.id}`;
      const record = searchIndex.find((r) => r.u === url);
      assert(record, `search must have its own result for the "${tab.label}" tab of ${name}`);
      assert(record.k.includes(tab.label), `${url}'s result must carry its tab's label, "${tab.label}"`);
    });
  }
  const redirect = redirectAlias(name, html);
  if (redirect && !searchUrls.has(name) && !isSensitive(redirect.alias)) {
    redirects++;
    const target = searchIndex.find((r) => r.u === redirect.target) ||
      searchIndex.find((r) => r.u === redirect.target.replace(/#.*$/, ''));
    assert(target, `${name} redirects to ${redirect.target}, which search does not index`);
    assert((target.a || '').includes(redirect.alias), `searching "${redirect.alias}" must find ${redirect.target}, where ${name} now goes`);
  }
  // Every word a reader can see on an untabbed page is searchable, unless the page hit the word cap.
  const record = tabs.length > 1 ? null : searchIndex.find((r) => r.u === name);
  if (record && (record.b || '').split(' ').length < 1499) {
    const text = searchable(record);
    const missing = wordBag(pageText(html)).split(' ')
      .filter((word) => word.length >= 4 && !text.includes(word));
    assert.deepEqual(missing.slice(0, 5), [], `${name}: visible words missing from its search record`);
  }
}
assert(tabbedPages > 0, 'no page with page-level tabs found; the tab coverage check checked nothing');
assert(redirects > 0, 'no redirect stubs found; the old-name check checked nothing');

// The ranking js/site-search.js applies, run against the built index.
const searchSource = await readFile('js/site-search.js', 'utf8');
const runSearch = new Function('index',
  `${searchSource.slice(searchSource.indexOf('function norm'), searchSource.indexOf('function render'))}; return search;`)(searchIndex);
const firstFor = (q) => (runSearch(q)[0] || {}).u;
const constructionTab = searchIndex.find((r) => /construction/i.test(r.u + r.k) && r.u.includes('#'));
assert(constructionTab, 'expected a Construction Labor & Costs tab result');
assert.equal(firstFor(constructionTab.k.split(' · ')[0]), constructionTab.u, 'a tab\'s own name must rank that tab first');
assert(firstFor(counties[0].name).startsWith(`housing-needs-assessment.html?geoid=${counties[0].geoid}&`),
  `searching "${counties[0].name}" must rank the county first`);
const bodyOnly = new Function('index',
  `${searchSource.slice(searchSource.indexOf('function norm'), searchSource.indexOf('function render'))}; return search;`)(
  [{ t: 'Page', u: 'p.html', d: '', k: '', b: 'family dynamic' }]);
assert.equal(bodyOnly('ami').length, 0, 'body words match from the start of a word: "ami" must not hit "family"');
assert.equal(bodyOnly('fam').length, 1, 'a body word must match its own prefix');

const index = await readFile('dist/index.html', 'utf8');
const indexJsonLd = jsonLdBlocks(index);
assert(hasSchemaType(indexJsonLd, 'Organization'), 'index must include Organization JSON-LD');
assert(hasSchemaType(indexJsonLd, 'WebSite'), 'index must include WebSite JSON-LD');

const silt = await readFile('dist/places/0870195.html', 'utf8');
const siltJsonLd = jsonLdBlocks(silt);
assert(hasSchemaType(siltJsonLd, 'Place'), 'place pages must include Place JSON-LD');
assert(hasSchemaType(siltJsonLd, 'Dataset'), 'place pages must include Dataset JSON-LD');
assert(JSON.stringify(siltJsonLd).includes('"identifier":"0870195"'), 'place JSON-LD must include its GEOID');

console.log(`Public build metadata: PASS (${sitemapUrls.length} URLs, ${placeUrls.length} place URLs, ${searchIndex.length} search records)`);
