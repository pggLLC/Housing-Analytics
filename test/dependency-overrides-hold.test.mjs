#!/usr/bin/env node
/**
 * Overrides that exist to close an advisory must keep holding.
 *
 * An `overrides` entry is invisible: nothing in the code references it, no
 * test exercises the package it pins, and a later `npm install`, a dependency
 * bump, or a merge that loses one line puts the vulnerable version back
 * without anyone noticing. The advisory count then climbs again and the only
 * signal is a Dependabot email.
 *
 * adm-zip (#1843). Three alerts — two high, one with no patched version at
 * all — reached this repo transitively through mapshaper 0.7.66, which
 * declares `adm-zip: ^0.5.9` and so will never take the fix on its own.
 *
 * Worth recording, because it decides how much this matters: the vulnerable
 * code path is NEVER EXECUTED here. All three advisories are about extracting
 * a hostile ZIP, and scripts/simplify-geojson.mjs — the only thing in this
 * repo that runs mapshaper — passes GeoJSON in and GeoJSON out. mapshaper
 * only reaches for adm-zip on a .zip input. So this is hygiene and an honest
 * advisory count, not an exposure being closed.
 *
 * The override was verified against the real workload rather than assumed
 * safe: tract boundaries simplified byte-for-byte identically under 0.5.18
 * and 0.6.1, and county polygons and transit lines both completed.
 */

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'));

/**
 * Each override that exists for a security advisory, and the floor it buys.
 * An entry here is a claim that the repo is no longer exposed to something;
 * losing it silently is the failure this file prevents.
 */
const SECURITY_OVERRIDES = [{
  name: 'adm-zip',
  minimum: [0, 6, 1],
  why: 'two high-severity memory-exhaustion advisories, fixed in 0.6.0/0.6.1; '
    + 'mapshaper pins ^0.5.9 and cannot take them (#1843)',
}];

let failures = 0;
const test = (name, fn) => {
  try { fn(); console.log(`  ✓ ${name}`); }
  catch (e) { failures += 1; console.log(`  ✗ ${name} — ${e.message}`); }
};

const parse = (v) => String(v).replace(/^[^\d]*/, '').split('.').map(Number);
const gte = (a, b) => {
  for (let i = 0; i < 3; i += 1) {
    if ((a[i] || 0) > (b[i] || 0)) return true;
    if ((a[i] || 0) < (b[i] || 0)) return false;
  }
  return true;
};

console.log('dependency-overrides-hold');

test('the probe itself works', () => {
  // Version comparison decides every assertion below, so prove it can fail.
  assert.strictEqual(gte(parse('0.6.1'), [0, 6, 1]), true, 'equal versions compare as below');
  assert.strictEqual(gte(parse('0.5.18'), [0, 6, 1]), false,
    '0.5.18 compares as at-or-above 0.6.1 — the comparison is string-wise, not numeric, '
    + 'and every check here would pass on the vulnerable version');
  assert.strictEqual(gte(parse('^0.7.0'), [0, 6, 1]), true, 'a caret range is not parsed');
});

test('every security override is still declared', () => {
  const declared = pkg.overrides || {};
  for (const o of SECURITY_OVERRIDES) {
    assert.ok(declared[o.name],
      `the ${o.name} override is gone from package.json. It exists because: ${o.why}`);
    assert.ok(gte(parse(declared[o.name]), o.minimum),
      `${o.name} is overridden to ${declared[o.name]}, below the ${o.minimum.join('.')} `
      + `the advisory requires. ${o.why}`);
  }
});

test('and the lockfile actually resolved to the patched version', () => {
  // The override is a request; the lockfile is what ships. A merge can keep
  // one and lose the other.
  for (const o of SECURITY_OVERRIDES) {
    const entries = Object.entries(lock.packages || {})
      .filter(([k]) => k.endsWith(`node_modules/${o.name}`));
    assert.ok(entries.length >= 1, `${o.name} is not in the lockfile at all`);
    for (const [where, v] of entries) {
      assert.ok(gte(parse(v.version), o.minimum),
        `${where} resolved to ${o.name}@${v.version}, below ${o.minimum.join('.')}. `
        + 'The override is declared but did not take — run npm install and commit the lockfile');
    }
  }
});

test('the reason each override exists is written down', () => {
  for (const o of SECURITY_OVERRIDES) {
    assert.ok(typeof o.why === 'string' && o.why.length > 30,
      `${o.name} is pinned with no stated reason; an unexplained pin gets removed as clutter`);
  }
});

console.log(failures === 0
  ? '  dependency-overrides-hold: PASS'
  : `  dependency-overrides-hold: FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
