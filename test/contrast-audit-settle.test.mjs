#!/usr/bin/env node
/**
 * The per-page contrast audit (scripts/contrast-audit/run.js) measures a page
 * once it has settled, measures what is actually rendered, and gives the same
 * answer every time.
 *
 * ── What was wrong (2026-09-28) ──
 *
 * The "WCAG 2.1 AA Accessibility & Contrast Audit" PR comment reported
 * housing-legislation-2026.html (#2014) and economic-dashboard.html (#2016)
 * failing on PRs that never touched them; the next run passed them. Both
 * reproduced on unchanged main, about one run in twelve. Three defects:
 *
 *   1. The scan ran at DOMContentLoaded — the moment js/navigation.js injects
 *      the header and requests css/navigation.css without blocking. What it
 *      measured depended on whether that stylesheet, and js/contrast-guard.js's
 *      three passes over the nav, had happened yet.
 *   2. A translucent background (rgba(9,110,101,.1), a near-white wash) was
 *      measured as solid teal, and a color-mix() background — which computes
 *      to oklab() — was not parsed at all and so skipped.
 *   3. The scan root was querySelector('main, header, footer'): always the
 *      injected nav header, so nothing in <main> was ever checked.
 *
 * Every fixture here fails against the old script. Needs Chromium, so it runs
 * in contrast-audit.yml, which installs it, not in the ci-checks chain.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RUN_JS = path.join(ROOT, 'scripts/contrast-audit/run.js');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'contrast-settle-'));

const page = (body, head = '') =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>fixture</title>${head}</head>` +
  `<body style="background:#fff;margin:0">${body}</body></html>`;

// A header ahead of <main>, the way navigation.js leaves every real page.
const HEADER = '<header><p style="color:#111">Site header</p></header>';

const FIXTURES = {
  // Defect 3: the failure is in <main>, behind a passing header.
  'low-contrast-in-main.html': page(HEADER +
    '<main><p id="bad" style="color:#bbb">Deliberately low-contrast body text</p></main>'),

  // Defect 2: link blue on a 10% teal wash renders on near-white. It passes.
  // In the <header>, which the old scan did cover, so the old script's
  // opaque-teal reading (1.17:1) fails this and the check is not vacuous.
  'translucent-wash.html': page(
    '<header><span style="color:#005a9c;background:rgba(9,110,101,.1)">Link blue on a pale wash</span></header><main></main>'),

  // Defect 2: the same blue on the old active-nav color-mix() is 3.79:1.
  'color-mix-bg.html': page(HEADER +
    '<main><p style="color:#005a9c;background:color-mix(in oklab, #fff 60%, #096e65 40%)">On a color-mix wash</p></main>'),

  // Defect 1: low contrast only until a slow stylesheet lands. Settled: passes.
  // In the <header> for the same reason: the old script scanned it at
  // DOMContentLoaded, caught the grey, and failed this.
  'transient-failure.html': page(
    '<header><span class="late" style="color:#ccc">Grey until the stylesheet arrives</span></header><main></main>' +
    '<script>document.addEventListener("DOMContentLoaded",function(){var l=document.createElement("link");' +
    'l.rel="stylesheet";l.href="slow.css";document.head.appendChild(l);});</script>'),

  // Defect 1, the other way round: fine at load, broken 1.2 s later. Fails.
  'late-regression.html': page(HEADER +
    '<main><p id="late" style="color:#111">Readable at first</p></main>' +
    '<script>setTimeout(function(){document.getElementById("late").style.color="#c8c8c8";},1200);</script>'),

  // #2038: an inactive control is exempt (WCAG 1.4.3), an active one is not.
  // Same grey label on both, so the active one keeps the check non-vacuous.
  'disabled-control.html': page(HEADER +
    '<main><button disabled style="color:#bbb;background:#fff">Not available yet</button>' +
    '<button style="color:#bbb;background:#fff">Available now</button></main>'),

  // A page whose colours never stop changing is not a pass and not a fail.
  'never-settles.html': page(HEADER +
    '<main><p id="blink" style="color:#111">Flickers forever</p></main>' +
    '<script>var d=0;setInterval(function(){d^=1;document.getElementById("blink").style.color=d?"#222":"#111";},150);</script>'),
};

/* Serves the repo, plus the fixtures, with the stylesheets a slow runner
 * would be slow on delayed by a random amount per request. */
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  const send = (type, body) => { res.writeHead(200, { 'content-type': type }); res.end(body); };
  if (url.startsWith('/__fixtures__/')) {
    const name = url.slice('/__fixtures__/'.length);
    if (name === 'slow.css') return setTimeout(() => send('text/css', '.late{color:#111 !important}'), 800);
    if (FIXTURES[name]) return send('text/html', FIXTURES[name]);
  }
  const file = path.join(ROOT, url);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); return res.end();
  }
  const ext = path.extname(file);
  const type = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json',
    '.svg': 'image/svg+xml' }[ext] || 'application/octet-stream';
  const delay = /\/css\/(navigation|mobile-nav)\.css$/.test(url) ? Math.random() * 1500 : 0;
  setTimeout(() => send(type, fs.readFileSync(file)), delay);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = 'http://127.0.0.1:' + server.address().port;

