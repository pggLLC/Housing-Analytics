#!/usr/bin/env node
/**
 * The working paper may not disagree with the repository it describes.
 *
 * working-paper.html claims, in §10, that every figure in it is generated
 * rather than typed. This file is what makes that claim true instead of
 * aspirational. It fails when:
 *
 *   - a figure in the page was hand-edited away from the data
 *   - data/paper/figures.json is stale against the data files it reads
 *   - the page carries a data-figure path the generator does not produce
 *   - a placeholder was never filled
 *   - a null figure was rendered as a number
 *
 * Figures about the repository's own git history change on every commit and are
 * listed in `volatile` by the generator; they are refreshed weekly and skipped
 * here. Every figure about Colorado is checked strictly.
 */

import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PAGE = path.join(ROOT, 'working-paper.html');
const FIGURES = path.join(ROOT, 'data', 'paper', 'figures.json');

let failures = 0;
const pass = (m) => console.log(`  ✓ ${m}`);
const fail = (m) => { failures += 1; console.log(`  ✗ ${m}`); };

function test(name, fn) {
  try {
    const why = fn();
    if (why) fail(`${name} — ${why}`);
    else pass(name);
  } catch (e) {
    fail(`${name} — threw: ${e.message}`);
  }
}

/* ── fixtures ────────────────────────────────────────────────────────────── */

if (!existsSync(PAGE)) {
  console.log('  ✗ working-paper.html is missing');
  process.exit(1);
}
if (!existsSync(FIGURES)) {
  console.log('  ✗ data/paper/figures.json is missing — run npm run paper:build');
  process.exit(1);
}

const html = readFileSync(PAGE, 'utf8');
const committed = JSON.parse(readFileSync(FIGURES, 'utf8'));

/** Regenerate into memory. --stdout writes nothing, so the check has no side effect. */
const regenerated = JSON.parse(execFileSync(
  process.execPath,
  [path.join(ROOT, 'scripts', 'paper', 'build-paper-figures.mjs'), '--stdout'],
  { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
));

const VOLATILE = new Set(regenerated.volatile || []);
const at = (obj, p) => p.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);

/** Every leaf path in an object, dotted. */
function leaves(obj, prefix = '') {
  if (obj === null || typeof obj !== 'object') return [prefix];
  if (Array.isArray(obj)) return obj.flatMap((v, i) => leaves(v, prefix ? `${prefix}.${i}` : String(i)));
  return Object.entries(obj).flatMap(([k, v]) => leaves(v, prefix ? `${prefix}.${k}` : k));
}

/* ── the drift gate ──────────────────────────────────────────────────────── */

test('committed figures match what the data produces right now', () => {
  const skip = (p) => [...VOLATILE].some((v) => p === v || p.startsWith(`${v}.`));
  const drifted = [];
  for (const p of leaves(regenerated)) {
    if (skip(p) || p.startsWith('volatile') || p.startsWith('unavailable')) continue;
    const now = at(regenerated, p);
    const was = at(committed, p);
    if (JSON.stringify(now) !== JSON.stringify(was)) {
      drifted.push(`${p}: committed ${JSON.stringify(was)} vs data ${JSON.stringify(now)}`);
    }
  }
  if (drifted.length) {
    return `${drifted.length} figure(s) drifted. Run: npm run paper:build\n      `
      + drifted.slice(0, 6).join('\n      ');
  }
  return null;
});

