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
for (const [election, ceiling] of [['20-50', 50], ['40-60', 60]]) {
  for (const pct of bands) {
    assert.equal(
      dc.isLihtcCreditEligiblePct(pct, election),
      pct <= ceiling,
      `${election}: ${pct}% eligibility follows the election's income limit (26 U.S.C. 42(g)(1), 42(i)(3)(A))`,
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
assert.equal(twentyFifty.countedLihtcUnits, 20, '20-50 counts only units at 50% AMI or below toward basis (26 U.S.C. 42(i)(3)(A))');
assert.equal(dc.evaluateMinimumSetAside('40-60', 100, { 50: 20, 60: 80 }).countedLihtcUnits, 100, '40-60 counts the same mix through 60%');

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
// The page fetches the underwriting rules; load the real file the same way.
dc.setCostRules(JSON.parse(fs.readFileSync(path.join(root, 'data/policy/lihtc-underwriting-rules.json'), 'utf8')));
assert.equal(document.getElementById('dc-minimum-set-aside').value, '40-60', 'rendered default is 40-60');
assert.equal(document.getElementById('dc-units-20').value, '0', 'new 20% tier defaults to zero units');
// #2160: the default qualified basis is the invented example budget's cost in
// basis (every default unit is restricted, so the applicable fraction is 1).
{
  const costBasis = require('../js/deal-cost-basis.js');
  const eligible = costBasis.summarizeCosts(costBasis.exampleLines(), +document.getElementById('dc-tdc').value).eligible;
  assert.equal(document.getElementById('dc-r-basis').textContent, '$' + Math.round(eligible).toLocaleString('en-US'), 'default qualified basis is the example budget cost in basis');
}

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


async function assertShareRoundTrip() {
  const shareDom = new JSDOM(`<!doctype html><body>
    <select id="dc-minimum-set-aside">
      <option value="20-50">20-50</option>
      <option value="40-60">40-60</option>
      <option value="average-income">Average Income Test</option>
    </select>
    <input id="dc-units-20" type="number" value="0">
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

  // The share list is read from the page (deal-calculator-share.js), so the
  // check is that these page inputs are in it, not that a string is in a file.
  const keys = Array.from(shareDom.window.__DealCalcShare.shareKeys());
  assert(keys.includes('dc-minimum-set-aside'), 'the election is a share-URL input');
  assert(keys.includes('dc-units-20'), 'the 20% designation is a share-URL input');
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
