'use strict';
// Site audit F2 (2026-10-31): four site/market scores of 90 with no deal run
// produced "90/A" and "Strongest: financial feasibility". paul chose
// (2026-10-31) to relabel only: the numbers stay, but site evidence is never
// called a financial result, never named strongest, and the grade is provisional.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const sandbox = { window: {}, console };
sandbox.window.window = sandbox.window;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(root, 'js/housing-outcome-score.js'), 'utf8'), sandbox);
const HOS = sandbox.window.HousingOutcomeScore;

const siteOnly = HOS.compute({ siteScore: 90, accessScore: 90, feasibilityScore: 90, marketScore: 90, dealConfidence: null, gapPct: null });
assert.equal(siteOnly.available, true, 'site-only evidence still scores: ' + siteOnly.unavailableReason);
assert.equal(siteOnly.dimensions.financialFeasibility.score, 90, 'number unchanged');
assert.equal(siteOnly.dimensions.financialFeasibility.evidence, 'site-only');
assert.equal(siteOnly.provisional, true, 'grade is provisional with no deal run');
assert.ok(!/Strongest: financial feasibility/.test(siteOnly.summary), 'site evidence is not named the strongest financial result: ' + siteOnly.summary);
assert.match(siteOnly.summary, /provisional: no deal run yet/);
assert.match(siteOnly.summary, /site evidence only, no deal run/);

const withDeal = HOS.compute({ siteScore: 90, accessScore: 90, feasibilityScore: 90, marketScore: 90, dealConfidence: 'high', gapPct: 2 });
assert.equal(withDeal.dimensions.financialFeasibility.evidence, 'deal');
assert.equal(withDeal.provisional, false, 'a deal run removes the provisional mark');
assert.ok(!/site evidence only/.test(withDeal.summary));

// Same composite either way when the financial number is the same: no weight change.
assert.deepEqual(HOS.WEIGHTS && Object.values(HOS.WEIGHTS).reduce((a, b) => a + b, 0).toFixed(2), '1.00');

const renderer = fs.readFileSync(path.join(root, 'js/components/hos-renderer.js'), 'utf8');
assert.match(renderer, /site evidence only, no deal run/, 'dimension row carries the label');
assert.match(renderer, /provisional, no deal run yet/, 'grade line carries the provisional mark');
console.log('housing-outcome-score-site-only-label: all checks passed');