test('the published page matches the committed figures', () => {
  const r = execFileSync(
    process.execPath,
    [path.join(ROOT, 'scripts', 'paper', 'inject-paper-figures.mjs'), '--check'],
    { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  ).toString();
  return r.includes('is current') ? null : 'injector did not report the page as current';
});

/* ── the page's own integrity ────────────────────────────────────────────── */

test('every data-figure path in the page exists in figures.json', () => {
  const paths = [...html.matchAll(/data-figure(?:-add)?="([^"]+)"/g)].map((m) => m[1]);
  if (!paths.length) return 'the page carries no data-figure markers at all';
  const orphans = paths.filter((p) => at(regenerated, p) === undefined);
  return orphans.length ? `unknown figure path(s): ${[...new Set(orphans)].join(', ')}` : null;
});

test('no placeholder survived injection', () => {
  // An em-dash inside a data-figure element means the injector never ran, or
  // ran and could not resolve it. Either way the page is showing furniture
  // where a measurement belongs.
  const stuck = [...html.matchAll(/<(\w+)[^>]*\bdata-figure="([^"]+)"[^>]*>(\s*&mdash;\s*)<\/\1>/g)]
    .map((m) => m[2]);
  return stuck.length ? `unfilled placeholder(s): ${[...new Set(stuck)].join(', ')}` : null;
});

/**
 * Read the inner HTML of a block by depth-counting its tag, the same way the
 * injector does. A non-greedy regex stops at the first closing tag, which for a
 * <div> block full of <div> rows is the wrong one.
 */
function blockInner(name) {
  const open = new RegExp(`<(\\w+)[^>]*\\bdata-figure-block="${name}"[^>]*>`);
  const m = html.match(open);
  if (!m) return null;
  const tag = m[1];
  const start = m.index + m[0].length;
  const re = new RegExp(`<(/?)${tag}\\b[^>]*?(/?)>`, 'gi');
  re.lastIndex = start;
  let depth = 1;
  let t;
  while ((t = re.exec(html)) !== null) {
    if (t[2] === '/') continue;
    depth += t[1] === '/' ? -1 : 1;
    if (depth === 0) return html.slice(start, t.index);
  }
  return null;
}

// Each block must carry exactly as many rows as the data has entries.
//
// The first version of this test asserted only that the block contained some
// <div> or <tr>. It passed against a page whose commit chart held 22 rows for 8
// months, because 22 rows contain a <div> just as surely as 8 do. A guard that
// checks for the presence of markup does not check the markup.
const BLOCK_ROWS = [
  ['commit-bars', 'repo.commits_by_month', /class="wp-bar-row"/g],
  ['case-bands', 'case.bands', /<tr>/g],
  ['tractable-rows', 'tractable.top', /<tr>/g],
];

for (const [name, dataPath, rowRe] of BLOCK_ROWS) {
  test(`${name} renders one row per datum, and no more`, () => {
    const inner = blockInner(name);
    if (inner == null) return `block ${name} is absent or its tag is unbalanced`;
    const expected = at(regenerated, dataPath);
    if (!Array.isArray(expected)) return `${dataPath} is not an array in figures.json`;
    const got = (inner.match(rowRe) || []).length;
    return got === expected.length ? null
      : `${got} row(s) rendered for ${expected.length} datum/data in ${dataPath}`;
  });
}

test('generated blocks leave the document structurally balanced', () => {
  const broken = [];
  for (const [name] of BLOCK_ROWS) {
    const inner = blockInner(name);
    if (inner == null) { broken.push(`${name}: unbalanced`); continue; }
    for (const tag of ['div', 'tr', 'tbody', 'table']) {
      const opens = (inner.match(new RegExp(`<${tag}\\b`, 'g')) || []).length;
      const closes = (inner.match(new RegExp(`</${tag}>`, 'g')) || []).length;
      if (opens !== closes) broken.push(`${name}: ${opens} <${tag}> vs ${closes} </${tag}>`);
    }
  }
  return broken.length ? broken.join('; ') : null;
});

test('no generated row survives OUTSIDE its block', () => {
  // The failure this catches actually happened: a non-idempotent injector left
  // fourteen orphaned chart rows sitting between the block's closing tag and
  // the <figcaption>. Every in-block check passed, because the orphans were not
  // in the block — they were in the document, which is where the reader is.
  // Counting document-wide and comparing against the block is the only version
  // of this check that can see them.
  const offenders = [];
  for (const [name, dataPath, rowRe] of BLOCK_ROWS) {
    const inner = blockInner(name);
    if (inner == null) continue;
    const inBlock = (inner.match(rowRe) || []).length;
    // CSS rules are written `.wp-bar-row {`, never `class="wp-bar-row"`, and
    // `<tr>` appears nowhere but a table body, so a document-wide count of the
    // row marker is comparable with the in-block count.
    const inDocument = (html.match(rowRe) || []).length;
    const expected = at(regenerated, dataPath);
    if (!Array.isArray(expected)) continue;
    // <tr> is shared by every table on the page, so only the chart — whose row
    // marker is unique — can be compared document-wide.
    if (!/wp-bar-row/.test(rowRe.source)) continue;
    if (inDocument !== inBlock) {
      offenders.push(`${name}: ${inDocument} in document vs ${inBlock} in block `
        + `(${inDocument - inBlock} orphaned)`);
    }
  }
  return offenders.length ? offenders.join('; ') : null;
});

test('a figure the generator cannot read never renders as a number', () => {
  // Driven end-to-end rather than asserted against the current build: today
  // every figure resolves, so a test that only inspected the live page would
  // pass while checking nothing. This forces a null through the real injector
  // and reads what the page then says.
  const tmp = mkdtempSync(path.join(tmpdir(), 'paper-absence-'));
  try {
    const forced = JSON.parse(JSON.stringify(regenerated));
    forced.inventory.geographies = null;
    forced.unavailable = [{ key: 'inventory.geographies', reason: 'forced null for this test' }];
    const figPath = path.join(tmp, 'figures.json');
    const pagePath = path.join(tmp, 'page.html');
    writeFileSync(figPath, JSON.stringify(forced, null, 2));
    writeFileSync(pagePath, readFileSync(PAGE, 'utf8'));

    execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'paper', 'inject-paper-figures.mjs')], {
      cwd: ROOT,
      stdio: 'ignore',
      env: { ...process.env, PAPER_FIGURES: figPath, PAPER_PAGE: pagePath },
    });

    const got = readFileSync(pagePath, 'utf8');
    const cells = [...got.matchAll(/<(\w+)[^>]*\bdata-figure="inventory\.geographies"[^>]*>([\s\S]*?)<\/\1>/g)]
      .map((m) => m[2]);
    if (!cells.length) return 'inventory.geographies is not cited on the page';
    const numeric = cells.filter((c) => /^\s*[\d,]+\s*$/.test(c));
    if (numeric.length) return `a null rendered as the number "${numeric[0].trim()}"`;
    const stated = cells.filter((c) => /wp-unknown/.test(c) && /forced null for this test/.test(c));
    return stated.length === cells.length ? null
      : 'a null rendered without its stated reason';
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('the injector is idempotent — running it twice changes nothing', () => {
  // Non-idempotence is not cosmetic here: the freshness gate runs the injector
  // in --check mode, so an injector that mangles its own output reports the
  // page as stale forever and the gate has to be switched off to ship anything.
  const before = readFileSync(PAGE, 'utf8');
  try {
    execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'paper', 'inject-paper-figures.mjs')],
      { cwd: ROOT, stdio: 'ignore' });
    const once = readFileSync(PAGE, 'utf8');
    execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'paper', 'inject-paper-figures.mjs')],
      { cwd: ROOT, stdio: 'ignore' });
    const twice = readFileSync(PAGE, 'utf8');
    if (once !== twice) return 'a second injection produced different output';
    if (before !== once) return 'the committed page is not what the injector produces';
    return null;
  } finally {
    writeFileSync(PAGE, before);
  }
});