let n = 0;
function audit(pagePath, env = {}) {
  const out = path.join(TMP, `r${n++}.json`);
  return new Promise((resolve, reject) => {
    // Async spawn: the server above lives in this process's event loop.
    const child = spawn(process.execPath, [RUN_JS], {
      env: { ...process.env, CONTRAST_BASE_URL: BASE, CONTRAST_PAGE: pagePath,
             CONTRAST_REPORT_FILE: out, ...env },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let err = '';
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', reject);
    child.on('close', () => {
      if (!fs.existsSync(out)) return reject(new Error('no report for ' + pagePath + ': ' + err));
      resolve(JSON.parse(fs.readFileSync(out, 'utf8')).pages[0]);
    });
  });
}
const key = (p) => p.error ? 'error' : JSON.stringify(p.violations.map((v) => [v.tag, v.text, v.fg, v.bg_effective, v.ratio]));

const failures = [];
async function check(name, fn) {
  try { await fn(); console.log('  ok  ' + name); }
  catch (e) { failures.push(name); console.log('  FAIL ' + name + '\n       ' + e.message.split('\n').join('\n       ')); }
}

try {
  await check('low-contrast text in <main> fails, behind a passing header', async () => {
    const p = await audit('__fixtures__/low-contrast-in-main.html');
    assert.equal(p.error, undefined, p.error);
    assert.ok(p.violations.some((v) => v.text === 'Deliberately low-contrast body text'),
      'the deliberate violation was not reported: ' + key(p));
  });

  await check('text on a translucent wash is measured on the composited colour, and passes', async () => {
    const p = await audit('__fixtures__/translucent-wash.html');
    assert.equal(p.error, undefined, p.error);
    assert.deepEqual(p.violations, [], 'reported: ' + key(p));
  });

  await check('a color-mix() background is read (it computes to oklab), and the 3.79:1 pair fails', async () => {
    const p = await audit('__fixtures__/color-mix-bg.html');
    const v = p.violations.find((x) => x.text === 'On a color-mix wash');
    assert.ok(v, 'not reported: ' + key(p));
    assert.ok(Math.abs(v.ratio - 3.79) < 0.05, 'ratio ' + v.ratio);
  });

  await check('a failure that exists only before a slow stylesheet loads is not reported', async () => {
    const p = await audit('__fixtures__/transient-failure.html');
    assert.equal(p.error, undefined, p.error);
    assert.deepEqual(p.violations, [], 'measured before the page settled: ' + key(p));
  });

  await check('a regression that appears after load is reported', async () => {
    const p = await audit('__fixtures__/late-regression.html');
    assert.ok(p.violations.some((v) => v.text === 'Readable at first'), 'measured too early: ' + key(p));
  });

  await check('a disabled control is exempt; the same label on an active one fails', async () => {
    const p = await audit('__fixtures__/disabled-control.html');
    assert.equal(p.error, undefined, p.error);
    assert.ok(p.violations.some((v) => v.text === 'Available now'), 'active control not reported: ' + key(p));
    assert.ok(!p.violations.some((v) => v.text === 'Not available yet'), 'disabled control reported: ' + key(p));
  });

  await check('a page that never settles is reported as not scanned, never as a pass', async () => {
    const p = await audit('__fixtures__/never-settles.html', { CONTRAST_SETTLE_TIMEOUT_MS: '3000' });
    assert.match(String(p.error), /did not settle/);
  });

  // The two pages from the report, under a jittery stylesheet delay that is
  // harsher than CI's. Asserted identical to each other, not to a count, so a
  // real regression on either page does not break this test — it shows up in
  // the audit, where it belongs.
  for (const real of ['economic-dashboard.html', 'housing-legislation-2026.html']) {
    await check(real + ' gives the same result on every run', async () => {
      const runs = [];
      for (let i = 0; i < 3; i++) runs.push(key(await audit(real)));
      assert.ok(runs[0] !== 'error', 'not scanned');
      assert.deepEqual(runs, [runs[0], runs[0], runs[0]]);
    });
  }
} finally {
  server.close();
  fs.rmSync(TMP, { recursive: true, force: true });
}

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed.`);
  process.exit(1);
}
console.log('\ncontrast-audit settle: all checks passed');
