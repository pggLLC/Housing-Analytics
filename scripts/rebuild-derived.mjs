#!/usr/bin/env node
/**
 * scripts/rebuild-derived.mjs — rebuild everything that derives from the
 * HNA ranking index, in dependency order.
 *
 * WHY THIS EXISTS
 *
 * Changing data/hna/ranking-index.json invalidates at least eight other
 * artifacts. Until now nothing recorded which, or in what order, so the list
 * was discovered by pushing and reading CI failures — one artifact per round.
 *
 * PR #1692 took seven CI rounds; only two were code fixes. Rounds 3-6 were four
 * different generated artifacts going stale, surfaced one at a time. On
 * 2026-09-16, restoring the LIHTC recency data cost three more rounds, all of
 * them `rebuild_manifest.py` — a step whose ordering constraint was written
 * down, in the issue, by the person who then forgot it three times in one
 * session.
 *
 * That is the case for this file. A chain that has to be remembered is not
 * documentation, it is a trap with a comment next to it.
 *
 * ORDER IS LOAD-BEARING IN THREE PLACES
 *
 *   1. The index has THREE producers. build_ranking_index.py writes it and the
 *      two augmenters add fields and write it back. Running only the first
 *      DELETES their contribution — that is what happened in June 2026 and
 *      stood for three months (#1698).
 *   2. ranking-scenarios pins the index's `generatedAt`. Rebuild the index
 *      without them and ci-checks fails on a timestamp.
 *   3. rebuild_manifest.py records BYTE COUNTS, so it must follow everything
 *      that writes a data file. Including itself-adjacent steps: the home
 *      snapshot changes a byte count, so the manifest runs after it.
 *
 * USAGE
 *   npm run rebuild:derived           run the chain
 *   npm run rebuild:derived -- --dry  print it without running anything
 *
 * AFTERWARDS: commit, and only THEN run the freshness checkers. They restore
 * their targets with `git checkout --`, so running one on an uncommitted
 * rebuild throws it away. scripts/lib/freshness_guard.py now refuses rather
 * than letting that happen (#1695), but the ordering is still yours to keep.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The chain. This array is the single source of the ordering —
 * test/rebuild-derived-chain.test.js asserts against it, so adding a step here
 * is how a new derived artifact becomes known to the repo.
 */
export const CHAIN = [
  {
    id: 'ranking-index',
    argv: ['python3', 'scripts/hna/build_ranking_index.py'],
    why: 'the index itself, from the committed HNA inputs',
  },
  {
    id: 'augment-recency',
    argv: ['node', 'scripts/augment_ranking_index_recency.mjs'],
    why: 'F179/F240 — writes recency + regional recency back INTO the index; '
       + 'skipping it deletes 32 metrics per jurisdiction (#1698)',
  },
  {
    id: 'augment-lihtc-geometry',
    argv: ['node', 'scripts/augment_lihtc_by_geometry.mjs'],
    why: 'F191 — point-in-polygon LIHTC counts, also written back into the index',
  },
  {
    id: 'ranking-scenarios',
    argv: ['python3', 'scripts/hna/build_ranking_scenarios.py'],
    why: 'pins the index generatedAt; stale scenarios fail ci-checks on a timestamp',
  },
  {
    id: 'jurisdiction-digests',
    argv: ['node', 'scripts/hna/build_jurisdiction_metrics_digest.mjs'],
    why: '546 digests + ownership-need.json, all derived from the index',
  },
  {
    id: 'brief-digest-sections',
    argv: ['node', 'scripts/generate-brief-metric-digest-sections.mjs'],
    why: 'brief d6 sections are generated from the digests, not from the index',
  },
  {
    id: 'home-snapshot',
    argv: ['node', 'scripts/build-home-snapshot.mjs'],
    why: 'pins the index generatedAt; a two-line diff here cost a CI round on #1692',
  },
  {
    id: 'place-pages',
    argv: ['python3', 'scripts/hna/build_place_pages.py'],
    why: '482 places/<geoid>.html, rebuilt from place-chas. Gated by '
       + 'test:place-pages-fresh, but it was NOT in this chain until '
       + '2026-09-19, so build-hna-data.yml changed HNA data and left eight '
       + 'pages stale on main with nothing to tell it otherwise',
  },
  {
    id: 'paper-figures',
    argv: ['npm', 'run', 'paper:build'],
    why: 'the working paper and methods page quote counts measured off the repo',
  },
  {
    id: 'inventory',
    argv: ['node', 'scripts/compute-inventory.mjs', '--write'],
    why: 'the CI-enforced inventory line in AGENTS.md and README.md. It counts TRACKED files, so `git add` any new script or test BEFORE this step or the line is written one short and ci-checks fails on it',
  },
  {
    id: 'data-manifest',
    argv: ['node', 'scripts/audit/build-data-manifest.mjs'],
    why: 'data/_manifest.json — the data inventory',
  },
  {
    id: 'byte-manifest',
    argv: ['python3', 'scripts/rebuild_manifest.py'],
    last: true,
    why: 'records byte counts, so it MUST be last — anything writing a data '
       + 'file after this leaves the manifest stale',
  },
];

