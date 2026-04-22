# `scripts/validate_hna_pages.js`

## Symbols

### `hasSentinel(val)`

scripts/validate_hna_pages.js

HNA page smoke-test and sentinel-leak validator.

Runs two complementary validation modes:

 1. **Static checks** (always run, no browser required)
    • HNA HTML pages exist and declare required elements / scripts
    • JS utility files (data-quality.js, hna-utils.js, …) are present
    • All <canvas> elements carry role="img" and aria-label
    • aria-live regions are present on interactive HNA pages
    • Spot-check of data/hna/summary/*.json for leaked sentinel values
    • Ranking-index.json and geo-config.json have expected structure

 2. **Browser checks** (opt-in, requires Playwright)
    • HNA pages load without JavaScript console errors
    • Missing-metric cells render as "—" (em-dash), not "-666,666,666"
    • Data-quality warning badges appear for incomplete geographies
    • Ranking table renders with ≥1 row
    Pass `--browser` to enable.

Usage
-----
  node scripts/validate_hna_pages.js              # static checks only
  node scripts/validate_hna_pages.js --browser    # static + browser
  node scripts/validate_hna_pages.js --url http://localhost:3000  # custom base URL

Exit codes
----------
  0   All enabled checks passed.
  1   One or more checks failed.
/

'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// CLI flags
// ---------------------------------------------------------------------------
const args       = process.argv.slice(2);
const RUN_BROWSER = args.includes('--browser');
const BASE_URL    = (() => {
  const idx = args.indexOf('--url');
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : 'http://localhost:3000';
})();

// ---------------------------------------------------------------------------
// Counters & helpers
// ---------------------------------------------------------------------------
let passed   = 0;
let failed   = 0;
let warnings = 0;

function pass(msg)  { console.log(`  ✅ PASS: ${msg}`);  passed++;   }
function fail(msg)  { console.error(`  ❌ FAIL: ${msg}`); failed++;   }
function warn(msg)  { console.warn(`  ⚠️  WARN: ${msg}`);  warnings++; }

function exists(rel)    { return fs.existsSync(path.join(ROOT, rel)); }
function read(rel)      { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }
function parseJSON(rel) { return JSON.parse(read(rel)); }

function section(title) { console.log(`\n── ${title} ──`); }

// ---------------------------------------------------------------------------
// 1. Required files
// ---------------------------------------------------------------------------
section('1. Required HNA pages & JS files');

const REQUIRED_FILES = [
  'housing-needs-assessment.html',
  'hna-comparative-analysis.html',
  'js/utils/data-quality.js',
  'js/hna/hna-utils.js',
  'js/hna/hna-controller.js',
  'js/hna/hna-ranking-index.js',
  'js/hna/hna-renderers.js',
  'css/pages/hna-comparative-analysis.css',
  'data/hna/ranking-index.json',
  'data/hna/geo-config.json',
];

REQUIRED_FILES.forEach(rel => {
  if (exists(rel)) pass(`${rel} exists`);
  else             fail(`${rel} is missing`);
});

// ---------------------------------------------------------------------------
// 2. HNA main page structure
// ---------------------------------------------------------------------------
section('2. housing-needs-assessment.html — structure');

if (exists('housing-needs-assessment.html')) {
  const html = read('housing-needs-assessment.html');

  const checks = [
    { re: /data-quality\.js/,                            label: 'includes data-quality.js' },
    { re: /hna-utils\.js/,                               label: 'includes hna-utils.js' },
    { re: /hna-controller\.js/,                          label: 'includes hna-controller.js' },
    { re: /<main[^>]+id=["']main-content["']/i,          label: '<main id="main-content"> present' },
    { re: /aria-live=["']polite["']/,                     label: 'aria-live="polite" region present' },
    { re: /href=["']#main-content["']/,                   label: 'skip-navigation link to #main-content' },
  ];

  checks.forEach(({ re, label }) => {
    if (re.test(html)) pass(label);
    else               fail(`housing-needs-assessment.html: ${label}`);
  });

  // Landmark checks — warn only (pre-existing issue tracked separately)
  [/<header\b/i, /<footer\b/i].forEach((re, i) => {
    const tag = i === 0 ? '<header>' : '<footer>';
    if (re.test(html)) pass(`${tag} landmark present`);
    else               warn(`housing-needs-assessment.html missing ${tag} landmark (pre-existing; see Rule 12)`);
  });

  // Canvas elements must have role="img" and aria-label
  const canvasCount = (html.match(/<canvas\b/gi) || []).length;
  const accessibleCanvas = (html.match(/<canvas[^>]+role=["']img["'][^>]*aria-label/gi) || []).length;
  if (canvasCount === 0) {
    warn('No <canvas> elements found in housing-needs-assessment.html');
  } else if (accessibleCanvas >= canvasCount) {
    pass(`All ${canvasCount} <canvas> element(s) have role="img" + aria-label`);
  } else {
    fail(`${canvasCount - accessibleCanvas} <canvas> element(s) missing role="img" or aria-label`);
  }
} else {
  warn('housing-needs-assessment.html not found — skipping structural checks');
}

// ---------------------------------------------------------------------------
// 3. HNA comparative analysis page structure
// ---------------------------------------------------------------------------
section('3. hna-comparative-analysis.html — structure');

if (exists('hna-comparative-analysis.html')) {
  const html = read('hna-comparative-analysis.html');

  const checks = [
    { re: /data-quality\.js/,       label: 'includes data-quality.js' },
    { re: /hna-ranking-index\.js/,  label: 'includes hna-ranking-index.js' },
    { re: /<main\b/i,               label: '<main> landmark present' },
    { re: /aria-live=["']polite["']/,label: 'aria-live region present' },
  ];

  checks.forEach(({ re, label }) => {
    if (re.test(html)) pass(label);
    else               fail(`hna-comparative-analysis.html: ${label}`);
  });
} else {
  warn('hna-comparative-analysis.html not found — skipping checks');
}

// ---------------------------------------------------------------------------
// 4. data-quality.js API surface
// ---------------------------------------------------------------------------
section('4. js/utils/data-quality.js — API surface');

if (exists('js/utils/data-quality.js')) {
  const src = read('js/utils/data-quality.js');

  const apis = [
    { re: /isMissingMetric/,  label: 'exports isMissingMetric()' },
    { re: /sanitizeNumber/,   label: 'exports sanitizeNumber()' },
    { re: /formatMetric/,     label: 'exports formatMetric()' },
    { re: /666666666/,        label: 'declares sentinel constant (-666666666)' },
  ];

  apis.forEach(({ re, label }) => {
    if (re.test(src)) pass(label);
    else              fail(`data-quality.js: ${label}`);
  });
}

// ---------------------------------------------------------------------------
// 5. Sentinel leak: spot-check summary JSON files
// ---------------------------------------------------------------------------
section('5. Sentinel leak check — data/hna/summary/*.json');

const SENTINEL          = -666666666;
const EXTREME_NEGATIVE  = -1_000_000;
const SUMMARY_DIR       = path.join(ROOT, 'data', 'hna', 'summary');

if (fs.existsSync(SUMMARY_DIR)) {
  const summaryFiles = fs.readdirSync(SUMMARY_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => path.join(SUMMARY_DIR, f));

  let leakFiles  = [];
  let cleanFiles = 0;

  /**
Recursively walk any JSON value; return true if a sentinel is found.
@param {*} val
@returns {boolean}
