// test/source-url-sweep-skip-templates.test.js
//
// Regression for the 2026-05-14 fix: shouldSkip must run on the *raw*
// URL before normalizeUrl(), because `new URL().toString()` percent-
// encodes `${...}` into `$%7B...%7D`, which breaks the `\${/` skip
// pattern. Without the raw-URL pre-filter, GitHub Actions template
// literals like `https://github.com/${context.repo.owner}/...` leak
// through and surface as bogus 404s in CI.
//
// What it asserts:
//   - SKIP_PATTERNS contains the `\${/` template-literal pattern
//   - The pre-filter (`.filter(...).map(...).filter(...)`) is present
//     in main() so shouldSkip sees raw URLs before normalization
//
// Run: node test/source-url-sweep-skip-templates.test.js
//
// Why source-grep (not an integration test): the script's main()
// reads the live repo and hits the network; a unit test against
// extracted helpers would require refactoring for export. The grep
// guard is enough to keep this fix from regressing silently.

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
  path.join(__dirname, '..', 'scripts/audit/source-url-sweep.mjs'),
  'utf8'
);

console.log('\n[test] sweep skip-template-URLs regression');

// 1. The template-literal skip pattern is still in SKIP_PATTERNS
assert(/\/\\\$\\\{\/,/.test(src) || /\/\\\$\\\{\//.test(src),
  'SKIP_PATTERNS includes the `\\${` regex for template literals');

// 2. The raw-URL pre-filter is present (filter-before-map-before-filter).
//    Permissive multiline match — only verifies the chained order:
//    a `.filter(...shouldSkip...)` appears before `.map(...normalizeUrl...)`
//    which appears before another `.filter(...shouldSkip...)`. The args
//    contain parens (`!shouldSkip(u)`) so the regex has to be relaxed.
const rawFilterPattern =
  /\.filter\([\s\S]*?shouldSkip[\s\S]*?\)\s*\.map\([\s\S]*?normalizeUrl[\s\S]*?\)\s*\.filter\([\s\S]*?shouldSkip[\s\S]*?\)/;
assert(rawFilterPattern.test(src),
  'main() filters shouldSkip on raw URLs before normalizeUrl()');

// 3. Sanity: the old broken form (map-then-filter only) is gone
const oldBrokenPattern = /rawUrls\s*\n\s*\.map\(\(u\) => normalizeUrl\(u\)\)\s*\n\s*\.filter\(\(u\) => isHttpUrl\(u\) && !shouldSkip\(u\)\),?\s*\n\s*\),?\s*\n\s*\);/;
assert(!oldBrokenPattern.test(src),
  'old map-then-filter-only form is removed');

console.log('\n=========================================');
console.log('Results: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed === 0 ? 0 : 1);
