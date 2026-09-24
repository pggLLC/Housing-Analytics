/**
 * Housing News (policy-briefs.html) — behavioural guard.
 *
 * History. F191 ordered the page by LIHTC relevance, so on a page titled
 * "Housing News" a two-month-old story sat above a three-day-old one. It was
 * then fixed to sort newest first, and this file pinned the variable names of
 * that fix. On 2026-09-24 the page was rebuilt from topic cards into a list
 * of headlines, because the card format itself hid news: each topic card
 * showed at most 25 articles with no way to see the rest, which left 41 of 96
 * in-scope stories unreachable by any click, filter or search.
 *
 * So this guard no longer pins source text. It runs the page in jsdom
 * against a stubbed fetch and asserts what a reader gets:
 *   - stories are newest first, before and after filtering;
 *   - every in-scope story is reachable (no per-topic cap);
 *   - the same headline from several outlets is one story;
 *   - other-state stories are out, federal policy is in;
 *   - tool evaluations and research briefs go to their own panels;
 *   - no clickable container wraps links (the old role="button" card).
 * The last test runs the committed data, so the page is checked against what
 * it will actually render.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HTML = fs.readFileSync(path.join(ROOT, 'policy-briefs.html'), 'utf8');

async function runPage(briefs, curated = { briefs: [] }) {
  const dom = new JSDOM(HTML, {
    runScripts: 'dangerously',
    url: 'http://localhost/policy-briefs.html',
    beforeParse(window) {
      window.fetch = (url) => Promise.resolve({
        ok: true,
        json: () => Promise.resolve(String(url).includes('curated') ? curated : briefs),
      });
      window.console.warn = () => {};
    },
  });
  const doc = dom.window.document;
  for (let i = 0; i < 200; i++) {
    const status = doc.getElementById('briefsStatus');
    if (doc.querySelector('.story') || (status && !/Loading/.test(status.textContent))) break;
    await new Promise((r) => setTimeout(r, 5));
  }
  return dom;
}

function expandAll(doc) {
  for (let i = 0; i < 100; i++) {
    const more = doc.getElementById('newsMore');
    if (!more) return;
    more.click();
  }
  throw new Error('"Show earlier" never ran out');
}

const visibleStories = (doc) => [...doc.querySelectorAll('.story')].filter((el) => !el.closest('[hidden]'));
const storyDates = (doc) => visibleStories(doc).map((el) => el.getAttribute('data-date'));
const isNewestFirst = (dates) => dates.every((d, i) => i === 0 || !d || !dates[i - 1] || dates[i - 1] >= d);

function article(title, source, date, link) {
  return { title: `${title} - ${source}`, source, date, link: link || `https://news.localhost/${encodeURIComponent(title)}` };
}

function fixture() {
  const bulk = [];
  for (let i = 0; i < 60; i++) {
    const day = String(1 + (i % 28)).padStart(2, '0');
    const month = i < 28 ? '08' : i < 56 ? '07' : '06';
    bulk.push(article(`Colorado housing story number ${i}`, 'Denver Post', `2026-${month}-${day}`));
  }
  return {
    meta: { generated: '2026-09-24T12:00:00Z' },
    briefs: [
      { policy_topic: 'Affordable Housing', articles: bulk },
      {
        policy_topic: 'General',
        articles: [
          article('Pueblo breaks ground on 98 homes', 'Pueblo Chieftain', '2026-09-20'),
          article('Pueblo breaks ground on 98 homes', 'KRDO', '2026-09-21'),
          article('Tennessee agency awards credits', 'Tennessee Lookout', '2026-09-23'),
          article('HUD rule change for public housing', 'Bisnow', '2026-09-22'),
          // Named with 'Colorado': the scope rule does not know Sterling yet (a
          // Phase 2 fix), and this guard is about ordering, not place names.
          article('Prop 123 funds go to Sterling, Colorado project', 'Sterling Journal-Advocate', '2026-09-10'),
          article('Denver council weighs Prop 123 opt-in', 'Denverite', '2026-09-05'),
        ],
      },
      {
        policy_topic: 'Tool Evaluations', is_tool_evaluation: true,
        articles: [{ title: 'Novogradac Rent & Income Limit Calculator', source: 'Novogradac', link: 'https://news.localhost/tool', date: '2026-07-21' }],
      },
    ],
  };
}

test('stories are newest first, and the first screen leads with the newest', async () => {
  const { window } = await runPage(fixture());
  const doc = window.document;
  expandAll(doc);
  const dates = storyDates(doc);
  assert.ok(dates.length > 10, 'the page rendered almost nothing; this guard would pass vacuously');
  assert.ok(isNewestFirst(dates), `stories are not newest first: ${dates.slice(0, 8).join(', ')}`);
  const lead = doc.querySelector('.story--lead');
  assert.ok(lead, 'no lead story');
  const newest = dates.filter(Boolean).sort().pop();
  assert.equal(lead.getAttribute('data-date'), newest, 'the lead story is not the newest one');
});

test('every in-scope story is reachable: no per-topic cap', async () => {
  const { window } = await runPage(fixture());
  const doc = window.document;
  expandAll(doc);
  const titles = [...doc.querySelectorAll('.story .story__link')].map((a) => a.textContent);
  const bulk = titles.filter((t) => /housing story number/.test(t));
  // One topic brief carried 60 articles. The old card showed 25.
  assert.equal(bulk.length, 60, `only ${bulk.length} of 60 stories from one topic are reachable`);
  // 60 bulk + merged Pueblo + HUD + two Prop 123 stories; Tennessee is out.
  assert.match(doc.getElementById('newsCount').textContent, /^64 stories/,
    'the story count in the header does not match what the page can show');
});

test('the same headline from several outlets is one story', async () => {
  const { window } = await runPage(fixture());
  const doc = window.document;
  expandAll(doc);
  const pueblo = [...doc.querySelectorAll('.story')].filter((el) => /Pueblo breaks ground/.test(el.textContent));
  assert.equal(pueblo.length, 1, 'duplicate headline shown twice');
  assert.match(pueblo[0].querySelector('.story__also').textContent, /Pueblo Chieftain/,
    'the other outlet is not listed under the merged story');
  const sterling = [...doc.querySelectorAll('.story__link')].find((l) => /Sterling/.test(l.textContent));
  assert.equal(sterling.textContent, 'Prop 123 funds go to Sterling, Colorado project',
    'a publisher name containing a hyphen was left on the headline');
});

test('other states are out, federal policy is in', async () => {
  const { window } = await runPage(fixture());
  const doc = window.document;
  expandAll(doc);
  const text = doc.getElementById('newsLatestBody').textContent + doc.getElementById('newsRiverBody').textContent;
  assert.doesNotMatch(text, /Tennessee agency/, 'an other-state story is shown');
  assert.match(text, /HUD rule change/, 'a federal policy story was dropped');
});

test('filtering keeps the order and shows only matches', async () => {
  const { window } = await runPage(fixture());
  const doc = window.document;
  const chip = doc.querySelector('.news-chip[data-program="Prop 123"]');
  assert.ok(chip, 'no Prop 123 filter although two headlines mention it');
  chip.click();
  assert.equal(doc.getElementById('newsLatest').hidden, true, 'Latest should give way to the results');
  const titles = [...doc.querySelectorAll('#newsRiverBody .story .story__link')].map((a) => a.textContent);
  assert.deepEqual(titles, ['Prop 123 funds go to Sterling, Colorado project', 'Denver council weighs Prop 123 opt-in']);
  assert.ok(isNewestFirst(storyDates(doc)), 'filtered results are not newest first');
  doc.getElementById('newsClear').click();
  assert.ok(doc.querySelector('.story--lead'), 'clearing filters did not restore the full list');
});

test('tool evaluations and research briefs go to their own panels', async () => {
  const curated = { briefs: [{ id: 'x', is_curated: true, source_reviewed: true, title: 'A reviewed research brief',
    summary: 'First sentence. Second sentence. Third sentence.', sources: ['Minneapolis Fed'],
    articles: [{ link: 'https://news.localhost/brief' }], generated: '2026-07-26T00:00:00Z' }] };
  const { window } = await runPage(fixture(), curated);
  const doc = window.document;
  expandAll(doc);
  const news = doc.getElementById('newsLatestBody').textContent + doc.getElementById('newsRiverBody').textContent;
  assert.doesNotMatch(news, /Rent & Income Limit Calculator/, 'a tool evaluation is mixed into the news');
  assert.match(doc.getElementById('toolWatchList').textContent, /Rent & Income Limit Calculator/);
  assert.equal(doc.getElementById('toolWatchPanel').hidden, false);
  assert.match(doc.getElementById('researchList').textContent, /Source-reviewed brief[\s\S]*A reviewed research brief/);
});

test('no clickable container wraps links', async () => {
  const { window } = await runPage(fixture());
  const nested = [...window.document.querySelectorAll('[role="button"]')].filter((el) => el.querySelector('a, button'));
  assert.equal(nested.length, 0, 'an element with role="button" contains links; screen readers cannot reach them');
});

test('the committed data renders newest first, every story reachable', async () => {
  const briefs = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'policy_briefs.json'), 'utf8'));
  const curated = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'policy_briefs_curated.json'), 'utf8'));
  const { window } = await runPage(briefs, curated);
  const doc = window.document;
  expandAll(doc);
  const dates = storyDates(doc);
  assert.ok(dates.length > 0, 'the committed data renders no stories');
  assert.ok(isNewestFirst(dates), 'the committed data does not render newest first');
  const advertised = Number((doc.getElementById('newsCount').textContent.match(/^(\d+)/) || [])[1]);
  assert.equal(dates.length, advertised, 'the header count and the stories a reader can reach disagree');
});
