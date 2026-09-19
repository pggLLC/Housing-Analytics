#!/usr/bin/env node
/**
 * A freshness failure must report in seconds, not at the end of the suite.
 *
 * ── Why ──
 *
 * `test:paper-fresh` was step 197 of 223. Regenerated data drifts on most
 * PRs that touch the HNA chain, so the commonest failure in this repo was
 * also the slowest to surface: roughly nine minutes of suite before it said
 * "run npm run paper:build". The fix is then a 30-second rebuild followed by
 * another full nine-minute run.
 *
 * Measured on a clean tree, all fifteen freshness gates together take ~84s,
 * and the dominant cost is jurisdiction-metrics-digest-fresh at 61s. Every
 * other gate is 0-6s, so the cheap ones report almost immediately.
 *
 * ── Why this is also more correct ──
 *
 * test:ci regenerates digests and briefs IN PLACE partway through. A
 * freshness gate running after that was checking post-regeneration state;
 * running first, it checks what is actually committed, which is what
 * "is the committed data fresh" means.
 *
 * Every gate was verified to pass standalone on a clean checkout and to leave
 * the tree untouched, so no later step can depend on one having run.
 *
 * ── What this guard holds ──
 *
 * The ordering, not the contents. A new gate may be added to test:freshness
 * freely; what must not happen is a gate drifting back into the body of the
 * suite, which is how this regressed into a 197th-step check in the first
 * place.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const scripts = pkg.scripts || {};

// test:ci is a chain of group scripts (ci:part-1 ... ci:part-N), so its steps
// have to be flattened one level to get the real running order. It used to be
// a single 7,595-character line holding all 213 steps, which meant any two
// PRs that added a guard conflicted by construction — #1752 and #1753 did,
// and resolving that conflict silently dropped one of the two new guards from
// CI until it was caught by hand.
//
// Flattening keeps this guard measuring the order a run actually executes,
// whether the steps live in one line or twenty.
function flattenCi(name, depth) {
  if (depth > 5) return [];
  return String(scripts[name] || '').split('&&')
    .map((s) => s.trim().replace(/^npm run /, ''))
    .filter(Boolean)
    .flatMap((step) => (/^ci:part-\d+$/.test(step) ? flattenCi(step, depth + 1) : [step]));
}
const ciSteps = flattenCi('test:ci', 0);
const freshnessSteps = String(scripts['test:freshness'] || '').split('&&')
  .map((s) => s.trim().replace(/^npm run /, '')).filter(Boolean);

/** A gate is anything whose job is to compare committed output to a rebuild. */
const GATE = /(^|[-:])(fresh|freshness)|manifest|inventory|derived-chain/;

test('the suite has something to order', () => {
  assert.ok(ciSteps.length > 100, `test:ci has only ${ciSteps.length} steps`);
  assert.ok(freshnessSteps.length >= 10,
    `test:freshness has only ${freshnessSteps.length} steps — did it lose its contents?`);
});

test('test:ci stays split, so two PRs can add guards without colliding', () => {
  // The suite ran as ONE 7,595-character line of 213 steps. Git sees that as a
  // single line, so every PR that registers a guard edits it and any two such
  // PRs conflict. #1752 and #1753 did exactly that, and resolving the conflict
  // by taking one side dropped the other side's guard from CI — a new guard
  // silently not running, which is the worst way for a guard to fail.
  //
  // The cap is generous: it is here to stop the groups being folded back into
  // one line, not to police how they are organised.
  const groups = Object.keys(scripts).filter((k) => /^ci:part-\d+$/.test(k));
  assert.ok(groups.length >= 4,
    `test:ci is split into only ${groups.length} group(s); it collapses back to a `
    + 'single line that every guard-adding PR has to edit');

  const longest = Math.max(...groups.map((g) => String(scripts[g]).length));
  assert.ok(longest < 4000,
    `the longest test:ci group is ${longest} characters; split it further before it `
    + 'becomes the single line again');

  // test:ci itself must only chain groups, not carry steps of its own — a step
  // added directly to it would reintroduce the shared line.
  const direct = String(scripts['test:ci'] || '').split('&&')
    .map((x) => x.trim().replace(/^npm run /, '')).filter(Boolean)
    .filter((x) => !/^ci:part-\d+$/.test(x));
  assert.deepEqual(direct, [],
    `test:ci runs these steps directly instead of via a group: ${direct.join(', ')}`);
});

test('splitting test:ci did not drop or reorder anything', () => {
  // The split is only safe if the flattened order is exactly what ran before.
  // Ordering is load-bearing here: the freshness block must stay at the front.
  assert.ok(ciSteps.length > 200,
    `only ${ciSteps.length} steps after flattening; the split lost some`);
  const seen = new Set();
  const dupes = ciSteps.filter((s) => (seen.has(s) ? true : (seen.add(s), false)));
  assert.deepEqual(dupes, [], `these steps run twice after the split: ${dupes.join(', ')}`);
  for (const s of ciSteps) {
    assert.ok(scripts[s], `test:ci runs "${s}", which is not a script in package.json`);
  }
});

test('test:freshness runs near the front of test:ci', () => {
  const at = ciSteps.indexOf('test:freshness');
  assert.ok(at >= 0, 'test:ci no longer runs test:freshness');
  assert.ok(at <= 5,
    `test:freshness is step ${at + 1} of ${ciSteps.length}; it belongs in the first few`);
});

test('no freshness gate has drifted back into the body of the suite', () => {
  // The actual regression this prevents. A gate listed directly in test:ci,
  // after the freshness block, is one that will report late again.
  const at = ciSteps.indexOf('test:freshness');
  const strays = ciSteps.filter((s, i) => i > at && GATE.test(s));
  assert.deepEqual(strays, [],
    `these gates run in the body of the suite instead of the front block: ${strays.join(', ')}`);
});

test('every step test:freshness names actually exists', () => {
  // A typo here would silently skip a gate: npm fails on an unknown script,
  // but a gate removed from the list fails nothing at all.
  for (const s of freshnessSteps) {
    assert.ok(scripts[s], `test:freshness runs "${s}", which is not a script in package.json`);
  }
});

test('the front block is not also run again later', () => {
  const seen = new Set();
  for (const s of ciSteps) {
    assert.ok(!seen.has(s), `${s} runs twice in test:ci`);
    seen.add(s);
  }
  for (const s of freshnessSteps) {
    assert.ok(!seen.has(s),
      `${s} is in test:freshness AND listed separately in test:ci — it would run twice`);
  }
});

test('the expensive gate is last within the block', () => {
  // Ordered cheapest-first so the common failures report in seconds.
  // jurisdiction-metrics-digest-fresh is 61s of the block's ~84s; putting it
  // anywhere but last delays every cheaper gate behind it.
  const slow = 'test:jurisdiction-metrics-digest-fresh';
  if (!freshnessSteps.includes(slow)) return;
  assert.equal(freshnessSteps[freshnessSteps.length - 1], slow,
    `${slow} takes 61s of the block and must run last so the cheap gates report first`);
});
