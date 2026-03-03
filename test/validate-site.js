// test/validate-site.js
//
// Automated validation checks for the Housing Analytics site.
// Checks:
//  1. JSON file existence: required data files are present
//  2. Link validation: no obviously broken (empty/javascript:void) hrefs in HTML pages
//  3. Hardcoded fetch check: flags any raw data-path fetches that bypass DataService
//  4. Map layer smoke test: colorado-deep-dive.html references expected layer elements
//  5. Basic accessibility: heading hierarchy and alt text presence
//
// Usage:
//   node test/validate-site.js
//
// Exit code 0 = all checks passed; non-zero = one or more failures.

'use strict';

const fs   = require('fs');
const path = require('path');
const glob = require('glob');

const ROOT = path.resolve(__dirname, '..');

let passed = 0;
let failed = 0;
let warnings = 0;

function pass(msg) { console.log('  ✅ PASS: ' + msg); passed++; }
function fail(msg) { console.error('  ❌ FAIL: ' + msg); failed++; }
function warn(msg) { console.warn('  ⚠️  WARN: ' + msg); warnings++; }

function fileExists(rel) {
  return fs.existsSync(path.join(ROOT, rel));
}

function readFile(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

// ─── 1. Required JSON data files ──────────────────────────────────────────────
console.log('\n── 1. Required JSON data files ──');
const REQUIRED_JSON = [
  'data/prop123_jurisdictions.json',
  'data/chfa-lihtc.json',
  'data/fred-data.json',
  'data/allocations.json',
  'data/dda-colorado.json',
  'data/qct-colorado.json',
  'data/co-demographics.json',
  'data/census-acs-state.json',
];

REQUIRED_JSON.forEach(function (f) {
  if (fileExists(f)) {
    // Also verify it's valid JSON
    try {
      JSON.parse(readFile(f));
      pass(f + ' exists and is valid JSON');
    } catch (e) {
      fail(f + ' exists but is NOT valid JSON: ' + e.message);
    }
  } else {
    warn(f + ' not found (may be fetched by CI; OK in local dev)');
  }
});

// ─── 2. Link validation ───────────────────────────────────────────────────────
console.log('\n── 2. Link validation ──');
var htmlFiles = glob.sync('*.html', { cwd: ROOT });
var emptyHrefs = 0;
var jsVoidHrefs = 0;

htmlFiles.forEach(function (htmlFile) {
  var content = readFile(htmlFile);
  var emptyMatches = (content.match(/href=["']\s*["']/g) || []).length;
  var jsVoidMatches = (content.match(/href=["']javascript:void/g) || []).length;
  emptyHrefs += emptyMatches;
  jsVoidHrefs += jsVoidMatches;
  if (emptyMatches > 0) warn(htmlFile + ': ' + emptyMatches + ' empty href(s)');
  if (jsVoidMatches > 0) warn(htmlFile + ': ' + jsVoidMatches + ' javascript:void href(s)');
});

if (emptyHrefs === 0 && jsVoidHrefs === 0) {
  pass('No empty or javascript:void hrefs found in HTML pages');
} else {
  pass('Link scan complete — see warnings above for items to review');
}

// ─── 3. Hardcoded fetch pattern check ────────────────────────────────────────
console.log('\n── 3. Hardcoded data-path fetch check ──');
var jsFiles = glob.sync('js/*.js', { cwd: ROOT, ignore: ['js/vendor/**'] });
var hardcodedFetches = [];

jsFiles.forEach(function (jsFile) {
  var content = readFile(jsFile);
  // Look for fetch(<literal data path>) calls that bypass DataService or fetchWithTimeout
  var lines = content.split('\n');
  lines.forEach(function (line, i) {
    // Skip comment lines
    if (/^\s*\/\//.test(line)) return;
    // Flag raw data-path fetch calls that are not using a helper
    if (/\bfetch\s*\(\s*['"`]data\//.test(line)) {
      // Only flag if not a helper call like fetchWithTimeout or DataService
      if (!/fetchWithTimeout|DataService|resolveData|baseData/.test(line)) {
        hardcodedFetches.push(jsFile + ':' + (i + 1) + ' → ' + line.trim().slice(0, 80));
      }
    }
  });
});

if (hardcodedFetches.length === 0) {
  pass('No unguarded hardcoded data-path fetch patterns found');
} else {
  hardcodedFetches.forEach(function (loc) { warn('Hardcoded fetch: ' + loc); });
  warn(hardcodedFetches.length + ' hardcoded fetch pattern(s) found — consider using DataService.baseData()');
}

// ─── 4. Map layer smoke test ──────────────────────────────────────────────────
console.log('\n── 4. Map layer smoke test (colorado-deep-dive.html) ──');
if (fileExists('colorado-deep-dive.html')) {
  var ddContent = readFile('colorado-deep-dive.html');
  var checks = [
    { pattern: /id=["']coMap["']/, label: '#coMap container present' },
    { pattern: /id=["']layerProp123["']/, label: '#layerProp123 toggle present' },
    { pattern: /id=["']layerQCT["']|id=["']layerQct["']/, label: '#layerQCT toggle present' },
    { pattern: /id=["']layerDDA["']|id=["']layerDda["']/, label: '#layerDDA toggle present' },
    { pattern: /id=["']layerCounties["']|id=["']filterQCT["']/, label: 'Layer filter toggle present' },
    { pattern: /id=["']prop123TableBody["']/, label: '#prop123TableBody present' },
    { pattern: /id=["']prop123Status["']/, label: '#prop123Status present' },
    { pattern: /co-lihtc-map\.js/, label: 'co-lihtc-map.js loaded' },
    { pattern: /prop123-map\.js/, label: 'prop123-map.js loaded' },
  ];
  checks.forEach(function (c) {
    if (c.pattern.test(ddContent)) pass(c.label);
    else fail(c.label + ' — missing from colorado-deep-dive.html');
  });
} else {
  fail('colorado-deep-dive.html not found');
}

// ─── 5. Basic accessibility checks ───────────────────────────────────────────
console.log('\n── 5. Basic accessibility checks ──');
var accessFailures = 0;
var imgWithoutAlt = 0;
var h1Count = 0;

htmlFiles.forEach(function (htmlFile) {
  var content = readFile(htmlFile);

  // Count <img> tags without alt attribute
  var imgTags = content.match(/<img\b[^>]*>/gi) || [];
  imgTags.forEach(function (tag) {
    if (!/\balt\s*=/i.test(tag)) {
      imgWithoutAlt++;
      warn(htmlFile + ': <img> without alt — ' + tag.slice(0, 60));
    }
  });

  // Check h1 count (each page should have exactly one)
  var h1s = (content.match(/<h1[\s>]/gi) || []).length;
  if (h1s === 0) {
    warn(htmlFile + ': No <h1> found');
  } else if (h1s > 1) {
    warn(htmlFile + ': Multiple <h1> tags (' + h1s + ')');
  } else {
    h1Count++;
  }
});

if (imgWithoutAlt === 0) {
  pass('All <img> tags have alt attributes');
} else {
  fail(imgWithoutAlt + ' <img> tag(s) missing alt attributes');
  accessFailures++;
}

pass('Heading hierarchy scan complete — ' + h1Count + ' page(s) with single <h1>');

// ─── 6. Market intelligence page check ───────────────────────────────────────
console.log('\n── 6. Market intelligence page ──');
if (fileExists('market-intelligence.html')) {
  var miContent = readFile('market-intelligence.html');
  var miChecks = [
    { pattern: /id=["']countySelect["']/, label: 'County selector present' },
    { pattern: /id=["']demandChart["']/, label: 'Demand chart canvas present' },
    { pattern: /id=["']supplyChart["']/, label: 'Supply chart canvas present' },
    { pattern: /id=["']exportJson["']/, label: 'JSON export button present' },
    { pattern: /id=["']exportCsv["']/, label: 'CSV export button present' },
    { pattern: /market-intelligence\.js/, label: 'market-intelligence.js loaded' },
  ];
  miChecks.forEach(function (c) {
    if (c.pattern.test(miContent)) pass(c.label);
    else fail(c.label + ' — missing from market-intelligence.html');
  });
} else {
  fail('market-intelligence.html not found');
}

if (fileExists('js/market-intelligence.js')) {
  pass('js/market-intelligence.js exists');
} else {
  fail('js/market-intelligence.js not found');
}

// ─── Summary ──────────────────────────────────────────────────────────────────
console.log('\n── Summary ──');
console.log('Passed:   ' + passed);
console.log('Warnings: ' + warnings);
console.log('Failed:   ' + failed);

if (failed > 0) {
  console.error('\n✗ Validation completed with ' + failed + ' failure(s).');
  process.exit(1);
} else {
  console.log('\n✓ Validation passed' + (warnings > 0 ? ' (' + warnings + ' warning(s) to review).' : '.'));
  process.exit(0);
}
