// Tests for scripts/audit/source-watch.mjs (report-only source watch).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  pageText, keyLines, hashedText, buildTargets, intervalDays, isDue, checkSource, run, summaryMarkdown,
  KEY_LINES_VERSION, HAND_CHECK_HOSTS,
} from '../scripts/audit/source-watch.mjs';

const NOW = '2026-11-02T13:00:00Z';
const page = (body, title = 'Bill page') => `<html><head><title>${title}</title><script>var x=1</script></head>`
  + `<body><nav>Menu 01/01/2020</nav><main>${body}</main><footer>© 2026 all rights reserved</footer></body></html>`;
const fakeFetch = (routes) => async (url, opts = {}) => {
  const r = typeof routes[url] === 'function' ? routes[url](opts) : routes[url];
  if (!r) throw new TypeError('fetch failed');
  return { status: 200, headers: {}, body: '', url, ...r };
};

const SPEC = { file: 'f.json', key: 'entries', title: 'T', page: 'p.html', name: (r) => r.title, source: (r) => r.url };

test('page text drops scripts, navigation and footers', () => {
  const t = pageText(page('<p>Signed 05/26/2026</p><p>Plain text</p>'));
  assert.match(t, /Signed 05\/26\/2026/);
  assert.doesNotMatch(t, /var x|Menu|rights reserved/);
});

test('key lines keep dates, amounts and status words, and drop stamps', () => {
  const kl = keyLines('Governor Signed 05/26/2026\nAwards of $2.5 million\nJust a sentence\nPage last updated October 31, 2026\nhttps://x.gov/a — printed November 1, 2026');
  assert.deepEqual(kl, ['Governor Signed 05/26/2026', 'Awards of $2.5 million']);
  assert.equal(hashedText('a\nPage last updated October 31, 2026'), 'a');
});

test('targets: one per URL, notes after the address dropped, legislation tagged', () => {
  const docs = { 'f.json': { entries: [
    { id: 'a', title: 'A', url: 'https://leg.colorado.gov/bills/hb26-1313', review_by: '2026-11-09' },
    { id: 'b', title: 'B', url: 'https://leg.colorado.gov/bills/hb26-1313#history' },
    { id: 'c', title: 'C', url: 'https://town.gov/fees (redirects to home)' },
    { id: 'd', title: 'D', url: 'http://insecure.gov/x' },
    { id: 'e', title: 'E', url: 'https://skip.gov/x' },
  ] } };
  const t = buildTargets(docs, { specs: [SPEC], skipUrls: new Set(['https://skip.gov/x']) });
  assert.deepEqual(t.map((x) => x.url), ['https://leg.colorado.gov/bills/hb26-1313', 'https://town.gov/fees']);
  assert.equal(t[0].kind, 'legislation');
  assert.equal(t[0].records.length, 2);
  assert.deepEqual(t[0].urgent, ['2026-11-09']);
});

test('cadence: bills daily in session, weekly after; near deadlines daily', () => {
  const bill = { kind: 'legislation', urgent: [] };
  assert.equal(intervalDays(bill, '2027-02-01'), 1);
  assert.equal(intervalDays(bill, '2026-08-01'), 7);
  assert.equal(intervalDays({ kind: 'agency', urgent: ['2026-11-10'] }, '2026-11-01'), 1);
  assert.equal(intervalDays({ kind: 'agency', urgent: ['2026-12-31'] }, '2026-11-01'), 7);
  assert.equal(intervalDays({ kind: 'agency', urgent: ['2026-10-01'] }, '2026-11-01'), 7);
  const t = { kind: 'agency', urgent: [] };
  assert.equal(isDue(t, { checked_at: '2026-10-30T13:00:00Z', ok: true }, NOW, '2026-11-02'), false);
  assert.equal(isDue(t, { checked_at: '2026-10-26T14:00:00Z', ok: true }, NOW, '2026-11-02'), true);
  assert.equal(isDue(t, { checked_at: '2026-11-01T13:00:00Z', ok: false }, NOW, '2026-11-02'), true);
});

