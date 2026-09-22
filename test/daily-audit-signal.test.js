'use strict';

/**
 * Guards for the daily audit's own honesty.
 *
 * The audit emails the owner every morning and files nothing, so a defect in
 * the audit is invisible in a way a defect in the site is not: it just changes
 * what the email claims, and there is no CI run to go red. Three such defects
 * shipped together, and each of these tests pins one of them shut.
 *
 *  1. checkCountyCoverage() pointed at data/hna/lihtc-trends-by-county.json,
 *     a path nothing writes and nothing reads. Every run took the not-found
 *     branch and returned early, so the 64-county assertion had NEVER executed
 *     while the email reported a present, complete file as missing.
 *
 *  2. Correcting the path alone would have swapped one false positive for
 *     another: the count read Object.keys(data).length at the TOP level, where
 *     this file holds seven metadata keys, with the 64 counties one level down
 *     under "counties". That reports "7 of 64" and reads exactly like real
 *     data loss.
 *
 *  3. checkLihtcCompliance() reported "926 records have null CREDIT, NON_PROF,
 *     or DDA" and recommended backfilling with 0 / "U". CREDIT is in fact fully
 *     populated; NON_PROF, DDA and QCT are null on every record because CHFA's
 *     layer does not publish them. Following the recommendation would have
 *     written a real 0 into DDA for 926 properties — turning "not published"
 *     into "not in a Difficult Development Area", which decides 30% basis boost
 *     eligibility.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const { countyEntriesIn } = require('./audit-modules/data-integrity.js');
const { classifyNullField } = require('./audit-modules/logic-validation.js');

let failures = 0;
function run(name, fn) {
  try { fn(); console.log('  ✓ ' + name); }
  catch (err) { failures += 1; console.error('  ✗ ' + name + '\n    ' + err.message); }
}

console.log('daily-audit-signal');

// ── 1 + 2. The LIHTC trends path and container ──────────────────────────────

const TRENDS = path.join(ROOT, 'data', 'lihtc-trends-by-county.json');

run('the audit checks the path the site actually fetches', () => {
  assert.ok(fs.existsSync(TRENDS),
    'data/lihtc-trends-by-county.json must exist — this is the path js/market-intelligence.js fetches');
  const src = fs.readFileSync(path.join(ROOT, 'test', 'audit-modules', 'data-integrity.js'), 'utf8');
  assert.ok(!/'hna',\s*'lihtc-trends-by-county\.json'/.test(src),
    "data-integrity.js must not look for lihtc-trends-by-county.json under data/hna/ — " +
    'nothing writes that path, so the check silently never runs');
});

run('counties are counted in their container, not at the metadata level', () => {
  const data = JSON.parse(fs.readFileSync(TRENDS, 'utf8'));
  const topLevel = Object.keys(data).length;
  assert.notEqual(topLevel, 64,
    'precondition: this file keeps metadata at the top level, so a naive top-level count is wrong');
  assert.equal(countyEntriesIn(data), 64,
    'countyEntriesIn must descend into "counties" — counting ' + topLevel +
    ' metadata keys would report "' + topLevel + ' of 64" and look like data loss');
});

run('every container shape a pipeline might emit is counted the same', () => {
  assert.equal(countyEntriesIn([{ a: 1 }, { a: 2 }]), 2, 'bare array');
  assert.equal(countyEntriesIn({ counties: [{ a: 1 }] }), 1, 'array under counties');
  assert.equal(countyEntriesIn({ counties: { Adams: {}, Weld: {} } }), 2, 'object under counties');
  assert.equal(countyEntriesIn({ '08001': {}, '08123': {} }), 2, 'flat object keyed by FIPS');
});

run('a container that is really metadata is refused, not miscounted', () => {
  // Every county entry is an object of per-county figures. A bag of scalars is
  // metadata we have mistaken for counties, and returning a number there would
  // silently produce a coverage figure from the wrong level.
  assert.equal(countyEntriesIn({ updated: '2026-09-07', source: 'CHFA', note: 'x' }), null);
  assert.equal(countyEntriesIn(null), null);
  assert.equal(countyEntriesIn('not an object'), null);
});

run('genuine coverage loss is still caught', () => {
  const short = { counties: {} };
  for (let i = 0; i < 61; i += 1) short.counties['county' + i] = { 2025: 1 };
  assert.equal(countyEntriesIn(short), 61,
    'a file missing three counties must count 61 so the 64-county assertion fires');
});

// ── 3. Null fields are classified, never backfilled ─────────────────────────

run('a field null on every record is reported as unpublished, not as N bad records', () => {
  const issue = classifyNullField('DDA', 926, 926, 'data/chfa-lihtc.json');
  assert.ok(issue, 'an all-null field must still be reported');
  assert.equal(issue.severity, 'medium');
  assert.match(issue.description, /does not publish it/,
    'the reader must be told the source lacks the field, not that 926 records are broken');
});

run('a field null on only some records keeps its per-record count and severity', () => {
  const issue = classifyNullField('CREDIT', 12, 926, 'data/chfa-lihtc.json');
  assert.equal(issue.severity, 'high');
  assert.match(issue.description, /12 of 926/,
    'a partial gap is a real defect and must keep its count');
});

run('a fully populated field produces no issue', () => {
  assert.equal(classifyNullField('CREDIT', 0, 926, 'data/chfa-lihtc.json'), null);
});

run('no recommendation anywhere tells anyone to backfill an absent value', () => {
  // AGENTS.md #1480: an unmeasurable quantity is null, never 0. A filled-in
  // value is indistinguishable from a measured one, which is precisely the
  // failure-presented-as-success class this repo keeps having to undo.
  const cases = [
    classifyNullField('DDA', 926, 926, 'f.json'),
    classifyNullField('QCT', 5, 926, 'f.json'),
  ];
  for (const issue of cases) {
    assert.doesNotMatch(issue.recommendation, /backfill with|fill (in |with )?0|default to 0/i,
      'recommendation must never propose writing a placeholder over an absent value: ' +
      issue.recommendation);
  }
  // Scope this to what the audit actually EMITS. The comment above
  // classifyNullField quotes the old wording on purpose, so that a future
  // reader knows why the shape is what it is — a whole-file grep would flag
  // that comment and pressure someone into deleting the explanation.
  const src = fs.readFileSync(path.join(ROOT, 'test', 'audit-modules', 'logic-validation.js'), 'utf8');
  const emitted = src.split('\n').filter(line => /^\s*recommendation:/.test(line));
  assert.ok(emitted.length > 0, 'precondition: the module emits recommendations');
  for (const line of emitted) {
    assert.doesNotMatch(line, /backfill with|fill (in |with )?0|default to 0/i,
      'no emitted recommendation may propose writing a placeholder over an ' +
      'absent value: ' + line.trim());
  }
});

// ── The workflow must carry history between runs ────────────────────────────
//
// monitoring-reports/ is gitignored, so a fresh runner starts with no prior
// snapshot and every finding is classified "new". The first fix carried the
// directory in actions/cache; it restored correctly for exactly one day and
// the entry was then evicted, so the email went straight back to reporting
// every issue as new. The cache is best-effort storage. The history now rides
// an artifact, which is kept for its retention period and never evicted early.

const WORKFLOW = path.join(ROOT, '.github', 'workflows', 'daily-audit-system.yml');

run('the daily audit restores its history from a durable artifact before it runs', () => {
  const wf = fs.readFileSync(WORKFLOW, 'utf8');
  const auditAt = wf.indexOf('run: node test/daily-audit-system.js');
  assert.ok(auditAt > 0, 'precondition: the workflow runs the audit');
  const restoreAt = wf.indexOf('name: Restore prior audit history');
  assert.ok(restoreAt > 0 && restoreAt < auditAt,
    'without a restore step before the audit the runner has no prior snapshot, so ' +
    'every finding is classified "new" and nothing can ever show as resolved');
  assert.match(wf.slice(restoreAt, auditAt), /listArtifactsForRepo/,
    'the restore must find the newest prior artifact, whichever run produced it');
  assert.match(wf.slice(restoreAt, auditAt), /name:\s*'audit-history'/,
    'the restore must look up the artifact by its fixed name');
  const restore = wf.slice(restoreAt, auditAt);
  assert.match(restore, /const dir = 'monitoring-reports\/audit-history'/,
    'the artifact must be unpacked where audit-history.js reads it');
  assert.match(restore, /downloadArtifact[\s\S]{0,600}exec\.exec\('unzip', \['-o', '-q', zipPath, '-d', dir\]\)/,
    'the download must be unzipped into that directory, overwriting any stale copy');
  assert.match(wf, /permissions:[\s\S]{0,120}actions:\s*read/,
    'listing and downloading artifacts needs actions: read on the job token');
  assert.doesNotMatch(wf, /uses:\s*actions\/cache/,
    'actions/cache is best-effort and lost the history within a day; do not reintroduce it');
});

run('the daily audit saves its history back to the same artifact after it runs', () => {
  const wf = fs.readFileSync(WORKFLOW, 'utf8');
  const auditAt = wf.indexOf('run: node test/daily-audit-system.js');
  const save = wf.slice(auditAt);
  assert.match(save, /upload-artifact@v\d+\s*\n\s*with:\s*\n\s*name:\s*audit-history\s*\n\s*path:\s*monitoring-reports\/audit-history/,
    'without a save step tomorrow has nothing to compare against');
  assert.match(save, /if:\s*always\(\)[^\n]*\n\s*uses:\s*actions\/upload-artifact@v\d+\s*\n\s*with:\s*\n\s*name:\s*audit-history/,
    'the save must run even when a later legacy check fails');
  assert.match(save, /name:\s*audit-history[\s\S]{0,200}overwrite:\s*true/,
    'a re-run of the same run must replace attempt 1\'s artifact, not fail on the name');
});

// ── The comparison itself classifies correctly once history is present ──────

const { compareWithPrior } = require('./audit-modules/audit-history.js');

run('an issue seen yesterday is persistent, a missing one is resolved, a fresh one is new', () => {
  const a = { file: 'x.json', type: 'schema', description: 'field A missing', severity: 'high' };
  const b = { file: 'y.json', type: 'link', description: 'broken link', severity: 'medium' };
  const c = { file: 'z.html', type: 'ui', description: 'no h1', severity: 'low' };
  const prior = { date: '2026-09-21', issues: [a, b] };
  const result = compareWithPrior([a, c], prior);
  assert.deepEqual(result.persistentIssues, [a]);
  assert.deepEqual(result.resolvedIssues, [b]);
  assert.deepEqual(result.newIssues, [c]);
});

run('with no prior snapshot everything is new and nothing is resolved or persistent', () => {
  const a = { file: 'x.json', type: 'schema', description: 'field A missing' };
  const result = compareWithPrior([a], null);
  assert.deepEqual(result, { newIssues: [a], resolvedIssues: [], persistentIssues: [] });
});

console.log(failures === 0
  ? '  all daily-audit-signal guards passed'
  : '  ' + failures + ' guard(s) failed');
process.exit(failures === 0 ? 0 : 1);
