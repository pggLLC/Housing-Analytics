// Guards for scripts/data-refresh-gate.mjs, the check a scheduled data job runs
// on its freshly fetched file before saving it (2026-11-11: a FRED refresh put
// a 13-month CPI change on the Economy page as year-over-year).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { findChecks, runGate, SKIP } from '../scripts/data-refresh-gate.mjs';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

// 1. Non-vacuous: the FRED gate finds the Economy page checks, and skips the
//    listed ones.
const fred = findChecks(root, 'data/fred-data.json');
assert.ok(fred.includes('test/econ-dash-accuracy.test.js'), 'FRED gate runs the Economy page accuracy check');
assert.ok(fred.includes('test/econ-dash-yoy-change.test.js'), 'FRED gate runs the year-over-year check');
assert.ok(fred.length >= 8, 'FRED gate finds the checks that read the file');
for (const f of Object.keys(SKIP)) {
  assert.ok(fs.existsSync(path.join(root, f)), 'SKIP names a missing test: ' + f);
  assert.ok(!fred.includes(f), 'skipped test is not run: ' + f);
}

// 2. The workflow runs the gate after validating and before its commit step.
const wf = fs.readFileSync(path.join(root, '.github/workflows/fetch-fred-data.yml'), 'utf8');
const gateAt = wf.indexOf('node scripts/data-refresh-gate.mjs data/fred-data.json');
assert.ok(gateAt > wf.indexOf('name: Validate output'), 'gate runs after the output is validated');
assert.ok(gateAt < wf.indexOf('name: Commit and push updated data'), 'gate runs before the commit step');
assert.ok(wf.indexOf('npm ci') > 0 && wf.indexOf('npm ci') < gateAt, 'dependencies are installed before the gate');

// 3. Behaviour, both ways, in a throwaway repo.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'refresh-gate-'));
const git = (...a) => execFileSync('git', a, { cwd: tmp, encoding: 'utf8' });
fs.mkdirSync(path.join(tmp, 'test'));
fs.mkdirSync(path.join(tmp, 'data'));
fs.writeFileSync(path.join(tmp, 'data/x.json'), JSON.stringify({ months: ['09', '10'] }));
fs.writeFileSync(path.join(tmp, 'test/x.test.js'),
  "const d = require('../data/x.json');\nif (d.months.length !== 2) { console.error('bad file'); process.exit(1); }\n");
fs.writeFileSync(path.join(tmp, 'test/other.test.js'), 'process.exit(1);\n');
git('init', '-q');
git('-c', 'user.email=t@t', '-c', 'user.name=t', 'add', '.');
git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'start');
const committed = fs.readFileSync(path.join(tmp, 'data/x.json'), 'utf8');
const quiet = () => {};

assert.deepEqual(findChecks(tmp, 'data/x.json'), ['test/x.test.js'], 'only the test that reads the file is run');

const good = JSON.stringify({ months: ['10', '11'] });
fs.writeFileSync(path.join(tmp, 'data/x.json'), good);
assert.equal(runGate(tmp, 'data/x.json', { log: quiet }), 0, 'a good file passes');
assert.equal(fs.readFileSync(path.join(tmp, 'data/x.json'), 'utf8'), good, 'a good file is kept for the commit step');

fs.writeFileSync(path.join(tmp, 'data/x.json'), JSON.stringify({ months: ['10'] }));
assert.equal(runGate(tmp, 'data/x.json', { log: quiet }), 1, 'a bad file fails the gate');
assert.equal(fs.readFileSync(path.join(tmp, 'data/x.json'), 'utf8'), committed, "a bad file is replaced by the committed version, so yesterday's data stays live");

assert.equal(runGate(tmp, 'data/none.json', { log: quiet }), 1, 'a file no check reads fails rather than passing an empty gate');

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`data refresh gate: passed (${fred.length} checks gate data/fred-data.json)`);
