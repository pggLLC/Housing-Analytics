// test/unit-mix-validation.test.js
//
// Source-grep tests verifying the three-state unit-mix integrity check
// is wired into BOTH the Deal Calculator and the Market Analysis PMA
// capture-rate simulator.
//
// What we're enforcing:
//   1. Both sites detect amiSum > totalUnits (HARD ERROR, red panel)
//   2. Both sites detect amiSum < totalUnits (INFO, blue panel,
//      surfaces the unrestricted market-rate unit count)
//   3. Both sites hide the panel when amiSum === totalUnits
//   4. Deal Calculator zeros annualRents on hard error to suppress
//      misleading downstream NOI/equity numbers
//   5. Market Analysis short-circuits the capture-rate simulator on
//      hard error (shows placeholder rather than misleading capture %)
//   6. Market Analysis HTML has a #pma-units-sync-warn container
//
// Run: node test/unit-mix-validation.test.js
//
// We use source-grep (not full DOM simulation) because the validation
// logic is a single function in each file and the DOM wiring is a
// separate concern verified by the smoke test.

'use strict';

const fs   = require('fs');
const path = require('path');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log('  ✅ PASS: ' + message);
    passed++;
  } else {
    console.error('  ❌ FAIL: ' + message);
    failed++;
  }
}

function readRel(rel) {
  return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
}

console.log('\n[test] Deal Calculator: three-state unit-mix indicator');
const dcSrc = readRel('js/deal-calculator.js');
assert(
  /amiUnitSum\s*>\s*units/.test(dcSrc),
  'Deal Calculator detects AMI sum > total (HARD ERROR branch)'
);
assert(
  /amiUnitSum\s*<\s*units/.test(dcSrc),
  'Deal Calculator detects AMI sum < total (INFO branch)'
);
assert(
  /unrestricted market-rate unit/i.test(dcSrc),
  'Deal Calculator surfaces unrestricted market-rate unit count'
);
assert(
  /unitMixError\s*=\s*true/.test(dcSrc),
  'Deal Calculator sets unitMixError flag on hard-error path'
);
assert(
  /if\s*\(\s*unitMixError\s*\)\s*\{[\s\S]{0,200}annualRents\s*=\s*0/.test(dcSrc),
  'Deal Calculator zeros annualRents when unit mix is broken'
);

console.log('\n[test] Market Analysis: three-state unit-mix indicator');
const maSrc = readRel('js/market-analysis.js');
assert(
  /function\s+validateUnitMix\s*\(\s*\)/.test(maSrc),
  'Market Analysis defines validateUnitMix() helper'
);
assert(
  /amiSum\s*>\s*total/.test(maSrc),
  'Market Analysis detects AMI sum > total (HARD ERROR branch)'
);
assert(
  /amiSum\s*<\s*total/.test(maSrc),
  'Market Analysis detects AMI sum < total (INFO branch)'
);
assert(
  /unrestricted market-rate unit/i.test(maSrc),
  'Market Analysis surfaces unrestricted market-rate unit count'
);
assert(
  /Capture rate unavailable/i.test(maSrc),
  'Market Analysis short-circuits simulator on hard error'
);
assert(
  /addEventListener\(['"]input['"][\s\S]{0,120}validateUnitMix\s*\(\s*\)/.test(maSrc),
  'Market Analysis runs validateUnitMix() on input event'
);

console.log('\n[test] Market Analysis HTML container present');
const maHtml = readRel('market-analysis.html');
assert(
  /id="pma-units-sync-warn"/.test(maHtml),
  'market-analysis.html contains #pma-units-sync-warn container'
);
assert(
  /role="status"[^>]*aria-live="polite"/.test(maHtml) ||
    /aria-live="polite"[^>]*role="status"/.test(maHtml),
  'Sync indicator has accessible role+aria-live (live region)'
);

console.log('\n[test] Both sites use consistent visual styling');
assert(
  dcSrc.includes('#fee2e2') && maSrc.includes('#fee2e2'),
  'Both sites use the same red-50 error background (#fee2e2)'
);
assert(
  dcSrc.includes('#eff6ff') && maSrc.includes('#eff6ff'),
  'Both sites use the same blue-50 info background (#eff6ff)'
);

console.log('\n=========================================');
console.log('Results: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed === 0 ? 0 : 1);
