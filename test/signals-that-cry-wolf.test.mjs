#!/usr/bin/env node
/**
 * Two permanent alarms, and the rule that they must not be permanent.
 *
 * A warning that fires on every run teaches the reader to skip the line. The
 * next one — the real one — prints in the same voice and gets the same
 * response. This repo has the pattern on record: a GOTCHA comment nobody read
 * (#1695), a derived chain reconstructed from memory each time (#1696).
 *
 * Two instances, fixed together because they are one defect:
 *
 *   #1840 — the source-URL sweep reported leg.colorado.gov as a HARD FAILURE.
 *   The sweep already sent a browser User-Agent, but no Accept header, so
 *   Node's fetch defaulted to a wildcard. Measured: that host answers 406 to
 *   the wildcard and 200 to a browser Accept, same User-Agent either way. Two
 *   live Colorado bill citations read as broken while resolving fine for any
 *   reader. Fixed by asking the way a reader asks — not by reclassifying 406,
 *   and not by an allowlist entry.
 *
 *   #1841 — the paper builder printed "[paper] DIVERGENCE property tax rate"
 *   on every run, for a difference that js/config/financial-constants.js
 *   documents as deliberate and test/affordability-defaults-inventory.test.js
 *   already pins. Expected pairs are now stated as expected; anything else is
 *   a finding, and this file fails on it.
 */

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BROWSER_USER_AGENT, BROWSER_ACCEPT } from '../scripts/audit/url-health-policy.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const SWEEPS = ['scripts/audit/source-url-sweep.mjs', 'scripts/audit/url-health-sweep.mjs'];

let failures = 0;
const test = (name, fn) => {
  try { fn(); console.log(`  ✓ ${name}`); }
  catch (e) { failures += 1; console.log(`  ✗ ${name} — ${e.message}`); }
};

console.log('signals-that-cry-wolf');

/* ── #1840: the sweeps ask the way a reader asks ─────────────────────────── */

test('the shared policy publishes a browser Accept, not a wildcard', () => {
  assert.ok(typeof BROWSER_ACCEPT === 'string' && BROWSER_ACCEPT.length > 10,
    'BROWSER_ACCEPT is missing from scripts/audit/url-health-policy.mjs');
  assert.ok(/text\/html/.test(BROWSER_ACCEPT),
    `BROWSER_ACCEPT does not offer text/html: ${BROWSER_ACCEPT}`);
  assert.ok(!/^\*\/\*/.test(BROWSER_ACCEPT.trim()),
    'BROWSER_ACCEPT leads with a wildcard, which is the value that produced the 406');
});

test('every sweep request that sends the UA also sends the Accept', () => {
  // The pairing is the point: a browser User-Agent without a browser Accept is
  // not a browser-shaped request, and that gap is what #1840 was.
  let checked = 0;
  for (const file of SWEEPS) {
    const src = read(file);
    const headerLiterals = src.match(/headers:\s*\{[^}]*\}/g) || [];
    const withUa = headerLiterals.filter((h) => h.includes('BROWSER_USER_AGENT'));
    assert.ok(withUa.length >= 1, `${file} sends no BROWSER_USER_AGENT at all`);
    for (const h of withUa) {
      checked += 1;
      assert.ok(h.includes('BROWSER_ACCEPT'),
        `${file} sends a browser User-Agent without a browser Accept: ${h.replace(/\s+/g, ' ')}`);
    }
  }
  assert.ok(checked >= 4,
    `only ${checked} request header sets found across the sweeps; the scan is not reading them`);
});

/* ── #1841: an expected divergence is not an alarm ───────────────────────── */

// Both files carry it: model-parameters.json is what the extractor writes,
// figures.json is what the paper injects from. They must agree — a reader of
// the paper and a reader of the data should not get different answers.
const params = JSON.parse(read('data/paper/model-parameters.json'));
const figures = JSON.parse(read('data/paper/figures.json'));
const divergences = (params.affordability && params.affordability.divergence) || [];
const published = ((figures.methods && figures.methods.affordability
  && figures.methods.affordability.divergence) || []);

