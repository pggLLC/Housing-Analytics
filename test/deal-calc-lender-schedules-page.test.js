'use strict';
// The lender schedules panel on the real Deal Calculator page, with invented sources only.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright');
const { routeInvented } = require('./helpers/deal-engine-page.cjs');
const shots = process.env.LS_SCREENSHOTS || null;
async function run() {
  const explicit = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  const bundled = chromium.executablePath();
  const executablePath = explicit || (fs.existsSync(bundled) ? bundled : await require('puppeteer').executablePath());
  const browser = await chromium.launch({ headless: true, executablePath, args: ['--no-sandbox'] });
  try {
    for (const name of ['deal-calculator.html', 'market-analysis.html']) for (const width of [1280, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const errors = []; page.on('pageerror', e => errors.push(e.message));
      await routeInvented(page);
      await page.goto('http://example.org/' + name, { waitUntil: 'networkidle' });
      await page.waitForFunction(() => window.__DealCalc && window.__DealCalc.getResult());
      await page.selectOption('#dc-county-select', '08001');
      assert.equal(await page.locator('#dc-ls-panel').count(), 1, name + ': one panel');
      // Before a construction loan is entered, the draw schedule says what it needs.
      await page.evaluate(() => window.__DealCalc.recalculate());
      assert.match(await page.locator('#dc-ls-draw-out').textContent(), /construction loan/i);
      assert.match(await page.locator('#dc-ls-minimums-out').textContent(), /Vacancy/);
      // Invented construction loan and pay-in.
      for (const [id, v] of [['dc-constr-loan', '12000000'], ['dc-constr-rate', '7'], ['dc-constr-months', '24'],
        ['dc-fed-payin-closing', '20'], ['dc-fed-payin-completion', '40'], ['dc-fed-payin-stabilization', '40'],
        ['dc-pf-mgmt-pct', '6'], ['dc-pf-capital-needs', '10:300000'], ['dc-after-refi-rate', '6'], ['dc-after-taxes', '500000']]) {
        // Some of these sit in closed panels, so set them as the page's own saved state would.
        await page.evaluate(([i, val]) => { const el = document.getElementById(i); el.value = val; el.dispatchEvent(new Event('input', { bubbles: true })); }, [id, v]);
      }
      await page.evaluate(() => { document.querySelectorAll('#dc-ls-panel details').forEach(d => { d.open = true; }); window.__DealCalc.recalculate(); });
      await page.waitForTimeout(100);
      const r = await page.evaluate(() => window.__DealCalc.getResult().schedules);
      assert.equal(r.draw.reason, null, name + ': draw schedule built');
      assert(r.draw.tie.ties);
      const text = await page.locator('#dc-ls-panel').innerText();
      assert.match(text, /Peak construction loan/); assert.match(text, /Stress tests over 15 years/); assert.match(text, /minimum price/i);
      assert(text.includes('$' + Math.round(r.draw.peakBalance).toLocaleString('en-US')), 'the screen shows the engine figure');
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      assert(overflow <= 1, name + ' @' + width + ': no sideways scroll (' + overflow + 'px)');
      const small = await page.evaluate(() => [...document.querySelectorAll('#dc-ls-panel input, #dc-ls-panel select, #dc-ls-panel summary')]
        .filter(el => el.offsetParent && el.getBoundingClientRect().height < 43.5).map(el => el.id || el.textContent.trim().slice(0, 30)));
      assert.deepEqual(small, [], 'every control is at least 44px tall');
      assert.deepEqual(errors, [], 'no page errors');
      if (shots) await page.locator('#dc-ls-panel').screenshot({ path: shots + '/' + name.replace('.html', '') + '-' + width + '.png' });
      console.log('lender schedules: ' + name + ' @ ' + width + 'px PASS');
      await page.close();
    }
  } finally { await browser.close(); }
}
run().catch(e => { console.error(e); process.exitCode = 1; });
