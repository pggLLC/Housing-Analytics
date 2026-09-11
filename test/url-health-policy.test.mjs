import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  BROWSER_USER_AGENT,
  CONFIRMED_FAILURE_SWEEPS,
  diffConfirmedSweeps,
  isTransient,
  checkUrl
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

console.log('url-health-policy: PASS');
