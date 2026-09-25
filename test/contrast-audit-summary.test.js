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

fs.rmSync(dir, { recursive: true, force: true });
console.log(`\ncontrast-audit summary: ${passed} passed`);
