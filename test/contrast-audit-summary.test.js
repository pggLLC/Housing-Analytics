#!/usr/bin/env node
// test/contrast-audit-summary.test.js
//
// contrast-audit.yml's per-page table. Two defects it used to have:
//   1. A page that failed to load printed "✅ Pass | 0" -- run.js swallowed
//      the error and exited 0, and the workflow trusted the exit code.
//   2. A page with violations printed "❌ Fail | 0" -- the count was read
//      from `.summary.violations`, a key run.js's report does not have at the
//      top level (it writes `.totals.violations`).
// The table is now built from the reports by scripts/contrast-audit/summarize.js.
// The fixtures below are the report shapes run.js writes; the last block
// checks them against run.js itself so they cannot drift from it.
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const childProcess = require('child_process');
const { summarize, classify } = require('../scripts/contrast-audit/summarize.js');

const ROOT = path.resolve(__dirname, '..');
const RUN = fs.readFileSync(path.join(ROOT, 'scripts/contrast-audit/run.js'), 'utf8');
const WF = fs.readFileSync(path.join(ROOT, '.github/workflows/contrast-audit.yml'), 'utf8');

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log('  ✓ ' + name);
}

const page = (over) => Object.assign({ url: 'p.html', violations: [], fixes: [] }, over);
const REPORTS = {
  'clean.html':    { pages: [page({ summary: { violations: 0, passed: true } })], totals: { violations: 0, errors: 0 } },
  'bad.html':      { pages: [page({ violations: [{}, {}, {}], summary: { violations: 3, passed: false } })], totals: { violations: 3, errors: 0 } },
  'broken.html':   { pages: [page({ error: 'page.evaluate: Execution context was destroyed', summary: { violations: 0, error: true } })], totals: { violations: 0, errors: 1 } },
  'moved.html':    { pages: [page({ redirect: 'pipeline.html', summary: { violations: 0, redirect: true } })], totals: { violations: 0, errors: 0, redirects: 1 } },
};

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'contrast-summary-'));
for (const [name, report] of Object.entries(REPORTS)) {
  fs.writeFileSync(path.join(dir, name.replace(/\.html$/, '.json')), JSON.stringify(report));
}
const PAGES = Object.keys(REPORTS).concat(['never-ran.html']);
const { markdown, counts } = summarize(dir, PAGES);
const row = (p) => markdown.split('\n').find((l) => l.startsWith('| `' + p + '`'));

test('every page gets exactly one row (non-vacuous: the scan saw all of them)', () => {
  assert.strictEqual(counts.total, PAGES.length);
  for (const p of PAGES) assert.ok(row(p), 'missing row for ' + p);
});

test('a page with violations shows its real count, not 0', () => {
  assert.match(row('bad.html'), /❌ Fail \| 3 \|$/);
});

test('a page that errored is Not scanned, never a pass', () => {
  assert.match(row('broken.html'), /⚠️ Not scanned/);
  assert.doesNotMatch(row('broken.html'), /Pass/);
});

test('a page with no report at all is Not scanned', () => {
  assert.match(row('never-ran.html'), /⚠️ Not scanned .*no report written/);
});

test('a redirect names its target and is not counted as a pass or a failure', () => {
  assert.match(row('moved.html'), /↪️ Redirect → `pipeline.html`/);
  assert.deepStrictEqual(counts, { total: 5, passed: 1, failed: 1, not_scanned: 2, redirects: 1 });
});

