#!/usr/bin/env node
/**
 * If a freshness gate can fail, the chain must be able to fix it — and the
 * workflow that writes the artifact must run the chain, not a hand-picked
 * subset of it.
 *
 * ── What happened on 2026-09-19 ──
 *
 * Four separate cron commits broke `main`, none of them reported, because
 * GitHub runs no workflows for pushes made with GITHUB_TOKEN (see the comment
 * at the top of .github/workflows/ci-checks.yml). ci-checks does catch them
 * afterwards through its `workflow_run` trigger — it fired at 12:12 and
 * failed — but by then main is already broken and every open PR has inherited
 * the failure on files it never touched.
 *
 * Two of the four came from the same cause: build-hna-data.yml ran 8 of the
 * 11 steps in scripts/rebuild-derived.mjs, hand-picked.
 *
 *   - it ran build_ranking_index.py without the two augmenters, taking the
 *     committed index from 72 metrics to 41 and deleting every recency and
 *     regional-recency field. That is #1698, which had already stood for
 *     three months once.
 *   - it never ran build_place_pages.py, so eight places/<geoid>.html sat
 *     stale against the data the same run had just changed.
 *
 * `place-pages` was not even IN the chain, so nothing could have noticed the
 * second one. It is now.
 *
 * ── What this guard holds ──
 *
 * Two properties, both relational — each compares two independent lists
 * rather than asserting text in one file:
 *
 *   1. every freshness gate in `test:freshness` has a chain step that can
 *      regenerate what it checks, so "this is stale" always has an answer.
 *   2. a workflow that writes a chained artifact runs the chain, rather than
 *      picking steps out of it and drifting.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const pkg = JSON.parse(read('package.json')).scripts;
const chainSrc = read('scripts/rebuild-derived.mjs');

const chainIds = [...chainSrc.matchAll(/^\s{4}id: '([^']+)'/gm)].map((m) => m[1]);
const chainCmds = [...chainSrc.matchAll(/argv: \[([^\]]+)\]/g)]
  .map((m) => m[1].replace(/['\s]/g, '').split(',').join(' '));

const freshnessSteps = String(pkg['test:freshness'] || '').split('&&')
  .map((s) => s.trim().replace(/^npm run /, '')).filter(Boolean);

test('the chain and the freshness block both have contents', () => {
  assert.ok(chainIds.length >= 10, `only ${chainIds.length} chain steps parsed`);
  assert.ok(freshnessSteps.length >= 10, `only ${freshnessSteps.length} freshness gates parsed`);
});

test('every gated artifact has a chain step that can rebuild it', () => {
  // A gate whose artifact nothing in the chain regenerates is a gate that can
  // fail with no documented fix — which is how place-pages sat outside the
  // chain while test:place-pages-fresh guarded it.
  const GATE_TO_CHAIN = {
    'test:ranking-fresh': 'ranking-index',
    'test:ranking-scenarios': 'ranking-scenarios',
    'test:jurisdiction-metrics-digest-fresh': 'jurisdiction-digests',
    'test:place-pages-fresh': 'place-pages',
    'test:paper-fresh': 'paper-figures',
    'test:file-manifest': 'byte-manifest',
  };
  const missing = [];
  for (const [gate, step] of Object.entries(GATE_TO_CHAIN)) {
    if (!freshnessSteps.includes(gate)) continue;   // gate retired: not this test's business
    if (!chainIds.includes(step)) missing.push(`${gate} -> no '${step}' step`);
  }
  assert.deepEqual(missing, [],
    `these freshness gates can fail with nothing in the chain to fix them: ${missing.join(', ')}`);
});

test('a workflow that writes a chained artifact runs the chain, not a subset', () => {
  // build-hna-data.yml ran 8 of 11 steps and deleted 31 metrics per
  // jurisdiction twice over. Hand-picking is the failure; calling the chain is
  // the fix. Any workflow that invokes the FIRST step must invoke all of them
  // — most simply by running `npm run rebuild:derived`.
  const wfDir = path.join(ROOT, '.github/workflows');
  const offenders = [];
  for (const file of fs.readdirSync(wfDir).filter((f) => f.endsWith('.yml'))) {
    const src = fs.readFileSync(path.join(wfDir, file), 'utf8');
    // An INVOCATION, and a workflow that commits. The first version matched
    // any mention of the script, and flagged test-sentinel-normalization.yml —
    // which names it in an `on: push: paths:` filter and never commits
    // anything. Mention versus usage, in the guard written about hand-picked
    // chain steps.
    if (!/(?:^|\n)\s*(?:python3?|-)\s+scripts\/hna\/build_ranking_index\.py/.test(src)) continue;
    if (!/git\s+commit/.test(src)) continue;       // runs it but ships nothing
    if (/rebuild:derived/.test(src)) continue;      // runs the whole chain: fine
    const absent = chainCmds
      .map((cmd) => (cmd.match(/[\w/.-]+\.(?:mjs|py)/) || [])[0])
      .filter(Boolean)
      .filter((script) => !src.includes(script));
    if (absent.length) offenders.push(`${file} omits ${absent.join(', ')}`);
  }
  assert.deepEqual(offenders, [],
    'a workflow rebuilds the ranking index but skips other chain steps, which is how '
    + `#1698 recurred: ${offenders.join(' | ')}`);
});
