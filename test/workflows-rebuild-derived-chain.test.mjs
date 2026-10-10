#!/usr/bin/env node
/**
 * A workflow that commits an input of the derived chain must rebuild the chain
 * before it commits (#2063).
 *
 * On 2026-10-01 backfill-hna-extended-acs-cache.yml committed 30 changed
 * data/hna/summary files and nothing derived from them. Data commits skip CI,
 * so main sat with 30 stale jurisdiction digests and no failing run, and every
 * open PR then failed on files it never touched (#2062 repaired it by hand).
 *
 * "Input" is read from every CHAIN step's scripts, including npm script
 * expansion, minus what the chain itself writes. A new step or input is
 * covered without keeping a second builder list here.
 *
 * "Rebuilds the chain" means `npm run rebuild:derived`, or every CHAIN step
 * from scripts/rebuild-derived.mjs, in order (build-hna-data.yml runs them as
 * its own phases). Either must come before the workflow's first `git commit`.
 * A shell script the workflow runs from scripts/ counts as part of it.
 *
 * Limitation, stated rather than hidden: a workflow that commits with a bare
 * `git add data/` (or `.`) names no path, so this cannot tell what it commits.
 * Those are treated as not writing chain inputs.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHAIN } from '../scripts/rebuild-derived.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

// ── 1. the chain's inputs, from the builders ───────────────────────────────
function dataPaths(src) {
  const out = [];
  // Both JS path.join and Python os.path.join use ROOT or REPO_ROOT,
  // and builders use both quote styles. Collect only the literal prefix.
  for (const m of src.matchAll(/(?:os\.)?path\.join\((?:REPO_ROOT|ROOT),\s*((?:(?:'[^']*'|"[^"]*")\s*,?\s*)+)/g)) {
    out.push([...m[1].matchAll(/['"]([^'"]*)['"]/g)].map(x => x[1]).join('/'));
  }
  for (const m of src.matchAll(/['"](data\/[A-Za-z0-9_./-]+)['"]/g)) out.push(m[1]);
  return out;
}
const npmScripts = JSON.parse(read('package.json')).scripts;
function scriptsFor(argv, seen = new Set()) {
  if (argv[0] !== 'npm') return argv.filter(p => /^scripts\/.*\.(?:mjs|js|py)$/.test(p));
  assert.equal(argv[1], 'run', `unhandled CHAIN command: ${argv.join(' ')}`);
  const name = argv[2];
  assert(!seen.has(name), `recursive npm script ${name}`);
  seen.add(name);
  const command = npmScripts[name];
  assert(command, `missing npm script ${name}`);
  const scripts = [...command.matchAll(/\bscripts\/[A-Za-z0-9_./-]+\.(?:mjs|js|py)\b/g)].map(m => m[0]);
  for (const m of command.matchAll(/\bnpm run ([\w:-]+)/g)) scripts.push(...scriptsFor(['npm', 'run', m[1]], new Set(seen)));
  return [...new Set(scripts)];
}
// The shared commit path list is the chain's output contract. INPUTS is a
// variable in that list; only its literal data outputs are subtracted here.
const outputBlock = read('scripts/commit-with-derived-chain.sh').match(/^PATHS=\(([\s\S]*?)^\)/m);
assert(outputBlock, 'the chain output contract must exist');
const OUTPUTS = [...outputBlock[1].matchAll(/^\s+(data\/[A-Za-z0-9_./-]+)\s*$/gm)].map(m => m[1]);
assert(OUTPUTS.includes('data/hna/ranking-index.json'));
const inputPaths = scripts => [...new Set(scripts.flatMap(file => dataPaths(read(file))))]
  .filter(p => p.startsWith('data/') && !OUTPUTS.some(o => p === o || p.startsWith(o + '/')));
const scannedSteps = CHAIN.map(step => {
  const scripts = scriptsFor(step.argv);
  assert(scripts.length, `no source script found for CHAIN step ${step.id}`);
  return { id: step.id, scripts };
});
const inputs = inputPaths(scannedSteps.flatMap(step => step.scripts));
const oldBuilderInputs = inputPaths(['scripts/hna/build_ranking_index.py', 'scripts/hna/build_jurisdiction_metrics_digest.mjs']);
assert(inputs.includes('data/hna/summary'), 'the input scan must find the ACS summaries');
assert(inputs.includes('data/affordable-housing/lihtc/chfa-properties.json'), 'the geometry augmenter input must be covered');
assert(inputs.length > oldBuilderInputs.length, 'scanning every step must find more inputs than the two-builder scan');
assert(inputs.length >= 15, `the input scan found only ${inputs.length} paths; the extraction broke`);
console.log(`Input scan: ${inputs.length} paths (two-builder scan: ${oldBuilderInputs.length}); all ${scannedSteps.length} CHAIN steps`);
for (const step of scannedSteps) console.log(`  ${step.id}: ${step.scripts.join(', ')}`);

// ── 2. what each workflow commits ──────────────────────────────────────────
const BROAD = new Set(['data', 'data/', '.', '-A', '--all', '--', '-u']);
// Full-line comments are prose, not steps. Without this a header comment that
// SAYS "npm run rebuild:derived" satisfied the check after the command itself
// was deleted (caught by this file's own sabotage run).
const code = (text) => text.split('\n').filter((line) => !/^\s*#/.test(line)).join('\n')
  .replace(/\\\r?\n[ \t]*/g, ' '); // shell continuations are one command, including multi-line git add
