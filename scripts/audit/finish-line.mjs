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

const ROUTE_SOURCE = 'js/components/workflow-progress.js';

/**
 * The guided path, READ from the one place a step number is written down.
 *
 * This used to be a hand-written table of six steps, and it went stale without
 * a sound. The route changed three times on 2026-09-16 — the entry point moved
 * from the Opportunity Finder to the jurisdiction, and a seventh step was
 * added — and this constant still described the old one. G1 kept reporting
 * PASS the whole time, because all it asks is whether six named files exist,
 * and they did.
 *
 * That is the failure this audit exists to catch, sitting inside the audit: a
 * green that is true about something other than what it claims. Worse, a test
 * asserted `GUIDED_PATH.length === 6`, so a guard was holding the wrong answer
 * in place and would have failed anyone who corrected it.
 *
 * So it is derived. The component's STEPS table is the route; if that table's
 * shape changes the parse returns nothing and G1 goes OPEN rather than passing
 * on an empty list. test:entry-path separately holds the component and the
 * twelve hard-coded rails to each other, so reading the component reads what
 * the pages actually render.
 */
import { readWalkthrough } from './walkthrough-record.mjs';

export const GUIDED_PATH = readGuidedPath();

function readGuidedPath() {
  const src = read(ROUTE_SOURCE);
  if (src === null) return [];
  const re = /\{ num: (\d+), key: '([^']+)',\s*label: '([^']+)',\s*href: '([^']+)' \}/g;
  return [...src.matchAll(re)].map((m) => ({
    step: Number(m[1]), key: m[2], name: m[3].trim(), page: m[4],
  }));
}

const PASS = 'PASS', OPEN = 'OPEN', UNMEASURED = 'UNMEASURED';
const WALKTHROUGH_DIR = path.join(ROOT, 'docs/walkthroughs');

/**
 * Decide G1 from a route and a file-existence oracle.
 *
 * Separated out so the failing cases can be tested with routes the repo does
 * not contain. Asserting these against the real route proves nothing: it is
 * correctly ordered and complete, so removing a check here would change no
 * observable output and a guard written that way passes over its own removal.
 *
 * An empty route is OPEN, never PASS. A parse that matches nothing has nothing
 * to say, and reporting success over an empty list is precisely how the stale
 * six-step table stayed green through three route changes.
 */
export function evaluateGuidedPath(route, existsFn) {
  if (!Array.isArray(route) || route.length === 0) {
    return {
      state: OPEN,
      detail: `the route could not be read from ${ROUTE_SOURCE} — its STEPS table has changed shape`,
    };
  }
  const outOfOrder = route.some((s, i) => s.step !== i + 1);
  if (outOfOrder) {
    return { state: OPEN, detail: `the route is numbered ${route.map((s) => s.step).join(', ')}` };
  }
  const missing = route.filter((s) => !existsFn(s.page)).map((s) => s.page);
  if (missing.length) {
    return { state: OPEN, detail: `missing: ${missing.join(', ')}` };
  }
  return {
    state: PASS,
    detail: `all ${route.length} step pages exist, in order, starting at ${route[0].page}`,
  };
}

