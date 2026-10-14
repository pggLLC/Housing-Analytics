'use strict';
// Real Chromium UI + share/JSON agreement, invented records only.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { routeInvented } = require('./helpers/deal-engine-page.cjs');
const fixture = require('./fixtures/loan-obligations/invented.json').cases;
const money = n => '$' + Math.round(n).toLocaleString('en-US');
async function run() {
  const bundled = chromium.executablePath();
  const browser = await chromium.launch({ headless:true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || (fs.existsSync(bundled) ? bundled : await require('puppeteer').executablePath()), args:['--no-sandbox'] });
  let views = 0;
  try {
    for (const width of [1280,390]) {
      const page = await browser.newPage({viewport:{width,height:900}});
      const errors=[]; page.on('pageerror',e=>errors.push(e.message));
      await routeInvented(page);
      await page.goto('http://example.org/deal-calculator.html',{waitUntil:'networkidle'});
      await page.selectOption('#dc-county-select','08001');
      await page.selectOption('#dc-senior-mode','entered');
      await page.fill('#dc-senior-amount','4000000');
      await page.fill('.dc-tr-amount','1000000');
      await page.fill('.dc-tr-rate','2');
      await page.fill('.dc-tr-term','35');
      await page.selectOption('.dc-tr-type','interest_only');
      await page.locator('#dc-soft-tranches details').evaluate(e=>{e.open=true;});
      await page.fill('.dc-tr-maturity','35');
      await page.uncheck('#dc-auto-noi');
      await page.fill('#dc-noi','360000');
      const inspect = async () => page.evaluate(() => {
        window.__DealCalc.recalculate();
        return {r:window.__DealCalc.getResult(),snapshot:window.__DealCalcShare.buildSnapshot(),
          senior:document.getElementById('dc-r-dscr-base').textContent,all:document.getElementById('dc-all-must-pay-dscr').textContent,
          mortgage:document.getElementById('dc-r-mortgage').textContent,notice:document.getElementById('dc-loan-coverage').textContent,
          scroll:document.documentElement.scrollWidth, viewport:innerWidth};
      });
      let v=await inspect();
      assert.equal(v.r.mortgage,4000000);
      assert.equal(v.senior,v.r.baseDSCR.toFixed(2)+'x'); assert.equal(v.all,v.r.allMustPayDSCR.toFixed(2)+'x');
      assert.equal(Number(v.r.allMustPayDSCR.toFixed(3)),fixture.enteredSenior.expected.all);
      assert.deepEqual(v.snapshot.loanObligations,v.r.obligations);
      assert.deepEqual(v.snapshot.debtCoverage,v.r.coverage);
      assert.equal(v.snapshot.outputs.allMustPayDebtService.value,v.r.allMustPayDebtService);
      const recipient=await browser.newPage(); await routeInvented(recipient);
      await recipient.goto(v.snapshot.url,{waitUntil:'networkidle'});
      await recipient.waitForFunction(()=>window.__DealCalc.getResult().totalLoanPrincipal===1000000 && window.__DealCalc.getResult().mortgage===4000000);
      const restored=await recipient.evaluate(()=>({r:window.__DealCalc.getResult(),tr:window.DealCalcSoftTranches()}));
      assert.equal(restored.r.allMustPayDSCR,v.r.allMustPayDSCR);
      assert.equal(restored.tr[0].loanType,'interest_only');assert.equal(restored.tr[0].maturity,35);
      await recipient.close();
      await page.check('#dc-auto-noi');
      await page.selectOption('.dc-tr-type','io_then_amortizing');
      await page.fill('.dc-tr-rate','4');await page.fill('.dc-tr-amount','2000000');await page.fill('.dc-tr-term','30');
      await page.fill('.dc-tr-maturity','15');await page.fill('.dc-tr-io','2');
      v=await inspect();
      assert.equal(v.r.obligations.loans[1].rows[0].due,80000);
      await page.locator('#pf-loans > details').evaluate(e=>{e.open=true;});
      const cells=await page.locator('#pf-loans table[data-loan-id="1"] tbody tr').nth(14).locator('td').allTextContents();
      assert.equal(cells[6],money(fixture.ioThenAmortize.expected.maturityDue));
      assert(v.notice.includes(String(v.r.coverage.weakestAllMustPay.year)));
      assert(v.scroll<=width+1,'no page overflow at '+width);
      const controls=await page.locator('#dc-soft-tranches input[type=number]').evaluateAll(els=>els.map(el=>({width:el.getBoundingClientRect().width,height:el.getBoundingClientRect().height})));
      assert(controls.length>=7 && controls.every(box=>box.width>=100 && box.height>=44),'loan amounts and terms remain readable at '+width);
      if (process.env.L1_SCREENSHOTS) {
        fs.mkdirSync(process.env.L1_SCREENSHOTS,{recursive:true});
        await page.evaluate(()=>{const note=document.createElement('p');note.textContent='INVENTED L1 SCREENING CASE — no real project data';note.style.cssText='background:white;color:black;padding:12px';document.querySelector('main').prepend(note);});
        await page.screenshot({path:path.join(process.env.L1_SCREENSHOTS,`loans-${width}.png`),fullPage:true});
        await page.locator('#pf-loans').screenshot({path:path.join(process.env.L1_SCREENSHOTS,`loan-schedule-${width}.png`)});
      }
      for (const [field,value] of [['#dc-dcr','0.9'],['#dc-rate','1']]) {
        await page.fill(field,value);v=await inspect();
        assert.equal(v.r.mortgage,null);assert(v.mortgage.includes(v.r.unavailable.mortgage));
        assert.equal(v.snapshot.outputs.firstMortgage.value,null);
        await page.fill(field,field==='#dc-dcr'?'1.2':'6.5');
      }
      await page.fill('.dc-tr-rate','');v=await inspect();
      assert.equal(v.r.obligations.loans,null);assert(v.r.obligations.unavailableReason);
      assert.deepEqual(errors,[]);
      views++; await page.close();
      console.log('loan-obligations-page: agreement at '+width+'px; entered senior, IO, maturity, share, absence, no overflow');
    }
  } finally {await browser.close();}
  assert.equal(views,2);
}
run().catch(e=>{console.error(e);process.exitCode=1;});
