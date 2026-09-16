#!/usr/bin/env node
/**
 * The derived-data chain is declared, ordered, and complete.
 *
 * Before scripts/rebuild-derived.mjs existed, the set of artifacts that go
 * stale when data/hna/ranking-index.json changes was discovered by pushing and
 * reading CI failures — one artifact per round. PR #1692 took seven rounds and
 * only two were code fixes. Restoring the LIHTC recency data (#1698) took three
 * more, every one of them the same forgotten final step.
 *
 * So the chain is now data, and this guards three things about it:
 *
 *   1. ORDER. The index has three producers and they must all run, in order,
 *      before anything reads the file — running only the first is what deleted
 *      32 metrics per jurisdiction in June 2026. rebuild_manifest.py records
 *      byte counts, so it must be last.
 *   2. COMPLETENESS. Every script that touches the ranking index is either a
 *      step in the chain or an explicit exclusion WITH A REASON. A new consumer
 *      then forces a decision, instead of being found by a CI failure months
 *      later.
 *   3. THE EXCLUSION LIST STAYS HONEST. An entry naming a file that no longer
 *      exists, or no longer touches the index, is stale curation pretending to
 *      be a decision.
 */

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHAIN, NOT_DERIVED } from '../scripts/rebuild-derived.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let failures = 0;
const pass = (m) => console.log(`  ✓ ${m}`);
const fail = (m) => { failures += 1; console.log(`  ✗ ${m}`); };
const test = (name, fn) => {
  try { fn(); pass(name); } catch (e) { fail(`${name} — ${e.message}`); }
};

console.log('rebuild-derived-chain');

const chainFiles = CHAIN
  .map((s) => s.argv.find((a) => a.startsWith('scripts/')))
  .filter(Boolean);

test('every step runs a script that exists', () => {
  for (const s of CHAIN) {
    const file = s.argv.find((a) => a.startsWith('scripts/'));
    // paper-figures goes through `npm run paper:build`; check the npm script.
    if (!file) {
      assert.ok(s.argv[0] === 'npm', `${s.id}: no script path and not an npm run`);
      const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
      assert.ok(pkg.scripts[s.argv[2]], `${s.id}: npm script ${s.argv[2]} does not exist`);
      continue;
    }
    assert.ok(fs.existsSync(path.join(ROOT, file)), `${s.id}: ${file} is missing`);
  }
});

test('every step states why it is in the chain', () => {
  for (const s of CHAIN) {
    assert.ok(s.why && s.why.length > 20,
      `${s.id} has no meaningful reason; an unexplained step is one nobody can safely remove`);
  }
});

test('all three ranking-index producers are in the chain', () => {
  // The index is written by the builder and then TWICE MORE by the augmenters.
  // #1698: running only the builder deleted 32 metrics from all 546 entries.
  for (const producer of [
    'scripts/hna/build_ranking_index.py',
    'scripts/augment_ranking_index_recency.mjs',
    'scripts/augment_lihtc_by_geometry.mjs',
  ]) {
    assert.ok(chainFiles.includes(producer),
      `${producer} writes the ranking index but is not in the chain`);
  }
});

test('the augmenters run AFTER the builder that would overwrite them', () => {
  const b = chainFiles.indexOf('scripts/hna/build_ranking_index.py');
  for (const aug of ['scripts/augment_ranking_index_recency.mjs', 'scripts/augment_lihtc_by_geometry.mjs']) {
    assert.ok(chainFiles.indexOf(aug) > b,
      `${aug} runs before the builder, which rewrites the file and discards it`);
  }
});

test('scenarios run after every producer of the file they pin', () => {
  // ranking-scenarios records the index's generatedAt; built first, they pin a
  // timestamp the index no longer has and ci-checks fails.
  const scen = chainFiles.indexOf('scripts/hna/build_ranking_scenarios.py');
  assert.ok(scen >= 0, 'ranking-scenarios is not in the chain');
  for (const aug of ['scripts/augment_ranking_index_recency.mjs', 'scripts/augment_lihtc_by_geometry.mjs']) {
    assert.ok(scen > chainFiles.indexOf(aug), `scenarios run before ${aug}`);
  }
});