/**
 * Consumers of the ranking index that are deliberately NOT in the chain.
 *
 * Curated once, then guarded: the test requires every file touching
 * ranking-index.json to be either a step above or an entry here, so a new
 * consumer forces a decision instead of being discovered by a CI failure
 * months later.
 */
export const NOT_DERIVED = {
  // Validators — they read the index and assert, they generate nothing.
  'scripts/check-ranking-index-fresh.py': 'freshness checker; runs AFTER a commit, not as part of the build',
  'scripts/audit/data-freshness-check.mjs': 'validator — reports how old each data file is; writes nothing',
  'scripts/audit/data-sentinels-check.mjs': 'validator — flags sentinel values published as real figures; writes nothing',
  'scripts/validate-critical-data.js': 'validator — asserts required data files parse and carry required keys',
  'scripts/validate_hna_coverage.py': 'validator — asserts every geography in the registry has HNA coverage',
  'scripts/validate_hna_pages.js': 'validator — asserts the HNA pages reference geographies that exist',

  // Upstream of the index, not downstream. Both edit the LIHTC source layer
  // that the augmenters then read; running them here would invert the order.
  'scripts/enrich_lihtc_award_year.mjs': 'UPSTREAM — enriches the LIHTC source layer, then the augmenters read it',
  'scripts/tag_chfa_preservation_lihtc.mjs': 'UPSTREAM — tags CHFA preservation records as LIHTC',

  // Network. A rebuild must work offline and be reproducible; these are not.
  'scripts/build_rent_burden_crosscheck.mjs': 'fetches ACS B25070 from the Census API',
  'scripts/fetch-pab-allocations.mjs': 'fetches PAB allocations from the network',

  // Own pipeline, own workflow (update-co-housing-costs.yml).
  'scripts/build_article_full_indicators.py': 'part of the co-housing-costs pipeline; reads its parquet caches',

  // Deploy artifact rather than a data derivation.
  'scripts/build-public-site.mjs': 'builds dist/ for deploy; not a data artifact',

  // Reads the index only for the geography list, with a geo-config fallback.
  'scripts/policy/build_housing_scorecard.py': 'uses the index as a geography list only, and falls back to geo-config',

  // This file.
  'scripts/rebuild-derived.mjs': 'the chain itself',
};

const DRY = process.argv.includes('--dry');

/**
 * Run only when invoked directly.
 *
 * test/rebuild-derived-chain.test.mjs imports CHAIN and NOT_DERIVED to assert
 * against them. Without this guard that import ran the entire 80-second
 * rebuild as a side effect of reading a constant — a test that silently
 * regenerates 579 files is worse than no test.
 */
const INVOKED_DIRECTLY = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

