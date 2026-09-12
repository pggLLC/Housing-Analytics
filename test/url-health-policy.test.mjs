import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  BROWSER_USER_AGENT,
  CONFIRMED_FAILURE_SWEEPS,
  checkUrl,
  decodeHtmlEntities,
  diffConfirmedSweeps,
  isSkippableUrl,
  isTransient,
  looksLikeCspValue,
  sanitizeExtractedUrl
} from '../scripts/audit/url-health-policy.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOOPBACK = 'http://127.0.0.1:8765/url-health-fixture';

function cache(status, consecutiveFailures, httpStatus = null) {
  return {
    byUrl: {
      [LOOPBACK]: { status, consecutiveFailures, httpStatus }
    }
  };
}

assert.equal(CONFIRMED_FAILURE_SWEEPS, 2, 'confirmation waits exactly two weekly sweeps');
assert.match(BROWSER_USER_AGENT, /^Mozilla\/5\.0 .+Chrome\//,
  'shared user-agent is browser-grade');

const firstFailure = diffConfirmedSweeps(cache('ok', 0, 200), cache('broken', 1, 404));
assert.deepEqual(firstFailure.newlyBroken, [], 'one failure is not reported as newly broken');
assert.equal(firstFailure.unconfirmed.length, 1, 'one failure remains visibly unconfirmed');

const secondFailure = diffConfirmedSweeps(cache('broken', 1, 404), cache('broken', 2, 404));
assert.equal(secondFailure.newlyBroken.length, 1,
  'a second consecutive weekly failure is promoted into the issue report');
assert.equal(secondFailure.newlyBroken[0].url, LOOPBACK);

const recovered = diffConfirmedSweeps(cache('broken', 1, 404), cache('ok', 0, 200));
assert.deepEqual(recovered.newlyBroken, [], 'a one-off failure that recovers is never reported');
assert.equal(recovered.recovered.length, 1, 'recovery remains visible in the summary');

const thirdFailure = diffConfirmedSweeps(cache('broken', 2, 404), cache('broken', 3, 404));
assert.deepEqual(thirdFailure.newlyBroken, [], 'a confirmed break is promoted only once');
assert.equal(thirdFailure.stillBroken.length, 1, 'later failures remain still-broken');

