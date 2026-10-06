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
 * "Input" is read from the builders themselves, not from a list kept here: the
 * data paths scripts/hna/build_ranking_index.py and
 * scripts/hna/build_jurisdiction_metrics_digest.mjs open, minus what the chain
 * itself writes. A new input added to either builder is covered without
 * editing this file.
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
function pyPaths(src) {
  const out = [];
  for (const m of src.matchAll(/os\.path\.join\(ROOT,\s*((?:"[^"]*"\s*,?\s*)+)/g)) {
    out.push([...m[1].matchAll(/"([^"]*)"/g)].map((x) => x[1]).join('/'));
  }
  for (const m of src.matchAll(/"(data\/[A-Za-z0-9_./-]+)"/g)) out.push(m[1]);
  return out;
}
function jsPaths(src) {
  const out = [];
  for (const m of src.matchAll(/path\.join\(ROOT,\s*((?:'[^']*'\s*,?\s*)+)/g)) {
    out.push([...m[1].matchAll(/'([^']*)'/g)].map((x) => x[1]).join('/'));
  }
  for (const m of src.matchAll(/'(data\/[A-Za-z0-9_./-]+)'/g)) out.push(m[1]);
  return out;
}
// What the chain writes is its output, not its input.
const OUTPUTS = [
  'data/hna/ranking-index.json', 'data/hna/ranking-scenarios', 'data/hna/jurisdiction-metrics-digest',
  'data/hna/ownership-need.json', 'data/jurisdiction-briefs', 'data/home-snapshot.json',
];
const inputs = [...new Set([
  ...pyPaths(read('scripts/hna/build_ranking_index.py')),
  ...jsPaths(read('scripts/hna/build_jurisdiction_metrics_digest.mjs')),
])].filter((p) => p.startsWith('data/') && !OUTPUTS.some((o) => p === o || p.startsWith(o + '/')));
assert(inputs.includes('data/hna/summary'), 'the input scan must find the ACS summaries');
assert(inputs.length >= 15, `the input scan found only ${inputs.length} paths; the extraction broke`);

// ── 2. what each workflow commits ──────────────────────────────────────────
const BROAD = new Set(['data', 'data/', '.', '-A', '--all', '--', '-u']);
// Full-line comments are prose, not steps. Without this a header comment that
// SAYS "npm run rebuild:derived" satisfied the check after the command itself
// was deleted (caught by this file's own sabotage run).
const code = (text) => text.split('\n').filter((line) => !/^\s*#/.test(line)).join('\n');
function withScripts(text) {
  // Inline any repo shell script the workflow runs, so a commit made there counts.
  return text.replace(/(?:^|\s)(?:bash\s+)?(scripts\/[A-Za-z0-9_./-]+\.sh)\b/g, (m, p) =>
    fs.existsSync(path.join(ROOT, p)) ? `${m}\n${code(read(p))}\n` : m);
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

// Workflows that commit a chain input without rebuilding, found by this guard
// when it was written and tracked for repair rather than fixed in #2063's PR.
// The list must be exact: a new gap fails, and so does fixing one of these
// without removing it here (so the list cannot outlive the gap).
const KNOWN_GAPS = {
  'cache-hud-gis-data.yml': 'QCT/DDA overlays, monthly (#2092)',
  'fetch-chas-data.yml': 'CHAS county gap; manual dispatch only since #2091 (#2092)',
  'market_data_build.yml': 'tract metrics, Opportunity Insights, walkability; weekly (#2092)',
};

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
  'backfill-hna-value-brackets.yml', 'build-hna-data.yml']) {
  assert(checked.some((c) => c.startsWith(known + ' ')), `the scan did not recognise ${known} as writing a chain input`);
}
for (const file of Object.keys(KNOWN_GAPS)) {
  assert(checked.some((c) => c.startsWith(file + ' ')), `${file} is a KNOWN_GAP but no longer commits a chain input; remove it`);
}
assert.deepEqual(failures, [], failures.join('\n'));
console.log(`workflows-rebuild-derived-chain: PASS (${inputs.length} chain inputs; ${checked.length} workflows commit one)`);
for (const c of checked) console.log('  ' + c);
