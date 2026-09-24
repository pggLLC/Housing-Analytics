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
 *   - every story is reachable (no per-topic cap);
 *   - the page shows the pipeline's stories as given: it does not re-decide
 *     scope or merge headlines itself (tests/test_news_stories.py covers
 *     those rules in scripts/generate_policy_briefs.py);
 *   - a story naming a place can be filtered by that place and its region,
 *     and shows that place's own numbers from its metrics digest, with no
 *     missing value rendered as 0;
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

async function runPage(briefs, curated = { briefs: [] }, digests = {}) {
  const dom = new JSDOM(HTML, {
    runScripts: 'dangerously',
    url: 'http://localhost/policy-briefs.html',
    beforeParse(window) {
      window.fetch = (url) => {
        const u = String(url);
        const digest = u.match(/jurisdiction-metrics-digest\/(\d+)\.json/);
        if (digest) {
          const doc = digests[digest[1]];
          return Promise.resolve({ ok: !!doc, json: () => Promise.resolve(doc) });
        }
        if (u.includes('glossary.json')) {
          const terms = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'glossary.json'), 'utf8'));
          return Promise.resolve({ ok: true, json: () => Promise.resolve(terms) });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve(u.includes('curated') ? curated : briefs) });
      };
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

const settle = () => new Promise((r) => setTimeout(r, 20));

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

function story(title, source, date, extra = {}) {
  return { title, source, date, link: `https://news.localhost/${encodeURIComponent(title)}`,
    scope: 'colorado', programs: [], places: [], regions: [], also: [], ...extra };
}

const STERLING = { geoid: '0873935', name: 'Sterling', type: 'place' };
const FRISCO = { geoid: '0828690', name: 'Frisco', type: 'place' };

function fixture() {
  const bulk = [];
  for (let i = 0; i < 60; i++) {
    const day = String(1 + (i % 28)).padStart(2, '0');
    const month = i < 28 ? '08' : i < 56 ? '07' : '06';
    bulk.push(story(`Colorado housing story number ${i}`, 'Denver Post', `2026-${month}-${day}`));
  }
  const stories = [
    ...bulk,
    story('Pueblo breaks ground on 98 homes', 'KRDO', '2026-09-21', {
      places: [{ geoid: '0862000', name: 'Pueblo', type: 'place' }], regions: ['Front Range'],
      also: [{ source: 'Pueblo Chieftain', link: 'https://news.localhost/pueblo', date: '2026-09-20' }] }),
    story('HUD rule change for public housing', 'Bisnow', '2026-09-22', { scope: 'federal', programs: ['HUD'] }),
    story('Sterling housing project is recipient of Proposition 123 funds', 'Sterling Journal-Advocate', '2026-09-10', {
      programs: ['Prop 123'], places: [STERLING], regions: ['Eastern Plains'] }),
    story('Frisco breaks ground on new affordable housing complex', 'CBS News', '2026-09-23', {
      places: [FRISCO], regions: ['Mountains'] }),
    story('Denver council weighs Prop 123 opt-in', 'Denverite', '2026-09-05', {
      programs: ['Prop 123'], places: [{ geoid: '0820000', name: 'Denver', type: 'place' }], regions: ['Front Range'] }),
  ];
  // Reversed: the page must order by date, not trust the file's order.
  stories.reverse();
  return {
    meta: { generated: '2026-09-24T12:00:00Z' },
    briefs: [
      { policy_topic: 'Affordable Housing', articles: [{ title: 'A headline only in a brief - X', source: 'X', date: '2026-09-24' }] },
      {
        policy_topic: 'Tool Evaluations', is_tool_evaluation: true,
        articles: [{ title: 'Novogradac Rent & Income Limit Calculator', source: 'Novogradac', link: 'https://news.localhost/tool', date: '2026-07-21' }],
      },
    ],
    stories,
  };
}