for (const file of ['url-health-sweep.mjs', 'source-url-sweep.mjs']) {
  const source = fs.readFileSync(path.join(ROOT, 'scripts/audit', file), 'utf8');
  assert.match(source, /import \{[^}]*BROWSER_USER_AGENT[^}]*\} from ['"]\.\/url-health-policy\.mjs['"]/s,
    `${file} imports the shared browser user-agent`);
  assert.match(source, /['"]User-Agent['"]\s*:\s*BROWSER_USER_AGENT/,
    `${file} sends the shared browser user-agent`);
  assert.match(source, /if \(!res\.ok\) \{/,
    `${file} confirms every non-OK HEAD response with GET`);
}

const weeklySweep = fs.readFileSync(
  path.join(ROOT, 'scripts/audit/url-health-sweep.mjs'), 'utf8');
const sourceSweep = fs.readFileSync(
  path.join(ROOT, 'scripts/audit/source-url-sweep.mjs'), 'utf8');
for (const fragment of [
  'dol\\.gov\\/general\\/topic\\/benefits-other',
  'rd\\.usda\\.gov\\/programs-services\\/single-family-housing-programs\\/single-family-housing-direct-home-loans',
  'rd\\.usda\\.gov\\/programs-services\\/single-family-housing-programs\\/single-family-housing-guaranteed-loan-program'
]) {
  const literal = fragment.replaceAll('\\.', '.').replaceAll('\\/', '/');
  assert.ok(weeklySweep.includes(literal), `${literal} is allow-listed by the weekly sweep`);
  assert.ok(sourceSweep.includes(fragment), `${literal} is skipped by the PR-time sweep`);
}

/* ── A live host that declines or throttles us is not link rot ──────── */

for (const [status, httpStatus, label] of [
  ['auth', 403, 'a 403 from a live host'],
  ['auth', 401, 'a 401 from a live host'],
  ['ratelimit', 429, 'a 429 rate-limit']
]) {
  const promoted = diffConfirmedSweeps(cache(status, 1, httpStatus), cache(status, 2, httpStatus));
  assert.deepEqual(promoted.newlyBroken, [],
    `${label} is never promoted into the broken-link issue`);
  const fromHealthy = diffConfirmedSweeps(cache('ok', 0, 200), cache(status, 1, httpStatus));
  assert.deepEqual(fromHealthy.newlyBroken, [], `${label} does not transition a healthy URL to broken`);
}

// A genuine 404 must still be reported — the widened healthy set must not
// swallow real rot.
const stillReports404 = diffConfirmedSweeps(cache('broken', 1, 404), cache('broken', 2, 404));
assert.equal(stillReports404.newlyBroken.length, 1, 'a confirmed 404 is still reported');

/* ── Transient outcomes are retried, 404 is not ─────────────────────── */

assert.equal(isTransient({ status: 'timeout', httpStatus: null }), true, 'timeout is transient');
assert.equal(isTransient({ status: 'ratelimit', httpStatus: 429 }), true, '429 is transient');
assert.equal(isTransient({ status: 'broken', httpStatus: null }), true, 'network error is transient');
assert.equal(isTransient({ status: 'broken', httpStatus: 503 }), true, '5XX is transient');
assert.equal(isTransient({ status: 'broken', httpStatus: 404 }), false, '404 is NOT transient');
assert.equal(isTransient({ status: 'ok', httpStatus: 200 }), false, 'ok is not transient');

process.env.SWEEP_RETRY_DELAY_MS = '0';

{
  // Blinked once, fine on the retry — must not be reported.
  let calls = 0;
  const probe = async (url) => {
    calls += 1;
    return calls === 1
      ? { url, status: 'timeout', httpStatus: null, message: 'timeout' }
      : { url, status: 'ok', httpStatus: 200, message: '' };
  };
  const result = await checkUrl(LOOPBACK, probe);
  assert.equal(calls, 2, 'a transient first result triggers exactly one retry');
  assert.equal(result.status, 'ok', 'the successful retry is what gets recorded');
}

{
  // Down on both attempts — reported, and labelled as confirmed.
  let calls = 0;
  const probe = async (url) => {
    calls += 1;
    return { url, status: 'broken', httpStatus: null, message: 'fetch failed' };
  };
  const result = await checkUrl(LOOPBACK, probe);
  assert.equal(calls, 2, 'a twice-failing URL is probed twice');
  assert.equal(result.status, 'broken', 'a confirmed failure stays broken');
  assert.match(result.message, /confirmed on retry/, 'the message records that it was confirmed');
}

{
  // A missing page does not un-miss itself: no retry, no wasted request.
  let calls = 0;
  const probe = async (url) => {
    calls += 1;
    return { url, status: 'broken', httpStatus: 404, message: 'not found' };
  };
  const result = await checkUrl(LOOPBACK, probe);
  assert.equal(calls, 1, 'a 404 is never retried');
  assert.equal(result.httpStatus, 404);
}

/* ── Extraction hygiene (#1552) ───────────────────────────────────────
 *
 * Ten strings that can never return 200 were sitting permanently in the
 * `stillBroken` bucket.
 *
 * source-url-sweep.mjs scrapes EVERY changed file for `https?://...` and probes
 * what it finds — its regex matches even a bare scheme — so fixtures here are
 * either loopback or assembled from `SCHEME` at runtime. Never write a literal
 * scheme-prefixed URL in this file.
 */

const SCHEME = 'https:' + '//';

// HTML entities left encoded in an href corrupt the query string.
assert.equal(
  decodeHtmlEntities('http://127.0.0.1:8765/css2?family=A:wght@400;600&amp;display=swap'),
  'http://127.0.0.1:8765/css2?family=A:wght@400;600&display=swap',
  '&amp; is decoded back into a query separator');
assert.equal(decodeHtmlEntities('http://127.0.0.1:8765/a?b=1&#38;c=2'),
  'http://127.0.0.1:8765/a?b=1&c=2', 'numeric entities decode');
assert.equal(decodeHtmlEntities('http://127.0.0.1:8765/a?b=1&unknown;c=2'),
  'http://127.0.0.1:8765/a?b=1&unknown;c=2', 'unknown entities are left untouched');

for (const [raw, expected, why] of [
  ['http://127.0.0.1:8765/lib;', 'http://127.0.0.1:8765/lib',
    'a CSP directive separator is not part of the URL'],
  ['http://127.0.0.1:8765/market-trends/**', 'http://127.0.0.1:8765/market-trends/',
    'markdown emphasis markers are not part of the URL'],
  ['http://127.0.0.1:8765/a?x=1&amp;y=2', 'http://127.0.0.1:8765/a?x=1&y=2',
    'entities are decoded before probing'],
  ['http://127.0.0.1:8765/page.', 'http://127.0.0.1:8765/page',
    'a sentence period is shed'],
  ['http://127.0.0.1:8765/page.,', 'http://127.0.0.1:8765/page',
    'stacked prose punctuation is shed'],
  ['http://127.0.0.1:8765/wiki/Foo_(bar)', 'http://127.0.0.1:8765/wiki/Foo_(bar)',
    'parentheses inside a real path survive'],
  ['http://127.0.0.1:8765/table/...', 'http://127.0.0.1:8765/table/...',
    'a trailing ellipsis is a placeholder marker, not prose punctuation'],
  [SCHEME, null, 'a bare scheme yields nothing probe-worthy'],
  ['not-a-url', null, 'non-URL text yields nothing probe-worthy']
]) {
  assert.equal(sanitizeExtractedUrl(raw), expected, why);
}

// A documented Content-Security-Policy value lists source expressions, not
// fetchable documents — every URL on such a line must be dropped.
assert.ok(looksLikeCspValue(
  `default-src 'self'; img-src 'self' data: ${SCHEME}*.tiles.example.invalid; frame-ancestors 'none'`),
  'a real CSP value is recognized');
assert.ok(looksLikeCspValue("script-src 'unsafe-inline' http://127.0.0.1:8765;"),
  'a single quoted-keyword directive is recognized');
assert.ok(!looksLikeCspValue('add the host to connect-src in the runbook'),
  'prose that merely names a directive is not a CSP value');
assert.ok(!looksLikeCspValue('See http://127.0.0.1:8765/csp for details'),
  'an ordinary sentence containing a URL is not a CSP value');

// Host patterns are never resolvable addresses.
assert.match(isSkippableUrl(`${SCHEME}*.tiles.example.invalid/`) || '', /wildcard host/,
  'a CSP wildcard source-expression is skipped, not probed');
assert.match(isSkippableUrl(`${SCHEME}{s}.tiles.example.invalid/{z}/{x}/{y}.png`) || '', /template placeholder/,
  'a Leaflet tile template is skipped, not probed');
assert.equal(isSkippableUrl(`${SCHEME}real.host.invalid/page`), null,
  'an ordinary URL is still probed');

// Placeholders are placeholders wherever they sit — these two rules were
// written but never fired, so the URLs below were probed on every sweep.
assert.match(isSkippableUrl(`${SCHEME}api.stlouisfed.org/fred/series/observations`) || '',
  /API endpoint reference/,
  'FRED is api.stlouisfed.ORG — the .gov-only pattern never matched it');
assert.match(isSkippableUrl(`${SCHEME}api.census.gov/data/2023/acs/acs5`) || '',
  /API endpoint reference/, 'the Census endpoint shape is still skipped');
assert.match(isSkippableUrl(`${SCHEME}api.stlouisfed.org/fred/series/observations?api_key=YOUR_KEY`) || '',
  /placeholder API key/, 'a documented example credential can never return 200');
assert.equal(isSkippableUrl(`${SCHEME}fred.stlouisfed.org/series/UNRATE`), null,
  'a real FRED series page is still probed');

assert.match(isSkippableUrl(`${SCHEME}reports.example.invalid/...`) || '', /ellipsis/,
  'a trailing ellipsis is a placeholder, not just a bare `...` host');
assert.match(isSkippableUrl(`${SCHEME}reports.example.invalid/table/...`) || '', /ellipsis/,
  'an ellipsis deeper in the path is a placeholder too');
assert.equal(isSkippableUrl(`${SCHEME}real.host.invalid/a...b`), null,
  'an ellipsis inside a path segment is not a placeholder');

// The sweep must actually route extraction through these helpers.
for (const [rx, why] of [
  [/addUrl\(urls,/, 'collection routes every match through the sanitizer'],
  [/if \(looksLikeCspValue\(line\)\) continue;/, 'markdown CSP lines are skipped wholesale'],
  [/sanitizeExtractedUrl\(url\)/, 'normalizeUrl sanitizes before canonicalizing']
]) {
  assert.match(weeklySweep, rx, why);
}

// Regression guard on the committed cache itself: none of the three faults
// may reappear as a probed URL.
const committedCache = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'data/url-health.json'), 'utf8'));
for (const url of Object.keys(committedCache.byUrl)) {
  assert.ok(!/^https?:\/\/[^/?#]*\*/.test(url),
    `cache holds a wildcard host pattern: ${url}`);
  assert.ok(!/^https?:\/\/[^/?#]*;/.test(url),
    `cache holds a CSP directive separator in the host: ${url}`);
  assert.ok(!url.includes('&amp;'),
    `cache holds an undecoded HTML entity: ${url}`);
  assert.ok(!/[{}]/.test(url),
    `cache holds a template placeholder: ${url}`);
  assert.ok(!url.endsWith('**'),
    `cache holds markdown emphasis markers: ${url}`);
}

// Guard against the recurring trap this file itself fell into: ci-checks runs
// source-url-sweep.mjs with --diff-added over every changed file, including
// .mjs, and its regex matches even a bare scheme. Any literal scheme-prefixed
// fixture added here becomes a live probe target and fails the PR. Loopback is
// exempt (the sweep skips it); everything else must be assembled from SCHEME.
{
  const selfSource = fs.readFileSync(
    path.join(ROOT, 'test/url-health-policy.test.mjs'), 'utf8');
  const scheme = 'https?:' + '//';
  const literal = new RegExp(scheme + '[^\\s"\'`<>)\\]]*', 'g');
  const offenders = (selfSource.match(literal) || [])
    .filter((u) => !u.includes('127.0.0.1') && !u.includes('localhost'))
    // The assembled `scheme` constant three lines up is not a fixture.
    .filter((u) => !/^https\?:\/\/$/.test(u));
  assert.deepEqual(offenders, [],
    'fixtures must be assembled from SCHEME, never written as literal URLs — ' +
    'source-url-sweep.mjs probes what it finds in this file');
}

console.log('url-health-policy: PASS');