test('the volatile list is declared, short, and about the repo not about Colorado', () => {
  if (!Array.isArray(regenerated.volatile)) return 'the generator emits no volatile list';
  if (!regenerated.volatile.length) return 'the volatile list is empty — commit counts cannot be stable';
  // A housing figure excluded from the drift gate is a figure nobody is
  // checking. The gate exists to catch exactly that.
  const housing = regenerated.volatile.filter((p) => /^(case|tractable|inventory)\b/.test(p));
  if (housing.length) return `housing figures must not be exempt from the drift gate: ${housing.join(', ')}`;
  return null;
});

test('the tenure label names the tenure that actually carries the burden', () => {
  // This shipped inverted: Air Force Academy, with 266 burdened renters and 0
  // burdened owners, was published as "owner only". The renter/owner split is
  // the one column county data cannot produce and the whole reason the paper
  // argues for place-level resolution — a jurisdiction acting on a flipped
  // label builds the wrong programme. Checked against the counts, not against
  // the function that produced them.
  const rows = at(regenerated, 'tractable.top');
  if (!Array.isArray(rows) || !rows.length) return 'the tractability screen returned no rows';
  const wrong = [];
  for (const r of rows) {
    const R = r.renters_burdened;
    const O = r.owners_burdened;
    if (R == null || O == null) continue;
    const p = r.tenure_profile;
    if (O === 0 && p !== 'renter only') wrong.push(`${r.name}: ${R}R/${O}O labelled "${p}"`);
    if (R === 0 && p !== 'owner only') wrong.push(`${r.name}: ${R}R/${O}O labelled "${p}"`);
    if (R > 0 && O > 0 && /only/.test(p)) wrong.push(`${r.name}: ${R}R/${O}O labelled "${p}"`);
    if (p === 'renter-dominant' && R < O) wrong.push(`${r.name}: ${R}R/${O}O labelled renter-dominant`);
    if (p === 'owner-dominant' && O < R) wrong.push(`${r.name}: ${R}R/${O}O labelled owner-dominant`);
  }
  return wrong.length ? wrong.join('; ') : null;
});

