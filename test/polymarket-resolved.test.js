#!/usr/bin/env node
/**
 * The prediction-market panel must not publish markets that have already
 * settled. Curated live markets may fall back to the API when absent from cache.
 *
 * ── What was wrong ──
 *
 * The fetch workflow held a hardcoded list of 15 event slugs and re-fetched
 * exactly those, forever. By 2026-09-18 NINE had resolved — including all
 * three housing markets, which asked about April 30 and were being shown in
 * mid-September on a housing site. Several slugs had a month in the name:
 * fed-decision-in-april, march-inflation-us-annual-higher-brackets.
 *
 * The cached payload carried only title, slug and prices, so the site had no
 * way to know a market had closed and inferred it from price extremes alone.
 *
 * ── What this file used to assert ──
 *
 *     assert(wiredResolvedMarkets.length > 0,
 *       'cached data includes at least one wired settled Polymarket market')
 *
 * It REQUIRED a settled market to be present. The intent was to prove the
 * "Settled" render path had something to render, but the effect was a guard
 * that enforced the defect: publishing only live markets would have failed
 * it. Render-path behaviour is checked against fixtures below instead, which
 * is where a rendering test belongs.
 *
 * ── What it asserts now ──
 *
 * That the published cache is current, that it carries the metadata needed to
 * know that, and that the page and fetcher read ONE curated list
 * (data/polymarket-curated.json, #2063). Missing responses preserve only their
 * old entries, marked stale and unavailable. A settled market disappears from
 * the page on its own: no hand edit, and no red main while someone makes one.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const readJson = (p) => JSON.parse(read(p));

function isResolved(prices) {
  if (!Array.isArray(prices) || prices.length < 2) return false;
  const nums = prices.map(Number).filter((n) => !Number.isNaN(n));
  if (nums.length < 2) return false;
  return Math.max(...nums) >= 0.999 && Math.min(...nums) <= 0.001;
}

const data = readJson('data/polymarket-data.json');
const dashboard = read('economic-dashboard.html');
const curatedDoc = readJson('data/polymarket-curated.json');
const workflow = read('.github/workflows/fetch-polymarket-data.yml');
const events = data.events || {};
const slugs = Object.keys(events);

/* ── the render path can still label a settled market ───────────────────── */

assert(dashboard.includes('function pmIsResolved'), 'economic dashboard defines pmIsResolved helper');
assert(/max\s*>=\s*0\.999/.test(dashboard), 'resolved helper checks the high price extreme');
assert(/min\s*<=\s*0\.001/.test(dashboard), 'resolved helper checks the low price extreme');
assert(dashboard.includes('Settled'), 'Polymarket render path can emit Settled labels');
assert(dashboard.includes('pm-settled'), 'Polymarket render path adds a settled visual state');
assert(dashboard.includes('pmIsResolved(prices)'), 'parsed markets carry the resolved check before rendering probabilities');
assert(dashboard.includes('pmEventIsResolved'), 'whole-card render paths distinguish fully settled events');
assert(!dashboard.includes('Live prediction market prices from'), 'panel intro no longer over-claims every market is live');

// Behaviour, against fixtures rather than against whatever production happens
// to contain. This is what the old data-dependent assertion was really for.
assert(isResolved(['0', '1']), '0/1 outcome prices are treated as settled');
assert(isResolved(['1', '0']), '1/0 outcome prices are treated as settled');
assert(!isResolved(['0.125', '0.875']), 'fractional outcome prices remain live');
assert(!isResolved(['0.5']), 'a single price is not a settled market');
assert(!isResolved(null), 'missing prices are not a settled market');

/* ── the cache is current ───────────────────────────────────────────────── */

assert(slugs.length > 0, 'the cached payload has no events at all');

