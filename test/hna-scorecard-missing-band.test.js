// test/hna-scorecard-missing-band.test.js
//
// 2026-11-04 practitioner QA (F7): the need scorecard's deep-need share
// counted a missing CHAS income band as 0, so a missing lowest band read as a
// measured 0% and a missing middle band shrank the denominator. A missing band
// now makes the share unavailable; a reported 0 stays 0.
//
// Run: node test/hna-scorecard-missing-band.test.js
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

// The computation moved to js/hna/need-scorecard.js, shared with the place hub (closeout ledger P04).
const src = fs.readFileSync(path.join(__dirname, '..', 'js/hna/need-scorecard.js'), 'utf8');
const start = src.indexOf('  function _scorecardComponents(rec, shape) {');
assert.ok(start !== -1, '_scorecardComponents is in need-scorecard.js');
const end = src.indexOf('\n  }\n', start) + 4;
const components = new Function(src.slice(start, end) + '\nreturn _scorecardComponents;')();

const rec = (bands) => ({ summary: { total_renter_hh: 100, total_owner_hh: 100, pct_renter_cb30: 40, pct_owner_cb30: 20, pct_renter_cb50: 20 },
  renter_hh_by_ami: Object.fromEntries(Object.entries(bands).map(([k, v]) => [k, v === undefined ? {} : { total: v }])) });
let passed = 0;
const check = (cond, msg) => { assert.ok(cond, msg); console.log('  ✅ PASS: ' + msg); passed++; };

check(components(rec({ lte30: 15, '31to50': 25, '51to80': 30, '81to100': 30 }), 'county').deepNeed === 0.15, 'measured bands: 15 of 100 is 0.15');
check(components(rec({ lte30: 0, '31to50': 25, '51to80': 30, '81to100': 45 }), 'county').deepNeed === 0, 'a reported zero lowest band stays 0');
check(components(rec({ lte30: undefined, '31to50': 25, '51to80': 30, '81to100': 45 }), 'county').deepNeed === null, 'a missing lowest band is unavailable, not 0%');
check(components(rec({ lte30: 15, '31to50': undefined, '51to80': 30, '81to100': 45 }), 'county').deepNeed === null, 'a missing middle band is unavailable, not a smaller denominator');
check(components(rec({ lte30: 15, '31to50': null, '51to80': 30, '81to100': 45 }), 'county').deepNeed === null, 'a null band is unavailable');
console.log(`\n${passed} passed`);
