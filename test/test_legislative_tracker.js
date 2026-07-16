/**
 * test/test_legislative_tracker.js
 * Unit tests for js/legislative-tracker.js
 *
 * Usage:
 *   node test/test_legislative_tracker.js
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const root = path.resolve(__dirname, '..');
const tracker = require(path.join(root, 'js', 'legislative-tracker'));
const legislation = require(path.join(root, 'data', 'policy', 'tax-credit-legislation.json'));

let passed = 0;
let failed = 0;
const pending = [];

function check(condition, message) {
  if (condition) {
    console.log('  PASS: ' + message);
    passed++;
  } else {
    console.error('  FAIL: ' + message);
    failed++;
  }
}

function test(name, fn) {
  console.log('\n[test] ' + name);
  try {
    const result = fn();
    if (result && typeof result.then === 'function') {
      pending.push(result.catch((err) => {
        console.error('  FAIL: threw unexpected async error - ' + err.message);
        failed++;
      }));
    }
  } catch (err) {
    console.error('  FAIL: threw unexpected error - ' + err.message);
    failed++;
  }
}

test('module exports the stable tracker API plus JSON loaders', () => {
  check(typeof tracker.getAllBills === 'function', 'getAllBills exported');
  check(typeof tracker.getBill === 'function', 'getBill exported');
  check(typeof tracker.getBillsByTag === 'function', 'getBillsByTag exported');
  check(typeof tracker.getMarketImpactSummary === 'function', 'getMarketImpactSummary exported');
  check(typeof tracker.getCraTractTargeting === 'function', 'getCraTractTargeting exported');
  check(typeof tracker.getLegislativeTimeline === 'function', 'getLegislativeTimeline exported');
  check(typeof tracker.setLegislationData === 'function', 'setLegislationData exported');
  check(typeof tracker.loadLegislationData === 'function', 'loadLegislationData exported');
  check(typeof tracker.STAGES === 'object', 'STAGES exported');
  check(Array.isArray(tracker.STAGE_ORDER), 'STAGE_ORDER is an array');
});

test('embedded bill database was removed', () => {
  tracker.setLegislationData({ entries: [] });
  check(Array.isArray(tracker.getAllBills()), 'getAllBills returns an array');
  check(tracker.getAllBills().length === 0, 'empty JSON yields zero bills');
  check(tracker.getBill('HR6644') === null, 'stale HR6644 fixture is not embedded');
});

test('real legislation JSON populates computed tracker records', () => {
  const bills = tracker.setLegislationData(legislation);
  check(bills.length === legislation.entries.length, 'all JSON entries loaded');
  bills.forEach((bill) => {
    check(typeof bill.id === 'string' && bill.id.length > 0, bill.id + ': id present');
    check(typeof bill.title === 'string' && bill.title.length > 0, bill.id + ': title present');
    check(typeof bill.stage === 'string', bill.id + ': stage present');
    check(typeof bill.stageProgress === 'number', bill.id + ': stageProgress computed');
    check(bill.stageProgress >= 0 && bill.stageProgress <= 100, bill.id + ': stageProgress bounded');
    check(typeof bill.passageProbability === 'number', bill.id + ': passageProbability computed');
    check(bill.passageProbability >= 0 && bill.passageProbability <= 100, bill.id + ': passageProbability bounded');
    check(typeof bill.combinedImpactScore === 'number', bill.id + ': combinedImpactScore computed');
    check(bill.combinedImpactScore >= 0 && bill.combinedImpactScore <= 10, bill.id + ': combinedImpactScore bounded');
    check(Array.isArray(bill.tags), bill.id + ': tags array present');
  });
});

test('expected policy entries and tags are available from real JSON', () => {
  tracker.setLegislationData(legislation);
  const lihtc = tracker.getBillsByTag('LIHTC');
  const cra = tracker.getBillsByTag('CRA');
  const nhia = tracker.getBill('nhia-119th-congress');
  const phasedOut = tracker.getBill('obbba-25c-25d-termination');
  const windSolar = tracker.getBill('obbba-45y-48e-wind-solar-deadlines');
  check(lihtc.length >= 2, 'LIHTC-tagged entries loaded');
  check(cra.length >= 1, 'CRA-tagged entries loaded');
  check(nhia && nhia.stage === tracker.STAGES.COMMITTEE, 'NHIA proposed entry maps to committee stage');
  check(phasedOut && phasedOut.stage === tracker.STAGES.SIGNED, 'phased-out enacted-law entry does not map to failed stage');
  check(windSolar && windSolar.status === 'enacted' && windSolar.stage === tracker.STAGES.SIGNED, '45Y/48E entry maps to enacted law');
});

test('market summary reflects loaded JSON and stays bounded', () => {
  tracker.setLegislationData(legislation);
  const summary = tracker.getMarketImpactSummary();
  check(summary.activeBillCount > 0, 'activeBillCount is positive');
  check(summary.weightedLihtcImpactScore >= 0 && summary.weightedLihtcImpactScore <= 100, 'LIHTC score bounded');
  check(summary.weightedCraImpactScore >= 0 && summary.weightedCraImpactScore <= 100, 'CRA score bounded');
  check(Array.isArray(summary.keyLihtcProvisions), 'LIHTC provisions array present');
  check(Array.isArray(summary.keyCraProvisions), 'CRA provisions array present');
});

test('loadLegislationData consumes a fetch-compatible JSON response', async () => {
  tracker.setLegislationData({ entries: [] });
  const bills = await tracker.loadLegislationData('http://127.0.0.1/tax-credit-legislation.json', () => Promise.resolve({
    ok: true,
    json: () => Promise.resolve(legislation)
  }));
  check(bills.length === legislation.entries.length, 'fetch-loaded entries populate tracker');
});

test('housing legislation page renders watchlist statuses without passage heuristics', async () => {
  const html = fs.readFileSync(path.join(root, 'housing-legislation-2026.html'), 'utf8');
  const trackerSrc = fs.readFileSync(path.join(root, 'js', 'legislative-tracker.js'), 'utf8');
  const dom = new JSDOM(html, {
    url: 'http://127.0.0.1/housing-legislation-2026.html',
    runScripts: 'outside-only'
  });
  const inlineScript = Array.from(dom.window.document.querySelectorAll('script:not([src])'))
    .map((node) => node.textContent)
    .find((script) => script.includes('loadLegislationData') && script.includes('renderBills'));
  assert(inlineScript, 'page render script found');
  const { window } = dom;
  window.fetch = () => Promise.resolve({
    ok: true,
    json: () => Promise.resolve(legislation)
  });
  window.eval(trackerSrc);
  window.eval(inlineScript);
  window.document.dispatchEvent(new window.Event('DOMContentLoaded', { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 0));

  const rendered = window.document.getElementById('bill-status-cards').innerHTML;
  check(rendered.includes('obbba-25c-25d-termination'), 'phased-out entry rendered');
  check(rendered.includes('Phased-out'), 'phased-out status pill rendered');
  check(rendered.includes('obbba-45y-48e-wind-solar-deadlines'), '45Y/48E entry rendered');
  check(rendered.includes('Enacted'), 'enacted status pill rendered');
  check(!rendered.includes('Failed'), 'rendered watchlist never labels enacted/phased-out entries as Failed');
  check(!rendered.includes('% passage'), 'rendered watchlist never shows passage percentages');
  check(!rendered.includes('role="progressbar"'), 'rendered watchlist has no progress bars');
});

test('CRA tract targeting remains available', () => {
  ['lmi', 'distressed', 'rural', 'opportunity_zone', 'non_lmi'].forEach((type) => {
    const targeting = tracker.getCraTractTargeting(type);
    check(targeting !== null, type + ': targeting is not null');
    check(typeof targeting.label === 'string', type + ': label is string');
    check(typeof targeting.craWeight === 'string', type + ': craWeight is string');
  });
  check(tracker.getCraTractTargeting('unknown_tract_type_xyz') === null, 'unknown tract returns null');
});

Promise.all(pending).then(() => {
  console.log('\n' + '-'.repeat(60));
  console.log('Results: ' + passed + ' passed, ' + failed + ' failed');
  if (failed > 0) process.exit(1);
});
