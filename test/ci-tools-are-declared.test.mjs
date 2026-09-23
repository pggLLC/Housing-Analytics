#!/usr/bin/env node
/**
 * Every tool CI runs through `npx` must be a declared dependency.
 *
 * `npx <tool>` does not fail when <tool> is absent — it downloads it from the
 * registry, then runs it. That turns a missing dependency into a silent
 * network call inside a gate, and the gate's result then depends on whether a
 * download won a race.
 *
 * It already cost a red main. `http-server` was never a dependency; in the
 * combined contrast job an earlier step had warmed it, so the scanner's spawn
 * was instant. The moment #1829 gave the scanner its own job, the download
 * outran a fixed 1.5-second sleep and every scan hit ERR_CONNECTION_REFUSED
 * (#1832). The declaration and the wait both landed, and this stops the class
 * coming back somewhere else.
 *
 * ── Usage, not mention ──
 *
 * This scans only places a command actually runs: `run:` lines in workflows,
 * `scripts` values in package.json, and spawn()/exec() argument lists in JS.
 * Comments are stripped first. The first version of this check, written by
 * hand at a shell prompt, reported `fetching` as an undeclared tool: it came
 * from the prose "npx fetching it from the registry" in a comment. A guard
 * that reads prose as code invents work and then gets switched off.
 *
 * The same hand-written pass made the opposite error, and this guard caught
 * it: `serve` was waved away as a substring of "http-server" when it was a
 * real `npx serve` in package.json. Eyeballing greps misses in both
 * directions; scanning the executable text does not.
 */

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Tools that may stay undeclared, each with the reason it cannot be a
 * dependency. An empty list is the healthy state; an entry is a debt.
 */
const ALLOWED_UNDECLARED = {
  // e.g. 'some-tool': 'reason it cannot be installed locally',
};

/** What this gate covers, stated outright rather than implied. */
const SCOPE = {
  workflows: '.github/workflows/*.yml — `run:` script bodies',
  packageJson: 'package.json — the "scripts" map',
  sources: 'scripts/**/*.{mjs,js} — spawn/exec argument lists',
};

let failures = 0;
const test = (name, fn) => {
  try { fn(); console.log(`  ✓ ${name}`); }
  catch (e) { failures += 1; console.log(`  ✗ ${name} — ${e.message}`); }
};

/** Strip // and /* *​/ comments so prose can never read as a command. */
function stripJsComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
}

/** Strip whole-line YAML comments. */
function stripYamlComments(src) {
  return src.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
}

const NPX = /\bnpx\s+(?:(?:-y|--yes|-q|--quiet|--no-install|-p\s+\S+|--package(?:=|\s+)\S+)\s+)*(@[\w.-]+\/[\w.-]+|[\w.-]+)/g;

function toolsIn(text) {
  const found = new Set();
  for (const m of text.matchAll(NPX)) found.add(m[1]);
  return found;
}

function walk(dir, test, out = []) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p, test, out); }
    else if (test(e.name)) out.push(p);
  }
  return out;
}

/** Every (tool, where) pair that some command actually runs. */
function collectUsages() {
  const usages = [];
  const add = (tool, where) => usages.push({ tool, where });

  // 1. Workflows: only the body of `run:` steps.
  for (const file of walk(path.join(ROOT, '.github/workflows'), (n) => /\.ya?ml$/.test(n))) {
    const rel = path.relative(ROOT, file);
    const lines = stripYamlComments(fs.readFileSync(file, 'utf8')).split('\n');
    let inRun = false;
    let runIndent = 0;
    for (const line of lines) {
      const runStart = /^(\s*)-?\s*run:\s*(.*)$/.exec(line);
      if (runStart) {
        inRun = true;
        runIndent = runStart[1].length;
        for (const t of toolsIn(runStart[2])) add(t, rel);
        continue;
      }
      if (inRun) {
        const indent = line.search(/\S/);
        if (indent !== -1 && indent <= runIndent) { inRun = false; continue; }
        for (const t of toolsIn(line)) add(t, rel);
      }
    }
  }

  // 2. package.json scripts.
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  for (const [name, body] of Object.entries(pkg.scripts || {})) {
    for (const t of toolsIn(String(body))) add(t, `package.json scripts.${name}`);
  }

  // 3. JS sources: spawn/exec argument lists, comments stripped.
  for (const file of walk(path.join(ROOT, 'scripts'), (n) => /\.m?js$/.test(n))) {
    const rel = path.relative(ROOT, file);
    const src = stripJsComments(fs.readFileSync(file, 'utf8'));
    // spawn('npx', ['http-server', ...]) and friends
    for (const m of src.matchAll(/['"`]npx['"`]\s*,\s*\[\s*['"`](@?[\w.\/-]+)['"`]/g)) add(m[1], rel);
    // inline command strings: exec('npx foo ...')
    for (const t of toolsIn(src)) add(t, rel);
  }

  return usages;
}

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const declared = new Set([
  ...Object.keys(pkg.dependencies || {}),
  ...Object.keys(pkg.devDependencies || {}),
]);
const usages = collectUsages();

