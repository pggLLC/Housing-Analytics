/**
 * Upcoming events on Housing News, and the news panel under each
 * jurisdiction brief — what a reader gets, run in jsdom.
 *
 * Both surfaces show feed data that ages: CHFA's and Housing Colorado's
 * calendars (data/policy/housing-events.json) and the headlines that named a
 * brief since its last review (data/alerts/brief-news-queue.json). The rule
 * for both is the same: never show an old list as if it were current. So
 * these tests assert that ended events and pre-review headlines are not
 * shown, that a file which stopped updating shows nothing and says so, that a
 * calendar which could not be read is named, and that the panel agrees with
 * the data file it renders (every upcoming event in the file within the
 * window is listed, in date order). The issue body is checked against the
 * same queue. The Python side is tests/test_housing_events.py and
 * tests/test_brief_news_queue.py.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { issueBody, MARKER, md } from '../scripts/news/update-brief-review-issue.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const HE = require('../js/components/housing-events.js');
const HTML = fs.readFileSync(path.join(ROOT, 'policy-briefs.html'), 'utf8');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const NOW = new Date('2026-10-14T15:00:00Z');
const day = (n) => new Date(NOW.getTime() + n * 864e5).toISOString().slice(0, 10);

function eventsDoc(events, extra = {}) {
  return {
    meta: { generated: '2026-10-14T09:30:00Z', as_of: '2026-10-14', categories: {
      conference: 'Conferences', compliance: 'Property management & compliance training', board: 'Board meetings' } },
    sources: [{ id: 'chfa', name: 'CHFA events and chfareach calendar', status: 'ok' },
      { id: 'housing_colorado', name: 'Housing Colorado upcoming events', status: 'ok' }],
    events,
    ...extra,
  };
}

const EV = [
  { title: 'Ended yesterday', start: day(-3), end: day(-1), category: 'compliance', organizer: 'CHFA', url: 'https://chfa.localhost/a' },
  { title: 'Housing Colorado Annual Conference', start: day(0), end: day(2), category: 'conference', organizer: 'Housing Colorado', location: 'Keystone', url: 'https://hc.localhost/c' },
  { title: 'NSPIRE Inspections, Fort Collins', start: day(8), time: '13:00', category: 'compliance', organizer: 'CHFA', location: 'In-person, Fort Collins', url: 'https://chfa.localhost/n' },
  { title: 'Board meeting', start: day(8), category: 'board', organizer: 'CHFA', url: 'javascript:alert(1)' },
  { title: 'Too far out', start: day(90), category: 'compliance', organizer: 'CHFA' },
];

async function runNewsPage(events, now = NOW) {
  const dom = new JSDOM(HTML, {
    runScripts: 'dangerously',
    url: 'http://localhost/policy-briefs.html',
    beforeParse(window) {
      const RealDate = window.Date;
      window.Date = class extends RealDate {
        constructor(...a) { super(...(a.length ? a : [now.getTime()])); }
        static now() { return now.getTime(); }
      };
      window.fetch = (url) => {
        const u = String(url);
        if (u.includes('housing-events.json')) return Promise.resolve({ ok: !!events, json: () => Promise.resolve(events) });
        if (u.includes('policy_briefs.json')) {
          return Promise.resolve({ ok: true, json: () => Promise.resolve({ meta: { generated: '2026-10-14T09:00:00Z' },
            stories: [{ title: 'A Colorado story', source: 'Denverite', date: '2026-10-13', link: 'https://news.localhost/a',
              scope: 'colorado', programs: [], places: [], regions: [], also: [] }] }) });
        }
        return Promise.resolve({ ok: false, json: () => Promise.resolve(null) });
      };
      window.console.warn = () => {};
      for (const f of ['js/workflow/recommendation-contract.js', 'js/components/policy-watch.js',
        'js/components/research-catalog.js', 'js/components/housing-events.js']) window.eval(read(f));
    },
  });
  const doc = dom.window.document;
  for (let i = 0; i < 200 && doc.getElementById('eventsPanel').hidden && !doc.querySelector('.story'); i++) {
    await new Promise((r) => setTimeout(r, 5));
  }
  await new Promise((r) => setTimeout(r, 20));
  return doc;
}

const titles = (doc) => [...doc.querySelectorAll('#eventsList .event-row__title')].map((el) => el.textContent);

test('the panel lists every upcoming event in the window, soonest first, and no ended one', async () => {
  const doc = await runNewsPage(eventsDoc(EV));
  assert.equal(doc.getElementById('eventsPanel').hidden, false);
  const expected = HE.read(eventsDoc(EV), NOW).events.map((e) => e.title);
  // Same day: an all-day item (no time) before a timed one.
  assert.deepEqual(expected, ['Housing Colorado Annual Conference', 'Board meeting', 'NSPIRE Inspections, Fort Collins']);
  assert.deepEqual(titles(doc), expected, 'the panel disagrees with the file it renders');
  assert.match(doc.querySelector('#eventsList .event-row__when').textContent, /^Oct 14–16$/);
  assert.match(doc.getElementById('eventsList').textContent, /Oct 22 · 1 pm/);
  assert.equal(doc.querySelector('#eventsList a[href^="javascript"]'), null, 'a non-http link was rendered');
});

test('a type filter narrows the list and "All" restores it', async () => {
  const doc = await runNewsPage(eventsDoc(EV));
  const chips = [...doc.querySelectorAll('#eventChips button')];
  assert.deepEqual(chips.map((b) => b.getAttribute('data-category')), ['', 'conference', 'compliance', 'board']);
  chips.find((b) => b.getAttribute('data-category') === 'board').click();
  assert.deepEqual(titles(doc), ['Board meeting']);
  chips[0].click();
  assert.equal(titles(doc).length, 3);
});

test('a file that stopped updating shows no events and says when it last updated', async () => {
  const old = eventsDoc(EV, {});
  old.meta.generated = '2026-09-30T09:00:00Z';
  const doc = await runNewsPage(old);
  assert.deepEqual(titles(doc), []);
  assert.match(doc.getElementById('eventsNote').textContent, /has not updated since September 30, 2026, so no events are shown/);
});

test('a calendar that could not be read is named', async () => {
  const d = eventsDoc(EV);
  d.sources[1].status = 'unreachable';
  const doc = await runNewsPage(d);
  assert.match(doc.getElementById('eventsNote').textContent, /Not available today: Housing Colorado upcoming events\./);
  assert.equal(titles(doc).length, 3, 'the other calendar still shows');
});

test('no events file, no panel; the news still loads', async () => {
  const doc = await runNewsPage(null);
  assert.equal(doc.getElementById('eventsPanel').hidden, true);
  assert.ok(doc.querySelector('.story'));
});

test('the committed events file renders: every event it holds in the window is shown', async () => {
  const committed = JSON.parse(read('data/policy/housing-events.json'));
  const asOf = new Date(committed.meta.generated);
  const st = HE.read(committed, asOf);
  assert.ok(st.events.length > 0, 'the committed file has no upcoming events to check');
  const doc = await runNewsPage(committed, asOf);
  doc.getElementById('eventsMore').hidden || doc.getElementById('eventsMore').click();
  assert.deepEqual(titles(doc), st.events.map((e) => e.title));
});

test('ended events move to Past events, newest first, and stay even when the file is old', async () => {
  const d = eventsDoc(EV, { past: [
    { title: 'Spooky Bingo', start: day(-20), category: 'networking', organizer: 'Housing Colorado', url: 'https://hc.localhost/b' },
    { title: 'Ended yesterday', start: day(-3), end: day(-1), category: 'compliance', organizer: 'CHFA', url: 'https://chfa.localhost/a' },
  ] });
  const doc = await runNewsPage(d);
  const past = () => [...doc.querySelectorAll('#eventsPastList .event-row__title')].map((el) => el.textContent);
  assert.equal(doc.getElementById('eventsPast').hidden, false);
  assert.equal(doc.getElementById('eventsPastLabel').textContent, 'Past events (2)', 'an event listed twice was counted twice');
  assert.deepEqual(past(), ['Ended yesterday', 'Spooky Bingo']);
  assert.match(doc.querySelector('#eventsPastList .event-row__when').textContent, /, 2026$/);
  assert.ok(!titles(doc).includes('Ended yesterday'), 'an ended event is still in the upcoming list');
  d.meta.generated = '2026-09-30T09:00:00Z';
  const stale = await runNewsPage(d);
  assert.deepEqual([...stale.querySelectorAll('#eventsPastList .event-row__title')].map((el) => el.textContent),
    ['Ended yesterday', 'Spooky Bingo'], 'past events are history; an old file still has them');
});

test('past events page in tens', async () => {
  const many = Array.from({ length: 23 }, (_, i) => ({ title: 'Past ' + i, start: day(-2 - i), category: 'board', organizer: 'CHFA' }));
  const doc = await runNewsPage(eventsDoc(EV, { past: many }));
  const count = () => doc.querySelectorAll('#eventsPastList .event-row').length;
  assert.equal(count(), 10);
  doc.getElementById('eventsPastMore').click();
  assert.equal(count(), 20);
  assert.equal(doc.getElementById('eventsPastMore').textContent, 'Show 4 more past events');
  doc.getElementById('eventsPastMore').click();
  assert.equal(count(), 24);
  assert.equal(doc.getElementById('eventsPastMore').hidden, true);
});

// ── The brief page's news panel ────────────────────────────────────────────

function briefDom() {
  const dom = new JSDOM('<!doctype html><div id="m"></div>', { runScripts: 'outside-only', url: 'http://localhost/developer-brief.html' });
  dom.window.eval(read('js/components/jurisdiction-brief.js'));
  return dom.window;
}

const BRIEF = { geoid: '0812045', jurisdiction: 'Town of Carbondale', last_curated: '2026-09-01' };
const queue = (stories, events = [], generated = '2026-10-14T09:40:00Z') => ({ meta: { generated }, briefs: [
  { geoid: '0812045', stories, events }, { geoid: '0820000', stories: [{ title: 'Denver only', date: '2026-10-01', match: 'place' }], events: [] }] });

test('the brief panel shows this brief\'s headlines since its review, apart from the brief', () => {
  const w = briefDom();
  const html = w.JurisdictionBrief._renderNews(BRIEF, queue([
    { title: 'Carbondale approves lease', source: 'The Sopris Sun', date: '2026-10-01', match: 'place', link: 'https://news.localhost/1' },
    { title: 'Garfield County housing', source: 'Post Independent', date: '2026-09-20', match: 'county', link: 'https://news.localhost/2' },
    { title: 'Before the review', source: 'X', date: '2026-08-31', match: 'place', link: 'https://news.localhost/3' },
    { title: 'Paywalled lead', source: 'Y', date: '2026-08-30', match: 'place', link: 'https://news.localhost/4', unread: 'blocked' },
    { title: 'Fresh unread', source: 'Y', date: '2026-10-02', match: 'place', link: 'https://news.localhost/5', unread: 'blocked' },
  ], [{ title: 'NSPIRE, Carbondale', start: '2026-10-22', organizer: 'CHFA', url: 'https://chfa.localhost/n' },
    { title: 'Over already', start: '2026-10-01', organizer: 'CHFA' }]), NOW);
  const el = w.document.createElement('div');
  el.innerHTML = html;
  const items = [...el.querySelectorAll('li')].map((li) => li.textContent);
  assert.equal(items.filter((t) => /Carbondale approves|Garfield County housing|Paywalled lead|Fresh unread/.test(t)).length, 4);
  assert.match(el.querySelector('.jbrief-news__title').textContent, /\(4\)/, 'the panel count disagrees with the headlines shown');
  assert.ok(items.some((t) => t.includes('Paywalled lead') && t.includes('not yet read') && t.includes('older')), 'an unread lead from before the review was dropped or not marked older');
  assert.ok(items.some((t) => t.includes('Fresh unread') && t.includes('not yet read') && !t.includes('older')), 'a post-review unread lead was called older');
  assert.match(el.textContent, /not part of this brief and not sources for it/);
  assert.ok(items.some((t) => t.includes('Carbondale approves lease')));
  assert.ok(items.some((t) => t.includes('Garfield County housing') && t.includes('names the county')));
  assert.ok(!items.some((t) => t.includes('Before the review')), 'a headline from before the review was shown');
  assert.ok(!items.some((t) => t.includes('Denver only')), 'another brief\'s headline was shown');
  assert.ok(items.some((t) => t.includes('NSPIRE, Carbondale')));
  assert.ok(!items.some((t) => t.includes('Over already')), 'an ended event was shown');
});

test('a missing or stale queue is said, not shown as "no news"', () => {
  const w = briefDom();
  assert.match(w.JurisdictionBrief._renderNews(BRIEF, null, NOW), /could not be loaded/);
  const stale = w.JurisdictionBrief._renderNews(BRIEF, queue([],
    [{ title: 'Future event from an old queue', start: '2026-11-01', organizer: 'CHFA' }], '2026-10-01T09:00:00Z'), NOW);
  assert.match(stale, /has not updated since Oct 1, 2026/);
  assert.ok(!stale.includes('Future event from an old queue'), 'a stale queue still listed an event');
  assert.match(w.JurisdictionBrief._renderNews(BRIEF, queue([]), NOW), /No new headlines since the last review/);
});

// ── The review issue ───────────────────────────────────────────────────────

test('the review issue lists each brief with news, with its reasons and headlines', () => {
  const committed = JSON.parse(read('data/alerts/brief-news-queue.json'));
  // A fully reviewed queue is the goal state, so when the committed file has no news,
  // give its first brief one headline to keep the section check honest.
  const q = committed.briefs.some((b) => b.stories.length) ? committed : {
    ...committed,
    briefs: committed.briefs.map((b, i) => (i ? b : {
      ...b, days_since_review: 3, reasons: ['1 new story naming it'],
      stories: [{ title: 'Fixture headline', source: 'Fixture', link: 'https://example.org/story', date: '2026-10-14', match: 'place', also: [] }],
    })),
  };
  if (q !== committed) {
    const empty = issueBody(committed);
    assert.match(empty, /\(0\)/);
    assert.ok(!empty.includes('\n### '), 'an empty queue still rendered a brief section');
  }
  const body = issueBody(q);
  assert.ok(body.startsWith(MARKER));
  assert.ok(!/\d{4}-\d{2}-\d{2}T\d{2}:/.test(body), 'a run timestamp in the body edits the issue every day');
  const withNews = q.briefs.filter((b) => b.stories.length);
  assert.ok(withNews.length > 0, 'the committed queue has no brief with news to check');
  for (const b of withNews) {
    // Match the section's own heading line: another brief's headline can name this place.
    const section = body.split('\n### ').find((s) => s.split('\n')[0].includes(md(b.jurisdiction)));
    assert.ok(section, `${b.jurisdiction} has news but no section`);
    assert.ok(section.includes(b.reasons.join('; ')), `${b.jurisdiction}'s reasons are missing`);
  }
  for (const b of q.briefs.filter((x) => !x.stories.length)) {
    assert.ok(body.includes(`| ${b.published ? 'yes' : 'draft'} | ${b.last_curated}`), `${b.jurisdiction} missing from the table`);
  }
  assert.match(body, new RegExp(`## News since the last review \\(${withNews.length}\\)`));
});
