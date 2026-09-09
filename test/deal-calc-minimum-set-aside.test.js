'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const root = path.resolve(__dirname, '..');
const shareSource = fs.readFileSync(path.join(root, 'js/deal-calculator-share.js'), 'utf8');

function makeDom() {
  const dom = new JSDOM('<!doctype html><body><div id="dealCalcMount"></div></body>', {
    url: 'http://127.0.0.1/deal-calculator.html',
  });
  global.document = dom.window.document;
  global.window = dom.window;
  global.HTMLElement = dom.window.HTMLElement;
  global.Event = dom.window.Event;
  global.CustomEvent = dom.window.CustomEvent;
  window.DealCalculatorMath = require('../js/deal-calculator-math.js');
  return dom;
}

const bands = [20, 30, 40, 50, 60, 70, 80, 100, 110, 120];
makeDom();
delete require.cache[require.resolve('../js/deal-calculator.js')];
require('../js/deal-calculator.js');
const dc = window.__DealCalc;

assert.equal(dc.DEFAULT_MINIMUM_SET_ASIDE_ELECTION, '40-60', '40-60 remains the default election');
for (const election of ['20-50', '40-60']) {
  for (const pct of bands) {
    assert.equal(
      dc.isLihtcCreditEligiblePct(pct, election),
      pct <= 60,
      `${election}: ${pct}% eligibility follows the federal credit ceiling`,
    );
  }
}
for (const pct of bands) {
  assert.equal(
    dc.isLihtcCreditEligiblePct(pct, 'average-income'),
    pct <= 80,
    `AIT: ${pct}% eligibility stops at 80%`,
  );
}
for (const pct of [100, 110, 120]) {
  for (const election of ['20-50', '40-60', 'average-income']) {
    assert.equal(dc.isLihtcCreditEligiblePct(pct, election), false, `${pct}% stays ineligible under ${election}`);
  }
}

const twentyFifty = dc.evaluateMinimumSetAside('20-50', 100, { 50: 20, 60: 80 });
assert.equal(twentyFifty.qualifies, true, '20-50 election tests its minimum using units at 50% or below');
assert.equal(twentyFifty.countedLihtcUnits, 100, '20-50 can still count designated units through 60% toward basis');

const aitPass = dc.evaluateMinimumSetAside('average-income', 40, { 40: 20, 80: 20 });
assert.equal(aitPass.averageAmiPct, 60, 'AIT average is unit-weighted across the designated group');
assert.equal(aitPass.qualifies, true, 'AIT qualifies at an average of exactly 60% with all units designated');
assert.equal(aitPass.countedLihtcUnits, 40, 'qualifying AIT units count toward applicable fraction');

const aitAverageFail = dc.evaluateMinimumSetAside('average-income', 40, { 70: 20, 80: 20 });
assert.equal(aitAverageFail.averageAmiPct, 75, 'failing AIT average is still displayed from the entered mix');
assert.equal(aitAverageFail.qualifies, false, 'AIT average above 60% does not qualify');
assert.equal(aitAverageFail.countedLihtcUnits, 0, 'failed AIT units do not reach qualified basis');
assert.match(aitAverageFail.reason, /average exceeds 60% AMI/, 'failed AIT carries the reason');

const aitChfaFail = dc.evaluateMinimumSetAside('average-income', 60, { 40: 40 });
assert.equal(aitChfaFail.minimumShareMet, true, 'federal 40% share can pass independently');
assert.equal(aitChfaFail.chfaAllUnitsMet, false, 'CHFA all-residential-units restriction is enforced separately');
assert.equal(aitChfaFail.countedLihtcUnits, 0, 'a CHFA-ineligible AIT mix is not credited');

dc.renderForTest(document.getElementById('dealCalcMount'));
assert.equal(document.getElementById('dc-minimum-set-aside').value, '40-60', 'rendered default is 40-60');
assert.equal(document.getElementById('dc-units-20').value, '0', 'new 20% tier defaults to zero units');
assert.equal(document.getElementById('dc-r-basis').textContent, '$16,000,000', 'default qualified-basis output is byte-identical to current main');

const election = document.getElementById('dc-minimum-set-aside');
election.value = 'average-income';
for (const pct of bands) {
  document.getElementById('dc-chk-' + pct).checked = false;
  document.getElementById('dc-units-' + pct).value = '0';
}
for (const [pct, count] of [[70, 20], [80, 20]]) {
  document.getElementById('dc-chk-' + pct).checked = true;
  document.getElementById('dc-units-' + pct).value = String(count);
}
document.getElementById('dc-units').value = '40';
dc.recalculate();
const failedStatus = document.getElementById('dc-minimum-set-aside-status').textContent;
assert.match(failedStatus, /Does not qualify/, 'rendered AIT failure is explicit');
assert.match(failedStatus, /75\.0% AMI/, 'rendered AIT failure shows the computed average');
assert.match(failedStatus, /No units are counted toward qualified basis/, 'rendered AIT failure explains the arithmetic consequence');
assert.equal(document.getElementById('dc-r-basis').textContent, '$0', 'failed AIT contributes no qualified basis');
assert(!document.getElementById('dc-ami-label-70').textContent.includes('does not model'), 'AIT label no longer claims income averaging is unmodeled');

assert(shareSource.includes("'dc-minimum-set-aside'"), 'the election persists through the established share-URL input list');
assert(shareSource.includes("'dc-units-20'"), 'the new 20% designation persists with the other unit tiers');

async function assertShareRoundTrip() {
  const shareDom = new JSDOM(`<!doctype html><body>
    <select id="dc-minimum-set-aside">
      <option value="20-50">20-50</option>
      <option value="40-60">40-60</option>
      <option value="average-income">Average Income Test</option>
    </select>
  </body>`, {
    url: 'http://127.0.0.1/deal-calculator.html?minimum-set-aside=average-income',
    runScripts: 'outside-only',
  });
  let copiedUrl = '';
  Object.defineProperty(shareDom.window.navigator, 'clipboard', {
    configurable: true,
    value: { writeText: (url) => { copiedUrl = url; return Promise.resolve(); } },
  });
  shareDom.window.eval(shareSource);
  shareDom.window.document.dispatchEvent(new shareDom.window.Event('DOMContentLoaded'));
  await new Promise((resolve) => shareDom.window.setTimeout(resolve, 425));

  const sharedElection = shareDom.window.document.getElementById('dc-minimum-set-aside');
  assert.equal(sharedElection.value, 'average-income', 'share URL hydrates the selected election');
  sharedElection.value = '20-50';
  shareDom.window.__DealCalcShare.copyLink();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.match(copiedUrl, /minimum-set-aside=20-50/, 'copied share URL serializes the selected election');
  shareDom.window.close();
}

assertShareRoundTrip().then(() => {
  console.log('deal-calc-minimum-set-aside: PASS');
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