console.log('ci-tools-are-declared');
console.log(`  scope: ${Object.values(SCOPE).join(' | ')}`);

test('the scan finds npx usages at all', () => {
  // Without this the whole file passes by finding nothing, which is how a
  // check ends up green about an empty set.
  assert.ok(usages.length >= 5,
    `only ${usages.length} npx usages found; the scan is not reading the files it claims to`);
  const tools = new Set(usages.map((u) => u.tool));
  assert.ok(tools.size >= 3, `only ${tools.size} distinct tools found: ${[...tools].join(', ')}`);
});

test('prose and substrings are never read as commands', () => {
  // 'fetching' came from the prose "npx fetching it from the registry" in a
  // comment; the hand-written version reported it as a tool. ('serve' looked
  // like a substring of "http-server" and was dismissed as one — this guard
  // proved it was a real `npx serve` in package.json. The dismissal was the
  // error, which is the case for scanning code instead of eyeballing greps.)
  const tools = new Set(usages.map((u) => u.tool));
  for (const ghost of ['fetching', 'it', 'run']) {
    assert.ok(!tools.has(ghost),
      `'${ghost}' was read as a tool — that is prose or a substring, not a command. `
      + 'Comment stripping or the word boundary has regressed');
  }
});

/**
 * The npx usages that are not installed by `npm ci`, as "tool (where, where)".
 *
 * Separated from the assertion so it can be exercised directly: every tool is
 * declared today, so the assertion below returns an empty list whether or not
 * this function works.
 */
function undeclaredIn(list, declaredSet, allowed = ALLOWED_UNDECLARED) {
  const missing = new Map();
  for (const { tool, where } of list) {
    if (declaredSet.has(tool) || tool in allowed) continue;
    if (!missing.has(tool)) missing.set(tool, new Set());
    missing.get(tool).add(where);
  }
  return [...missing.entries()].map(([tool, where]) => `${tool} (${[...where].join(', ')})`);
}

test('every tool CI runs through npx is a declared dependency', () => {
  const report = undeclaredIn(usages, declared);
  assert.deepStrictEqual(report, [],
    'these are fetched from the registry at run time instead of installed by `npm ci`, '
    + 'so the gate that runs them depends on a download winning a race. Add each to '
    + `devDependencies: ${report.join('; ')}`);
});

test('and that check would actually notice', () => {
  // The assertion above passes on an empty list, and the list is empty in
  // every healthy run — so on its own it says nothing about whether the
  // comparison still works. Probe it directly.
  const probe = [
    { tool: 'ghost-tool', where: 'workflows/x.yml' },
    { tool: 'ghost-tool', where: 'package.json scripts.y' },
    { tool: 'real-tool', where: 'workflows/x.yml' },
  ];
  const have = new Set(['real-tool']);

  const found = undeclaredIn(probe, have, {});
  assert.deepStrictEqual(found, ['ghost-tool (workflows/x.yml, package.json scripts.y)'],
    'an undeclared tool is no longer reported, or its call sites are no longer collected — '
    + 'the check above would pass vacuously');
  assert.deepStrictEqual(undeclaredIn([{ tool: 'real-tool', where: 'a' }], have, {}), [],
    'a DECLARED tool is reported as missing');
  assert.deepStrictEqual(
    undeclaredIn(probe, have, { 'ghost-tool': 'allowlisted for this probe only' }), [],
    'the allowlist no longer exempts anything');
  assert.deepStrictEqual(undeclaredIn([], have, {}), [],
    'an empty usage list reports something');
});

test('the allowlist stays empty, or every entry says why', () => {
  for (const [tool, reason] of Object.entries(ALLOWED_UNDECLARED)) {
    assert.ok(typeof reason === 'string' && reason.length > 20,
      `${tool} is allowed to stay undeclared with no stated reason — that is an exemption`);
    assert.ok(!declared.has(tool),
      `${tool} is on the allowlist but IS declared; delete the entry so the list keeps meaning something`);
  }
});

console.log(failures === 0
  ? '  ci-tools-are-declared: PASS'
  : `  ci-tools-are-declared: FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
