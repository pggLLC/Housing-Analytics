#!/usr/bin/env node
'use strict';
// A returning visitor's freshness badge must show the date the data file
// carries now, not the date cached on an earlier visit (Codex audit,
// 2026-10-17: a "September 20" stale warning corrected to "October 15" on a
// later visit). safeFetchJSON serves a localStorage copy first and refreshes
// it in the background; the badge rendered once, from the copy.
//
// Run with the real fetch-helper.js and data-vintage-badge.js: an old cached
// copy of the snapshot is seeded, the server answers with the current file,
// and the rendered date must equal the current file's own timestamp. A
// legitimately old file must still render the stale warning.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const SNAP = 'data/home-snapshot.json';
const current = JSON.parse(read(SNAP));
const src = Object.keys(current.source_vintages || {}).find((k) => current.source_vintages[k] && current.source_vintages[k].updated);
assert(src, 'the snapshot carries source vintages to check');

async function render(cachedUpdated, cacheAgeHours, servedUpdated, sla) {
  const dom = new JSDOM(`<!doctype html><body><div id="t" data-vintage-source="${src}" data-vintage-sla-days="${sla}"></div></body>`,
    { runScripts: 'outside-only', url: 'http://localhost/index.html' });
  const w = dom.window;
  const snap = (updated) => ({ source_vintages: { [src]: Object.assign({}, current.source_vintages[src], { updated }) } });
  w.localStorage.setItem('_fh_' + SNAP, JSON.stringify({ ts: Date.now() - cacheAgeHours * 3600e3, data: snap(cachedUpdated) }));
  w.fetch = (url) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(url.includes('home-snapshot') ? snap(servedUpdated) : {}) });
  w.eval(read('js/fetch-helper.js'));
  w.eval(read('js/components/data-vintage-badge.js'));
  await new Promise((r) => setTimeout(r, 50));
  const badge = w.document.querySelector('#t .data-vintage-badge');
  return badge ? { date: badge.querySelector('strong').textContent, stale: badge.classList.contains('data-vintage-badge--stale') } : null;
}

(async () => {
  const now = current.source_vintages[src].updated;
  const old = new Date(Date.parse(now) - 25 * 86400e3).toISOString();
  // Cache older than the 24 h TTL (served stale, refreshed in background) and
  // cache inside the TTL (served without any refresh): both must show now.
  for (const age of [48, 2]) {
    const r = await render(old, age, now, 3650);
    assert(r, 'a badge rendered');
    assert.equal(r.date, now.slice(0, 10), `with a ${age} h old cached copy the badge shows the file's current date`);
  }
  // A file that really is past its refresh window still warns.
  const r = await render(old, 2, old, 7);
  assert.equal(r.stale, true, 'a genuinely old file still shows the stale warning');
  assert.equal(r.date, old.slice(0, 10), 'and names its own date');
  console.log(`vintage-badge-fresh-on-return: PASS (${src}, ${now.slice(0, 10)})`);
})().catch((e) => { console.error(e); process.exit(1); });
