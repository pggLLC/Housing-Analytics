'use strict';

/**
 * economic-dashboard must not render the ACS jam value as money.
 *
 * js/census-geo.js guarded its three formatters with isFinite(n). Number(null)
 * is 0 and isFinite(0) is true, so a missing median rendered "$0"; and
 * -666666666 -- the ACS "not available" jam value -- is finite, so it rendered
 * "-$666,666,666" under the label "ACS 2023 · [Source]", with no console error.
 *
 * Observed live on cohoanalytics.com before this fix: 8 of the first 22
 * Colorado places (Aguilar, Air Force Academy, Alpine, Amherst, Arapahoe,
 * Arboles, Aspen Park, Atwood). 170 of Colorado's 547 place/county ACS
 * profiles have no published median gross rent.
 *
 * Two things had to change together: the formatters, and the upstream
 * Number(record[field]) coercion that turned a null into a real 0 before any
 * formatter could see it.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'js', 'census-geo.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'economic-dashboard.html'), 'utf8');
const money = require(path.join(root, 'js', 'utils', 'format-money.js'));

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { passed++; console.log('  ✅ PASS: ' + msg); }
  else { failed++; console.log('  ❌ FAIL: ' + msg); }
}

console.log('[test] census-geo: the ACS jam value is absence, not money');

// 1. No formatter may gate on bare isFinite() again.
const isFiniteGuards = (src.match(/return isFinite\(n\)\s*\?/g) || []).length;
check(isFiniteGuards === 0,
  'no formatter guards on bare isFinite(n) (found ' + isFiniteGuards + ')');

// 2. All three formatters route through the shared absence test.
for (const fn of ['formatNumber', 'formatCurrency', 'formatPct']) {
  const m = new RegExp('function ' + fn + '\\s*\\([^)]*\\)\\s*\\{[^}]*_absent\\(');
  check(m.test(src), fn + '() checks _absent() before formatting');
}

// 3. The upstream coercion must not pre-convert null to 0.
check(!/const val\s*=\s*Number\(record\[/.test(src),
  'record values are passed raw, not through Number() (which makes null a real 0)');

// 4. The helper must be loaded before census-geo.js on the page that uses it.
const iHelper = html.indexOf('js/utils/format-money.js');
const iGeo = html.indexOf('js/census-geo.js');
check(iHelper !== -1, 'economic-dashboard.html loads js/utils/format-money.js');
check(iHelper !== -1 && iGeo !== -1 && iHelper < iGeo,
  'format-money.js is loaded BEFORE census-geo.js');

// 5. The contract itself, including the string form the API actually returns.
const abs = [null, undefined, '', NaN, -666666666, '-666666666', '-666666666.0'];
abs.forEach(function (v) {
  check(money.isAbsent(v) === true, JSON.stringify(v) + ' is treated as absent');
});
check(money.isAbsent(0) === false, '0 is a real value, not absence');
check(money.formatMoney(0) === '$0', 'a real zero still renders as $0');
check(money.formatMoney(1795) === '$1,795', 'a real median still renders');

console.log('\nResults: ' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exit(1);
