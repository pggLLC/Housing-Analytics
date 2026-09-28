/**
 * AHCIA page: bill status comes from the tax-credit watchlist, never typed.
 *
 * lihtc-enhancement-ahcia.html typed the pending bills' status by hand and
 * nothing re-checked it: on 2026-09-28 it said "100+" House cosponsors
 * ("59 R / 58 D") and 30 in the Senate, where the bills had 168 and 41. The
 * status now lives in data/policy/tax-credit-legislation.json, with
 * last_verified and review_by like every other watchlist entry, and the page
 * renders it. This guard names both sides:
 *   - the page source carries no typed stage, committee or cosponsor count;
 *   - what the page renders equals the watchlist entry, so changing the data
 *     changes the page and a stale copy cannot survive;
 *   - a missing entry says so instead of leaving a placeholder.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const HTML = read('lihtc-enhancement-ahcia.html');
const WATCH = JSON.parse(read('data/policy/tax-credit-legislation.json'));
const PENDING = ['ahcia-2025-hr2725', 'ahcia-2025-s1515'];

async function render(watch = WATCH) {
  const dom = new JSDOM(HTML, {
    runScripts: 'dangerously',
    url: 'https://pggllc.github.io/Housing-Analytics/lihtc-enhancement-ahcia.html',
    beforeParse(window) {
      window.fetch = (url) => Promise.resolve(String(url).includes('tax-credit-legislation.json')
        ? { ok: true, json: () => Promise.resolve(structuredClone(watch)) }
        : { ok: false, json: () => Promise.resolve(null) });
      window.eval(read('js/components/review-status.js'));
    },
  });
  const doc = dom.window.document;
  for (let i = 0; i < 200 && [...doc.querySelectorAll('[data-field="status"]')].some((el) => /Loading/.test(el.textContent)); i++) {
    await new Promise((r) => setTimeout(r, 5));
  }
  return doc;
}

test('the watchlist carries the pending bills with a source, a check date and a review date', () => {
  for (const id of PENDING) {
    const e = WATCH.entries.find((x) => x.id === id);
    assert.ok(e, `${id} is not in the watchlist`);
    assert.equal(e.status, 'proposed');
    assert.match(e.source_url, /^https:\/\/www\.congress\.gov\/bill\/119th-congress\//);
    assert.match(e.last_verified, /^\d{4}-\d{2}-\d{2}$/);
    assert.match(e.review_by, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(e.bill && e.bill.number && e.bill.committee && Number.isInteger(e.bill.cosponsors.total), `${id} has no bill details`);
  }
});

test('the page source types no bill status', () => {
  // The text a reader sees without scripts: parse the page, drop script
  // elements, read the body text (comments are not text).
  const doc = new JSDOM(HTML).window.document;
  doc.querySelectorAll('script').forEach((el) => el.remove());
  const visible = doc.body.textContent;
  assert.ok(visible.length > 1000, 'the page text is nearly empty; this guard would pass vacuously');
  assert.doesNotMatch(visible, /\b\d+\+?\s+cosponsors\b/i, 'a cosponsor count is typed into the page');
  assert.doesNotMatch(visible, /Referred to/i, 'a committee referral is typed into the page');
  const cells = [...doc.querySelectorAll('[data-field="status"]')];
  assert.equal(cells.length, PENDING.length, 'the status cells this guard reads are missing');
});

test('what the page shows is what the watchlist says', async () => {
  const doc = await render();
  for (const id of PENDING) {
    const e = WATCH.entries.find((x) => x.id === id);
    const cell = doc.querySelector(`[data-ahcia-bill="${id}"][data-field="status"]`).textContent;
    assert.ok(cell.includes(e.bill.committee), `${id}: "${cell}" does not name ${e.bill.committee}`);
    assert.ok(cell.includes(`${e.bill.cosponsors.total} cosponsors`), `${id}: "${cell}" does not show ${e.bill.cosponsors.total} cosponsors`);
  }
  const [house, senate] = PENDING.map((id) => WATCH.entries.find((x) => x.id === id));
  assert.equal(doc.querySelector('[data-ahcia="cosponsor-stat"]').textContent,
    `${house.bill.cosponsors.total} · ${senate.bill.cosponsors.total}`);
});

test('changing the data changes the page; a missing entry says so', async () => {
  const changed = structuredClone(WATCH);
  changed.entries.find((x) => x.id === 'ahcia-2025-s1515').bill.cosponsors.total = 77;
  let doc = await render(changed);
  assert.match(doc.querySelector('[data-ahcia-bill="ahcia-2025-s1515"][data-field="status"]').textContent, /\b77 cosponsors\b/);
  const without = structuredClone(WATCH);
  without.entries = without.entries.filter((x) => x.id !== 'ahcia-2025-hr2725');
  doc = await render(without);
  assert.match(doc.querySelector('[data-ahcia-bill="ahcia-2025-hr2725"][data-field="status"]').textContent, /Not in the watchlist/);
  assert.equal(doc.querySelector('[data-ahcia="cosponsor-stat"]').textContent, '—', 'a partial total is shown as if complete');
});