test('the fixtures agree with what run.js writes', () => {
  // The count summarize.js reads is the one run.js puts in its totals.
  assert.ok(/report\.totals\s*=\s*{[^}]*violations:\s*totalViolations/.test(RUN), 'run.js totals.violations');
  assert.strictEqual(classify({ pages: [{}], totals: { violations: 2 } }).violations, 2);
  // An error and a redirect each land on the page entry under the key classify() reads.
  assert.ok(/report\.pages\.push\(\{\s*url: url, error: err\.message/.test(RUN), 'run.js page.error');
  assert.ok(/report\.pages\.push\(\{\s*url: url, redirect: result\.redirect/.test(RUN), 'run.js page.redirect');
  // An unscanned page does not exit 0.
  assert.ok(/if \(totalErrors > 0\) \{\s*process\.exit\(2\)/.test(RUN), 'run.js exits non-zero on errors');
});

test('the workflow builds its table with summarize.js, not the old jq read', () => {
  assert.ok(WF.includes('node scripts/contrast-audit/summarize.js contrast-reports'), 'workflow calls summarize.js');
  assert.ok(!WF.includes('.summary.violations'), 'workflow still reads .summary.violations');
  assert.ok(!/status="✅ Pass"/.test(WF), 'workflow still derives Pass from the exit code');
});

const pagesFile = path.join(dir, 'pages.txt');
fs.writeFileSync(pagesFile, PAGES.join('\n') + '\n');

// #2038: 14 pages failed under a green check. Every per-page run ends in
// `|| true`, and the only step that could fail the job ran `if: failure()`,
// which nothing before it could trigger. The gate below must read a count
// summarize.js actually writes, run whatever happened before it, and exit
// non-zero on a failing page. It is executed here, not just read.
function stepBlock(name) {
  const start = WF.indexOf('      - name: ' + name);
  assert.ok(start >= 0, 'workflow has a step named "' + name + '"');
  const rest = WF.slice(start + 1);
  const end = rest.search(/\n      (- name:|#)/);
  return end < 0 ? rest : rest.slice(0, end);
}
const GATE_NAME = 'Fail on contrast or WCAG gate failures';

test('the gate reads counts the audit step really writes', () => {
  const gate = stepBlock(GATE_NAME);
  assert.ok(/\n\s+if: always\(\)/.test(gate), 'gate runs if: always()');
  const audit = stepBlock('Run contrast audit on each page');
  assert.ok(/\n\s+id: audit\n/.test(audit), 'audit step has id: audit');
  assert.ok(audit.includes('node scripts/contrast-audit/summarize.js'), 'audit step runs summarize.js');
  assert.ok(WF.indexOf('      - name: ' + GATE_NAME) > WF.indexOf('      - name: Run contrast audit on each page'),
    'gate runs after the audit');
  // Every steps.audit.outputs.<key> the gate reads is a key summarize.js emits.
  const outFile = path.join(dir, 'gh-output');
  fs.writeFileSync(outFile, '');
  const prev = process.env.GITHUB_OUTPUT;
  process.env.GITHUB_OUTPUT = outFile;
  try {
    childProcess.execFileSync(process.execPath, [path.join(ROOT, 'scripts/contrast-audit/summarize.js'), dir, pagesFile]);
  } finally {
    if (prev === undefined) delete process.env.GITHUB_OUTPUT; else process.env.GITHUB_OUTPUT = prev;
  }
  const emitted = fs.readFileSync(outFile, 'utf8').split('\n').filter(Boolean).map(l => l.split('=')[0]);
  const read = [...gate.matchAll(/steps\.audit\.outputs\.(\w+)/g)].map(m => m[1]);
  assert.ok(read.length > 0, 'gate reads at least one audit output');
  read.forEach(k => assert.ok(emitted.includes(k), 'gate reads steps.audit.outputs.' + k + ', which summarize.js does not write'));
  // Same for the pytest exit code.
  const pyRead = [...gate.matchAll(/steps\.wcag-gate\.outputs\.(\w+)/g)].map(m => m[1]);
  pyRead.forEach(k => assert.ok(stepBlock('Run Stage 3 WCAG Accessibility Gate (46 checks)').includes(k + '='),
    'gate reads steps.wcag-gate.outputs.' + k + ', which that step does not write'));
});

test('the gate fails the job on a failing or unscanned page, and only then', () => {
  const gate = stepBlock(GATE_NAME);
  const m = gate.match(/run: \|\n([\s\S]*)$/);
  assert.ok(m, 'gate has a run block');
  const script = m[1].replace(/^ {10}/gm, '');
  const run = (env) => childProcess.spawnSync('bash', ['-e', '-c', script], { env: Object.assign({ PATH: process.env.PATH }, env) }).status;
  const ok = { PYTEST_RC: '0', FAILED_PAGES: '0', NOT_SCANNED: '0', AUDIT_OUTCOME: 'success' };
  assert.strictEqual(run(ok), 0, 'all clean passes');
  assert.strictEqual(run(Object.assign({}, ok, { FAILED_PAGES: '14' })), 1, '14 failing pages fail the job');
  assert.strictEqual(run(Object.assign({}, ok, { PYTEST_RC: '1' })), 1, 'a pytest failure fails the job');
  assert.strictEqual(run(Object.assign({}, ok, { FAILED_PAGES: '' })), 1, 'a missing count is not a pass');
  assert.strictEqual(run(Object.assign({}, ok, { NOT_SCANNED: '66' })), 1, 'unscanned pages are not a pass');
  assert.strictEqual(run(Object.assign({}, ok, { NOT_SCANNED: '' })), 1, 'a missing unscanned count is not a pass');
  assert.strictEqual(run(Object.assign({}, ok, { AUDIT_OUTCOME: 'failure' })), 1, 'an audit step that errored is not a pass');
});

fs.rmSync(dir, { recursive: true, force: true });
console.log(`\ncontrast-audit summary: ${passed} passed`);
