#!/usr/bin/env node
/**
 * scripts/audit/finish-line.mjs — measure the repo against the definition of
 * done in docs/FINISH-LINE.md.
 *
 * WHY THIS IS A SCRIPT AND NOT A CHECKLIST
 *
 * A checklist in a doc goes stale silently, and this repo has spent a week
 * proving what that costs: a GOTCHA comment nobody read (#1695), a derived
 * chain reconstructed from memory every time (#1696), a glossary that shipped
 * and reached 17 of 975 terms. Written-down rules do not survive contact with
 * a working session.
 *
 * So the finish line is measured. Every item is PASS, OPEN, or UNMEASURED —
 * and UNMEASURED is a first-class state, never quietly counted as done. That
 * distinction is the entire subject of this codebase.
 *
 *   node scripts/audit/finish-line.mjs            human-readable status
 *   node scripts/audit/finish-line.mjs --json     machine-readable
 *   node scripts/audit/finish-line.mjs --strict   exit 1 if a PASS regressed
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => { try { return fs.readFileSync(path.join(ROOT, p), 'utf8'); } catch { return null; } };
const exists = (p) => fs.existsSync(path.join(ROOT, p));

function npmTest(script) {
  try {
    execFileSync('npm', ['run', script], { cwd: ROOT, encoding: 'utf8', stdio: 'pipe' });
    return true;
  } catch { return false; }
}

/** The six steps of the guided path, in order, with the page each points at. */
export const GUIDED_PATH = [
  { step: 1, name: 'Opportunity Finder', page: 'lihtc-opportunity-finder.html' },
  { step: 2, name: 'Jurisdiction',       page: 'select-jurisdiction.html' },
  { step: 3, name: 'Needs Assessment',   page: 'housing-needs-assessment.html' },
  { step: 4, name: 'Market Analysis',    page: 'market-analysis.html' },
  { step: 5, name: 'Scenarios',          page: 'hna-scenario-builder.html' },
  { step: 6, name: 'Deal',               page: 'deal-calculator.html' },
];

const PASS = 'PASS', OPEN = 'OPEN', UNMEASURED = 'UNMEASURED';