test('three steps: baseline, unchanged text, cosmetic, changed', async () => {
  const t = { url: 'https://x.gov/p', kind: 'agency', document: false, urgent: [] };
  let body = page('<p>Applications due March 5, 2027</p><p>Welcome</p>');
  const f = fakeFetch({ [t.url]: () => ({ body }) });
  const a = await checkSource(t, {}, f, NOW);
  assert.equal(a.outcome, 'baseline');
  const b = await checkSource(t, a.entry, f, NOW);
  assert.equal(b.outcome, 'unchanged-text');
  body = page('<p>Applications due March 5, 2027</p><p>Welcome, neighbors</p><p>Page last updated Nov 2, 2026</p>');
  const c = await checkSource(t, b.entry, f, NOW);
  assert.equal(c.outcome, 'cosmetic');
  body = page('<p>Applications due April 9, 2027</p>');
  const d = await checkSource(t, c.entry, f, NOW);
  assert.equal(d.outcome, 'changed');
  assert.deepEqual(d.detail.key_lines.added, ['Applications due April 9, 2027']);
  assert.equal(d.entry.last_changed_at, NOW);
  assert.equal(d.entry.key_lines_version, KEY_LINES_VERSION);
});

test('a 304 to a conditional request is unchanged; the validators are sent', async () => {
  const t = { url: 'https://x.gov/p', kind: 'agency', document: false, urgent: [] };
  let sent;
  const f = fakeFetch({ [t.url]: (o) => { sent = o.headers; return { status: 304 }; } });
  const r = await checkSource(t, { checked_at: NOW, ok: true, etag: '"v1"', text_sha256: 'h', key_lines: [] }, f, NOW);
  assert.equal(r.outcome, 'unchanged-headers');
  assert.equal(sent['If-None-Match'], '"v1"');
  assert.equal(r.entry.text_sha256, 'h');
});

test('documents are only asked for headers, never downloaded', async () => {
  const t = { url: 'https://x.gov/plan.pdf', kind: 'agency', document: true, urgent: [] };
  const methods = [];
  let len = '100';
  const f = fakeFetch({ [t.url]: (o) => { methods.push(o.method); return { headers: { 'content-length': len } }; } });
  const a = await checkSource(t, {}, f, NOW);
  assert.equal(a.outcome, 'baseline');
  assert.equal((await checkSource(t, a.entry, f, NOW)).outcome, 'unchanged-headers');
  len = '200';
  assert.equal((await checkSource(t, a.entry, f, NOW)).outcome, 'changed');
  assert.deepEqual([...new Set(methods)], ['HEAD']);
});

test('a failure keeps the last snapshot and turns unverifiable after 3 days', async () => {
  const t = { url: 'https://x.gov/p', kind: 'agency', document: false, urgent: [] };
  const prev = { checked_at: '2026-10-30T13:00:00Z', ok: false, first_failed_at: '2026-10-30T13:00:00Z', text_sha256: 'h', key_lines: ['x 2026-01-01'] };
  const r = await checkSource(t, prev, fakeFetch({ [t.url]: { status: 403 } }), NOW);
  assert.equal(r.outcome, 'failed');
  assert.equal(r.entry.text_sha256, 'h');
  assert.equal(r.entry.unverifiable, true);
  const blocked = await checkSource(t, {}, fakeFetch({ [t.url]: { body: page('x', 'Just a moment...') } }), NOW);
  assert.equal(blocked.outcome, 'failed');
});

test('run: hand-check hosts and home pages are never fetched; report is report-only', async () => {
  const host = Object.keys(HAND_CHECK_HOSTS)[0];
  const docs = { 'f.json': { entries: [
    { id: 'a', title: 'A', url: `https://${host}/co/town/codes` },
    { id: 'b', title: 'B', url: 'https://town.gov/' },
    { id: 'c', title: 'C', url: 'https://town.gov/fees' },
  ] } };
  const fetched = [];
  const fetcher = async (url) => { fetched.push(url); return { status: 200, headers: {}, body: page('<p>Fee waived 2026-01-01</p>') }; };
  const { report, state } = await run({ docs, fetcher, now: NOW, specsOverride: [SPEC] });
  assert.deepEqual(fetched, ['https://town.gov/fees']);
  assert.equal(report.mode, 'report-only');
  assert.equal(report.counts['hand-check'], 2);
  assert.equal(report.counts.baseline, 1);
  assert.ok(state.sources['https://town.gov/fees'].text_sha256);
  assert.match(summaryMarkdown(report), /Nothing was opened, committed or edited/);
});
