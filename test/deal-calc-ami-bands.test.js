'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const root = path.join(__dirname, '..');
const dcSrc = fs.readFileSync(path.join(root, 'js', 'deal-calculator.js'), 'utf8');
const shareSrc = fs.readFileSync(path.join(root, 'js', 'deal-calculator-share.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'deal-calculator.html'), 'utf8');
const hudData = JSON.parse(fs.readFileSync(path.join(root, 'data', 'hud-fmr-income-limits.json'), 'utf8'));

const EXPECTED_BANDS = [30, 40, 50, 60, 70, 80, 100, 110, 120];

function dollarsToNumber(text) {
  return Number(String(text || '').replace(/[^0-9.-]/g, ''));
}

function assertIncludes(haystack, needle, message) {
  assert(haystack.includes(needle), message + ' - missing "' + needle + '"');
}

function makeDom() {
  const dom = new JSDOM('<!DOCTYPE html><body><div id="dealCalcMount"></div></body>', {
    url: 'http://127.0.0.1/deal-calculator.html'
  });
  global.document = dom.window.document;
  global.window = dom.window;
  global.HTMLElement = dom.window.HTMLElement;
  global.Event = dom.window.Event;
  global.CustomEvent = dom.window.CustomEvent;
  window.DealCalculatorMath = require('../js/deal-calculator-math.js');
  return dom;
}

function buildRentLimits() {
  const flat = {};
  const byBr = {};
  EXPECTED_BANDS.forEach((pct) => {
    const rent = 1000 + (pct * 10);
    flat[pct] = rent;
    byBr[pct] = {
      studio: rent,
      '1br': rent,
      '2br': rent,
      '3br': rent,
      '4br': rent
    };
  });
  return { flat, byBr };
}

function setInput(id, value) {
  const el = document.getElementById(id);
  assert(el, id + ' renders');
  el.value = String(value);
}

function setChecked(id, checked) {
  const el = document.getElementById(id);
  assert(el, id + ' renders');
  el.checked = !!checked;
}

function readOutputs() {
  return {
    rents: dollarsToNumber(document.getElementById('dc-r-rents').textContent),
    basis: dollarsToNumber(document.getElementById('dc-r-basis').textContent),
    credits: dollarsToNumber(document.getElementById('dc-r-credits').textContent)
  };
}

async function main() {
  console.log('\nDeal Calculator 110%/120% AMI band tests');
  console.log('='.repeat(52));

  assertIncludes(dcSrc, 'var DEAL_AMI_BANDS = [30, 40, 50, 60, 70, 80, 100, 110, 120]', 'central AMI band list guard');
  assertIncludes(dcSrc, '110% and 120% AMI are middle-income planning bands', 'middle-income methodology disclosure');
  assertIncludes(dcSrc, 'not LIHTC-credit-eligible', 'credit-ineligibility label disclosure');
  assertIncludes(shareSrc, "'dc-units-110'", '110% units share key');
  assertIncludes(shareSrc, "'dc-chk-120'", '120% enabled share key');
  assertIncludes(shareSrc, "'dc-br-120'", '120% bedroom share key');
  assertIncludes(html, '[30, 40, 50, 60, 70, 80, 100, 110, 120].reduce', 'JSON export band-list guard');

  let dom = makeDom();
  window.safeFetchJSON = function (assetPath) {
    assert.strictEqual(assetPath, 'data/hud-fmr-income-limits.json', 'HudFmr loads the committed county income-limit file');
    return Promise.resolve(hudData);
  };
  require('../js/data-connectors/hud-fmr.js');
  await window.HudFmr.load();
  assert.strictEqual(window.HudFmr.getGrossRentLimit('08031', 110), 3413, 'Denver County 110% AMI gross rent spot value');
  assert.strictEqual(window.HudFmr.getGrossRentLimit('08031', 120), 3723, 'Denver County 120% AMI gross rent spot value');

  delete require.cache[require.resolve('../js/deal-calculator.js')];
  dom = makeDom();
  require('../js/deal-calculator.js');
  document.dispatchEvent(new Event('DOMContentLoaded', { bubbles: true }));

  const dc = window.__DealCalc;
  assert.deepStrictEqual(dc.getAmiBands(), EXPECTED_BANDS, 'runtime AMI bands expose all nine tiers');
  assert.strictEqual(dc.isLihtcCreditEligiblePct(100), false, '100% AMI is not LIHTC-credit-eligible');
  assert.strictEqual(dc.isLihtcCreditEligiblePct(110), false, '110% AMI is not LIHTC-credit-eligible');
  assert.strictEqual(dc.isLihtcCreditEligiblePct(120), false, '120% AMI is not LIHTC-credit-eligible');

  EXPECTED_BANDS.forEach((pct) => {
    assert(document.getElementById('dc-chk-' + pct), pct + '% AMI checkbox renders');
    assert(document.getElementById('dc-units-' + pct), pct + '% AMI unit input renders');
    assert(document.getElementById('dc-br-' + pct), pct + '% AMI bedroom selector renders');
  });
  assert(document.body.textContent.includes('110% AMI'), '110% AMI rendered label');
  assert(document.body.textContent.includes('120% AMI'), '120% AMI rendered label');
  assert(document.body.textContent.includes('middle-income: CHFA MIHTC/TOC + Prop 123'), 'middle-income program label rendered');

  const rentLimits = buildRentLimits();
  dc._setAmiLimitsForTest(rentLimits.flat, rentLimits.byBr, '08031');
  setInput('dc-tdc', 20000000);
  setInput('dc-units', 70);
  setInput('dc-basis-pct', 80);
  setInput('dc-equity-price', 0.86);
  EXPECTED_BANDS.forEach((pct) => {
    if (pct > 60) {
      setChecked('dc-chk-' + pct, false);
      setInput('dc-units-' + pct, 0);
    }
  });
  dc.recalculate();
  const baseline = readOutputs();

  setChecked('dc-chk-120', true);
  setInput('dc-units-120', 10);
  dc.recalculate();
  const with120 = readOutputs();

  assert(with120.rents > baseline.rents, '120% AMI row contributes rent/income');
  assert(with120.basis < baseline.basis, '120% AMI row stays outside LIHTC basis and lowers applicable fraction');
  assert(with120.credits < baseline.credits, '120% AMI row stays outside federal LIHTC credits');

  console.log('All Deal Calculator AMI band tests passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