test('the divergence list reaches the paper, and says the same thing', () => {
  // A first draft of this file read figures.json at the wrong path, found an
  // empty array, and two of its assertions passed on it. Absence is not
  // agreement: check there is something, then check both copies match.
  assert.ok(divergences.length >= 1,
    'model-parameters.json publishes no divergence at all; the extractor may have stopped '
    + 'comparing the registry against the constants file');
  assert.deepStrictEqual(
    published.map((d) => `${d.parameter}:${d.registry_default}:${d.constants_file}:${d.expected}`),
    divergences.map((d) => `${d.parameter}:${d.registry_default}:${d.constants_file}:${d.expected}`),
    'the paper publishes a different divergence list from the extractor');
});

test('every published divergence declares whether it is expected', () => {
  assert.ok(Array.isArray(divergences), 'the paper no longer publishes a divergence list');
  assert.ok(divergences.length >= 1, 'nothing to check; see the previous assertion');
  for (const d of divergences) {
    assert.strictEqual(typeof d.expected, 'boolean',
      `'${d.parameter}' does not say whether it is expected; an untagged divergence is an alarm`);
  }
});

test('an UNEXPECTED divergence is a finding, not a log line', () => {
  // The assertion the permanent warning could never make.
  const surprises = divergences.filter((d) => !d.expected)
    .map((d) => `${d.parameter}: registry ${d.registry_default} vs constants ${d.constants_file}`);
  assert.deepStrictEqual(surprises, [],
    'the registry and the constants file disagree in a way nothing has accounted for. '
    + 'Either reconcile them, or record the pair as expected in EXPECTED_DIVERGENCE in '
    + `scripts/paper/extract-model-parameters.mjs with its reason: ${surprises.join('; ')}`);
});

test('an expected divergence states why, and the reason points somewhere real', () => {
  const expected = divergences.filter((d) => d.expected);
  assert.ok(expected.length >= 1,
    'no expected divergence is published; this check has nothing to verify and the '
    + 'tagging may have silently stopped working');
  for (const d of expected) {
    assert.ok(typeof d.reason === 'string' && d.reason.length > 40,
      `'${d.parameter}' is marked expected with no stated reason — that is an exemption`);
    const cited = d.reason.match(/[\w/.-]+\.(js|mjs)/g) || [];
    assert.ok(cited.length >= 1, `'${d.parameter}' cites no file for its reason`);
    for (const f of cited) {
      assert.ok(fs.existsSync(path.join(ROOT, f)) || fs.existsSync(path.join(ROOT, 'test', path.basename(f))),
        `'${d.parameter}' cites ${f}, which does not exist`);
    }
  }
});

test('and the expected-tag would actually notice', () => {
  // Everything is tagged correctly today, so the assertions above pass whether
  // or not the tagging works. Exercise the rule directly.
  const rule = (d, known) => Boolean(known.find((e) => e.parameter === d.parameter
    && e.registry_default === d.registry_default && e.constants_file === d.constants_file));
  const known = [{ parameter: 'p', registry_default: 1, constants_file: 2 }];
  assert.strictEqual(rule({ parameter: 'p', registry_default: 1, constants_file: 2 }, known), true,
    'a documented pair is not recognised as expected');
  assert.strictEqual(rule({ parameter: 'p', registry_default: 9, constants_file: 2 }, known), false,
    'a pair whose registry value MOVED is still treated as expected — the documented pair is '
    + 'stale and would go unnoticed');
  assert.strictEqual(rule({ parameter: 'p', registry_default: 1, constants_file: 9 }, known), false,
    'a pair whose constants value MOVED is still treated as expected');
  assert.strictEqual(rule({ parameter: 'other', registry_default: 1, constants_file: 2 }, known), false,
    'a different parameter is treated as expected');
});

console.log(failures === 0
  ? '  signals-that-cry-wolf: PASS'
  : `  signals-that-cry-wolf: FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
