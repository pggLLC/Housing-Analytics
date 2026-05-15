// test/hna-extended-fetch-tenure.test.js
//
// Tiny regression test for the 2026-05-12 fix that added DP04_0002E,
// DP04_0003E, and DP04_0046E to fetchAcsExtended's batchA variable
// list. Without these, the cached summary files served on initial
// page load were missing the fields chartTenure's count-then-percent
// fallback chain depends on for the owner slice.
//
// What it asserts:
//   - fetchAcsExtended's batchA contains the three supplement codes
//   - batchA stays under the ACS API's 50-variable limit
//   - The structure-type and bedroom-mix code groups remain intact
//
// Run: node test/hna-extended-fetch-tenure.test.js

'use strict';

const fs   = require('fs');
const path = require('path');

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) { console.log('  ✅ PASS: ' + msg); passed++; }
  else { console.error('  ❌ FAIL: ' + msg); failed++; }
}

const src = fs.readFileSync(
  path.join(__dirname, '..', 'js/hna/hna-controller.js'),
  'utf8'
);

// Extract the batchA array literal
const m = src.match(/var batchA = \[([\s\S]*?)\];/);
assert(m != null, 'batchA literal found in hna-controller.js');

if (m) {
  const body = m[1];
  const codes = (body.match(/'DP0\d_\d{4}P?E'/g) || []).map(s => s.replace(/'/g, ''));
  const unique = Array.from(new Set(codes));
  assert(unique.length <= 50,
    `batchA stays under ACS 50-var limit (${unique.length} unique codes)`);

  ['DP04_0002E', 'DP04_0003E', 'DP04_0046E'].forEach(code => {
    assert(codes.includes(code),
      'batchA includes ' + code);
  });

  // Sanity: didn't accidentally lose the structure-type or bedroom-mix groups
  ['DP04_0007E','DP04_0014E'].forEach(code => {
    assert(codes.includes(code),
      'structure-type code ' + code + ' still in batchA');
  });
  ['DP04_0039E','DP04_0044E'].forEach(code => {
    assert(codes.includes(code),
      'bedroom-mix code ' + code + ' still in batchA');
  });
}

console.log('\n=========================================');
console.log('Results: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed === 0 ? 0 : 1);