function git(...args) {
  return (spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' }).stdout || '').trim();
}

function dirtySet() {
  const out = git('status', '--porcelain');
  if (!out) return new Set();
  const paths = [];
  for (const line of out.split('\n')) {
    const m = /^(..) (.*)$/.exec(line);
    if (!m) continue;
    // Renames read "XY old -> new"; the new path is the one that exists.
    let p = m[2].includes(' -> ') ? m[2].split(' -> ')[1] : m[2];
    // Paths with unusual characters come back quoted.
    if (p.startsWith('"') && p.endsWith('"')) { try { p = JSON.parse(p); } catch { /* keep raw */ } }
    if (p) paths.push(p);
  }
  return new Set(paths);
}

/**
 * Anything whose whole diff is a wall-clock stamp or a source-commit SHA.
 *
 * A full rebuild dirties ~579 files and essentially all of it is this: every
 * digest carries `ranking_index_generated_at`, every brief embeds that same
 * timestamp inside its metric LABELS, scenarios pin `based_on` plus the commit
 * they were built from. Reporting "579 files changed" without saying so is the
 * difference between a maintainer thinking "expected" and "what did I just do".
 */
const VOLATILE_LINE = [
  '[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}',
  '"source_commit"',
  '"generated_from_commit"',
  '"extracted_at_commit"',
];

/** Files whose diff survives ignoring every volatile line — i.e. real change. */
function substantiveChanges() {
  const args = ['diff', '--name-only'];
  for (const re of VOLATILE_LINE) args.push('-I', re);
  const out = git(...args);
  return out ? out.split('\n').filter(Boolean) : [];
}

function summarise(paths) {
  const byDir = new Map();
  for (const p of paths) {
    const dir = p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '.';
    byDir.set(dir, (byDir.get(dir) || 0) + 1);
  }
  return [...byDir.entries()].sort((a, b) => b[1] - a[1]);
}

if (!INVOKED_DIRECTLY) {
  // Imported for its declarations; do nothing else.
} else if (DRY) {
  console.log('rebuild:derived — the chain, in order:\n');
  CHAIN.forEach((s, i) => {
    console.log(`  ${String(i + 1).padStart(2)}. ${s.id}`);
    console.log(`      ${s.argv.join(' ')}`);
    console.log(`      ${s.why}\n`);
  });
  console.log('Deliberately NOT in the chain:\n');
  for (const [file, reason] of Object.entries(NOT_DERIVED)) {
    console.log(`  ${file}\n      ${reason}`);
  }
  process.exit(0);
}

if (INVOKED_DIRECTLY) main();

function main() {
const before = dirtySet();
if (before.size > 0) {
  console.log(`note: ${before.size} path(s) already dirty before the rebuild; `
    + 'they are excluded from the per-step reports below.\n');
}

let seen = new Set(before);
const started = Date.now();

for (const [i, step] of CHAIN.entries()) {
  const label = `[${i + 1}/${CHAIN.length}] ${step.id}`;
  process.stdout.write(`${label} … `);
  const t0 = Date.now();
  const res = spawnSync(step.argv[0], step.argv.slice(1), {
    cwd: ROOT, encoding: 'utf8', env: process.env,
  });
  const secs = ((Date.now() - t0) / 1000).toFixed(1);

  if (res.status !== 0) {
    console.log('FAILED');
    console.error(`\n${step.argv.join(' ')} exited ${res.status}`);
    console.error(`  purpose: ${step.why}\n`);
    const tail = (res.stderr || res.stdout || '').slice(-3000);
    if (tail) console.error(tail);
    console.error('\nThe chain stops here. Later steps are NOT run, because a '
      + 'partial rebuild leaves a tree that looks finished and is not.');
    process.exit(1);
  }

  const now = dirtySet();
  const fresh = [...now].filter((p) => !seen.has(p));
  seen = now;
  console.log(`${secs}s  ${fresh.length ? `${fresh.length} file(s) changed` : 'no change'}`);
  if (fresh.length > 0 && fresh.length <= 6) {
    for (const p of fresh) console.log(`        ${p}`);
  } else if (fresh.length > 6) {
    for (const [dir, n] of summarise(fresh).slice(0, 4)) console.log(`        ${dir}/ (${n})`);
  }
}

const changed = [...dirtySet()].filter((p) => !before.has(p));
const substantive = substantiveChanges().filter((p) => !before.has(p));
console.log(`\ndone in ${((Date.now() - started) / 1000).toFixed(1)}s — ${changed.length} file(s) touched`);
for (const [dir, n] of summarise(changed)) console.log(`  ${String(n).padStart(4)}  ${dir}/`);

console.log('');
if (substantive.length === 0) {
  console.log('No substantive change: every touched file differs only by a');
  console.log('timestamp or the commit it was built from. The committed data');
  console.log('already matched its inputs.');
} else {
  console.log(`${substantive.length} file(s) changed BEYOND timestamps — this is the real diff:`);
  for (const p of substantive.slice(0, 25)) console.log(`  ${p}`);
  if (substantive.length > 25) console.log(`  … and ${substantive.length - 25} more`);
}
console.log('\nNext: commit these, and only THEN run the freshness checkers —');
console.log('they restore their targets and would discard an uncommitted rebuild.');
}
