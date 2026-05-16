'use strict';
/**
 * test/hna-deep-dive-batch1.test.js
 *
 * Regression for 2026-05-16 HNA deep-dive batch 1. The user reported a
 * laundry list of broken or missing UI on housing-needs-assessment.html.
 * This file locks down the five that were unambiguous bugs with clear
 * fixes — leaving zombie / unimplemented features for a follow-up.
 *
 * Bugs in scope:
 *   1. rentBurden30Plus() summed legacy 2022 codes (DP04_0145PE +
 *      DP04_0146PE) that don't exist in the 2023 vintage cache,
 *      so the Executive Snapshot "Rent burdened (≥30%)" stat read "—".
 *   2. computeIncomeNeeded(profile) was called with the whole profile,
 *      but the helper takes a scalar home value and returns an OBJECT;
 *      then renderSnapshot tried to fmtMoney() the object. Stat read "—".
 *   3. LIHTC map markers built by divIcon(<span class="lihtc-dot">)
 *      had no CSS — span rendered zero-width, dots were invisible.
 *   4. Bridge Statewide Context card sat on "Loading statewide data…"
 *      forever when summary.statewide was missing because the renderer
 *      had no else branch.
 *   5. Methodology & Data Sources ULs (.method-list) had no CSS — the
 *      default UA bullet indent pushed markers outside the card.
 *
 * What this test asserts (source-grep only — see hna-rent-burden-bins
 * test for the precedent and rationale):
 *   - rentBurden30Plus() now reads DP04_0141PE / DP04_0142PE
 *   - renderSnapshot's incomeNeeded call passes a home-value scalar
 *     and reads .annualIncome from the result
 *   - css/site-theme.css carries non-zero-size .lihtc-marker .lihtc-dot
 *   - css/site-theme.css carries a .method-section .method-list padding
 *   - housing-needs-assessment.html's bridgeStatewideCard has an else
 *     branch (no longer ONLY renders when summary.statewide is truthy)
 *
 * Run: node test/hna-deep-dive-batch1.test.js
 */

const fs   = require('fs');
const path = require('path');

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { console.log('  ✅ PASS:', msg); passed++; }
  else       { console.error('  ❌ FAIL:', msg); failed++; }
}

const root  = path.join(__dirname, '..');
const utils = fs.readFileSync(path.join(root, 'js/hna/hna-utils.js'), 'utf8');
const rend  = fs.readFileSync(path.join(root, 'js/hna/hna-renderers.js'), 'utf8');
const theme = fs.readFileSync(path.join(root, 'css/site-theme.css'), 'utf8');
const html  = fs.readFileSync(path.join(root, 'housing-needs-assessment.html'), 'utf8');

console.log('\n[test] #1 rentBurden30Plus reads ACS 2023 PE codes');
const rbMatch = utils.match(/function rentBurden30Plus\(pcts\)\s*\{([\s\S]*?)\n\s*\}/);
assert(rbMatch != null, 'rentBurden30Plus() body found');
if (rbMatch) {
  // Strip // line-comments so the "no longer referenced" checks only
  // see executable code, not the historical-context comment that
  // names the legacy codes.
  const body = rbMatch[1].replace(/\/\/[^\n]*/g, '');
  assert(/DP04_0141PE/.test(body), 'reads DP04_0141PE (30-34.9% bin, 2023)');
  assert(/DP04_0142PE/.test(body), 'reads DP04_0142PE (35%+ bin, 2023)');
  assert(!/DP04_0145PE/.test(body), 'legacy DP04_0145PE no longer referenced in executable code');
  assert(!/DP04_0146PE/.test(body), 'legacy DP04_0146PE no longer referenced in executable code');
}

console.log('\n[test] #2 renderSnapshot passes home value, reads .annualIncome');
// The snapshot block we patched uses homeVal (the DP04_0089E value
// captured a few lines earlier) and pulls annualIncome off the result.
const incBlock = rend.match(/computeIncomeNeeded\([\s\S]{0,40}\)\s*[\s\S]{0,200}annualIncome/);
assert(incBlock != null,
  'snapshot block calls computeIncomeNeeded then accesses .annualIncome');
assert(/computeIncomeNeeded\(homeVal\)/.test(rend),
  'computeIncomeNeeded receives homeVal (scalar), not the whole profile');

console.log('\n[test] #3 .lihtc-marker .lihtc-dot has non-zero width + height');
const lihtcDot = theme.match(/\.lihtc-marker\s+\.lihtc-dot\s*\{([\s\S]*?)\}/);
assert(lihtcDot != null, '.lihtc-marker .lihtc-dot block exists');
if (lihtcDot) {
  const body = lihtcDot[1];
  assert(/width\s*:\s*\d+px/.test(body), 'sets an explicit width');
  assert(/height\s*:\s*\d+px/.test(body), 'sets an explicit height');
  assert(/border-radius\s*:\s*50%/.test(body), 'rounded — matches the legend swatch');
}

console.log('\n[test] #4 bridgeStatewideCard finalizes even when summary.statewide is missing');
// Match the renderer slice — must have an else branch for the swEl block.
const swBlock = html.match(/\/\/ ── Statewide card ──[\s\S]{0,1200}else\s*\{[\s\S]{0,400}bridgeStatewideCard|bridgeStatewideCard[\s\S]{0,1500}?\bif\s*\(summary\.statewide\)[\s\S]{0,1500}\belse\s*\{/);
assert(swBlock != null,
  'Statewide card has an else-branch (finalizes when statewide rollup missing)');
assert(/Statewide rollup pending/.test(html),
  'else-branch shows "Statewide rollup pending" text instead of "Loading…"');

console.log('\n[test] #5 .method-list has a padding to keep bullets inside the card');
const methodList = theme.match(/\.method-section\s+\.method-list\s*\{([\s\S]*?)\}/);
assert(methodList != null, '.method-section .method-list block exists');
if (methodList) {
  const body = methodList[1];
  assert(/padding-left\s*:/.test(body),
    'padding-left set so default UA indent does not push bullets outside the card');
}

console.log('\n=========================================');
console.log('Results: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed === 0 ? 0 : 1);
