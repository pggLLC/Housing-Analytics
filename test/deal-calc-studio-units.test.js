'use strict';

/**
 * Studio units must be enterable, not just priceable.
 *
 * The per-tier bedroom split was hardcoded ['1br','2br','3br','4br'] at six
 * separate call sites, while studio was present in the tier <select>, in
 * _amiLimitsByBr, and in getZoriPerBrRent. The result: the calculator showed a
 * studio rent limit for a band but offered no input to put studio units in it.
 * Audit item 19.
 *
 * These are source-level assertions on the invariant that caused the bug --
 * one shared list rather than six literals -- plus a check that studio reaches
 * the rent lookups.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'js', 'deal-calculator.js'), 'utf8');

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { passed++; console.log('  ✅ PASS: ' + msg); }
  else { failed++; console.log('  ❌ FAIL: ' + msg); }
}

console.log('[test] deal calculator: studio units are enterable');

// 1. The shared constant exists and includes studio.
const m = src.match(/var SPLIT_BR_TYPES\s*=\s*\[([^\]]*)\]/);
check(!!m, 'SPLIT_BR_TYPES is defined');
if (m) {
  const list = m[1].split(',').map(s => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
  check(list[0] === 'studio', 'studio is the first entry in SPLIT_BR_TYPES (got "' + list[0] + '")');
  ['studio', '1br', '2br', '3br', '4br'].forEach(function (br) {
    check(list.indexOf(br) !== -1, 'SPLIT_BR_TYPES includes ' + br);
  });
}

// 2. The duplicated literal that drifted must not come back.
const stale = (src.match(/\[\s*'1br'\s*,\s*'2br'\s*,\s*'3br'\s*,\s*'4br'\s*\]/g) || []).length;
check(stale === 0, 'no hardcoded 1br-4br split list remains (found ' + stale + ')');

// 3. It is actually used at the sites that build inputs, wire listeners and sum counts.
const uses = (src.match(/SPLIT_BR_TYPES/g) || []).length;
check(uses >= 7, 'SPLIT_BR_TYPES used at every former call site (' + uses + ' references)');

// 4. The split accumulator must not reintroduce a fixed shape.
check(!/var out = \{ '1br': 0/.test(src),
  '_tierSplitCounts seeds its accumulator from SPLIT_BR_TYPES, not a literal');

// 5. Studio must have somewhere to get a rent from, or the units price at zero.
check(/'studio':\s*Math\.round/.test(src), 'getZoriPerBrRent returns a studio rent');
check(/studio/.test(src.slice(src.indexOf('_amiLimitsByBr'))), '_amiLimitsByBr carries a studio key');

// 6. The five-column grid must not be pinned to four.
check(!/grid-template-columns:repeat\(4,minmax\(0,1fr\)\);gap:0\.35rem/.test(src),
  'per-bedroom grid is not hardcoded to 4 columns');

console.log('\nResults: ' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exit(1);