function digest(name, metrics) {
  const m = {};
  for (const [k, v] of Object.entries(metrics)) {
    m[k] = { value: v, confidence: v === null ? 'missing' : 'high', as_of: 'ACS 2020-2024 5-year' };
  }
  return { geography: { name }, metrics: m };
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
  // 60 bulk + Pueblo + HUD + Sterling + Frisco + Denver.
  assert.match(doc.getElementById('newsCount').textContent, /^65 stories/,
    'the story count in the header does not match what the page can show');
});

test('the page shows the pipeline stories as given, not headlines from the topic briefs', async () => {
  const { window } = await runPage(fixture());
  const doc = window.document;
  expandAll(doc);
  const text = doc.getElementById('newsLatestBody').textContent + doc.getElementById('newsRiverBody').textContent;
  assert.doesNotMatch(text, /A headline only in a brief/,
    'the page built a story from a topic brief; scope and merging are the pipeline\'s job');
  const pueblo = [...doc.querySelectorAll('.story')].filter((el) => /Pueblo breaks ground/.test(el.textContent));
  assert.equal(pueblo.length, 1);
  assert.match(pueblo[0].querySelector('.story__also').textContent, /Pueblo Chieftain/,
    'the outlets the pipeline merged are not listed under the story');
  assert.match(text, /HUD rule change/, 'a federal policy story was dropped');
});

test('a place named in a headline filters by that place and by its region', async () => {
  const { window } = await runPage(fixture());
  const doc = window.document;
  const sel = doc.getElementById('regionFilter');
  const group = (label) => [...sel.querySelectorAll('optgroup')].find((g) => g.label === label);
  assert.ok(group('Places'), 'no Places group in the filter');
  const sterling = [...group('Places').querySelectorAll('option')].find((o) => /^Sterling \(1\)$/.test(o.textContent));
  assert.ok(sterling, 'Sterling is not offered as a place filter');
  sel.value = sterling.value;
  sel.dispatchEvent(new window.Event('change'));
  let titles = [...doc.querySelectorAll('#newsRiverBody .story .story__link')].map((a) => a.textContent);
  assert.deepEqual(titles, ['Sterling housing project is recipient of Proposition 123 funds']);
  assert.ok([...group('Regions').querySelectorAll('option')].some((o) => o.value === 'Eastern Plains'),
    'the region the pipeline gave Sterling is not a filter');
  sel.value = 'Eastern Plains';
  sel.dispatchEvent(new window.Event('change'));
  titles = [...doc.querySelectorAll('#newsRiverBody .story .story__link')].map((a) => a.textContent);
  assert.deepEqual(titles, ['Sterling housing project is recipient of Proposition 123 funds']);
});

test('a story naming a place shows that place\'s numbers, and a missing number is left out, not 0', async () => {
  const digests = {
    '0873935': digest('Sterling (city)', { pct_cost_burdened: 50.9, gross_rent_median: 1031, housing_gap_units: 485 }),
    '0828690': digest('Frisco (town)', { pct_cost_burdened: null, gross_rent_median: 1954, housing_gap_units: 0 }),
  };
  const { window } = await runPage(fixture(), { briefs: [] }, digests);
  const doc = window.document;
  expandAll(doc);
  await settle();
  const lineFor = (re) => [...doc.querySelectorAll('.story')].find((el) => re.test(el.textContent))
    .querySelector('.story__local');
  const sterling = lineFor(/Sterling housing project/).textContent;
  assert.match(sterling, /Sterling \(city\):/);
  assert.match(sterling, /51% of renter households rent-burdened/);
  assert.match(sterling, /median gross rent \$1,031/);
  assert.match(sterling, /485 units short/);
  assert.match(sterling, /ACS 2020-2024 5-year/, 'the numbers are shown without their vintage');
  const frisco = lineFor(/Frisco breaks ground/).textContent;
  assert.match(frisco, /median gross rent \$1,954/);
  assert.doesNotMatch(frisco, /rent-burdened/, 'a missing burden share was rendered');
  assert.doesNotMatch(frisco, /\b0 units/, 'a zero gap was rendered as a real number');
  assert.equal(lineFor(/Frisco breaks ground/).querySelector('a').getAttribute('href'),
    'housing-needs-assessment.html?geoid=0828690', 'the local line does not open the place\'s assessment');
  const denver = lineFor(/Denver council/);
  assert.equal(denver.querySelectorAll('a').length, 1, 'a place with no digest lost its assessment link');
  assert.doesNotMatch(denver.textContent, /\d/, 'numbers appeared for a place with no digest');
});

