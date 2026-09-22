#!/usr/bin/env node
// test/runtime-contrast-scanner-errors.test.mjs
//
// #1819 — the runtime DOM contrast scanner's error paths, driven with a fake
// puppeteer so no Chrome is needed. The fake models what actually happened on
// 2026-09-22: a renderer that dies on one page-mode and STAYS dead for every
// later navigation on the same tab. The scanner must (1) recycle the tab so
// the remaining pages still get scanned, (2) exit non-zero because an
// unscanned page is not a pass, and (3) stop after three consecutive errors
// instead of running to the job cap.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCANNER = join(ROOT, 'scripts', 'audit', 'runtime-contrast-scanner.mjs');

const FAKE_PUPPETEER = `
// Fake puppeteer. DEAD_ON = comma-separated "page.html:mode" that kill the
// renderer; once dead, every later goto on that tab throws too (that is the
// real failure shape). A fresh tab from newPage() is healthy again.
import { appendFileSync } from 'node:fs';
const deadOn = new Set((process.env.DEAD_ON || '').split(',').filter(Boolean));
const log = (line) => appendFileSync(process.env.FAKE_LOG, line + '\\n');
let mode = 'light';
export default {
  async launch() {
    log('launch');
    return {
      async newPage() {
        log('newPage');
        let dead = false; let current = '';
        return {
          async setViewport() {},
          async goto(url) {
            if (dead) throw new Error('Navigation timeout of 30000 ms exceeded');
            current = url.split('/').pop();
          },
          async evaluate(fn, arg) {
            if (typeof fn === 'function') { mode = arg; return; }   // the class toggle
            if (deadOn.has(current + ':' + mode)) { dead = true; throw new Error("Runtime.callFunctionOn timed out."); }
            return [];                                              // SCANNER_FN: no failures
          },
          async close() { log('page.close'); },
        };
      },
      async close() { log('browser.close'); },
      async version() { return 'fake'; },
    };
  },
};
`;

function runScanner(deadOn) {
  const dir = mkdtempSync(join(tmpdir(), 'contrast-scanner-'));
  for (const p of ['a.html', 'b.html', 'c.html', 'd.html']) writeFileSync(join(dir, p), '<html></html>');
  const fake = join(dir, 'fake-puppeteer.mjs');
  writeFileSync(fake, FAKE_PUPPETEER);
  const log = join(dir, 'fake.log');
  writeFileSync(log, '');
  const r = spawnSync(process.execPath, [SCANNER], {
    cwd: dir,
    env: { ...process.env, RUNTIME_CONTRAST_PUPPETEER: fake, RUNTIME_CONTRAST_NO_SERVER: '1', DEAD_ON: deadOn, FAKE_LOG: log },
    encoding: 'utf8',
  });
  const reportDir = join(dir, 'audit-report', 'runtime-contrast');
  const reportFile = readdirSync(reportDir).find((f) => f.startsWith('report-'));
  return {
    status: r.status,
    out: r.stdout + r.stderr,
    log: readFileSync(log, 'utf8').trim().split('\n'),
    report: JSON.parse(readFileSync(join(reportDir, reportFile), 'utf8')),
  };
}

let failures = 0;
function run(name, fn) {
  try { fn(); console.log('  ✓ ' + name); }
  catch (err) { failures += 1; console.error('  ✗ ' + name + '\n    ' + err.message); }
}

console.log('runtime-contrast-scanner-errors');

run('healthy run: every page-mode scanned, exit 0, one tab', () => {
  const r = runScanner('');
  assert.equal(r.status, 0, r.out);
  assert.equal(r.log.filter((l) => l === 'newPage').length, 1);
  assert.match(r.out, /Mode-scans: 8 /);
  assert.match(r.out, /Scan errors: 0/);
});

run('one dead renderer costs one scan, not the rest of the run', () => {
  const r = runScanner('b.html:dark');
  // b.html [dark] errored; the tab was recycled; c and d still scanned on the new tab.
  assert.deepEqual(r.report['b.html'].dark, { error: 'Runtime.callFunctionOn timed out.' });
  assert.deepEqual(r.report['c.html'], { light: [], dark: [] }, 'c.html must be scanned after the recycle');
  assert.deepEqual(r.report['d.html'], { light: [], dark: [] }, 'd.html must be scanned after the recycle');
  assert.equal(r.log.filter((l) => l === 'newPage').length, 2, 'exactly one recycle');
  assert.equal(r.log.filter((l) => l === 'page.close').length, 1, 'the dead tab is closed');
  assert.match(r.out, /Mode-scans: 7 /);
});

run('an unscanned page is not a pass: any scan error exits non-zero', () => {
  const r = runScanner('b.html:dark');
  assert.equal(r.status, 1, 'exit code must be 1 even with zero contrast failures');
  assert.match(r.out, /1 page-mode scan\(s\) could not be completed/);
  assert.match(r.out, /Scan errors: 1/);
});

run('three consecutive errors abort the run instead of running to the job cap', () => {
  // Every dark scan dies: a [dark] errors, tab recycled; b [dark] errors … but
  // a [light]/b [light] succeed in between, so consecutive resets. Make every
  // page-mode die to model a broken environment.
  const r = runScanner(['a.html:light', 'a.html:dark', 'b.html:light', 'b.html:dark', 'c.html:light', 'c.html:dark', 'd.html:light', 'd.html:dark'].join(','));
  assert.equal(r.status, 1);
  assert.match(r.out, /Aborted after 3 consecutive scan errors/);
  assert.match(r.out, /Scan errors: 3/, 'stopped at three, not eight');
  assert.equal(r.report['c.html'], undefined, 'no scans attempted past the abort');
  assert.equal(r.log.filter((l) => l === 'browser.close').length, 1, 'browser is closed on abort');
});

if (failures) { console.error('runtime-contrast-scanner-errors: FAIL'); process.exitCode = 1; }
else console.log('runtime-contrast-scanner-errors: PASS');
