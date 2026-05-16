// test/hna-rent-burden-bins.test.js
//
// Regression for 2026-05-15 fix: renderRentBurdenBins was reading
// DP04_0136E..DP04_0141E (count fields), but the cached summary and
// fetchAcsExtended only populate DP04_0137PE..DP04_0142PE (percent
// fields). Every bar rendered as zero — chart looked broken in the
// browser, but the test suite passed because nothing actually
// validated which codes the renderer consumed.
//
// What it asserts:
//   - The renderer's `bins` array uses the 6 PE codes that are
//     actually populated by the data pipeline
//   - The codes that fetchAcsExtended.batchA fetches (DP04_0141PE,
//     DP04_0142PE) are still represented in the renderer
//   - Sample summary file 08001.json carries the PE fields (cache
//     parity check — catches data-pipeline regressions too)
//
// Run: node test/hna-rent-burden-bins.test.js

'use strict';

const fs   = require('fs');
const path = require('path');

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) { console.log('  ✅ PASS: ' + msg); passed++; }
  else { console.error('  ❌ FAIL: ' + msg); failed++; }
}

const REND_SRC = fs.readFileSync(
  path.join(__dirname, '..', 'js/hna/hna-renderers.js'),
  'utf8'
);

console.log('\n[test] renderRentBurdenBins uses ACS 2023 PE codes');

// Extract the bins array inside renderRentBurdenBins
const fnMatch = REND_SRC.match(
  /function renderRentBurdenBins\([\s\S]*?const bins = \[([\s\S]*?)\];/
);
assert(fnMatch != null, 'renderRentBurdenBins() found with bins literal');

if (fnMatch) {
  const binsBody = fnMatch[1];
  const codes = (binsBody.match(/'DP04_\d{4}PE?'/g) || []).map(s => s.replace(/'/g, ''));

  ['DP04_0137PE','DP04_0138PE','DP04_0139PE','DP04_0140PE','DP04_0141PE','DP04_0142PE']
    .forEach(c => {
      assert(codes.includes(c), 'bins use ' + c);
    });

  // The old broken count-codes should be gone
  ['DP04_0136E','DP04_0137E','DP04_0140E','DP04_0141E']
    .forEach(c => {
      assert(!codes.includes(c),
        'legacy count code ' + c + ' is no longer in bins');
    });

  // Y-axis tick callback should emit a percent suffix (post-fix change)
  const yCallback = REND_SRC.match(
    /function renderRentBurdenBins[\s\S]*?ticks:\s*\{\s*color:\s*t\.muted,\s*callback:\s*v\s*=>\s*`\$\{v\}%`/
  );
  assert(yCallback != null,
    'y-axis ticks callback formats values with `%` suffix');
}

console.log('\n[test] cache parity — sample summary has the PE fields');
const sampleSummary = path.join(__dirname, '..', 'data/hna/summary/08001.json');
if (fs.existsSync(sampleSummary)) {
  const parsed = JSON.parse(fs.readFileSync(sampleSummary, 'utf8'));
  const ap = (parsed && parsed.acsProfile) || {};
  ['DP04_0137PE','DP04_0138PE','DP04_0139PE','DP04_0140PE','DP04_0141PE','DP04_0142PE']
    .forEach(c => {
      assert(Object.prototype.hasOwnProperty.call(ap, c),
        '08001 acsProfile carries ' + c);
    });
} else {
  console.warn('  ⚠ data/hna/summary/08001.json not present; skipping cache parity');
}

console.log('\n=========================================');
console.log('Results: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed === 0 ? 0 : 1);