test('the byte-count manifest is the LAST step', () => {
  // It records file sizes. Anything that writes a data file after it leaves it
  // stale — three separate CI rounds on 2026-09-16 were exactly this.
  const last = CHAIN[CHAIN.length - 1];
  assert.ok(last.argv.includes('scripts/rebuild_manifest.py'),
    `the chain ends with ${last.id}, not the byte-count manifest`);
  assert.strictEqual(last.last, true, 'the final step is not marked `last: true`');
  const marked = CHAIN.filter((s) => s.last);
  assert.strictEqual(marked.length, 1, 'more than one step claims to be last');
});

/* ── completeness ────────────────────────────────────────────────────────── */

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (/\.(py|mjs|js|cjs)$/.test(e.name)) out.push(full);
  }
  return out;
}

const touchers = walk(path.join(ROOT, 'scripts'))
  .filter((f) => fs.readFileSync(f, 'utf8').includes('ranking-index.json'))
  .map((f) => path.relative(ROOT, f))
  .sort();

test('the scan finds the ranking-index consumers at all', () => {
  // Without this the completeness check passes by finding nothing.
  assert.ok(touchers.length >= 10,
    `only ${touchers.length} scripts reference ranking-index.json; the scan has drifted`);
  assert.ok(touchers.includes('scripts/hna/build_ranking_index.py'),
    'the scan missed the builder itself');
});

test('every script touching the ranking index is either in the chain or excluded with a reason', () => {
  const unaccounted = touchers.filter((f) => !chainFiles.includes(f) && !NOT_DERIVED[f]);
  assert.deepStrictEqual(unaccounted, [],
    `these read or write data/hna/ranking-index.json and are neither a chain step `
    + `nor an explicit exclusion: ${unaccounted.join(', ')}. Add to CHAIN if the file `
    + `GENERATES something from the index, or to NOT_DERIVED with the reason it does not.`);
});

test('no exclusion is both in the chain and excluded', () => {
  const both = chainFiles.filter((f) => NOT_DERIVED[f]);
  assert.deepStrictEqual(both, [], `contradictory entries: ${both.join(', ')}`);
});

test('the exclusion list carries no dead entries', () => {
  const dead = [];
  for (const file of Object.keys(NOT_DERIVED)) {
    if (!fs.existsSync(path.join(ROOT, file))) { dead.push(`${file} (missing)`); continue; }
    if (file === 'scripts/rebuild-derived.mjs') continue;   // the chain itself
    if (!touchers.includes(file)) dead.push(`${file} (no longer references the index)`);
  }
  assert.deepStrictEqual(dead, [],
    `stale exclusions — curation that has stopped describing the repo: ${dead.join(', ')}`);
});

test('every exclusion states a reason', () => {
  for (const [file, reason] of Object.entries(NOT_DERIVED)) {
    assert.ok(reason && reason.length > 12,
      `${file} is excluded without a real reason; "excluded" with no why is just a silenced guard`);
  }
});

/* ── reachable from npm, and documented ──────────────────────────────────── */

test('npm run rebuild:derived exists and points at the chain', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const s = pkg.scripts['rebuild:derived'];
  assert.ok(s, 'package.json has no rebuild:derived script');
  assert.ok(s.includes('scripts/rebuild-derived.mjs'), `rebuild:derived runs "${s}"`);
});

test('AGENTS.md tells a maintainer the chain exists', () => {
  // The chain being runnable is only half of it. A maintainer who does not know
  // it exists still rebuilds by hand and still misses the last step.
  const agents = fs.readFileSync(path.join(ROOT, 'AGENTS.md'), 'utf8');
  assert.ok(/rebuild:derived/.test(agents),
    'AGENTS.md does not mention rebuild:derived, so nobody will know to run it');
});

console.log(failures === 0
  ? '  rebuild-derived-chain: PASS'
  : `  rebuild-derived-chain: FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