function withScripts(text, depth = 0) {
  // Inline any repo shell script the workflow runs, so a commit made there
  // counts; recursively, because commit-summary-backfill.sh hands off to
  // commit-with-derived-chain.sh via "$here/..." (#2092). The script goes
  // AFTER the calling line, so that line's own arguments stay on it.
  if (depth > 3) return text;
  return text.split('\n').map((line) => {
    const inlined = [...line.matchAll(/(?:^|\s|")(?:bash\s+)?(?:scripts\/|\$here\/)([A-Za-z0-9_.-]+\.sh)\b/g)]
      .map((m) => `scripts/${m[1]}`)
      .filter((p) => fs.existsSync(path.join(ROOT, p)))
      .map((p) => withScripts(code(read(p)), depth + 1));
    return [line, ...inlined].join('\n');
  }).join('\n');
}
function committedPaths(text) {
  const tokens = [];
  for (const line of text.split('\n')) {
    const m = line.match(/\bgit add\b(.*)$/);
    if (!m) continue;
    for (let tok of m[1].trim().split(/\s+/)) {
      tok = tok.replace(/^['"]|['"]$/g, '').replace(/\/\*.*$/, '').replace(/\/$/, '');
      if (tok.startsWith('$')) continue;
      if (!tok || BROAD.has(tok) || tok.startsWith('#')) continue;
      tokens.push(tok);
    }
  }
  // Input paths handed to the shared commit script after `--` (#2092).
  for (const m of text.matchAll(/commit-with-derived-chain\.sh\b[^\n]*?\s--\s+([^\n]+)/g)) {
    for (const tok of m[1].trim().split(/\s+/)) if (tok && !tok.startsWith('$') && !tok.startsWith('#')) tokens.push(tok.replace(/\/$/, ''));
  }
  // Path lists held in a variable or array: paths="a b" / PATHS=( a b ).
  for (const m of text.matchAll(/^\s*(?:paths|PATHS)=(?:"([^"]*)"|\(([\s\S]*?)\))/gm)) {
    for (const tok of (m[1] || m[2]).split(/\s+/)) if (tok && !tok.startsWith('#')) tokens.push(tok.replace(/\/$/, ''));
  }
  return [...new Set(tokens)];
}
const touches = (committed, input) =>
  input === committed || input.startsWith(committed + '/') || committed.startsWith(input + '/');

// ── 3. the chain must run before the first commit ──────────────────────────
const stepCommand = (step) => step.argv.join(' ');
const escape = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// The command as a statement: at the start of a line, or as a step's `run:`.
// A mention inside a string (a commit message, an echo) is not running it;
// that is the second way this guard passed its own sabotage run.
function statementAt(text, command, from = 0) {
  const re = new RegExp(`^[ \\t]*(?:run:[ \\t]*)?${escape(command)}(?![\\w:-])`, 'gm');
  re.lastIndex = from;
  const m = re.exec(text);
  return m ? m.index : -1;
}
function rebuildsBeforeCommit(text) {
  const commit = text.search(/^[ \t]*(?:run:[ \t]*)?git commit\b/m);
  const before = commit === -1 ? text : text.slice(0, commit);
  if (statementAt(before, 'npm run rebuild:derived') !== -1) return 'rebuild:derived';
  let at = 0;
  for (const step of CHAIN) {
    const i = statementAt(before, stepCommand(step), at);
    if (i === -1) return null;
    at = i + 1;
  }
  return 'every CHAIN step in order';
}

// Workflows that commit a chain input without rebuilding. Empty since #2092
// fixed the three this guard found when it was written. The list must stay
// exact: a new gap fails, and so does an entry whose workflow now rebuilds.
const KNOWN_GAPS = {};

const dir = path.join(ROOT, '.github/workflows');
const checked = [];
const failures = [];
for (const file of fs.readdirSync(dir).filter((f) => /\.ya?ml$/.test(f)).sort()) {
  const text = withScripts(code(fs.readFileSync(path.join(dir, file), 'utf8')));
  const writes = committedPaths(text).flatMap((c) => inputs.filter((i) => touches(c, i)));
  if (!writes.length) continue;
  const how = rebuildsBeforeCommit(text);
  checked.push(`${file} (${[...new Set(writes)].join(', ')}) → ${how || 'NO REBUILD'}`);
  if (!how && !KNOWN_GAPS[file]) failures.push(`${file} commits ${[...new Set(writes)].join(', ')} without rebuilding the derived chain first`);
  if (how && KNOWN_GAPS[file]) failures.push(`${file} now rebuilds the chain; remove it from KNOWN_GAPS`);
}

// Non-vacuity on the scan: it must find the workflows this guard exists for.
for (const known of ['backfill-hna-extended-acs-cache.yml', 'backfill-hna-household-occupation.yml',
  'backfill-hna-value-brackets.yml', 'build-hna-data.yml', 'fetch-chfa-lihtc.yml', 'update-co-housing-costs.yml']) {
  assert(checked.some((c) => c.startsWith(known + ' ')), `the scan did not recognise ${known} as writing a chain input`);
}
for (const file of Object.keys(KNOWN_GAPS)) {
  assert(checked.some((c) => c.startsWith(file + ' ')), `${file} is a KNOWN_GAP but no longer commits a chain input; remove it`);
}
assert.deepEqual(failures, [], failures.join('\n'));
console.log(`workflows-rebuild-derived-chain: PASS (${inputs.length} chain inputs; ${checked.length} workflows commit one)`);
for (const c of checked) console.log('  ' + c);
