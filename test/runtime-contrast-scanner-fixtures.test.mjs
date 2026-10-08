#!/usr/bin/env node
// test/runtime-contrast-scanner-fixtures.test.mjs
//
// #2038 — the runtime contrast scanner passed 14 pages the per-page audit
// listed as failing. Three blind spots, each pinned here against a fixture in
// a real browser, using exactly the code the gate runs
// (scripts/audit/runtime-contrast-scan-fn.mjs):
//
//   1. An oklab() / color-mix() background parsed as null, so the text was
//      measured against an ancestor (the HNA jurisdiction banner).
//   2. A background with alpha <= 0.5 was skipped instead of composited, so a
//      10% tint behind its own colour was ignored ("Western Slope").
//   3. Text in an unopened tab panel is display:none at load and was never
//      measured at all (also "Western Slope": it sits in the Market Trends tab).
//
// Each failing fixture has a passing twin that differs only in the colour, so
// the test fails if the scanner stops catching the case AND if it starts
// flagging text that is fine. Exemptions (aria-hidden, disabled) are pinned
// the same way.
//
// Needs Chrome: runs in contrast-audit.yml's runtime-contrast-scan job, after
// the Puppeteer Chrome install. Locally, RUNTIME_CONTRAST_EXECUTABLE_PATH can
// point at any Chromium.
import assert from 'node:assert/strict';
import { SCANNER_FN, scanAllStates } from '../scripts/audit/runtime-contrast-scan-fn.mjs';

const puppeteer = (await import('puppeteer')).default;

const FIXTURE = `<!doctype html><html><head><style>
  body { background:#fff; color:#111; font:16px sans-serif; margin:0; padding:16px; }
  div, span, a, button, p { display:block; margin:6px 0; }
  .tab-panel[hidden] { display:none; }
</style></head><body>
  <p style="color:#999">PLAIN FAIL</p>
  <p style="color:#222">PLAIN PASS</p>

  <div style="background:color-mix(in oklab, #fff 60%, #096e65 40%);padding:8px">
    <a href="#" style="color:#096e65">OKLAB FAIL</a>
  </div>
  <div style="background:color-mix(in oklab, #fff 88%, #096e65 12%);padding:8px">
    <a href="#" style="color:#096e65">OKLAB PASS</a>
  </div>

  <span style="color:rgb(230,119,0);background:rgba(230,119,0,.1)">TINT FAIL</span>
  <span style="color:#a84608;background:rgba(230,119,0,.1)">TINT PASS</span>

  <div role="tablist">
    <button role="tab" id="t1" aria-selected="true" aria-controls="p1" style="color:#111">First</button>
    <button role="tab" id="t2" aria-selected="false" aria-controls="p2" style="color:#111">Second</button>
  </div>
  <div class="tab-panel" id="p1" role="tabpanel"><p style="color:#222">FIRST PANEL</p></div>
  <div class="tab-panel" id="p2" role="tabpanel" hidden>
    <p style="color:#e67700">TAB FAIL</p>
    <p style="color:#a84608">TAB PASS</p>
  </div>

  <p aria-hidden="true" style="color:#ccc">DECOR EXEMPT</p>
  <button disabled style="color:#ccc;background:#fff">DISABLED EXEMPT</button>

  <script>
    document.querySelectorAll('[role="tab"]').forEach(function (tab) {
      tab.addEventListener('click', function () {
        document.querySelectorAll('[role="tab"]').forEach(function (t) {
          var on = t === tab;
          t.setAttribute('aria-selected', on ? 'true' : 'false');
          document.getElementById(t.getAttribute('aria-controls')).hidden = !on;
        });
      });
    });
  </script>
</body></html>`;

const launchOptions = { headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] };
if (process.env.RUNTIME_CONTRAST_EXECUTABLE_PATH) launchOptions.executablePath = process.env.RUNTIME_CONTRAST_EXECUTABLE_PATH;

const browser = await puppeteer.launch(launchOptions);
let failed = 0;
const check = (name, fn) => {
  try { fn(); console.log('  ✓ ' + name); } catch (e) { failed++; console.log('  ✗ ' + name + '\n    ' + e.message.split('\n').join('\n    ')); }
};

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1000, height: 1200 });
  await page.setContent(FIXTURE, { waitUntil: 'load' });

  const asLoaded = await page.evaluate(SCANNER_FN);
  const all = await scanAllStates(page);
  const byText = new Map(all.map((f) => [f.text, f]));
  const texts = [...byText.keys()].sort();

  console.log('runtime-contrast-scanner-fixtures');
  console.log('  flagged: ' + texts.join(', '));

  // Non-vacuity: the scan found the plain failure the old scanner also caught.
  check('a plain rgb() failure is flagged (the scan ran and measured something)', () => {
    assert.ok(byText.has('PLAIN FAIL'), 'PLAIN FAIL not flagged');
  });
  check('an oklab()/color-mix() background is measured, not skipped', () => {
    const f = byText.get('OKLAB FAIL');
    assert.ok(f, 'OKLAB FAIL not flagged');
    assert.ok(f.ratio > 2.8 && f.ratio < 3.6, 'OKLAB FAIL ratio ' + f.ratio + ' is not the ~3.2:1 of the tint');
  });
  check('a 10% background is composited over what is behind it', () => {
    const f = byText.get('TINT FAIL');
    assert.ok(f, 'TINT FAIL not flagged');
    assert.ok(f.ratio < 3, 'TINT FAIL ratio ' + f.ratio + ' is not the ~2.7:1 of orange on its tint');
  });
  check('text in an unopened tab is measured after opening the tab', () => {
    assert.ok(!asLoaded.some((f) => f.text === 'TAB FAIL'), 'TAB FAIL was visible before the tab walk, so the fixture proves nothing');
    const f = byText.get('TAB FAIL');
    assert.ok(f, 'TAB FAIL not flagged');
    assert.equal(f.state, 'tab: Second');
  });
  check('each passing twin is not flagged', () => {
    for (const t of ['PLAIN PASS', 'OKLAB PASS', 'TINT PASS', 'TAB PASS', 'FIRST PANEL']) {
      assert.ok(!byText.has(t), t + ' flagged at ' + (byText.get(t) || {}).ratio);
    }
  });
  check('aria-hidden decoration and disabled controls are exempt (WCAG 1.4.3)', () => {
    assert.ok(!byText.has('DECOR EXEMPT'), 'aria-hidden text flagged');
    assert.ok(!byText.has('DISABLED EXEMPT'), 'disabled button flagged');
  });
  check('nothing else is flagged', () => {
    assert.deepEqual(texts, ['OKLAB FAIL', 'PLAIN FAIL', 'TAB FAIL', 'TINT FAIL']);
  });
} finally {
  await browser.close();
}

console.log('\nruntime-contrast-scanner-fixtures: ' + (failed ? 'FAIL' : 'PASS'));
process.exit(failed ? 1 : 0);
