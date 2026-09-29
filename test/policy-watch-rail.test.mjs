/**
 * Housing News side column: a summary that agrees with the pages it opens.
 *
 * Until 2026-09-28 the right-hand column of policy-briefs.html printed every
 * Policy watch entry in full: 6,804px beside ~3,050px of news, and on a phone
 * the rest of the headlines began 7,395px down. Now it is a few rows, each
 * linked to the page that lists that section in full
 * (js/components/policy-watch.js). A summary can drift from what it
 * summarises, so this guard renders the rail AND each destination from the
 * same data and asserts they agree:
 *   - every row's count equals what its destination renders, and the anchor
 *     the row opens exists on that page;
 *   - every current entry is shown in full on exactly one page;
 *   - the rail stays a summary: at most 5 rows, at most 3 research titles
 *     (each opening its own page), no entry detail, and no link to a raw .md
 *     or .json file.
 * Rewording a row stays green. Dropping an entry from a destination, sending
 * a row to a missing anchor, or reprinting entries in the rail fails.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readText = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const readJson = (rel) => JSON.parse(readText(rel));
const NOW = '2026-09-28T12:00:00Z';
const BASE = 'https://pggllc.github.io/Housing-Analytics/';
const WATCH = readJson('data/policy/policy-watch.json');
const PW = readText('js/components/policy-watch.js');

function fixDate(window) {
  const RealDate = window.Date;
  window.Date = class extends RealDate {
    constructor(...args) { super(...(args.length ? args : [NOW])); }
    static now() { return new RealDate(NOW).getTime(); }
  };
}

async function until(check) {
  for (let i = 0; i < 200 && !check(); i++) await new Promise((r) => setTimeout(r, 5));
}

// Housing News with the committed feed, curated briefs and the given watch.
async function newsPage(watch = WATCH) {
  const briefs = readJson('data/policy_briefs.json');
  const curated = readJson('data/policy_briefs_curated.json');
  const dom = new JSDOM(readText('policy-briefs.html'), {
    runScripts: 'dangerously',
    url: BASE + 'policy-briefs.html',
    beforeParse(window) {
      fixDate(window);
      window.console.warn = () => {};
      window.fetch = (url) => {
        const u = String(url);
        if (/jurisdiction-metrics-digest/.test(u)) return Promise.resolve({ ok: false, json: () => Promise.resolve(null) });
        if (u.includes('policy-watch.json')) return Promise.resolve({ ok: !!watch, json: () => Promise.resolve(structuredClone(watch)) });
        if (u.includes('insights/catalog.json')) return Promise.resolve({ ok: true, json: () => Promise.resolve(readJson('data/insights/catalog.json')) });
        if (u.includes('glossary.json')) return Promise.resolve({ ok: false, json: () => Promise.resolve(null) });
        return Promise.resolve({ ok: true, json: () => Promise.resolve(u.includes('curated') ? curated : briefs) });
      };
      window.eval(readText('js/workflow/recommendation-contract.js'));
      window.eval(PW);
      window.eval(readText('js/components/research-catalog.js'));
    },
  });
  const doc = dom.window.document;
  await until(() => doc.querySelector('.story') || doc.querySelector('.research-card'));
  await until(() => watch == null || !doc.getElementById('policyWatchPanel').hidden);
  return doc;
}

// The legislation page's full Policy watch section, from the given watch.
async function legislationPage(watch = WATCH) {
  const dom = new JSDOM(readText('housing-legislation-2026.html'), {
    runScripts: 'dangerously',
    url: BASE + 'housing-legislation-2026.html',
    beforeParse(window) {
      fixDate(window);
      window.fetch = (url) => Promise.resolve(String(url).includes('policy-watch.json')
        ? { ok: true, json: () => Promise.resolve(structuredClone(watch)) }
        : { ok: false, json: () => Promise.resolve(null) });
      window.eval(PW);
    },
  });
  const doc = dom.window.document;
  await until(() => !/Loading/.test(doc.getElementById('policy-watch-list').textContent));
  return doc;
}

// The elections page's people list: its own renderer, the committed data.
async function electionsPage(watch = WATCH) {
  const geo = readJson('data/hna/geo-config.json');
  const payloads = new Map([
    ['data/hna/geo-config.json', geo],
    ['data/policy/candidate-platforms-2026.json', readJson('data/policy/candidate-platforms-2026.json')],
    ['data/policy/policy-watch.json', watch],
    ['data/policy/ballot-2026/statewide.json', readJson('data/policy/ballot-2026/statewide.json')],
    ...geo.counties.map((c) => [`data/policy/ballot-2026/counties/${c.geoid}.json`, readJson(`data/policy/ballot-2026/counties/${c.geoid}.json`)]),
  ]);
  const dom = new JSDOM(readText('colorado-elections.html'), { url: BASE + 'colorado-elections.html', runScripts: 'outside-only' });
  const { window } = dom;
  fixDate(window);
  window.fetch = async (url) => {
    const pathname = new URL(url, window.location).pathname;
    const name = pathname.slice(pathname.indexOf('data/'));
    return payloads.has(name) ? { ok: true, json: async () => structuredClone(payloads.get(name)) } : { ok: false, status: 404 };
  };
  window.eval(readText('js/path-resolver.js'));
  window.eval(readText('js/colorado-elections.js'));
  await until(() => window.document.getElementById('election-data').dataset.loadState === 'ready');
  return window.document;
}

const rowsOf = (doc) => [...doc.querySelectorAll('#policyWatchList [data-watch-row]')];

test('the side column is a summary, not a second copy of the lists', async () => {
  const doc = await newsPage();
  const panel = doc.getElementById('policyWatchPanel');
  assert.equal(panel.hidden, false, 'the policy watch panel is hidden although the file has entries');
  const rows = rowsOf(doc);
  assert.ok(rows.length > 0, 'no summary rows rendered; the checks below would pass vacuously');
  assert.ok(rows.length <= 5, `${rows.length} policy watch rows; the rail holds at most 5`);
  assert.equal(panel.querySelectorAll('.watch-item, #policyWatchList p').length, 0, 'entry detail is printed in the rail');
  const cards = [...doc.querySelectorAll('#researchList .research-card')];
  assert.ok(cards.length > 0 && cards.length <= 3, `${cards.length} research items; the rail holds 1 to 3`);
  assert.equal(doc.querySelectorAll('#researchList p').length, 0, 'research summaries are printed in the rail');
  for (const card of cards) {
    const links = [...card.querySelectorAll('a')];
    assert.equal(links.length, 1, 'a research card links somewhere besides its own page');
    const page = new URL(links[0].href).pathname.replace('/Housing-Analytics/', '');
    assert.ok(/\.html$/.test(page) && fs.existsSync(path.join(ROOT, page)), `a research card opens ${links[0].href}, not a page`);
  }
  const aside = doc.querySelector('.news-aside');
  for (const a of aside.querySelectorAll('a')) {
    assert.doesNotMatch(new URL(a.href).pathname, /\.(md|json)$/, `the rail links a raw file: ${a.href}`);
  }
  assert.equal(doc.getElementById('toolWatchPanel'), null, 'the tools list is back in the news rail');
  const about = doc.getElementById('aboutFeed');
  assert.ok(about && !about.closest('.news-aside'), '"About this feed" must sit under the header, not at the bottom of the rail');
});

test('each summary row agrees with the page it opens', async () => {
  const [news, leg, elections] = await Promise.all([newsPage(), legislationPage(), electionsPage()]);
  const rendered = {
    'housing-legislation-2026.html': { doc: leg, html: readText('housing-legislation-2026.html') },
    'colorado-elections.html': { doc: elections, html: readText('colorado-elections.html') },
  };
  const countAt = {
    qap: () => leg.querySelectorAll('[data-watch-section="qap"] .watch-item').length,
    ballot: () => leg.querySelectorAll('[data-watch-section="ballot"] .watch-item').length,
    people: () => elections.querySelectorAll('#people-records [data-person-id]').length,
    gaps: () => leg.querySelectorAll('#policy-watch-gap-list li').length,
  };
  const rows = rowsOf(news);
  assert.ok(rows.some((r) => Number(r.dataset.count) > 1), 'no row summarises more than one entry; nothing is being checked');
  for (const row of rows) {
    const key = row.dataset.watchRow;
    const href = row.querySelector('a').getAttribute('href');
    const [file, anchor] = href.split('#');
    assert.ok(rendered[file], `${key} row opens ${file}, which this guard does not render`);
    assert.ok(anchor && rendered[file].html.includes(`id="${anchor}"`), `${key} row opens #${anchor}, which ${file} does not have`);
    assert.ok(countAt[key], `no destination count known for section ${key}`);
    assert.equal(Number(row.dataset.count), countAt[key](), `${key}: the rail says ${row.dataset.count}, ${file} shows ${countAt[key]()}`);
    assert.match(row.textContent, new RegExp(row.dataset.count === '1' ? '.' : `\\b${row.dataset.count}\\b`),
      `${key} row does not show the count it claims`);
  }
});

test('every current entry is shown in full on exactly one page', async () => {
  const [leg, elections] = await Promise.all([legislationPage(), electionsPage()]);
  const onLeg = [...leg.querySelectorAll('[data-watch-id]')].map((el) => el.dataset.watchId);
  const onElections = [...elections.querySelectorAll('#people-records [data-person-id]')].map((el) => el.dataset.personId);
  const shown = [...onLeg, ...onElections];
  assert.equal(new Set(shown).size, shown.length, 'an entry is shown in full on more than one page');
  const window = new JSDOM('', { runScripts: 'outside-only' }).window;
  fixDate(window);
  window.eval(PW);
  const current = WATCH.entries.filter((e) => window.PolicyWatch.isCurrent(e)).map((e) => e.id);
  assert.ok(current.length > 0, 'no current entries; this guard would pass vacuously');
  assert.deepEqual([...shown].sort(), [...current].sort(), 'the full pages do not show exactly the current entries');
  assert.deepEqual([...leg.querySelectorAll('#policy-watch-gap-list li')].map((li) => li.textContent), WATCH.meta.known_gaps,
    'the gaps the file declares are not all shown on the legislation page');
});

test('a reported entry says so where it is shown in full; no file hides the rail', async () => {
  const watch = { schema: 'policy-watch/v1', meta: { as_of: '2026-09-24', known_gaps: [] }, entries: [{
    id: 'x', section: 'ballot', status: 'on ballot', date: '2026-11-03', title: 'A county lodging tax for housing',
    source: { label: 'Some Outlet', url: 'https://news.localhost/ballot' },
    verification: { level: 'reported', by: 'Some Outlet', checked: '2026-09-24' } }] };
  const leg = await legislationPage(watch);
  const check = leg.querySelector('[data-watch-id="x"] .watch-item__check').textContent;
  assert.match(check, /^As reported by Some Outlet/);
  assert.match(check, /Not checked against a primary document/);
  const news = await newsPage(watch);
  const rows = rowsOf(news);
  assert.equal(rows.length, 1);
  assert.match(rows[0].textContent, /A county lodging tax for housing/, 'a single entry is not named in its row');
  const empty = await newsPage(null);
  assert.equal(empty.getElementById('policyWatchPanel').hidden, true, 'the panel shows with no data behind it');
});

test('a section with mixed statuses shows each; a malformed source is text, not a link', async () => {
  const entry = (id, status, url) => ({ id, section: 'qap', status, date: null, title: `Entry ${id}`,
    source: { label: 'CHFA', url }, verification: { level: 'primary', against: 'the plan', checked: '2026-09-24' } });
  const watch = { schema: 'policy-watch/v1', meta: { as_of: '2026-09-24', known_gaps: [] },
    entries: [entry('a', 'third draft', 'https://example.org/a'), entry('b', 'adopted', 'javascript:alert(1)')] };
  const news = await newsPage(watch);
  const row = rowsOf(news).find((r) => r.dataset.watchRow === 'qap');
  assert.match(row.textContent, /third draft/);
  assert.match(row.textContent, /adopted/, 'one status stands for a section whose entries differ');
  const leg = await legislationPage(watch);
  const hrefs = [...leg.querySelectorAll('#policy-watch-list a')].map((a) => a.getAttribute('href'));
  assert.equal(new Set(hrefs).has('https://example.org/a'), true, 'a valid source is not linked');
  assert.ok(!hrefs.some((h) => /^javascript:/i.test(h)), 'a javascript: source became a link');
  assert.match(leg.querySelector('[data-watch-id="b"] .watch-item__title').textContent, /Entry b/, 'the malformed entry is not shown at all');
});

test('the anchor on a destination page is held until its data can have arrived', () => {
  // settle-anchor.js keeps a linked section in view while the lists above it
  // load. Its safety bound must outlast the slowest fetch those pages allow,
  // or a slow response pushes the section away after it has stopped.
  const bound = Number((readText('js/components/settle-anchor.js').match(/SETTLE_MS = (\d+)/) || [])[1]);
  assert.ok(bound > 0, 'settle-anchor.js has no SETTLE_MS');
  const timeouts = [];
  for (const file of ['housing-legislation-2026.html', 'js/colorado-elections.js']) {
    const found = [...readText(file).matchAll(/\}\s*,\s*(\d{4,6})\s*\)/g)].map((m) => Number(m[1]));
    assert.ok(found.length > 0, `${file} passes no fetch timeout this guard can read`);
    timeouts.push(...found);
  }
  for (const page of ['housing-legislation-2026.html', 'colorado-elections.html']) {
    assert.ok(readText(page).includes('js/components/settle-anchor.js'), `${page} is linked from Housing News but does not hold its anchor`);
  }
  assert.ok(bound > Math.max(...timeouts), `settle-anchor stops after ${bound} ms; the pages wait up to ${Math.max(...timeouts)} ms for data`);
});

