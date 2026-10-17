'use strict';
// The fetch helper's data cache ('_fh_' keys in localStorage) must leave room
// for the user's own saved work. Before the size limit, the map layers alone
// (several over 1 MB each) filled browser storage, and the saved market-area
// run was refused without a word, so reopening the page lost it.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'js', 'fetch-helper.js'), 'utf8');
const LIMIT = 256 * 1024;

function load(seed) {
  const dom = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost/market-analysis.html', runScripts: 'outside-only' });
  const w = dom.window;
  w.console.error = w.console.warn = () => {};
  Object.entries(seed || {}).forEach(([k, v]) => w.localStorage.setItem(k, v));
  w.eval(SRC);
  assert.strictEqual(typeof w.safeFetchJSON, 'function', 'fetch helper did not load');
  return w;
}
function entry(chars) { return JSON.stringify({ ts: Date.now(), data: 'x'.repeat(chars) }); }
function respond(w, body) {
  w.fetch = () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
}

(async () => {
  // Entries written before the limit existed are pruned on load; small ones stay.
  const big = entry(LIMIT + 10), small = entry(1000);
  assert.ok(big.length > LIMIT && small.length < LIMIT, 'fixture sizes straddle the limit');
  let w = load({ '_fh_data/big.json': big, '_fh_data/small.json': small, 'coho_wf_active': 'keep' });
  assert.strictEqual(w.localStorage.getItem('_fh_data/big.json'), null, 'an oversize cache entry survived load');
  assert.strictEqual(w.localStorage.getItem('_fh_data/small.json'), small, 'a small cache entry was pruned');
  assert.strictEqual(w.localStorage.getItem('coho_wf_active'), 'keep', 'pruning touched a non-cache key');

  // A large file is fetched but not cached; a small one is cached.
  w = load();
  respond(w, { rows: 'y'.repeat(LIMIT) });
  const got = await w.safeFetchJSON('data/market/large.json');
  assert.strictEqual(got.rows.length, LIMIT, 'the large file was not returned to the caller');
  assert.strictEqual(w.localStorage.getItem('_fh_data/market/large.json'), null, 'a file over the limit was cached');
  respond(w, { rows: [1, 2, 3] });
  await w.safeFetchJSON('data/small.json');
  const cached = JSON.parse(w.localStorage.getItem('_fh_data/small.json') || 'null');
  assert.ok(cached && cached.data && cached.data.rows.length === 3, 'a small file was not cached (non-vacuity)');
  console.log('fetch-helper-cache-size: PASS (oversize pruned and skipped, small files still cached)');
})().catch((e) => { console.error('fetch-helper-cache-size: FAIL —', e.message); process.exit(1); });
