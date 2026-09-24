'use strict';

// #1815 — the ownership panel spans three actors (resident, developer/operator,
// public interest) plus the bridge between the first two. Every output row must
// say whose money it describes, and the public interest must be on the panel,
// not only inside the resale comparison table.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const root = path.join(__dirname, '..');
const developerFunding = JSON.parse(fs.readFileSync(path.join(root, 'data', 'policy', 'developer-ownership-funding.json'), 'utf8'));
const resaleConventions = JSON.parse(fs.readFileSync(path.join(root, 'data', 'policy', 'resale-conventions.json'), 'utf8'));
const layoutCss = fs.readFileSync(path.join(root, 'css', 'layout.css'), 'utf8');

console.log('\nDeal Calculator ownership panel: actor labels (#1815)');
console.log('='.repeat(62));

const dom = new JSDOM('<!DOCTYPE html><body><div id="dealCalcMount"></div></body>', {
  url: 'http://127.0.0.1/deal-calculator.html'
});
global.document = dom.window.document;
global.window = dom.window;
global.HTMLElement = dom.window.HTMLElement;
global.Event = dom.window.Event;

window.DealCalculatorMath = require('../js/deal-calculator-math.js');
require('../js/hna/hna-ownership-need.js');
require('../js/hna/ownership-resale.js');
require('../js/deal-calculator.js');
document.dispatchEvent(new Event('DOMContentLoaded', { bubbles: true }));

const ACTORS = ['resident', 'developer', 'bridge', 'public'];
const EXPECTED = {
  'dc-own-cost-per-unit': 'developer',
  'dc-own-cost-per-sf': 'developer',
  'dc-own-max-price': 'resident',
  'dc-own-gap-per-unit': 'bridge',
  'dc-own-total-gap': 'bridge',
  'dc-own-public-recovery': 'public',
};

const rows = document.getElementById('dc-own-rows');
assert(rows, 'ownership output rows render');
const dds = Array.from(rows.querySelectorAll('dd'));
assert.strictEqual(dds.length, Object.keys(EXPECTED).length, 'every ownership output row is covered by the expectation table');
dds.forEach((dd) => {
  const dt = dd.previousElementSibling;
  assert(dt && dt.tagName === 'DT', dd.id + ' has a term');
  const actor = dt.getAttribute('data-actor');
  assert(ACTORS.includes(actor), dd.id + ' names an actor from the fixed set (got ' + actor + ')');
  assert.strictEqual(actor, EXPECTED[dd.id], dd.id + ' is attributed to ' + EXPECTED[dd.id]);
  const pill = dt.querySelector('.dc-own-actor');
  assert(pill && pill.getAttribute('data-actor') === actor, dd.id + ' shows a visible actor label matching its attribute');
  assert(pill.textContent.trim().length > 0, dd.id + ' actor label is not empty');
});
assert(/Resident/.test(document.getElementById('dc-own-max-price').previousElementSibling.textContent), 'max sale price row visibly says Resident');
assert(/Developer/.test(document.getElementById('dc-own-cost-per-unit').previousElementSibling.textContent), 'cost row visibly says Developer');
assert(/developer cost − resident capacity/.test(document.getElementById('dc-own-gap-per-unit').previousElementSibling.textContent), 'gap row states the bridge formula in actor terms');

const legend = document.getElementById('dc-own-actor-legend');
assert(legend, 'actor legend renders');
['Resident', 'Developer / operator', 'Bridge', 'Public interest'].forEach((name) => {
  assert(legend.textContent.includes(name), 'legend defines ' + name);
});
assert(/\.dc-own-actor\s*\{/.test(layoutCss), 'actor pill has a stylesheet rule');

// Section surfaces carry the actor too.
assert.strictEqual(document.getElementById('dc-own-funding-stack').getAttribute('data-actor'), 'developer', 'funding stack is the developer side');
assert.strictEqual(document.getElementById('dc-own-resale-screen').getAttribute('data-actor'), 'public', 'resale screen carries the public interest');
const resaleYears = document.getElementById('dc-own-resale-years');
assert.strictEqual(resaleYears.closest('[data-actor]').getAttribute('data-actor'), 'resident', 'resale equity inputs are the resident over time');

// The public interest row is populated from the selected mechanism.
const dc = window.__DealCalc;
const ownershipMode = document.getElementById('dc-mode-ownership');
ownershipMode.checked = true;
ownershipMode.dispatchEvent(new Event('change', { bubbles: true }));

const result = dc.computeForSaleFeasibility({
  tdc: 20000000,
  units: 40,
  ami4Person: 100000,
  targetAmiPct: 0.80,
  developerFundingPrograms: developerFunding,
  resaleConventions,
  resaleHoldingYears: 10,
  resaleRemainingPrincipal: 0,
  resaleSellingCosts: 0,
});
assert.strictEqual(result.status, 'ok', 'fixture computes');
dc.renderForSaleFeasibility(result);

const publicCell = document.getElementById('dc-own-public-recovery');
const conventionLabel = document.getElementById('dc-own-public-convention');
const comparison = result.ownershipResale.comparison;
const selected = comparison.rows.find((r) => r.conventionId === comparison.selectedConventionId) || comparison.rows.find((r) => !r.disabled);
const moderateIdx = comparison.scenarios.findIndex((s) => s.id === 'moderate');
const outcome = selected.outcomes[moderateIdx];
assert(outcome && outcome.maxResalePrice != null, 'fixture yields a resale cap for the selected mechanism');
assert.strictEqual(conventionLabel.textContent, selected.label, 'public row names the selected mechanism');
const expectedCap = '$' + Math.round(outcome.maxResalePrice).toLocaleString('en-US');
assert(publicCell.textContent.includes(expectedCap), 'public row shows the capped next-buyer price (' + expectedCap + '); got "' + publicCell.textContent + '"');
assert(/subsidy recovered|no cash recovery/.test(publicCell.textContent), 'public row states whether the public recovers cash');

// Gap note names both banks of the bridge.
assert(/developer cost per unit minus the resident/.test(document.getElementById('dc-own-note').textContent), 'gap note names developer cost and resident capacity');

// Without a resale price the public row is honest about being absent.
dc.renderForSaleFeasibility({ status: 'missing-ami' });
assert.strictEqual(publicCell.textContent, '—', 'public row clears when feasibility is unavailable');

console.log('  ✓ every ownership output row names its actor; public interest is on the panel');
console.log('\nAll tests passed');
