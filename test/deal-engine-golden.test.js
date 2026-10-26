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
const { routeInvented } = require('./helpers/deal-engine-page.cjs');
async function run() {
  // CI already installs Puppeteer's Chrome for its rendered audit tests.
  const explicit = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  const bundled = chromium.executablePath();
  const executablePath = explicit || (fs.existsSync(bundled) ? bundled : await require('puppeteer').executablePath());
  const browser = await chromium.launch({ headless: true, executablePath, args: ['--no-sandbox'] });
  const result = { invented: true, capturedBeforeExtractionAt: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), scenarios: {} };
  try {
    for (const scenario of ['A', 'B', 'C']) {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await routeInvented(page);
      await page.goto('http://example.org/deal-calculator.html', { waitUntil: 'networkidle' });
      await page.waitForFunction(() => [...document.querySelectorAll('#dc-county-select option')].some(o => o.value === '08001'));
      await page.selectOption('#dc-county-select', '08001');
      if (scenario === 'B') {
        await page.locator('.dc-tr-amount').fill('1000000');
        await page.locator('.dc-tr-rate').fill('3');
        await page.locator('.dc-tr-term').fill('30');
        await page.locator('#dc-soft-tranches details').evaluate(el => { el.open = true; });
        await page.locator('.dc-tr-cfpay').fill('0');
        await page.locator('.dc-tr-type').selectOption('accrue_defer');
      }
      // A blank operating budget is unknown, never $0 of expenses.
      if (scenario === 'C') await page.evaluate(() => document.querySelectorAll('#dc-op-lines input[id^="dc-op-"]').forEach(i => { i.value = ''; }));
      // Recalculate after asynchronous county hydration has settled.
      await page.evaluate(() => window.__DealCalc.recalculate());
      await page.waitForTimeout(100);
      const captured = await page.evaluate(() => {
        const figures = {};
        document.querySelectorAll('[id^="dc-r-"], [id^="dc-su-"], [id^="dc-exit-"], #dc-noi-computed').forEach(el => {
          if (!el.matches('input, select, button, textarea')) figures[el.id] = el.textContent.trim();
        });
        figures.stressTable = [...document.querySelectorAll('#dc-dscr-stress-table tbody tr:not([data-scenario=base])')].map(row => [...row.querySelectorAll('td')].slice(1).map(td => td.textContent.trim()));
        const fields = Object.fromEntries([...document.querySelectorAll('#dealCalcMount input[id], #dealCalcMount select[id], [id^="pf-"]')].map(el => [el.id, el.type === 'checkbox' || el.type === 'radio' ? el.checked : el.value]));
        return { figures, fields, tranches: window.DealCalcSoftTranches(), amiLimitsByBr: window.__DealCalc.getAmiLimitsByBr(), constants: window.__DealCalc._getConstants() };
      });
      assert.deepEqual(errors, [], 'real page has no uncaught errors');
      assert.equal(captured.fields['dc-tdc'], '20000000');
      assert.equal(captured.fields['dc-units'], '60');
      assert(Object.keys(captured.figures).length > 40, 'non-empty figure scan');
      assert(captured.figures.stressTable.length === 4, 'every stress scenario captured');
      assert.equal(captured.figures['dc-r-noi-stab'].includes('Unavailable'), scenario === 'C');
      if (scenario === 'B') assert(captured.figures['dc-su-impact-note'].includes('$0/yr'), 'L1 accrued loan has no regular payment');
      if (!record) {
        const expected = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
        if (scenario !== 'C') assert.deepEqual(captured.figures, require('./helpers/deal-engine-p-expected.cjs')(scenario, require('./helpers/deal-engine-g-expected.cjs')(scenario, require('./helpers/deal-engine-b1-expected.cjs')(scenario, require('./helpers/deal-engine-l1-expected.cjs')(scenario, expected.scenarios[scenario].figures)))), `scenario ${scenario}: every displayed figure is unchanged`);
        else for (const id of ['dc-r-noi-stab', 'dc-r-mortgage', 'dc-su-gap', 'dc-exit-noi', 'dc-exit-resale']) assert(captured.figures[id].includes('Enter the operating budget'), id + ': C has the missing-cost reason');
        const contract = await page.evaluate(() => {
          const expected = window.__DealCalc.getResult();
          const copy = window.__DealCalc.getResult();
          copy.pricedRows[0].units = 999;
          copy.exit.nNoi = 1;
          let eventResult;
          document.addEventListener('deal-calc:updated', event => {
            eventResult = JSON.parse(JSON.stringify(event.detail.result));
            event.detail.result.pricedRows[0].units = 888;
          }, { once: true });
          window.__DealCalc.recalculate();
          return { expected, stored: window.__DealCalc.getResult(), eventResult };
        });
        assert.deepEqual(contract.stored, contract.expected, 'getResult and event detail cannot mutate the stored result');
        assert.deepEqual(contract.eventResult, contract.expected, 'updated event carries the same unrounded result');
      }
      result.scenarios[scenario] = captured;
      console.log(`Golden ${scenario}: NOI ${captured.figures['dc-r-noi-stab']}, mortgage ${captured.figures['dc-r-mortgage']}, gap ${captured.figures['dc-su-gap']}; ${Object.keys(captured.figures).length} figures`);
      await page.close();
    }
    if (!record) for (const name of ['deal-calculator.html', 'market-analysis.html']) {
      for (const width of [1280, 390]) {
        const page = await browser.newPage({ viewport: { width, height: 900 } });
        await routeInvented(page);
        await page.goto('http://example.org/' + name, { waitUntil: 'networkidle' });
        await page.waitForFunction(() => window.__DealCalc && window.__DealCalc.getResult());
        // Use the page's county control, never a private project's saved state.
        await page.selectOption('#dc-county-select', '08001');
        const view = await page.evaluate(() => {
          window.__DealCalc.recalculate();
          return { width: innerWidth, mortgage: document.getElementById('dc-r-mortgage').textContent,
            result: window.__DealCalc.getResult(), engine: typeof window.DealEngine.computeDeal };
        });
        assert.equal(view.width, width);
        assert.equal(view.engine, 'function');
        assert(view.result.mortgage > 0, name + ': calculator runs at ' + width + 'px');
        assert.equal(view.mortgage, '$' + Math.round(view.result.mortgage).toLocaleString('en-US'));
        console.log(`Chromium ${name} @ ${width}px: calculator mounted; result matches the screen`);
        await page.close();
      }
    }
  } finally { await browser.close(); }
  if (record) fs.writeFileSync(fixturePath, JSON.stringify(result, null, 2) + '\n');
  else {
    const expected = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
    for (const scenario of ['A', 'B']) assert.deepEqual(result.scenarios[scenario].figures, require('./helpers/deal-engine-p-expected.cjs')(scenario, require('./helpers/deal-engine-g-expected.cjs')(scenario, require('./helpers/deal-engine-b1-expected.cjs')(scenario, require('./helpers/deal-engine-l1-expected.cjs')(scenario, expected.scenarios[scenario].figures)))), `scenario ${scenario}: every displayed figure is unchanged`);
    console.log('deal-engine golden: PASS (invented A/B pinned with explicit L1 accrue-loan corrections; C blocks missing operating cost)');
  }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