test('filtering keeps the order and shows only matches', async () => {
  const { window } = await runPage(fixture());
  const doc = window.document;
  const chip = doc.querySelector('.news-chip[data-program="Prop 123"]');
  assert.ok(chip, 'no Prop 123 filter although two headlines mention it');
  chip.click();
  assert.equal(doc.getElementById('newsLatest').hidden, true, 'Latest should give way to the results');
  const titles = [...doc.querySelectorAll('#newsRiverBody .story .story__link')].map((a) => a.textContent);
  assert.deepEqual(titles, ['Sterling housing project is recipient of Proposition 123 funds', 'Denver council weighs Prop 123 opt-in']);
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

test('every control the page renders has a 44px touch target (rule 14)', async () => {
  const { window } = await runPage(fixture());
  const doc = window.document;
  doc.querySelector('.news-chip').click(); // renders the Clear control too
  const css = [...doc.querySelectorAll('style')].map((s) => s.textContent).join('\n');
  const rulesFor = (sel) => [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)]
    .filter(([, sels]) => sels.split(',').some((x) => x.trim() === sel)).map(([, , body]) => body);
  const controls = [...doc.querySelectorAll('.news-toolbar button, .news-toolbar input, .news-toolbar select, #newsRiver button')];
  assert.ok(controls.length >= 3, 'the scan found almost no controls; this guard would pass vacuously');
  const missing = controls.filter((el) => {
    const sels = [...el.classList].map((c) => '.' + c);
    if (el.closest('.news-search') && el.tagName === 'INPUT') sels.push('.news-search input');
    if (el.closest('.news-place') && el.tagName === 'SELECT') sels.push('.news-place select');
    return !sels.some((sel) => rulesFor(sel).some((body) => /min-height:\s*44px/.test(body)));
  }).map((el) => el.outerHTML.slice(0, 80));
  assert.deepEqual(missing, [], 'controls below the 44px minimum');
});

test('neither glossary script splices definitions into headlines or local lines', async () => {
  // Both js/glossary.js and js/components/inline-glossary.js must honour
  // .no-glossary. Run the real glossary.js against the rendered page.
  const digests = { '0873935': digest('Sterling (city)', { pct_cost_burdened: 50.9, gross_rent_median: 1031, housing_gap_units: 485 }) };
  const f = fixture();
  f.stories.push(story('HUD and CHFA announce AMI changes', 'Colorado Sun', '2026-09-24', {
    programs: ['HUD', 'CHFA'], places: [STERLING], regions: ['Eastern Plains'] }));
  const { window } = await runPage(f, { briefs: [] }, digests);
  const doc = window.document;
  expandAll(doc);
  await settle();
  window.eval(fs.readFileSync(path.join(ROOT, 'js', 'glossary.js'), 'utf8'));
  await new Promise((r) => setTimeout(r, 400));
  const wrapped = [...doc.querySelectorAll('.gl-tooltip-trigger')];
  assert.ok(wrapped.length > 0, 'glossary.js wrapped nothing anywhere; this guard would pass vacuously');
  const inNews = wrapped.filter((el) => el.closest('#newsLatestBody, #newsRiverBody, #toolWatchList'));
  assert.deepEqual(inNews.map((el) => el.textContent.slice(0, 30)), [],
    'glossary definitions were spliced into the news list');
});