const now = new Date();
const stale = [];
for (const slug of slugs) {
  const e = events[slug];
  // `closed` is the signal. `active` is NOT: every one of the nine settled
  // events in #1738 reported active:true alongside closed:true, so a liveness
  // check built on `active` would have kept all of them.
  if (e.closed === true) { stale.push(`${slug} (closed)`); continue; }
  if (e.endDate) {
    const end = new Date(e.endDate);
    if (!Number.isNaN(end.getTime()) && end < now) stale.push(`${slug} (ended ${e.endDate.slice(0, 10)})`);
  }
}
assert.deepEqual(stale, [],
  `the published cache contains settled or expired markets: ${stale.join(', ')}`);

for (const slug of slugs) {
  assert('endDate' in events[slug],
    `${slug} has no endDate — without it nothing can tell a live market from a resolved one`);
  assert('closed' in events[slug],
    `${slug} has no closed flag`);
}

/* ── one curated list, read by both the page and the fetcher ────────────── */

// Three places used to hold this list independently: the workflow, this test
// and the page. When a market settled the fetcher dropped it, and main stayed
// red until someone edited the page by hand (#2063). The list is now data.
const curated = curatedDoc.events.map((e) => e.slug);
assert(curated.length > 0, 'the curated list names no market');
assert.equal(new Set(curated).size, curated.length, 'a curated slug is listed twice');
const keys = curatedDoc.events.map((e) => e.key);
assert.equal(new Set(keys).size, keys.length, 'curated keys must be unique; they name element ids');
const sections = [...dashboard.matchAll(/data-pm-section="([a-z-]+)"/g)].map((m) => m[1]);
assert(sections.length > 0, 'the dashboard has no market sections to fill');
const roleBlock = dashboard.match(/var ROLES = \{([\s\S]*?)\n  \};/);
assert(roleBlock, 'the dashboard defines its market roles');
const roles = [...roleBlock[1].matchAll(/^    '([a-z-]+)': \{/gm)].map((m) => m[1]);
const kpiRoles = [...roleBlock[1].matchAll(/^    '([a-z-]+)': \{\n      kpi: true,/gm)].map((m) => m[1]);
for (const e of curatedDoc.events) {
  assert(sections.includes(e.section), `${e.slug}: section "${e.section}" is not on the page`);
  assert(roles.includes(e.role), `${e.slug}: role "${e.role}" has no renderer`);
  if (e.kpi) assert(kpiRoles.includes(e.role), `${e.slug}: role "${e.role}" cannot fill a headline tile`);
  for (const field of ['label', 'description', 'badge', 'color']) {
    assert(typeof e[field] === 'string' && e[field], `${e.slug}: missing ${field}`);
  }
}
assert.deepEqual([...curatedDoc.meta.sections].sort(), [...sections].sort(), 'curated meta.sections matches the page');
assert.deepEqual([...curatedDoc.meta.roles].sort(), [...roles].sort(), 'curated meta.roles matches the page');

// The page and the workflow name no market themselves.
for (const slug of curated) {
  assert(!dashboard.includes(slug), `economic-dashboard.html hard-codes curated market ${slug}`);
  assert(!workflow.includes(slug), `fetch-polymarket-data.yml hard-codes curated market ${slug}`);
}
assert(!/polymarket\.com\/event\/[a-z0-9]/.test(dashboard), 'the dashboard links a specific market by hand');
assert(!/getEvent\('[^']+'\)/.test(dashboard), 'the dashboard requests a specific market by hand');
assert(/Path\("data\/polymarket-curated\.json"\)/.test(workflow), 'the fetcher reads the curated list');

const retired = [
  'what-will-the-median-home-value-in-the-us-be-on-september-30-20260630175540363',
  'what-will-the-median-home-value-in-miami-be-on-september-30-20260630172328034',
  'what-will-the-median-home-value-in-new-york-city-be-on-september-30-20260630180215064',
];
for (const slug of retired) {
  assert(!curated.includes(slug), `retired settled market still curated: ${slug}`);
  assert(!dashboard.includes(slug), `retired settled market still in dashboard: ${slug}`);
}

const uncurated = slugs.filter((s) => !curated.includes(s));
assert.deepEqual(uncurated, [],
  `these markets are cached but not curated, so shown nowhere: ${uncurated.join(', ')}`);

/* ── this is a housing site ─────────────────────────────────────────────── */

// Word-boundaried. A bare /rent/ matches "Brentford FC" and "different",
// which is how a football fixture nearly qualified as a housing market while
// this was being written.
const HOUSING = /\b(home value|home prices?|housing|mortgage rate|rents?)\b/i;
const housing = slugs.filter((s) => HOUSING.test(String(events[s].title || '')));
assert(housing.length > 0,
  'no housing-related market is published, on a housing site — the curated list in '
  + 'data/polymarket-curated.json needs a successor market');

/* ── the workflow cannot go back to publishing settled markets ──────────── */

// Definition AND call site. A bare /is_settled/ passes against
// `def is_settled_DISABLED(...)`, which is how this assertion first failed
// its own sabotage test: the substring survived the function being disabled.
assert(/def is_settled\(event\):/.test(workflow),
  'the fetch workflow no longer defines is_settled()');
assert(/settled,\s*why\s*=\s*is_settled\(event\)/.test(workflow),
  'the fetch workflow defines is_settled() but never calls it on a fetched event');
assert(/if settled:/.test(workflow),
  'the fetch workflow calls is_settled() but does not act on the result');
assert(/"endDate": event\.get\("endDate"\)/.test(workflow),
  'the fetch workflow no longer persists endDate');
assert(!/\bactive\b\s*is\s*True/.test(workflow),
  'the workflow appears to treat `active` as a liveness signal; `closed` is the signal');


/* ── run the actual workflow Python against controlled API responses ────── */

const fetchPython = workflow.match(/python3 - <<'PY'\n([\s\S]*?)\n          PY/)[1].replace(/^ {10}/gm, '');
const fedSlug = 'fed-decision-in-october-20260617190323537';
assert(curated.includes(fedSlug), 'the October Fed market remains curated');
const fetchCheck = spawnSync('python3', ['-c', `
import contextlib, datetime, io, json, os, sys, tempfile, time, urllib.request
from pathlib import Path
from unittest.mock import patch
case = json.load(sys.stdin)
class Clock(datetime.datetime):
    @classmethod
    def now(cls, tz=None): return cls(2026, 10, 5, tzinfo=tz)
stamp = '2026-10-05T00:00:00Z'
# The two markets the settle cases close: any two that are not the Fed event,
# whatever order the curated file lists them in.
settle = [s for s in case['curated'] if s != case['fed']][:2]
modes = ['empty_then_live', 'error_then_live', 'partial', 'wrong_slug',
         'stale_3days', 'stale_4days', 'no_previous_entry', 'missing_4days_no_entry',
         'recovered', 'all_missing', 'settled', 'all_settled']
for mode in modes:
    calls = {}
    old = {slug: dict(slug=slug, title='Old title', closed=False,
                     endDate='2099-10-29T03:59:00Z', markets=[dict(question='Old price', volume='10')])
           for slug in case['curated']}
    prior = dict(updated='2026-10-01T00:00:00Z', events=old)
    if mode in ['stale_3days', 'stale_4days', 'recovered']:
        old[case['fed']]['stale_since'] = '2026-10-02T00:00:00Z' if mode == 'stale_3days' else '2026-10-01T00:00:00Z'
    if mode in ['no_previous_entry', 'missing_4days_no_entry']:
        del old[case['fed']]
    if mode == 'missing_4days_no_entry':
        prior['missing_since'] = {case['fed']: '2026-10-01T00:00:00Z'}
    def response(req, timeout):
        slug = req.full_url.split('slug=')[1]
        calls[slug] = calls.get(slug, 0) + 1
        event = dict(slug=slug, title='Mortgage rate fixture', closed=False,
                     endDate='2099-10-29T03:59:00Z', markets=[dict(question='New price', volume='20')])
        if mode in ['partial', 'settled']:
            if slug == settle[0]: event['closed'] = True
            if slug == settle[1]: event['endDate'] = '2000-01-01T00:00:00Z'
        if mode == 'all_settled': event['closed'] = True
        if mode == 'all_missing': return io.BytesIO(b'[]')
        if slug == case['fed']:
            if mode == 'error_then_live' and calls[slug] == 1: raise OSError('temporary API error')
            if mode in ['partial', 'stale_3days', 'stale_4days', 'no_previous_entry', 'missing_4days_no_entry'] or (mode == 'empty_then_live' and calls[slug] == 1):
                return io.BytesIO(b'[]')
            if mode == 'wrong_slug': event['slug'] = 'unrelated-event'
        return io.BytesIO(json.dumps([event]).encode())
    with tempfile.TemporaryDirectory() as tmp:
        previous = os.getcwd()
        try:
            os.chdir(tmp)
            Path('data').mkdir()
            Path('data/polymarket-curated.json').write_text(json.dumps({'events': [{'slug': s} for s in case['curated']]}))
            output = Path('data/polymarket-data.json')
            original = json.dumps(prior)
            output.write_text(original)
            code, logs = 0, io.StringIO()
            with patch.object(urllib.request, 'urlopen', response), patch.object(time, 'sleep'), patch.object(datetime, 'datetime', Clock), contextlib.redirect_stdout(logs):
                try: exec(compile(case['source'], 'fetch-polymarket-data.yml', 'exec'), {})
                except SystemExit as ex: code = ex.code
            if mode == 'all_missing':
                assert code != 0, 'all missing must fail'
                assert output.read_text() == original, 'all missing must write nothing'
                assert all(n == 3 for n in calls.values()), 'every missing event retried'
            else:
                assert code == 0, mode + ': successful responses must still be published'
                payload = json.loads(output.read_text())
                assert payload['updated'] == stamp, mode + ': cache was not written'
                errors = '::error::' in logs.getvalue()
                assert errors == (mode in ['stale_4days', 'missing_4days_no_entry']), mode + ': wrong escalation threshold'
                for slug in case['curated']:
                    if mode == 'all_settled' or (mode in ['partial', 'settled'] and slug in settle):
                        assert slug not in payload['events'], 'closed/expired event retained'
                        assert slug in payload['dropped_settled']
                    elif slug == case['fed'] and mode in ['partial', 'wrong_slug', 'stale_3days', 'stale_4days']:
                        expected = dict(old[slug], stale_since=old[slug].get('stale_since', stamp))
                        assert payload['events'].get(slug) == expected, mode + ': preserve the old entry unchanged with its first stale_since'
                        assert payload['missing_since'][slug] == expected['stale_since']
                        assert calls[slug] == 3, 'missing event was not retried'
                    elif slug == case['fed'] and mode in ['no_previous_entry', 'missing_4days_no_entry']:
                        assert slug not in payload['events'], 'cannot invent an old price'
                        assert payload['missing_since'][slug] == prior.get('missing_since', {}).get(slug, stamp)
                    else:
                        fresh = payload['events'][slug]
                        assert fresh['title'] == 'Mortgage rate fixture', mode + ': returned event not updated'
                        assert fresh['markets'][0]['volume'] == '20', mode + ': old price retained'
                        assert 'stale_since' not in fresh, 'recovered data must clear stale_since'
                        assert slug not in payload['missing_since'], 'recovered event still marked missing'
                if mode.endswith('_then_live'): assert calls[case['fed']] == 2
            print('fetcher: ' + mode + ' PASS')
        finally: os.chdir(previous)
`], { input: JSON.stringify({ source: fetchPython, curated, fed: fedSlug }), encoding: 'utf8' });
assert.equal(fetchCheck.status, 0, fetchCheck.stdout + fetchCheck.stderr);
process.stdout.write(fetchCheck.stdout);

/* ── run the dashboard renderer, including absent-cache/API responses ───── */

const fixture = (question, probability) => ({
  markets: [{ groupItemTitle: question, outcomePrices: JSON.stringify([probability, 1 - probability]), volume: '100' }],
});
const cardCases = [
  ['us-recession-by-end-of-2026', 'pm-recession-detail', 'Recession', .11],
  [fedSlug, 'pm-fed-oct-detail', 'No change', .72],
  ['how-many-fed-rate-cuts-in-2026', 'pm-fed-cuts-detail', '2 cuts', .33],
  ['how-high-will-inflation-get-in-2026', 'pm-inflation-detail', '4%', .44],
  ['gdp-growth-in-2026', 'pm-gdp-detail', '3% growth', .55],
  ['fed-decision-in-january-20260729233815502', 'pm-fed-jan-yes', 'No change', .64],
  ['tech-layoffs-up-or-down-in-2026', 'pm-layoffs', 'Up', .22],
  ['will-the-30-year-mortgage-rate-hit-in-2026', 'pm-mortgage-detail', 'Below 6%', .31],
];
assert.deepEqual(cardCases.map(([slug]) => slug).sort(), [...curated].sort(), 'exercise every curated card');

async function render(cache, live, curatedOverride) {
  const dom = new JSDOM(dashboard, { runScripts: 'outside-only', url: 'http://localhost/economic-dashboard.html' });
  const requests = [];
  const w = dom.window;
  w.fetch = async (url) => {
    const u = new URL(url, w.location);
    const slug = u.searchParams.get('slug');
    if (slug) requests.push(slug);
    const body = slug ? (live[slug] ? [live[slug]] : [])
      : u.pathname.endsWith('polymarket-curated.json') ? (curatedOverride || curatedDoc) : cache;
    return { ok: true, json: async () => body };
  };
  const script = [...w.document.scripts].find((el) => el.textContent.includes('function loadPolymarket()'));
  assert(script, 'execute the real Polymarket renderer');
  w.eval(script.textContent);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(w.document.getElementById('pm-refresh').disabled, false, 'load completed');
  assert.doesNotMatch(w.document.getElementById('pm-updated').textContent, /failed/i);
  return { dom, document: w.document, requests };
}

(async () => {
  const recessionSlug = 'us-recession-by-end-of-2026';
  const fixtures = Object.fromEntries(cardCases.map(([slug, , label, prob]) => [slug, fixture(label, prob)]));
  const cached = { ...fixtures };
  delete cached[fedSlug];
  const live = await render({ events: cached }, { [fedSlug]: fixtures[fedSlug] });
  try {
    assert.deepEqual(live.requests, [fedSlug], 'missing live October event uses the API fallback');
    for (const [slug, id, , prob] of cardCases) {
      assert(live.document.getElementById(id).textContent.includes(Math.round(prob * 100) + '%'),
        `${slug} must render its own probabilities after removing three requests`);
    }
    assert.equal(live.document.getElementById('pm-fed-oct').textContent, '72%');
    for (const id of ['pm-home', 'pm-home-detail', 'pm-miami-detail', 'pm-nyc-top', 'pm-co-denver', 'pm-co-payment', 'pm-co-ratio']) {
      assert.equal(live.document.getElementById(id), null, `${id} no longer presents a retired market`);
    }
  } finally { live.dom.window.close(); }

  const stale = await render({ events: Object.fromEntries(Object.entries(fixtures)
    .map(([slug, entry]) => [slug, { ...entry, stale_since: '2026-10-01T00:00:00Z' }])) }, fixtures);
  try {
    assert.deepEqual(stale.requests, [], 'stale cached prices are explicitly unavailable');
    for (const [, id] of cardCases) {
      assert.doesNotMatch(stale.document.getElementById(id).textContent, /\d+%/, `${id} must not present stale prices as current`);
    }
    assert.match(stale.document.getElementById('pm-fed-oct-detail').textContent, /unavailable/i);
    const housing = stale.document.getElementById('pm-mortgage-detail').closest('.hp-binary-grid');
    assert.match(housing.previousElementSibling.textContent, /mortgage/i, 'heading agrees with the only remaining housing contract');
    assert.doesNotMatch(stale.document.getElementById('polymarket-section').textContent, /Parcl|national median home price|home value markets resolve/i);
  } finally { stale.dom.window.close(); }

  // Exercise every absent response, including the production cache's missing
  // Fed event. No live network or hand-edited cache is needed for this guard.
  const absent = await render({ events: {} }, {});
  try {
    assert.deepEqual([...absent.requests].sort(), [...curated].sort());
    const panel = absent.document.getElementById('polymarket-section');
    assert.doesNotMatch(panel.textContent, /Loading/);
    assert.match(absent.document.getElementById('pm-fed-oct-detail').textContent, /unavailable/i);
    assert.match(absent.document.getElementById('pm-mortgage-detail').textContent, /unavailable/i);
    for (const grid of panel.querySelectorAll('.hp-binary-grid')) {
      assert(grid.querySelector('a'), 'removing settled cards leaves no empty section');
    }
  } finally { absent.dom.window.close(); }
  // A market settles: the fetcher drops it from events and lists it in
  // dropped_settled. Its card and tile disappear with no page edit, nothing
  // asks the API for it, and every other card still renders.
  const settledFixtures = { ...fixtures };
  delete settledFixtures[recessionSlug];
  const settled = await render({ events: settledFixtures, dropped_settled: [recessionSlug] }, {});
  try {
    const panel = settled.document.getElementById('polymarket-section');
    assert.equal(panel.querySelector(`[data-pm-slug="${recessionSlug}"]`), null, 'a settled market keeps no card');
    assert.equal(settled.document.getElementById('pm-recession'), null, 'a settled market keeps no headline tile');
    assert.equal(settled.document.getElementById('pm-co-recession').textContent, 'Unavailable');
    assert.deepEqual(settled.requests, [], 'a settled market is not fetched live');
    assert.equal(panel.querySelectorAll('a.hp-binary-card').length, curated.length - 1);
    assert.doesNotMatch(panel.textContent, /Loading/);
    for (const [slug, id, , prob] of cardCases.filter(([slug]) => slug !== recessionSlug)) {
      assert(settled.document.getElementById(id).textContent.includes(Math.round(prob * 100) + '%'), `${slug} still renders`);
    }
  } finally { settled.dom.window.close(); }

  // A section whose only market settles shows its empty state, not a blank grid.
  const mortgageSlug = 'will-the-30-year-mortgage-rate-hit-in-2026';
  const noMortgage = { ...fixtures };
  delete noMortgage[mortgageSlug];
  const emptied = await render({ events: noMortgage, dropped_settled: [mortgageSlug] }, {});
  try {
    const grid = emptied.document.querySelector('[data-pm-section="mortgage"]');
    assert.equal(grid.querySelector('a'), null);
    assert(grid.querySelector('.pm-empty'), 'an emptied section says it has no live market');
  } finally { emptied.dom.window.close(); }

  // Adding a market is a data change: a new curated entry renders with no page edit.
  const extraSlug = 'fixture-new-market-2027';
  const extended = { ...curatedDoc, events: [...curatedDoc.events, {
    slug: extraSlug, key: 'fixture-new', role: 'brackets', section: 'labor', badge: 'Fixture',
    color: '#6a1b9a', label: 'Fixture market', description: 'Added by data alone.' }] };
  const added = await render({ events: { ...fixtures, [extraSlug]: fixture('Fixture bracket', .48) } }, {}, extended);
  try {
    assert.match(added.document.getElementById('pm-fixture-new-detail').textContent, /48%/);
    assert.equal(added.document.querySelectorAll('a.hp-binary-card').length, curated.length + 1);
  } finally { added.dom.window.close(); }

  console.log(`polymarket-resolved: PASS (${slugs.length} cached live events, ${housing.length} housing, ${cardCases.length} rendered cards, 0 settled)`);
})().catch((error) => { console.error(error); process.exitCode = 1; });
