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

// The brief page's news panel and the "Jurisdiction briefs to review" issue moved to coho-backend with the
// briefs on 18 Nov 2026 (member/test/housing-events-and-brief-news.test.mjs there).
