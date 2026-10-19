'use strict';
// #2158: real calculator, invented source records only, no project/local data.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { routeInvented } = require('./helpers/deal-engine-page.cjs');
const money = n => '$' + Math.round(n).toLocaleString('en-US');
const compact = n => n === 0 ? '$0' : (n < 0 ? '-$' : '$') + (Math.abs(n) >= 1e6 ? (Math.abs(n)/1e6).toFixed(2)+'M' : Math.abs(n) >= 1e3 ? (Math.abs(n)/1e3).toFixed(0)+'K' : Math.abs(n).toFixed(0));
const outputMap = {
  annualRents: ['annualRents', 'dc-r-rents'], stabilizedNoi: ['noi', 'dc-r-noi-stab'],
  firstMortgage: ['mortgage', 'dc-r-mortgage'], creditEquity: ['equity', 'dc-r-equity'],
  deferredDeveloperFee: ['deferredDevFee', 'dc-r-deferred'], fundingGap: ['gap', 'dc-su-gap'],
  totalDevelopmentCost: ['tdc', 'dc-su-tdc'], annualDebtService: ['annualDebtService', 'dc-r-ads']
};
function csvRecords(text) {
  const rows = text.trim().split('\r\n').map(line => [...line.matchAll(/"((?:""|[^"])*)"/g)].map(m => m[1].replace(/""/g, '"')));
  assert.deepEqual(rows.shift(), ['metric', 'value', 'display', 'unavailable_reason']);
  return Object.fromEntries(rows.map(row => [row[0], { value: row[1] === '' ? null : Number(row[1]), display: row[2], unavailableReason: row[3] || null }]));
}
async function capture(page) {
  return page.evaluate(() => {
    function text(id) {
      const el = document.getElementById(id); if (!el) return null;
      const copy = el.cloneNode(true); copy.querySelectorAll('.me-icon, .me-pop, .input-prov').forEach(n => n.remove());
      return copy.textContent.trim();
    }
    const ids = ['dc-r-rents','dc-r-noi-stab','dc-r-mortgage','dc-r-equity','dc-r-deferred','dc-su-gap','dc-su-tdc','dc-r-ads',
      'dc-stress-base-noi','dc-stress-base-dscr','dc-stress-base-margin','dc-wf-lp-equity-auto',
      'dc-exit-noi','dc-exit-resale','dc-exit-mortbal','dc-exit-softbal','dc-exit-net','dc-exit-defyr','dc-exit-irr',
      'pf-table-wrap','dcWaterfallTable','dcWaterfallAnnualTable','dc-dscr-manual-note','dc-stress-leaseup-impact','dc-adjust-guidance-list'];
    return { result: window.__DealCalc.getResult(), snapshot: window.__DealCalcShare.buildSnapshot(), csv: window.__DealCalcShare.buildCsv(),
      text: Object.fromEntries(ids.map(id => [id, text(id)])),
      reasons: Object.fromEntries(ids.map(id => [id, document.getElementById(id)?.dataset.unavailableReason])),
      projection: [...document.querySelectorAll('#pf-table-wrap tbody tr:first-child td')].map(n => n.textContent.trim()),
      projectionColumns: document.querySelectorAll('#pf-table-wrap thead th').length,
      waterfall: [...document.querySelectorAll('#dcWaterfallTable tbody tr')].map(n => n.querySelectorAll('td')[1].textContent.trim()),
      stackKey: [...document.querySelectorAll('#dcCapitalStackDiagram .dg-stack__key li')].map(n => n.textContent.trim()),
      ladder: [...document.querySelectorAll('#dcWaterfallLadder .dg-ladder__amt')].map(n => n.textContent.trim()),
      scroll: { viewport: innerWidth, document: document.documentElement.scrollWidth } };
  });
}
async function run() {
  const bundled = chromium.executablePath();
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || (fs.existsSync(bundled) ? bundled : await require('puppeteer').executablePath());
  const browser = await chromium.launch({ headless: true, executablePath, args: ['--no-sandbox'] });
  let surfaces = 0, comparisons = 0;
  try {
    for (const width of [1280, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const errors = []; page.on('pageerror', e => errors.push(e.message));
      await routeInvented(page);
      await page.goto('http://example.org/deal-calculator.html', { waitUntil: 'networkidle' });
      await page.selectOption('#dc-county-select', '08001');
      // Use 4% credits, a real soft-debt payment and manual deferred fee to expose
      // the former 9% fallback / empty-ID reads and omitted funding sources.
      await page.check('#dc-rate-4');
      await page.locator('.dc-tr-amount').fill('1000000');
      await page.locator('.dc-tr-rate').fill('3');
      await page.locator('.dc-tr-term').fill('30');
      await page.uncheck('#dc-deferred-auto-balance');
      await page.locator('#dc-exit-hold').fill('5');
      await page.evaluate(() => window.__DealCalc.recalculate());
      await page.waitForTimeout(250);
      let view = await capture(page), r = view.result;
      assert.equal(r.annualCredits, r.eligibleBasis * 0.04, '4% credit scenario actually applied');
      assert(r.totalLoanPrincipal > 0 && r.totalSoftDebtService > 0, 'soft source and service are non-zero');
      assert(r.projection && r.waterfall, 'all downstream views have engine records');
      const csv = csvRecords(view.csv);
      for (const [name, [key, id]] of Object.entries(outputMap)) {
        assert.equal(view.text[id], money(r[key]), id + ': summary reads result');
        assert.equal(view.snapshot.outputs[name].value, r[key], name + ': JSON unrounded value');
        assert.equal(view.snapshot.outputs[name].display, view.text[id], name + ': display beside value');
        assert.deepEqual(csv[name], view.snapshot.outputs[name], name + ': CSV = JSON');
        assert.deepEqual(view.snapshot.reportMeta.outputs[name], view.snapshot.outputs[name], name + ': report captured result');
        comparisons += 5;
      }
      for (const [column, key] of [[1,'annualRents'],[2,'annualOtherIncome'],[5,'annualOpex'],[6,'annualRepReserve'],[7,'netPropTax'],[8,'noi']]) {
        assert.equal(view.projection[column], money(r[key]), 'projection year 1 ' + key); comparisons++;
      }
      assert.equal(view.projection[9], money(r.annualDebtService + r.totalSoftDebtService), 'projection includes the engine soft debt service');
      assert.equal(view.projection[10], money(r.projection.rows[0].bridgeDebtService + r.projection.rows[0].assetMgmtFee), 'projection bridge and asset fee column reads the engine row');
      assert.equal(view.text['dc-stress-base-noi'], money(r.noi));
      assert.equal(view.text['dc-stress-base-dscr'], r.allMustPayDSCR.toFixed(2) + 'x');
      assert.equal(view.text['dc-stress-base-margin'], (r.stressBase.margin >= 0 ? '+' : '') + r.stressBase.margin.toFixed(2));
      assert.equal(r.waterfall.grossProceeds, r.exit.resale);
      assert.equal(r.waterfall.inputs.mortBal, r.exit.firstMortBal);
      assert.equal(r.waterfall.inputs.softBal, r.exit.softBal);
      assert.equal(r.waterfall.autoLpEquity, r.equity + r.stateEquity);
      assert.equal(r.waterfall.lpEquity, r.equity + r.stateEquity, 'LP contribution uses the actual 4% equity plus any state credit equity');
      assert(r.deferredDevFee > 0 && r.exit.dfYr === null, 'unpaid deferred fee is a non-zero test');
      const feePaidInHold = r.projection.rows.slice(0, r.exit.holdYears).reduce((a, x) => a + x.deferredFeePaid, 0);
      assert(feePaidInHold < r.deferredDevFee, 'part of the fee is still unpaid at exit');
      assert(Math.abs(r.waterfall.inputs.defFeeRemaining - (r.deferredDevFee - feePaidInHold)) < 0.01, 'the sale pays the fee operations left unpaid, not the whole fee again');
      assert.equal(view.text['dc-wf-lp-equity-auto'], compact(r.equity + r.stateEquity));
      for (let i = 0; i < r.waterfall.tiers.length; i++) assert.equal(view.waterfall[i], compact(r.waterfall.tiers[i].amount), 'waterfall tier ' + i);
      // The capital stack bar and the waterfall ladder draw the same figures.
      for (const [label, v] of [['First mortgage', r.mortgage], ['Federal credit equity', r.creditStack.federal],
        ['Soft funding', r.totalSoftSourceAmt], ['Deferred developer fee', r.deferredDevFee], ['Gap still to fill', r.gap]]) {
        assert(view.stackKey.some(t => t.startsWith(label + ' ' + compact(v))), 'capital stack shows ' + label + ' ' + compact(v) + ': ' + view.stackKey.join(' | '));
      }
      assert.equal(view.ladder.length, r.waterfall.tiers.length, 'one ladder step per waterfall tier');
      r.waterfall.tiers.forEach((t, i) => { if (t.amount > 0) assert.equal(view.ladder[i], compact(t.amount), 'ladder step ' + i); });
      assert.equal(r.fundingGap, Math.max(0, r.gap), 'guidance includes all Sources & Uses');
      assert(r.gap > 0 && view.text['dc-adjust-guidance-list'].includes(money(r.fundingGap)), 'guidance names the same remaining gap');
      surfaces += 7;
      assert(view.scroll.document <= view.scroll.viewport + 1, 'no page-level horizontal scroll at ' + width);
      if (process.env.DEAL_SURFACE_SCREENSHOTS) {
        fs.mkdirSync(process.env.DEAL_SURFACE_SCREENSHOTS, { recursive: true });
        await page.evaluate(() => {
          ['dcWaterfallDetails'].forEach(id => { document.getElementById(id).open = true; });
          const note = document.createElement('p'); note.textContent = 'TEST SCREEN — invented inputs and source records, FY2090';
          note.style.cssText = 'background:#fff;color:#111;padding:12px;font-weight:bold'; document.querySelector('main').prepend(note);
        });
        await page.screenshot({ path: path.join(process.env.DEAL_SURFACE_SCREENSHOTS, `calculator-${width}.png`), fullPage: true });
      }
      // Explicit manual deferred fee must not revive exit results when costs go missing.
      await page.uncheck('#dc-deferred-auto-balance');
      await page.evaluate(() => document.querySelectorAll('#dc-op-lines input[id^="dc-op-"]').forEach(i => { i.value = ''; }));
      await page.evaluate(() => window.__DealCalc.recalculate());
      view = await capture(page); r = view.result;
      const reason = r.unavailable.noi;
      assert(reason && r.noi === null && r.projection === null && r.waterfall === null);
      for (const id of ['dc-r-noi-stab','dc-r-mortgage','dc-su-gap','dc-r-ads','dc-exit-noi','dc-exit-resale','dc-exit-net','dc-exit-defyr','dc-exit-irr',
        'pf-table-wrap','dcWaterfallTable','dcWaterfallAnnualTable','dc-dscr-manual-note','dc-stress-leaseup-impact','dc-adjust-guidance-list']) {
        assert(view.text[id].includes(reason), id + ': same unavailable reason');
        assert(!view.text[id].includes('$0'), id + ': absence is not a dollar zero'); comparisons++;
      }
      // A list may own only list items (axe "list"); the unavailable reason used
      // to be written straight into the guidance <ul> as bare text.
      const badLists = await page.evaluate(() => [...document.querySelectorAll('ul, ol, [role="list"]')]
        .filter(l => [...l.childNodes].some(n => (n.nodeType === 3 && n.textContent.trim()) ||
          (n.nodeType === 1 && !['LI', 'SCRIPT', 'TEMPLATE'].includes(n.tagName) && n.getAttribute('role') !== 'listitem')))
        .map(l => l.id || l.className || l.tagName));
      assert.deepEqual(badLists, [], 'every list owns only list items in the unavailable state');
      for (const name of ['stabilizedNoi','firstMortgage','annualDebtService','fundingGap','exitNoi','resaleValue','netExitProceeds']) {
        assert.equal(view.snapshot.outputs[name].value, null, name + ': JSON absence');
        assert.equal(view.snapshot.outputs[name].unavailableReason, reason);
        assert.deepEqual(csvRecords(view.csv)[name], view.snapshot.outputs[name]); comparisons++;
      }
      const explanation = view.snapshot.reportMeta.methodology.find(figure => figure.key === 'funding-gap');
      assert(explanation && explanation.withYourNumbers.result === null, 'report explanation also stays absent');
      assert.equal(explanation.withYourNumbers.unavailableReason, reason);
      assert.equal(view.snapshot.outputs.annualRents.value, r.annualRents, 'independent known rents survive');
      await page.evaluate(() => { const ob = window.DealOperatingBudget; ob.LINE_TEMPLATE.forEach(t => { document.getElementById('dc-op-' + t.id).value = ob.EXAMPLE_BUDGET[t.id]; }); });
      await page.evaluate(() => window.__DealCalc.recalculate());
      view = await capture(page);
      assert(view.result.noi > 0 && view.projectionColumns > 0 && view.projection.length === view.projectionColumns, 'restoring costs restores projection (a full row under every column header)');
      assert.equal(view.reasons['dcWaterfallTable'], undefined, 'old unavailable state cleared');
      await page.locator('#pf-rent-growth').fill('');
      await page.evaluate(() => window.__DealCalc.recalculate());
      view = await capture(page);
      const growthReason = view.result.unavailable['exit.nNoi'];
      assert(growthReason && view.result.exit.nNoi === null);
      for (const id of ['dc-exit-noi', 'dc-exit-resale', 'pf-table-wrap', 'dcWaterfallTable']) {
        assert(view.text[id].includes(growthReason), id + ': missing growth uses the engine reason'); comparisons++;
      }
      assert.equal(view.snapshot.outputs.exitNoi.unavailableReason, growthReason);
      await page.locator('#pf-rent-growth').fill('2');
      await page.selectOption('#dc-rent-limit-regime', 'ami_formula');
      await page.evaluate(() => window.__DealCalc.recalculate());
      view = await capture(page);
      assert.equal(view.snapshot.outputs.creditEquity.value, view.result.equity);
      assert.equal(view.snapshot.outputs.creditEquity.display, view.text['dc-r-equity'], 'export retains the non-CHFA explanation');
      assert.equal(view.result.waterfall.lpMultiple, null, 'no LP contribution has no cash multiple');
      assert(view.text.dcWaterfallTable.includes(view.result.unavailable['waterfall.lpMultiple']), 'unavailable LP ratio carries the engine reason');
      assert.deepEqual(errors, [], 'real page has no uncaught errors');
      console.log(`Agreement @ ${width}px: summary / projection / stress / waterfall / JSON / CSV / report; blank operating cost blocks all dependents; no page overflow`);
      await page.close();
    }
  } finally { await browser.close(); }
  assert.equal(surfaces, 14, 'all seven named surfaces at both widths');
  assert(comparisons >= 100, 'non-vacuous numeric and absence comparisons');
  console.log(`deal-engine-surfaces: PASS (${surfaces} surface checks, ${comparisons} value/reason comparisons; invented data only)`);
}
run().catch(error => { console.error(error); process.exitCode = 1; });