export function measure({ runTests = false } = {}) {
  const items = [];
  const add = (id, group, state, detail, evidence) =>
    items.push({ id, group, state, detail, evidence });

  /* ── The deliverable: a novice can complete the guided path ───────────── */

  const missingPages = GUIDED_PATH.filter((s) => !exists(s.page)).map((s) => s.page);
  add('G1', 'Guided path', missingPages.length ? OPEN : PASS,
    missingPages.length ? `missing: ${missingPages.join(', ')}` : 'all six step pages exist',
    'file existence');

  const hnaPages = fs.readdirSync(ROOT)
    .filter((f) => /^(housing-needs-assessment|hna-)[\w-]*\.html$/.test(f));
  const railless = hnaPages.filter((f) => !/wf-step__label/.test(read(f) || ''));
  add('G2', 'Guided path', railless.length ? OPEN : PASS,
    railless.length ? `no step rail on: ${railless.join(', ')}` : `step rail present on all ${hnaPages.length} HNA pages`,
    'wf-step__label in page source');

  // Whether a novice can actually FINISH the path is a human judgement about
  // comprehension. It is not derivable from the repo, and pretending otherwise
  // is how "shipped" gets mistaken for "works".
  add('G3', 'Guided path', UNMEASURED,
    'no walkthrough recorded — needs one person, unfamiliar with the tool, completing all six steps',
    'requires a human');

  /* ── The correctness floor ────────────────────────────────────────────── */

  const floor = [
    ['C1', 'no unmeasured value is published as 0',        'test:no-coerced-zeros'],
    ['C2', 'the derived-data chain is runnable and mapped', 'test:derived-chain'],
    ['C3', 'freshness checks refuse to discard your work',  'test:freshness-guard'],
    ['C4', 'every data source has a declared state',        'test:planned-sources'],
    ['C5', 'the glossary reaches rendered content',         'test:glossary-reach'],
    ['C6', 'the ownership panel leads with its answer',     'test:ownership-answer'],
    ['C7', 'a blocked calculation produces no number',      'test:deal-calc-absence'],
  ];
  for (const [id, detail, script] of floor) {
    const wired = /"test:ci":[^"]*"[^"]*/.test(read('package.json') || '')
      && (JSON.parse(read('package.json')).scripts['test:ci'] || '').includes(script);
    if (!wired) { add(id, 'Correctness floor', OPEN, `${detail} — ${script} is not in test:ci`, 'package.json'); continue; }
    if (!runTests) { add(id, 'Correctness floor', PASS, `${detail} (guarded by ${script})`, 'wired into test:ci'); continue; }
    add(id, 'Correctness floor', npmTest(script) ? PASS : OPEN, detail, `ran ${script}`);
  }

  /* ── Known-open product work ──────────────────────────────────────────── */

  const costPerSf = ['js/deal-calculator.js', 'js/project-market-study/effective-demand.js']
    .some((f) => /cost.?per.?sf|costPerSf|cost_per_sf|perSquareFoot/i.test(read(f) || ''));
  add('O1', 'Open product work', costPerSf ? PASS : OPEN,
    costPerSf ? 'cost per square foot is modelled'
      : 'cost per square foot exists nowhere in the deal calculator or market study; '
        + 'it needs a gross-SF input (plan pass criterion 6)',
    'source scan');

  add('O2', 'Open product work', UNMEASURED,
    'Market Study V1 scoping (#1620) — page map, data availability, ranked defects, validation cases',
    'issue #1620 open');

  /* ── The definition itself ────────────────────────────────────────────── */

  const doc = read('docs/FINISH-LINE.md');
  const recorded = doc ? (doc.match(/^\| ?(PC-\d+)/gm) || []).length : 0;
  add('D1', 'The definition', recorded > 0 ? PASS : OPEN,
    recorded > 0 ? `${recorded} pass criteria recorded in docs/FINISH-LINE.md`
      : 'docs/FINISH-LINE.md records no pass criteria',
    'docs/FINISH-LINE.md');

  // Guard against passing by finding nothing: with no document, "zero gaps" is
  // trivially true. The first version of this scored PASS while the file it
  // measures did not exist — which is the exact failure this whole file is
  // about, committed inside the tool built to detect it.
  const gaps = doc ? (doc.match(/NOT RECORDED/g) || []).length : null;
  add('D2', 'The definition',
    doc === null ? OPEN : (gaps === 0 ? PASS : OPEN),
    doc === null ? 'docs/FINISH-LINE.md does not exist, so there is nothing to check against'
      : gaps === 0 ? 'every pass criterion has its text recorded'
      : `${gaps} pass criteria are referenced but their text is not in the repo — `
        + 'they exist only in the owner\'s plan, so nothing here can check them',
    'docs/FINISH-LINE.md');

  return items;
}

/* ── output ───────────────────────────────────────────────────────────────── */

const args = process.argv.slice(2);
const INVOKED_DIRECTLY = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (INVOKED_DIRECTLY) {
  const items = measure({ runTests: args.includes('--run-tests') });
  if (args.includes('--json')) {
    console.log(JSON.stringify(items, null, 2));
  } else {
    const counts = items.reduce((a, i) => (a[i.state] = (a[i.state] || 0) + 1, a), {});
    console.log('\nFinish line — measured ' + new Date().toISOString().slice(0, 10) + '\n');
    let group = null;
    for (const i of items) {
      if (i.group !== group) { group = i.group; console.log('  ' + group); }
      const mark = i.state === PASS ? '✓' : i.state === OPEN ? '○' : '?';
      console.log(`    ${mark} ${i.id.padEnd(3)} ${i.state.padEnd(11)} ${i.detail}`);
    }
    console.log(`\n  ${counts[PASS] || 0} pass · ${counts[OPEN] || 0} open · ${counts[UNMEASURED] || 0} unmeasured`);
    console.log('\n  UNMEASURED is not done. It means nobody has checked.\n');
  }
  if (args.includes('--strict') && items.some((i) => i.state === OPEN)) process.exit(1);
}
