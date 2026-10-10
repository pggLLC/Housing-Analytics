'use strict';
// #2118: recorded on main BEFORE extracting arithmetic. Only invented data.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright');
const sources = require('./fixtures/deal-engine/invented-sources.cjs');
const root = path.resolve(__dirname, '..');
const fixturePath = path.join(__dirname, 'fixtures/deal-engine/golden.json');
const record = process.argv.includes('--record');
const mime = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml', '.json': 'application/json' };
async function run() {
  // CI already installs Puppeteer's Chrome for its rendered audit tests.
  const explicit = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  const bundled = chromium.executablePath();
  const executablePath = explicit || (fs.existsSync(bundled) ? bundled : require('puppeteer').executablePath());
  const browser = await chromium.launch({ headless: true, executablePath, args: ['--no-sandbox'] });
  const result = { invented: true, capturedBeforeExtractionAt: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), scenarios: {} };
  try {
    for (const scenario of ['A', 'B', 'C']) {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/*', async route => {
        const u = new URL(route.request().url());
        if (u.origin !== 'http://invented.test') return route.abort();
        const rel = decodeURIComponent(u.pathname.slice(1));
        if (Object.hasOwn(sources, rel)) return route.fulfill({ json: sources[rel] });
        if (rel.startsWith('data/')) return route.fulfill({ status: 404, json: { unavailableReason: 'not_in_invented_fixture' } });
        const file = path.resolve(root, rel);
        if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return route.fulfill({ status: 404, body: '' });
        return route.fulfill({ body: fs.readFileSync(file), contentType: mime[path.extname(file)] || 'application/octet-stream' });
      });
      await page.goto('http://invented.test/deal-calculator.html', { waitUntil: 'networkidle' });
      await page.waitForFunction(() => [...document.querySelectorAll('#dc-county-select option')].some(o => o.value === '08001'));
      await page.selectOption('#dc-county-select', '08001');
      if (scenario === 'B') {
        await page.locator('.dc-tr-amount').fill('1000000');
        await page.locator('.dc-tr-rate').fill('3');
        await page.locator('.dc-tr-term').fill('30');
        await page.locator('#dc-soft-tranches details').evaluate(el => { el.open = true; });
        await page.locator('.dc-tr-cfpay').fill('0');
        await page.locator('.dc-tr-accrue').selectOption('accrued');
      }
      if (scenario === 'C') await page.locator('#dc-opex').fill('');
      // Recalculate after asynchronous county hydration has settled.
      await page.evaluate(() => window.__DealCalc.recalculate());
      await page.waitForTimeout(100);
      const captured = await page.evaluate(() => {
        const figures = {};
        document.querySelectorAll('[id^="dc-r-"], [id^="dc-su-"], [id^="dc-exit-"], #dc-noi-computed').forEach(el => {
          if (!el.matches('input, select, button, textarea')) figures[el.id] = el.textContent.trim();
        });
        figures.stressTable = [...document.querySelectorAll('#dc-dscr-stress-table tbody tr')].map(row => [...row.querySelectorAll('td')].slice(1).map(td => td.textContent.trim()));
        const fields = Object.fromEntries([...document.querySelectorAll('#dealCalcMount input[id], #dealCalcMount select[id], [id^="pf-"]')].map(el => [el.id, el.type === 'checkbox' || el.type === 'radio' ? el.checked : el.value]));
        return { figures, fields, tranches: window.DealCalcSoftTranches(), amiLimitsByBr: window.__DealCalc.getAmiLimitsByBr(), constants: window.__DealCalc._getConstants() };
      });
      assert.deepEqual(errors, [], 'real page has no uncaught errors');
      assert.equal(captured.fields['dc-tdc'], '20000000');
      assert.equal(captured.fields['dc-units'], '60');
      assert(Object.keys(captured.figures).length > 40, 'non-empty figure scan');
      assert(captured.figures.stressTable.length === 4, 'every stress scenario captured');
      assert(!captured.figures['dc-r-noi-stab'].includes('Unavailable'));
      if (scenario === 'B') assert(captured.figures['dc-su-impact-note'].includes('$50,592'), 'preserve the existing soft-loan payment even at 0% cash-flow pay');
      result.scenarios[scenario] = captured;
      console.log(`Golden ${scenario}: NOI ${captured.figures['dc-r-noi-stab']}, mortgage ${captured.figures['dc-r-mortgage']}, gap ${captured.figures['dc-su-gap']}; ${Object.keys(captured.figures).length} figures`);
      await page.close();
    }
  } finally { await browser.close(); }
  if (record) fs.writeFileSync(fixturePath, JSON.stringify(result, null, 2) + '\n');
  else {
    const expected = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
    for (const scenario of ['A', 'B', 'C']) assert.deepEqual(result.scenarios[scenario].figures, expected.scenarios[scenario].figures, `scenario ${scenario}: every displayed figure is unchanged`);
    console.log('deal-engine golden: PASS (all three invented scenarios, character-for-character)');
  }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
