'use strict';
/**
 * test/deal-calc-workflow-prefill.test.js
 *
 * Regression for 2026-05-16 plus GEO-1: Deal Calculator must preselect
 * from the canonical countyFips when a place/CDP is active, while still
 * falling back to legacy jx.fips for older projects.
 *
 * What this asserts (source-grep):
 *   - Deal Calculator reads workflowCtx.countyFips and falls back to jx.fips.
 *   - PMA still reads jx.fips on its legacy path.
 *
 * Run: node test/deal-calc-workflow-prefill.test.js
 */

const fs   = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { console.log('  ✅ PASS:', msg); passed++; }
  else       { console.error('  ❌ FAIL:', msg); failed++; }
}

function execOnly(src) {
  return src
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
}

const root = path.join(__dirname, '..');
const dc   = fs.readFileSync(path.join(root, 'js/deal-calculator.js'),    'utf8');
const pma  = fs.readFileSync(path.join(root, 'js/pma-ui-controller.js'),  'utf8');

console.log('\n[test] deal-calculator.js reads canonical countyFips before legacy fips');
const dcExec = execOnly(dc);
assert(/workflowCtx\.countyFips/.test(dcExec),
  'pre-selection lookup uses canonical workflowCtx.countyFips');
assert(/_jx\s*&&\s*_jx\.fips\s*\)\s*fips\s*=\s*_jx\.fips/.test(dcExec),
  'pre-selection lookup still falls back to _jx.fips for legacy projects');

console.log('\n[test] pma-ui-controller.js reads jx.fips (not jx.countyFips)');
const pmaExec = execOnly(pma);
assert(!/_jx\.countyFips|jx\.countyFips/.test(pmaExec),
  'no executable references to the bogus jx.countyFips field');
assert(/_jx\s*&&\s*_jx\.fips\s*\)\s*countyFips\s*=\s*_jx\.fips/.test(pmaExec),
  'CHFA-awards / AMI-gap wiring uses _jx.fips correctly');

console.log('\n=========================================');
console.log('Results: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed === 0 ? 0 : 1);
