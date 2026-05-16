'use strict';
/**
 * test/deal-calc-workflow-prefill.test.js
 *
 * Regression for 2026-05-16: Deal Calculator and PMA UI controller
 * both looked up the user's project county from a non-existent
 * `jx.countyFips` field. WorkflowState / select-jurisdiction.js /
 * HNA all write the county FIPS to `jx.fips` — there's no
 * `countyFips` field anywhere in the schema. So the county
 * pre-selection silently no-op'd: a user who picked Adams County on
 * Step 1 still landed on Deal Calc with the dropdown sitting on
 * "Select a county…".
 *
 * What this asserts (source-grep):
 *   - Neither file references the legacy `jx.countyFips` /
 *     `_jx.countyFips` field in executable code.
 *   - Both files use `jx.fips` / `_jx.fips` instead.
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

console.log('\n[test] deal-calculator.js reads jx.fips (not jx.countyFips)');
const dcExec = execOnly(dc);
assert(!/_jx\.countyFips|jx\.countyFips/.test(dcExec),
  'no executable references to the bogus jx.countyFips field');
assert(/_jx\s*&&\s*_jx\.fips\s*\)\s*fips\s*=\s*_jx\.fips/.test(dcExec),
  'pre-selection lookup uses _jx.fips correctly');

console.log('\n[test] pma-ui-controller.js reads jx.fips (not jx.countyFips)');
const pmaExec = execOnly(pma);
assert(!/_jx\.countyFips|jx\.countyFips/.test(pmaExec),
  'no executable references to the bogus jx.countyFips field');
assert(/_jx\s*&&\s*_jx\.fips\s*\)\s*countyFips\s*=\s*_jx\.fips/.test(pmaExec),
  'CHFA-awards / AMI-gap wiring uses _jx.fips correctly');

console.log('\n=========================================');
console.log('Results: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed === 0 ? 0 : 1);
