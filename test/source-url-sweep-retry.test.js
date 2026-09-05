// test/source-url-sweep-retry.test.js
//
// Guard: a single transient outage must not fail an unrelated PR.
//
// The sweep probes ~180 live external URLs on every PR that touches a file
// containing one. Across that many hosts a momentary 502 or a dropped
// connection is routine. Before the retry, one of them turned the whole run
// red regardless of the diff — #1544 failed on two govinfo.gov 502s and a
// govtrack.us network error for a bill its three changed files never
// mention, while the same URLs returned 200 two hours earlier.
//
// The distinction the old binary could not make: a URL that blinked versus a
// URL that is gone. One retry separates them. This asserts both halves —
// 502-then-200 passes, 502-then-502 still blocks — because a retry that
// swallowed genuine breakage would be worse than no retry at all.
//
// Run: node test/source-url-sweep-retry.test.js

'use strict';

const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');

process.env.SWEEP_RETRY_DELAY_MS = '1'; // keep the suite fast; logic unchanged

const MODULE = pathToFileURL(
  path.join(__dirname, '..', 'scripts/audit/source-url-sweep.mjs')
).href;

// Loopback only: the sweep probes URLs on added lines of a diff, including
// ones inside test fixtures, so a real citation here would make this file
// fail the very check it is testing. fetch is stubbed — nothing is dialled.
const URL_UNDER_TEST = 'http://127.0.0.1/sweep-retry-fixture';

/**
 * Stub `fetch` with a scripted sequence of outcomes.
 * Each entry is an HTTP status, or the string 'throw' for a network failure.
 * checkUrl issues HEAD then falls back to GET when the response is not ok, so
 * one failing probe consumes two entries.
 */
function stubFetch(sequence) {
  const calls = [];
  globalThis.fetch = async (url, opts) => {
    calls.push({ url, method: (opts && opts.method) || 'GET' });
    const next = sequence.shift();
    if (next === undefined) throw new Error('stub exhausted — unexpected extra fetch');
    if (next === 'throw') throw new TypeError('fetch failed');
    return { ok: next >= 200 && next < 300, status: next };
  };
  return calls;
}

(async () => {
  const realFetch = globalThis.fetch;
  const { checkUrl, isTransient } = await import(MODULE);
  let failures = 0;
  const check = (fn, msg) => {
    try { fn(); console.log('  ✅ ' + msg); }
    catch (e) { failures++; console.error('  ❌ ' + msg + '\n     ' + e.message); }
  };

  console.log('\n[test] source-url-sweep transient retry');

  // ── A 502 that clears on the retry must pass ────────────────────────────
  stubFetch([502, 502, 200]);
  let r = await checkUrl(URL_UNDER_TEST);
  check(() => assert.strictEqual(r.status, 'OK'),
    'a 502 that clears on retry reports OK — a blip does not fail the PR');

  // ── A 502 that persists must still block ────────────────────────────────
  stubFetch([502, 502, 502, 502]);
  r = await checkUrl(URL_UNDER_TEST);
  check(() => assert.strictEqual(r.status, '5XX'),
    'a 502 on both attempts still reports 5XX — real breakage still blocks');
  check(() => assert.ok(/confirmed on retry/.test(r.message)),
    'the persistent failure says it was confirmed, so triage knows it retried');

  // ── A network-level failure is equally ambiguous, so equally retried ────
  stubFetch(['throw', 'throw', 200]);
  r = await checkUrl(URL_UNDER_TEST);
  check(() => assert.strictEqual(r.status, 'OK'),
    'a dropped connection that succeeds on retry reports OK');

  stubFetch(['throw', 'throw', 'throw', 'throw']);
  r = await checkUrl(URL_UNDER_TEST);
  check(() => assert.strictEqual(r.status, 'FAIL'),
    'a connection that fails twice still reports FAIL');

  // ── 404 is not ambiguous: a missing page does not un-miss itself ────────
  let calls = stubFetch([404, 404]);
  r = await checkUrl(URL_UNDER_TEST);
  check(() => assert.strictEqual(r.status, '404'),
    'a 404 stays a 404');
  check(() => assert.strictEqual(calls.length, 2),
    'a 404 is not retried — exactly one probe (HEAD + GET fallback)');

  // ── 403 keeps its non-blocking WAF bucket and is not retried ────────────
  calls = stubFetch([403, 403]);
  r = await checkUrl(URL_UNDER_TEST);
  check(() => assert.strictEqual(r.status, 'WAF'),
    'a 403 still lands in the non-blocking WAF bucket');
  check(() => assert.strictEqual(calls.length, 2),
    'a 403 is not retried — bot-blocking is not transient');

  // ── The classifier itself, stated directly ──────────────────────────────
  check(() => {
    assert.strictEqual(isTransient({ status: '5XX', http: 502 }), true);
    assert.strictEqual(isTransient({ status: 'FAIL', http: null }), true);
    assert.strictEqual(isTransient({ status: 'FAIL', http: 418 }), false);
    assert.strictEqual(isTransient({ status: '404', http: 404 }), false);
    assert.strictEqual(isTransient({ status: 'WAF', http: 403 }), false);
    assert.strictEqual(isTransient({ status: 'OK', http: 200 }), false);
  }, 'only 5XX and no-response network failures count as transient');

  globalThis.fetch = realFetch;

  if (failures) {
    console.error(`\n[test] source-url-sweep retry: ${failures} FAILED`);
    process.exit(1);
  }
  console.log('[test] source-url-sweep retry: PASS');
})().catch((err) => { console.error(err); process.exit(1); });