export function measure({ runTests = false } = {}) {
  const items = [];
  const add = (id, group, state, detail, evidence) =>
    items.push({ id, group, state, detail, evidence });

  /* ── The deliverable: a novice can complete the guided path ───────────── */

  const g1 = evaluateGuidedPath(GUIDED_PATH, exists);
  add('G1', 'Guided path', g1.state, g1.detail, `${ROUTE_SOURCE} STEPS + file existence`);

  const hnaPages = fs.readdirSync(ROOT)
    .filter((f) => /^(housing-needs-assessment|hna-)[\w-]*\.html$/.test(f));
  const railless = hnaPages.filter((f) => !/wf-step__label/.test(read(f) || ''));
  add('G2', 'Guided path', railless.length ? OPEN : PASS,
    railless.length ? `no step rail on: ${railless.join(', ')}` : `step rail present on all ${hnaPages.length} HNA pages`,
    'wf-step__label in page source');

  // Whether a novice can actually FINISH the path is a human judgement about
  // comprehension. It is not derivable from the repo, and pretending otherwise
  // is how "shipped" gets mistaken for "works".
  //
  // So this does not judge — it reads a record of a judgement someone made.
  // It was hardcoded UNMEASURED until 2026-09-24, which was honest but left a
  // walkthrough that DID happen with nowhere to land, and meant the finish
  // line could never reach a full count however much real work was done.
  //
  // A negative verdict is a complete record, not a missing one: it reports
  // OPEN with the reader's own blockers. A form that can only express success
  // is the defect this repo keeps removing. See walkthrough-record.mjs for
  // what a record has to contain and why.
  const walk = readWalkthrough(WALKTHROUGH_DIR, GUIDED_PATH);
  add('G3', 'Guided path', walk.state, walk.detail, walk.record || 'requires a human');

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
  // "Wired into test:ci" means REACHABLE from it, not named in its string.
  // A substring check cannot see through one level of npm composition, so
  // when the freshness gates were folded into `test:freshness` this reported
  // test:derived-chain and test:freshness-guard as unwired while they were
  // still running. Resolve the script graph instead: expand each `npm run X`
  // and collect what actually executes.
  const reachableFromCi = (() => {
    let scripts;
    try { scripts = JSON.parse(read('package.json') || '{}').scripts || {}; }
    catch { return null; }
    if (!scripts['test:ci']) return null;
    const seen = new Set();
    const walk = (name, depth) => {
      if (depth > 10 || seen.has(name)) return;   // depth cap: a cycle would hang
      seen.add(name);
      const body = scripts[name];
      if (!body) return;
      for (const m of body.matchAll(/npm run ([\w:.-]+)/g)) walk(m[1], depth + 1);
    };
    walk('test:ci', 0);
    seen.delete('test:ci');
    return seen;
  })();

  for (const [id, detail, script] of floor) {
    const wired = reachableFromCi ? reachableFromCi.has(script) : false;
    if (!wired) { add(id, 'Correctness floor', OPEN, `${detail} — ${script} is not in test:ci`, 'package.json'); continue; }
    if (!runTests) { add(id, 'Correctness floor', PASS, `${detail} (guarded by ${script})`, 'wired into test:ci'); continue; }
    add(id, 'Correctness floor', npmTest(script) ? PASS : OPEN, detail, `ran ${script}`);
  }

  /* ── Known-open product work ──────────────────────────────────────────── */

  // Matches the real implementation: costPerGrossSf() in the deal calculator.
  // Deliberately anchored on the FUNCTION, not on the words 'cost per sf'
  // appearing somewhere — a comment mentioning it would otherwise close
  // this item, which is the mistake four guards made today.
  const costPerSf = /function costPerGrossSf\(/.test(read('js/deal-calculator.js') || '');
  add('O1', 'Open product work', costPerSf ? PASS : OPEN,
    costPerSf ? 'cost per gross square foot is modelled in the deal calculator'
      : 'cost per square foot exists nowhere in the deal calculator or market study; '
        + 'it needs a gross-SF input (plan pass criterion 6)',
    'source scan');

  // O2 was hardcoded UNMEASURED with the evidence string 'issue #1620 open'.
  // #1620 closed 2026-09-17, so the line kept asserting a fact that had
  // stopped being true and no test could notice — the same defect #1720 fixed
  // for G1, in the same file.
  //
  // Measured from the repo instead, on the same principle as O1: anchor on
  // the artifacts §7 actually had to produce, plus their guards being wired
  // into test:ci. A scoping item is done when the thing it scoped exists and
  // cannot silently regress.
  const o2Artifacts = [
    ['recommendation.html', 'the step-7 recommendation page'],
    ['js/workflow/recommendation-contract.js', 'the recommendation contract'],
    ['js/market/sale-price-evidence.js', 'named sale-price evidence'],
    ['js/project-market-study/study-geography.js', 'the study geography'],
  ];
  const o2Guards = ['test:entry-path', 'test:forsale-jurisdiction', 'test:recommendation', 'test:sale-price'];
  // Reachability, not substring — the same correction this file already
  // applies to the correctness floor above. test:ci is a chain of ci:part-N
  // groups since #1755, so `ciScript.includes('test:entry-path')` reported
  // all four §7 guards as unwired and took the finish line from 12 pass to
  // 11. They were running the whole time. reachableFromCi is already computed
  // above for exactly this reason; O2 was added later and missed it.
  const missingArtifacts = o2Artifacts.filter(([f]) => read(f) === null).map(([, d]) => d);
  const unwiredGuards = o2Guards.filter((g) => !(reachableFromCi && reachableFromCi.has(g)));
  const o2Done = missingArtifacts.length === 0 && unwiredGuards.length === 0;
  add('O2', 'Open product work', o2Done ? PASS : OPEN,
    o2Done
      ? `Market Study V1 scoping (#1620) shipped — ${o2Artifacts.length} artifacts present, `
        + `${o2Guards.length} guards in test:ci`
      : `Market Study V1 scoping (#1620) incomplete — `
        + [missingArtifacts.length ? `missing: ${missingArtifacts.join(', ')}` : '',
           unwiredGuards.length ? `not in test:ci: ${unwiredGuards.join(', ')}` : ''].filter(Boolean).join('; '),
    'source scan + package.json');

  /* ── Transit zone screen (#1937) ──────────────────────────────────────── */

  // T1: one statewide stop file, CDOT first, with the source of every stop
  // recorded and a coverage report for all 64 counties. Measured from the
  // files themselves, so a refresh that drops CDOT or loses the per-stop
  // source reopens it. T2-T4 are added with the phases that build them.
  const t1Problems = [];
  let t1Stops = null, t1Report = null;
  try { t1Stops = JSON.parse(read('data/amenities/transit_stops_statewide_co.geojson')); } catch { /* reported below */ }
  try { t1Report = JSON.parse(read('data/market/transit_stops_coverage_co.json')); } catch { /* reported below */ }
  if (!t1Stops || !Array.isArray(t1Stops.features)) t1Problems.push('statewide stop file missing or unreadable');
  if (!t1Report || !Array.isArray(t1Report.counties)) t1Problems.push('coverage report missing or unreadable');
  if (t1Stops && Array.isArray(t1Stops.features)) {
    const feats = t1Stops.features;
    const fromCdot = feats.filter((f) => (f.properties?.sources || []).includes('cdot')).length;
    const unsourced = feats.filter((f) => !(f.properties?.sources || []).length || !/^08\d{3}$/.test(f.properties?.county_fips || '')).length;
    if (!fromCdot) t1Problems.push('no stop comes from CDOT');
    if (unsourced) t1Problems.push(`${unsourced} stops lack a source or county`);
    const gen = Date.parse(t1Stops.meta?.generated || '');
    const ageDays = Number.isFinite(gen) ? (Date.now() - gen) / 86400000 : null;
    if (ageDays === null) t1Problems.push('stop file has no generated date');
    else if (ageDays > 16) t1Problems.push(`stop file is ${Math.floor(ageDays)} days old (SLA 16)`);
  }
  if (t1Report && Array.isArray(t1Report.counties) && t1Report.counties.length !== 64) {
    t1Problems.push(`coverage report has ${t1Report.counties.length} counties, not 64`);
  }
  add('T1', 'Transit zone screen', t1Problems.length ? OPEN : PASS,
    t1Problems.length ? t1Problems.join('; ')
      : `${t1Stops.features.length.toLocaleString('en-US')} stops, CDOT first, source recorded per stop; `
        + `coverage report for all 64 counties`,
    'data/amenities/transit_stops_statewide_co.geojson + data/market/transit_stops_coverage_co.json');

  /* ── The definition itself ────────────────────────────────────────────── */

  const doc = read('docs/FINISH-LINE.md');
  // A row is a recorded criterion only when its text is there. Counting every
  // PC row reported "7 pass criteria recorded" beside D2's "6 not in the repo".
  const rows = doc ? doc.split('\n').filter((l) => /^\| ?PC-\d+/.test(l)) : [];
  const recorded = rows.filter((l) => !l.includes('NOT RECORDED')).length;
  add('D1', 'The definition', recorded > 0 ? PASS : OPEN,
    recorded > 0 ? `${recorded} of ${rows.length} pass criteria recorded in docs/FINISH-LINE.md`
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