test('the inventory the paper quotes is itself current', () => {
  // The paper reads its inventory figures from the AGENTS.md line rather than
  // recounting them, so that there is one producer of those numbers instead of
  // two. The cost of that choice is a hole: if AGENTS.md is stale, the paper and
  // the drift check both read the same stale line and agree with each other
  // while disagreeing with the repository. ci-checks fails on a stale inventory
  // line, but that runs in a different job — this makes the dependency visible
  // where the paper's own gate can see it.
  // compute-inventory.mjs exits non-zero on a stale line, which execFileSync
  // turns into a throw. Catching it keeps the failure readable: a stale
  // inventory should tell you the two commands to run, not "Command failed".
  let out;
  try {
    out = execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'compute-inventory.mjs')],
      { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    out = `${e.stdout || ''}${e.stderr || ''}`;
    if (!out.trim()) return `compute-inventory.mjs failed with no output: ${e.message}`;
  }
  if (/inventory is stale/i.test(out)) {
    return 'AGENTS.md inventory is stale — run node scripts/compute-inventory.mjs --write, '
      + 'then npm run paper:build';
  }
  // And the paper must actually be quoting that line, not a number of its own.
  const line = readFileSync(path.join(ROOT, 'AGENTS.md'), 'utf8')
    .split('\n').find((l) => l.startsWith('Inventory (derived'));
  if (!line) return 'AGENTS.md has no inventory line for the paper to quote';
  const mismatched = [];
  for (const [key, label] of [['workflows', 'workflows'], ['data_files', 'data files'],
    ['geographies', 'unique geographies'], ['counties', 'counties']]) {
    const v = at(regenerated, `inventory.${key}`);
    if (v == null) continue;
    if (!line.includes(`**${v}**`)) mismatched.push(`${label}=${v} is not in the AGENTS.md line`);
  }
  return mismatched.length ? mismatched.join('; ') : null;
});

test('the paper cites the case study it actually computed', () => {
  const name = at(regenerated, 'case.name');
  if (!name) return 'the case study has no name';
  return html.includes(`data-figure="case.name"`) ? null
    : 'the page does not bind the case-study name to the data';
});

console.log(failures === 0 ? '  paper-figures-fresh: PASS' : `  paper-figures-fresh: FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
